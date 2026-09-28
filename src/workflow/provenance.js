import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { commitRange, receiptAtCommit } from "./source.js";
import { readWorkflowRun } from "./runtime.js";
import { discoverStreams } from "../loop/repo-scan.js";
import { resolveConvention, conventionForStream } from "../loop/convention.js";
import { readAuditDirectory, validateEventAuthorization } from "../governance/protocol.js";
import { reconstructLegacyReceipt } from "../governance/legacy-receipt.js";
import { readFrontMatter } from "../loop/front-matter.js";

function committedText(root, revision, file) {
  try {
    return execFileSync("git", ["-C", root, "show", `${revision}:${file}`], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
  } catch { return null; }
}

function hasCommittedEvent(root, revision, file, hash) {
  const text = committedText(root, revision, file);
  if (text === null) return false;
  return text.split("\n").some((line) => {
    try { return JSON.parse(line).eventHash === hash; }
    catch { return false; }
  });
}

function discoverRuns(root, convention) {
  const roots = [path.join(root, path.dirname(convention.statusFile)), path.join(root, convention.archiveDir)];
  const found = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = path.join(dir, entry.name);
      if (fs.existsSync(path.join(child, "workflow.lock.json"))) found.push(path.relative(root, child));
      else walk(child);
    }
  };
  roots.forEach(walk);
  return found;
}

export function checkProvenance(repoRoot, { base, head, overrides = {} }) {
  const root = path.resolve(repoRoot);
  const changes = commitRange(root, base, head);
  const receipts = new Map();
  const invalidRuns = [];
  const convention = resolveConvention(overrides);
  const runs = discoverRuns(root, convention);
  for (const dir of runs) {
    let run;
    try { run = readWorkflowRun(root, dir); } catch (error) { invalidRuns.push({ dir, reason: error.message }); continue; }
    const candidate = run.events.filter((event) => event.type === "candidate").at(-1);
    const review = run.events.filter((event) => event.type === "stage_completed" && event.payload?.stage === "review").at(-1);
    const signed = run.events.filter((event) => event.type === "stage_completed" && event.payload?.stage === "signoff").at(-1);
    const closed = run.events.filter((event) => event.type === "stage_completed" && event.payload?.stage === "close").at(-1);
    if (!candidate || !review || !signed || !closed) continue;
    const auditFile = path.join(dir, "workflow.audit.jsonl");
    // Historical receipts still explain drift, but only a close event first
    // committed in this interval may cover the current delivery.
    if (!hasCommittedEvent(root, head, auditFile, closed.eventHash)) continue;
    const inRange = !hasCommittedEvent(root, base, auditFile, closed.eventHash);
    if ([review, signed, closed].some((event) => event.payload.candidateId !== candidate.payload.candidateId)) { invalidRuns.push({ dir, reason: "候选、Review、签署或关闭关系不一致" }); continue; }
    const source = closed.payload.source;
    if (!source || JSON.stringify(source) !== JSON.stringify(candidate.payload.source)) { invalidRuns.push({ dir, reason: "关闭源码快照不匹配候选" }); continue; }
    for (const item of source.files) {
      const claims = receipts.get(item.path) ?? [];
      claims.push({ run: dir, receipt: item, closed: Boolean(closed), inRange });
      receipts.set(item.path, claims);
    }
  }
  const found = discoverStreams(root, overrides);
  const streams = found.mode === "streams" ? found.streams : [null];
  for (const stream of streams) {
    const scoped = stream ? conventionForStream(stream, overrides) : convention;
    const statusText = fs.existsSync(path.join(root, scoped.statusFile)) ? fs.readFileSync(path.join(root, scoped.statusFile), "utf8") : null;
    const status = statusText === null ? null : readFrontMatter(statusText);
    const archive = path.join(root, scoped.archiveDir);
    if (!fs.existsSync(archive)) continue;
    for (const entry of fs.readdirSync(archive, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(scoped.loopDirPrefix)) continue;
      const dir = path.join(archive, entry.name);
      const audit = readAuditDirectory(dir);
      if (!audit.exists) continue;
      if (audit.issues.length || !status?.ok || audit.events.some((event) => !validateEventAuthorization(status.meta, event))) { invalidRuns.push({ dir: path.relative(root, dir), reason: "v1 审计链或角色不可信" }); continue; }
      const review = audit.events.filter((event) => event.type === "review_completed" && event.payload?.outcome === "READY_FOR_HUMAN_REVIEW").at(-1);
      const signed = audit.events.filter((event) => event.type === "human_signed").at(-1);
      const closed = audit.events.filter((event) => event.type === "loop_closed").at(-1);
      if (!review || !signed || !closed || review.codeFingerprint !== signed.codeFingerprint || review.deliveryFingerprint !== closed.deliveryFingerprint) continue;
      const auditFile = path.relative(root, closed._file);
      if (!hasCommittedEvent(root, head, auditFile, closed.eventHash)) continue;
      const inRange = !hasCommittedEvent(root, base, auditFile, closed.eventHash);
      const rebuilt = reconstructLegacyReceipt(root, { review, statusRel: scoped.statusFile, archiveDir: scoped.archiveDir, stream });
      if (!rebuilt.ok) continue;
      for (const item of rebuilt.files) {
        const claims = receipts.get(item.path) ?? [];
        claims.push({ run: path.relative(root, dir), receipt: { ...item, kind: item.kind.replace(/^file:/, "") }, closed: true, legacy: true, inRange });
        receipts.set(item.path, claims);
      }
    }
  }
  const controlRoots = new Set([path.dirname(convention.statusFile), convention.archiveDir]);
  for (const dir of runs) {
    try { const { lock } = readWorkflowRun(root, dir); controlRoots.add(lock.controlDir); controlRoots.add(lock.archiveDir); }
    catch { /* Invalid runs are reported above; do not trust their path configuration. */ }
  }
  const deliveryChanges = changes.filter(({ path: file }) => ![...controlRoots].some((prefix) => file === prefix || file.startsWith(`${prefix}/`)));
  const rows = deliveryChanges.map(({ path: file, status }) => {
    const claims = receipts.get(file) ?? [];
    const actual = receiptAtCommit(root, head, file);
    const matching = claims.filter((claim) => claim.inRange && actual && JSON.stringify(claim.receipt) === JSON.stringify(actual));
    let classification;
    if (!claims.length) classification = "unattributed";
    else if (matching.length > 1) classification = "ambiguous";
    else if (matching.length === 1) classification = "covered";
    else classification = "drifted";
    return { path: file, status, classification, claims: claims.map((claim) => ({ run: claim.run, closed: claim.closed, inRange: claim.inRange })), actual };
  });
  const counts = Object.fromEntries(["covered", "drifted", "unattributed", "ambiguous"].map((kind) => [kind, rows.filter((row) => row.classification === kind).length]));
  return { base, head, rows, counts, invalidRuns, ok: !invalidRuns.length && counts.drifted === 0 && counts.unattributed === 0 && counts.ambiguous === 0 };
}
