import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { readFrontMatter, isBlank } from "../loop/front-matter.js";
import { resolveConvention, conventionForStream } from "../loop/convention.js";
import { discoverStreams } from "../loop/repo-scan.js";

export const GOVERNANCE_VERSION = "1";
export const GOVERNANCE_STATES = Object.freeze([
  "in-progress",
  "awaiting-continue",
  "review-blocked",
  "ready-for-human-review",
  "human-approved",
  "closed",
]);
export const GOVERNANCE_ROLES = Object.freeze([
  "requester",
  "product",
  "architect",
  "implementer",
  "reviewer",
  "approver",
]);
export const BUILTIN_EXTENSIONS = Object.freeze(["testing", "pbt", "security", "resiliency"]);
export const REVIEW_OUTCOMES = Object.freeze([
  "READY_FOR_HUMAN_REVIEW",
  "CHANGES_REQUIRED",
  "NOT_REVIEWABLE_SAFELY",
]);

const ROLE_FIELDS = Object.freeze({
  requester: "roleRequester",
  product: "roleProduct",
  architect: "roleArchitect",
  implementer: "roleImplementer",
  reviewer: "roleReviewer",
  approver: "roleApprover",
});

const APPROVER_ROLES = Object.freeze({
  requirements: ["requester", "product"],
  architecture: ["architect"],
  specification: ["product", "architect"],
  tasks: ["architect"],
  implementation: ["implementer"],
});

const EVENT_ROLES = Object.freeze({
  intent_captured: ["requester", "product"],
  question_answered: ["requester", "product"],
  change_decision: GOVERNANCE_ROLES,
  extension_evaluated: ["implementer", "reviewer"],
  implementation_completed: ["implementer"],
  architecture_reconciled: ["implementer"],
  governance_migrated: ["architect", "approver"],
  review_completed: ["reviewer"],
  human_signed: ["approver"],
  loop_closed: ["approver"],
});

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function hashAuditEvent(event) {
  const source = { ...event };
  delete source.eventHash;
  return sha256(JSON.stringify(stable(source)));
}

export function splitList(value) {
  if (isBlank(value)) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function git(repoRoot, args) {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function readFile(absPath) {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

export function scanProjectExtensions(repoRoot) {
  const root = path.join(path.resolve(repoRoot), "docs/sdd/extensions");
  const definitions = new Map();
  const optIns = new Map();
  const issues = [];
  if (!fs.existsSync(root)) return { root, definitions, optIns, issues };
  const visit = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      issues.push({ kind: "unreadable-extension-dir", file: dir });
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(abs);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const optIn = entry.name.endsWith(".opt-in.md");
      const name = entry.name.slice(0, optIn ? -".opt-in.md".length : -".md".length);
      const bucket = optIn ? optIns : definitions;
      if (bucket.has(name)) issues.push({ kind: "duplicate-extension", name, files: [bucket.get(name), abs] });
      else bucket.set(name, abs);
    }
  };
  visit(root);
  for (const [name, file] of definitions) {
    if (BUILTIN_EXTENSIONS.includes(name)) issues.push({ kind: "builtin-extension-conflict", name, file });
    if (!/^[a-z][a-z0-9-]*$/.test(name)) issues.push({ kind: "invalid-extension-name", name, file });
    const content = readFile(file);
    const parsed = content === null ? { ok: false, meta: {} } : readFrontMatter(content);
    if (!parsed.ok) {
      issues.push({ kind: "invalid-extension-file", name, file });
      continue;
    }
    if (parsed.meta.extension !== name) issues.push({ kind: "extension-name-mismatch", name, file });
    const stages = splitList(parsed.meta.stages);
    if (!stages.length || stages.some((stage) => !resolveConvention().stageDocs.includes(stage))) {
      issues.push({ kind: "invalid-extension-stages", name, file });
    }
  }
  for (const [name, file] of optIns) {
    if (!definitions.has(name)) issues.push({ kind: "orphan-opt-in", name, file });
  }
  return { root, definitions, optIns, issues };
}

function resolveTarget(repoRoot, stream, overrides = {}, { allowClosed = false } = {}) {
  const root = path.resolve(repoRoot);
  const found = discoverStreams(root, overrides);
  if (found.mode === "streams" && !stream) {
    throw new Error(`这是分流仓库，请用 --stream 指明一条流：${found.streams.join(" / ")}`);
  }
  if (stream && !found.streams.includes(stream)) {
    throw new Error(`没有名为 ${stream} 的流；可用流：${found.streams.join(" / ") || "(无)"}`);
  }
  if (found.mode === "single" && stream) throw new Error("这是单流仓库，不能使用 --stream。");
  const convention = stream ? conventionForStream(stream, overrides) : resolveConvention(overrides);
  const statusPath = path.join(root, convention.statusFile);
  const statusText = readFile(statusPath);
  if (statusText === null) throw new Error(`状态文件读不出来：${convention.statusFile}`);
  const parsed = readFrontMatter(statusText);
  if (!parsed.ok) throw new Error(`状态文件 front-matter 不可信：${convention.statusFile}`);
  if (String(parsed.meta.governanceVersion ?? "") !== GOVERNANCE_VERSION) {
    throw new Error(`状态文件没有启用 governanceVersion: ${GOVERNANCE_VERSION}`);
  }
  let loop;
  let loopDirRel;
  if (!isBlank(parsed.meta.activeLoop)) {
    loop = String(parsed.meta.activeLoop);
    loopDirRel = path.join(path.dirname(convention.statusFile), `${convention.loopDirPrefix}${loop}`);
  } else if (allowClosed && !isBlank(parsed.meta.lastClosedLoop)) {
    loop = String(parsed.meta.lastClosedLoop);
    const archiveRoot = path.join(root, convention.archiveDir);
    const prefix = `${convention.loopDirPrefix}${loop}`;
    const candidates = fs.existsSync(archiveRoot)
      ? fs.readdirSync(archiveRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && (entry.name === prefix || entry.name.startsWith(`${prefix}-`)))
        .map((entry) => path.join(convention.archiveDir, entry.name))
        .filter((rel) => fs.existsSync(path.join(root, rel, "audit")))
      : [];
    if (candidates.length !== 1) throw new Error(`无法唯一定位已归档 Loop ${loop} 的 audit/：${candidates.join(" / ") || "没有候选"}`);
    [loopDirRel] = candidates;
  } else {
    throw new Error("当前没有活跃 Loop，不能追加该治理事件。");
  }
  return {
    root,
    stream: stream || null,
    convention,
    statusPath,
    statusRel: convention.statusFile,
    statusText,
    meta: parsed.meta,
    loop,
    loopDirRel,
    loopDir: path.join(root, loopDirRel),
  };
}

function roleEmails(meta, role) {
  return splitList(meta[ROLE_FIELDS[role]]).map((email) => email.toLowerCase());
}

function allowedRoles(type, stage) {
  if (type === "stage_approved") return APPROVER_ROLES[stage] ?? [];
  if (type === "continue_authorized") return GOVERNANCE_ROLES;
  return EVENT_ROLES[type] ?? [];
}

function requireRole(target, payload, identity) {
  const role = String(payload.role ?? "").trim().toLowerCase();
  if (!GOVERNANCE_ROLES.includes(role)) throw new Error(`未知项目角色：${role || "(空)"}`);
  const allowed = allowedRoles(payload.type, payload.stage);
  if (!allowed.includes(role)) {
    throw new Error(`角色 ${role} 不能记录 ${payload.type}${payload.stage ? `(${payload.stage})` : ""}`);
  }
  if (!roleEmails(target.meta, role).includes(identity.email.toLowerCase())) {
    throw new Error(`${identity.email} 没有登记为 ${role}；请先更新 status.md 的 ${ROLE_FIELDS[role]}。`);
  }
  return role;
}

function identity(repoRoot) {
  const name = git(repoRoot, ["config", "user.name"]);
  const email = git(repoRoot, ["config", "user.email"]);
  if (!name || !email) throw new Error("缺少 git user.name 或 git user.email，不能记录可问责的治理事件。");
  return { name, email };
}

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(api[_-]?key|access[_-]?token|secret|password|passwd)\b(\s*[:=]\s*)[^\s,;]+/gi,
];

function redactText(value) {
  const original = String(value);
  let text = original;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (_match, prefix = "", separator = "") => `${prefix || ""}${separator || ""}[REDACTED]`);
  }
  return { text, changed: text !== original, hash: sha256(original) };
}

function sanitizePayload(payload, repoRoot) {
  const kept = {};
  for (const key of ["summary", "input", "evidence", "reason", "minimalCounterexample"]) {
    if (payload[key] === undefined) continue;
    const redacted = redactText(payload[key]);
    kept[key] = redacted.text
      .split(repoRoot).join("[REPO]")
      .replace(/\/(?:Users|home|tmp|private\/tmp|var\/folders)\/[^\s"'`,;)}\]]+/g, "[LOCAL_PATH]")
      .replace(/\b[A-Za-z]:\\[^\s"'`,;)}\]]+/g, "[LOCAL_PATH]");
    kept[`${key}Hash`] = redacted.hash;
    if (redacted.changed) kept[`${key}Redacted`] = true;
  }
  for (const key of ["extension", "outcome", "caseCount", "seed"]) {
    if (payload[key] !== undefined) kept[key] = payload[key];
  }
  return kept;
}

export function fingerprintFile(absPath) {
  const content = readFile(absPath);
  return content === null ? null : sha256(content);
}

export function fingerprintRepo(repoRoot, { statusRel, excludePrefixes = [] } = {}) {
  const root = path.resolve(repoRoot);
  const output = git(root, ["ls-files", "-co", "--exclude-standard"]);
  if (output === null) return null;
  const normalizedStatus = statusRel?.split(path.sep).join("/");
  const normalizedPrefixes = excludePrefixes.map((prefix) => prefix.split(path.sep).join("/").replace(/\/$/, ""));
  const files = output.split("\n").filter(Boolean).filter((rel) => {
    const normalized = rel.split(path.sep).join("/");
    if (normalizedStatus && normalized === normalizedStatus) return false;
    return !normalizedPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
  }).sort();
  const hash = crypto.createHash("sha256");
  for (const rel of files) {
    const abs = path.join(root, rel);
    let stat;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      continue;
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) continue;
    hash.update(`${rel}\0`);
    hash.update(stat.isSymbolicLink() ? fs.readlinkSync(abs) : fs.readFileSync(abs));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function fingerprintCurrentCode(target) {
  return fingerprintRepo(target.root, {
    statusRel: target.statusRel,
    excludePrefixes: [path.join(target.loopDirRel, "audit")],
  });
}

function deliveryFingerprint(target) {
  return fingerprintRepo(target.root, {
    statusRel: target.statusRel,
    excludePrefixes: [path.dirname(target.convention.statusFile), target.convention.archiveDir],
  });
}

function replaceFrontMatterFields(text, changes) {
  const lines = text.split(/\r?\n/);
  const end = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (lines[0]?.trim() !== "---" || end < 0) throw new Error("状态文件 front-matter 无法更新。");
  const endIndex = end + 1;
  const pending = new Map(Object.entries(changes).map(([key, value]) => [key, value]));
  for (let index = 1; index < endIndex; index += 1) {
    const match = lines[index].match(/^([^:]+):/);
    if (!match) continue;
    const key = match[1].trim();
    if (!pending.has(key)) continue;
    lines[index] = `${key}: ${pending.get(key)}`;
    pending.delete(key);
  }
  lines.splice(endIndex, 0, ...[...pending].map(([key, value]) => `${key}: ${value}`));
  return lines.join("\n");
}

function updateStatus(target, changes) {
  const next = replaceFrontMatterFields(target.statusText, changes);
  const temp = `${target.statusPath}.sdd-loop-${process.pid}.tmp`;
  fs.writeFileSync(temp, next, { encoding: "utf8", mode: fs.statSync(target.statusPath).mode });
  fs.renameSync(temp, target.statusPath);
  target.statusText = next;
  Object.assign(target.meta, Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, String(value)])));
}

function stageDoc(target, stage) {
  return path.join(target.loopDir, `${stage}.md`);
}

function requireConfirmedStage(target, stage) {
  if (!APPROVER_ROLES[stage]) throw new Error(`阶段 ${stage} 不使用 stage_approved 事件。`);
  const file = stageDoc(target, stage);
  const text = readFile(file);
  if (text === null) throw new Error(`阶段文档不存在或读不出来：${path.relative(target.root, file)}`);
  const parsed = readFrontMatter(text);
  if (!parsed.ok || parsed.meta.status !== "confirmed") throw new Error(`${stage}.md 必须先成为 confirmed。`);
  return fingerprintFile(file);
}

function lastEventInFile(file) {
  const text = readFile(file);
  if (!text?.trim()) return null;
  const lines = text.trimEnd().split("\n");
  try {
    return JSON.parse(lines.at(-1));
  } catch {
    throw new Error(`审计分片最后一行不可解析：${file}`);
  }
}

function selectShard(target, branch) {
  const dir = path.join(target.loopDir, "audit");
  if (fs.existsSync(dir)) {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`audit 路径必须是仓库内真实目录：${path.relative(target.root, dir)}`);
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }
  for (const entry of fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl")).sort()) {
    const file = path.join(dir, entry);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`审计分片必须是普通文件，不能是目录或软链：${path.relative(target.root, file)}`);
    const first = readFile(file)?.split("\n").find(Boolean);
    if (!first) continue;
    try {
      if (JSON.parse(first).context?.branch === branch) return file;
    } catch {
      continue;
    }
  }
  return path.join(dir, `${crypto.randomUUID()}.jsonl`);
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("event JSON 必须是对象。");
  if (!payload.type) throw new Error("event JSON 缺少 type。 ");
  if (!String(payload.summary ?? "").trim()) throw new Error("event JSON 缺少 summary。 ");
  if (payload.type === "extension_evaluated") {
    if (!/^[a-z][a-z0-9-]*$/.test(String(payload.extension ?? ""))) throw new Error(`扩展名不合法：${payload.extension || "(空)"}`);
    if (!["PASS", "FAIL", "N/A"].includes(payload.outcome)) throw new Error("扩展结果必须是 PASS、FAIL 或 N/A。");
    if (payload.outcome === "N/A" && !String(payload.reason ?? "").trim()) throw new Error("扩展结果为 N/A 时必须给出 reason。");
    if (payload.outcome === "PASS" && !String(payload.evidence ?? "").trim()) throw new Error("扩展结果为 PASS 时必须给出 evidence。");
    if (payload.extension === "pbt" && payload.outcome === "PASS") {
      if (!Number.isInteger(payload.caseCount) || payload.caseCount <= 0 || payload.seed === undefined) {
        throw new Error("PBT PASS 必须记录正整数 caseCount 和 seed。");
      }
    }
    if (payload.extension === "pbt" && payload.outcome === "N/A" && /没有.*(?:PBT|属性测试).*库|no .*library/i.test(payload.reason)) {
      throw new Error("没有 PBT 库本身不是 N/A 理由；先判断是否存在不变量，并考虑确定性轻量生成器。");
    }
  }
  if (payload.type === "review_completed" && !REVIEW_OUTCOMES.includes(payload.outcome)) {
    throw new Error(`AI Review 结果必须是：${REVIEW_OUTCOMES.join(" / ")}`);
  }
  if (["intent_captured", "question_answered"].includes(payload.type) && !String(payload.input ?? "").trim()) {
    throw new Error(`${payload.type} 必须包含用户原始 input。`);
  }
  if (["architecture_reconciled", "review_completed"].includes(payload.type) && !String(payload.evidence ?? "").trim()) {
    throw new Error(`${payload.type} 必须包含 evidence。`);
  }
  if (payload.type === "governance_migrated" && !String(payload.reason ?? "").trim()) {
    throw new Error("governance_migrated 必须说明无法补录历史的 reason。");
  }
}

function transition(target, payload) {
  const type = payload.type;
  const stage = String(payload.stage ?? target.meta.gateStage ?? "");
  if (type === "stage_approved") {
    if (target.meta.gateState !== "in-progress") throw new Error(`当前 gateState=${target.meta.gateState}，不能审批阶段。`);
    if (stage !== target.meta.gateStage) throw new Error(`当前门禁是 ${target.meta.gateStage}，不能审批 ${stage}。`);
    const fingerprint = requireConfirmedStage(target, stage);
    return { fields: { gateState: "awaiting-continue", gateFingerprint: fingerprint }, artifactFingerprint: fingerprint };
  }
  if (type === "continue_authorized") {
    if (target.meta.gateState !== "awaiting-continue") throw new Error("当前不在 awaiting-continue，不能继续。");
    if (stage !== target.meta.gateStage) throw new Error(`待继续阶段是 ${target.meta.gateStage}，不是 ${stage}。`);
    const fingerprint = fingerprintFile(stageDoc(target, stage));
    if (!fingerprint || fingerprint !== target.meta.gateFingerprint) throw new Error("阶段文档在审批后发生变化，旧审批已失效。");
    const index = target.convention.stageDocs.indexOf(stage);
    const next = target.convention.stageDocs[index + 1];
    if (!next) throw new Error("Verification 收口不使用 continue；请完成 AI Review 和人工签署。");
    return { fields: { gateStage: next, gateState: "in-progress", gateFingerprint: "null", nextPhase: next }, artifactFingerprint: fingerprint };
  }
  if (type === "review_completed") {
    if (stage !== "verification" || target.meta.gateStage !== "verification") throw new Error("AI Review 只能在 Verification 门禁记录。");
    const currentFingerprint = fingerprintCurrentCode(target);
    if (payload.outcome === "READY_FOR_HUMAN_REVIEW") {
      const audit = readAuditDirectory(target.loopDir);
      const reconciled = audit.events.filter((event) => event.type === "architecture_reconciled").at(-1);
      if (!reconciled || reconciled.codeFingerprint !== currentFingerprint) {
        throw new Error("Architecture Baseline 与 change surface 尚未按当前代码指纹完成对账。");
      }
      for (const extension of splitList(target.meta.enabledExtensions)) {
        const evaluation = audit.events.filter((event) => (
          event.type === "extension_evaluated" && event.payload?.extension === extension
        )).at(-1);
        if (!evaluation || !["PASS", "N/A"].includes(evaluation.payload?.outcome) || evaluation.codeFingerprint !== currentFingerprint) {
          throw new Error(`工程扩展 ${extension} 尚未通过或给出合理 N/A。`);
        }
      }
    }
    const state = payload.outcome === "READY_FOR_HUMAN_REVIEW"
      ? "ready-for-human-review"
      : payload.outcome === "CHANGES_REQUIRED"
        ? "in-progress"
        : "review-blocked";
    const fields = payload.outcome === "CHANGES_REQUIRED"
      ? { gateStage: "implementation", gateState: state, gateFingerprint: "null", nextPhase: "implementation" }
      : { gateState: state, gateFingerprint: currentFingerprint };
    return { fields, codeFingerprint: currentFingerprint, deliveryFingerprint: deliveryFingerprint(target) };
  }
  if (type === "human_signed") {
    if (target.meta.gateState !== "ready-for-human-review") throw new Error("只有 READY_FOR_HUMAN_REVIEW 后才能人工签署。");
    const currentFingerprint = fingerprintCurrentCode(target);
    if (!currentFingerprint || currentFingerprint !== target.meta.gateFingerprint) throw new Error("审查后代码或关键文档已变化，旧审查失效。");
    return { fields: { gateState: "human-approved" }, codeFingerprint: currentFingerprint, deliveryFingerprint: deliveryFingerprint(target) };
  }
  if (type === "governance_migrated") {
    if (stage !== target.meta.gateStage) throw new Error(`治理迁移阶段必须等于当前 gateStage: ${target.meta.gateStage}。`);
    const file = stageDoc(target, stage);
    const content = readFile(file);
    const parsed = content === null ? null : readFrontMatter(content);
    if (parsed?.ok && parsed.meta.status === "confirmed") {
      const artifactFingerprint = fingerprintFile(file);
      return {
        fields: { gateState: "awaiting-continue", gateFingerprint: artifactFingerprint },
        artifactFingerprint,
        codeFingerprint: fingerprintCurrentCode(target),
      };
    }
    return { fields: {}, codeFingerprint: fingerprintCurrentCode(target) };
  }
  if (["implementation_completed", "architecture_reconciled", "extension_evaluated"].includes(type)) {
    return { fields: {}, codeFingerprint: fingerprintCurrentCode(target) };
  }
  if (type === "loop_closed") {
    if (target.meta.gateState !== "human-approved") throw new Error("只有人工签署后才能记录 Loop 关闭。");
    if (!isBlank(target.meta.activeLoop)) throw new Error("先归档阶段文档并清空 activeLoop，再记录 loop_closed。 ");
    for (const stageName of target.convention.stageDocs) {
      const file = path.join(target.loopDir, `${stageName}.md`);
      const content = readFile(file);
      const parsed = content === null ? null : readFrontMatter(content);
      if (!parsed?.ok || parsed.meta.status !== "archived") {
        throw new Error(`关闭前 ${path.relative(target.root, file)} 必须存在且 status: archived。`);
      }
    }
    const audit = readAuditDirectory(target.loopDir);
    const review = audit.events.filter((event) => event.type === "review_completed").at(-1);
    const signed = audit.events.filter((event) => event.type === "human_signed").at(-1);
    const delivery = deliveryFingerprint(target);
    if (!review || !signed || review.codeFingerprint !== target.meta.gateFingerprint || signed.codeFingerprint !== target.meta.gateFingerprint) {
      throw new Error("已归档 Loop 缺少当前审查指纹对应的 AI Review 或人工签署。");
    }
    if (!delivery || delivery !== review.deliveryFingerprint) throw new Error("人工签署后代码、配置或长期文档发生变化，不能关闭 Loop。");
    return { fields: { gateState: "closed" }, codeFingerprint: target.meta.gateFingerprint, deliveryFingerprint: delivery };
  }
  return { fields: {} };
}

export function recordGovernanceEvent({ repoRoot, stream = null, eventFile, overrides = {} }) {
  const raw = readFile(path.resolve(eventFile));
  if (raw === null) throw new Error(`event JSON 读不出来：${eventFile}`);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(`event JSON 不可解析：${error.message}`);
  }
  validatePayload(payload);
  const target = resolveTarget(repoRoot, stream, overrides, { allowClosed: payload.type === "loop_closed" });
  if (payload.stage !== undefined && !target.convention.stageDocs.includes(String(payload.stage))) {
    throw new Error(`事件阶段不合法：${payload.stage}`);
  }
  if (payload.type === "extension_evaluated" && !splitList(target.meta.enabledExtensions).includes(payload.extension)) {
    throw new Error(`扩展 ${payload.extension} 没有在 enabledExtensions 中启用。`);
  }
  if (payload.type === "implementation_completed" && target.meta.gateStage !== "implementation") {
    throw new Error("implementation_completed 只能在 Implementation 门禁记录。");
  }
  if (["architecture_reconciled", "extension_evaluated"].includes(payload.type) && target.meta.gateStage !== "verification") {
    throw new Error(`${payload.type} 只能在 Verification 门禁记录。`);
  }
  const actor = identity(target.root);
  const role = requireRole(target, payload, actor);
  const transitionResult = transition(target, payload);
  const branch = git(target.root, ["branch", "--show-current"]) || "DETACHED";
  const commit = git(target.root, ["rev-parse", "HEAD"]);
  const shard = selectShard(target, branch);
  const previous = lastEventInFile(shard);
  const event = {
    version: 1,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type: payload.type,
    actor: { ...actor, role },
    context: { stream: target.stream, loop: target.loop, stage: payload.stage || target.meta.gateStage, branch, commit },
    payload: sanitizePayload(payload, target.root),
    artifactFingerprint: transitionResult.artifactFingerprint ?? null,
    codeFingerprint: transitionResult.codeFingerprint ?? null,
    deliveryFingerprint: transitionResult.deliveryFingerprint ?? null,
    previousEventHash: previous?.eventHash ?? null,
  };
  event.eventHash = hashAuditEvent(event);
  fs.appendFileSync(shard, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o644 });
  if (Object.keys(transitionResult.fields).length) updateStatus(target, transitionResult.fields);
  return { event, auditFile: path.relative(target.root, shard), statusFile: target.statusRel };
}

export function readAuditDirectory(loopDir) {
  const auditDir = path.join(loopDir, "audit");
  if (!fs.existsSync(auditDir)) return { exists: false, files: [], events: [], issues: [] };
  const files = [];
  const events = [];
  const issues = [];
  let entries;
  try {
    const stat = fs.lstatSync(auditDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return { exists: true, files, events, issues: [{ kind: "unsafe-audit-dir", file: auditDir }] };
    }
    entries = fs.readdirSync(auditDir).filter((name) => name.endsWith(".jsonl")).sort();
  } catch {
    return { exists: true, files, events, issues: [{ kind: "unreadable-audit-dir", file: auditDir }] };
  }
  for (const name of entries) {
    const file = path.join(auditDir, name);
    files.push(file);
    let stat;
    try {
      stat = fs.lstatSync(file);
    } catch {
      issues.push({ kind: "unreadable-audit-file", file });
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      issues.push({ kind: "unsafe-audit-file", file });
      continue;
    }
    const text = readFile(file);
    if (text === null) {
      issues.push({ kind: "unreadable-audit-file", file });
      continue;
    }
    let previous = null;
    for (const [index, line] of text.split("\n").entries()) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        issues.push({ kind: "invalid-audit-json", file, line: index + 1 });
        continue;
      }
      if (event.previousEventHash !== previous) issues.push({ kind: "broken-audit-chain", file, line: index + 1 });
      if (event.eventHash !== hashAuditEvent(event)) issues.push({ kind: "invalid-event-hash", file, line: index + 1 });
      previous = event.eventHash;
      events.push({ ...event, _file: file, _line: index + 1 });
    }
  }
  events.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || String(a.id).localeCompare(String(b.id)));
  return { exists: true, files, events, issues };
}

export function validateEventAuthorization(meta, event) {
  const role = event.actor?.role;
  const email = event.actor?.email;
  if (!role || !email || !event.actor?.name) return false;
  if (!allowedRoles(event.type, event.context?.stage).includes(role)) return false;
  return roleEmails(meta, role).includes(String(email).toLowerCase());
}

export function governanceRoleField(role) {
  return ROLE_FIELDS[role] ?? null;
}
