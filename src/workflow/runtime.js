import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { readFrontMatter, isBlank } from "../loop/front-matter.js";
import { discoverStreams } from "../loop/repo-scan.js";
import { conventionForStream, resolveConvention } from "../loop/convention.js";
import { hashAuditEvent } from "../governance/protocol.js";
import { digest, loadWorkflow, parseWorkflow, ROUTES, LOOP_DOCS } from "./definition.js";
import { captureSource, changedFiles, compareSource, fileReceipt, gitHead, gitIdentity, safeRelative } from "./source.js";

const FINAL_STAGES = new Set(["final_test", "reconciliation", "review", "signoff", "close"]);

function readJson(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${file} 必须是 JSON 对象。`);
  return parsed;
}

function assertSafeRunPath(root, dir) {
  safeRelative(dir.split(path.sep).join("/"));
  let current = root;
  for (const part of dir.split(path.sep)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`工作目录包含非真实目录：${dir}`);
  }
}

function assertRegular(file) {
  if (!fs.existsSync(file)) return;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`工作流文件必须是普通文件：${file}`);
}

function stateContext(root, stream, overrides = {}) {
  safeRelative(overrides.statusFile ?? "docs/loops/status.md");
  safeRelative(overrides.archiveDir ?? "docs/archive");
  const found = discoverStreams(root, overrides);
  if (found.mode === "streams" && (!stream || !found.streams.includes(stream))) throw new Error(`请用 --stream 指定有效流：${found.streams.join(" / ")}`);
  if (found.mode === "single" && stream) throw new Error("单流仓库不接受 --stream。");
  const convention = stream ? conventionForStream(stream, overrides) : resolveConvention(overrides);
  const file = path.join(root, convention.statusFile);
  const parsed = readFrontMatter(fs.readFileSync(file, "utf8"));
  if (!parsed.ok) throw new Error("状态文件 front-matter 不可信。");
  if (String(parsed.meta.governanceVersion) !== "2") throw new Error("新工作需要 governanceVersion: 2；v1 工作使用原有规则或显式差量核对入口。");
  return { convention, meta: parsed.meta, statusRel: convention.statusFile };
}

function lockedStateContext(root, lock) {
  const overrides = {
    statusFile: lock.stream
      ? path.join(path.dirname(path.dirname(lock.statusRel)), path.basename(lock.statusRel))
      : lock.statusRel,
    archiveDir: lock.stream ? path.dirname(lock.archiveDir) : lock.archiveDir,
  };
  const context = stateContext(root, lock.stream, overrides);
  if (context.statusRel !== lock.statusRel || context.convention.archiveDir !== lock.archiveDir) {
    throw new Error("工作流锁定的状态或归档目录与当前仓库不一致。");
  }
  return context;
}

function runDirectory(root, route, id, stream, context) {
  const statusDir = path.dirname(context.statusRel);
  if (route === "loop") {
    if (isBlank(context.meta.activeLoop)) throw new Error("Loop 启动前状态文件必须有 activeLoop。");
    const dir = path.join(statusDir, `${context.convention.loopDirPrefix}${context.meta.activeLoop}`);
    if (!fs.existsSync(path.join(root, dir))) throw new Error(`活跃 Loop 目录不存在：${dir}`);
    return dir;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(String(id ?? ""))) throw new Error("Hotfix/Debug 必须提供安全的 --id。");
  return path.join(statusDir, "workflow-runs", id);
}

function appendEvent(root, dir, lock, payload, extra = {}) {
  assertSafeRunPath(root, dir);
  const auditFile = path.join(root, dir, "workflow.audit.jsonl");
  assertRegular(auditFile);
  const current = readWorkflowAudit(root, dir);
  if (current.issues.length) throw new Error(`审计链不可用：${current.issues[0]}`);
  const previous = current.events.at(-1);
  const actor = gitIdentity(root);
  const event = {
    version: 2,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type: payload.type,
    actor,
    runId: lock.id,
    workflowHash: lock.workflow.hash,
    lockHash: lock.lockHash,
    payload: { ...payload, ...extra },
    previousEventHash: previous?.eventHash ?? null,
  };
  event.eventHash = hashAuditEvent(event);
  const originalSize = fs.existsSync(auditFile) ? fs.statSync(auditFile).size : 0;
  try { fs.appendFileSync(auditFile, `${JSON.stringify(event)}\n`, { mode: 0o644 }); }
  catch (error) {
    if (fs.existsSync(auditFile)) fs.truncateSync(auditFile, originalSize);
    throw error;
  }
  return event;
}

export function readWorkflowAudit(root, dir) {
  assertSafeRunPath(root, dir);
  const file = path.join(root, dir, "workflow.audit.jsonl");
  if (!fs.existsSync(file)) return { events: [], issues: [] };
  assertRegular(file);
  const events = [];
  const issues = [];
  let previous = null;
  for (const [index, line] of fs.readFileSync(file, "utf8").split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.version !== 2 || event.previousEventHash !== previous || event.eventHash !== hashAuditEvent(event)) issues.push(`workflow.audit.jsonl:${index + 1} 哈希链或版本错误`);
      previous = event.eventHash;
      events.push(event);
    } catch { issues.push(`workflow.audit.jsonl:${index + 1} 不是有效事件`); }
  }
  return { events, issues };
}

export function readWorkflowRun(root, dir) {
  assertSafeRunPath(root, dir);
  const file = path.join(root, dir, "workflow.lock.json");
  assertRegular(file);
  const lock = readJson(file);
  const { lockHash, ...content } = lock;
  if (lockHash !== digest(JSON.stringify(content))) throw new Error("工作流锁整体摘要不匹配。");
  if (lock.version !== 2 || !ROUTES.includes(lock.route) || !lock.workflow?.definition || digest(JSON.stringify(lock.workflow.definition)) !== lock.workflow.definitionHash || digest(lock.workflow.text ?? "") !== lock.workflow.hash || JSON.stringify(parseWorkflow(lock.workflow.text, lock.route)) !== JSON.stringify(lock.workflow.definition)) throw new Error("工作流锁内容或摘要不可信。");
  const audit = readWorkflowAudit(root, dir);
  if (audit.issues.length) throw new Error(audit.issues.join("；"));
  if (audit.events.some((event) => event.workflowHash !== lock.workflow.hash || event.lockHash !== lock.lockHash || event.runId !== lock.id)) throw new Error("审计事件不属于当前工作流锁。");
  return { lock, ...audit, dir };
}

export function startWorkflow({ repoRoot, stream = null, route, id = null, confirmation, overrides = {} }) {
  const root = path.resolve(repoRoot);
  if (!ROUTES.includes(route)) throw new Error(`未知流程：${route}`);
  if (confirmation?.route !== route || !String(confirmation?.input ?? "").trim()) throw new Error("启动前需要用户明确确认推荐流程；confirmation.route 和 input 必须对应本次选择。");
  const context = stateContext(root, stream, overrides);
  const dir = runDirectory(root, route, id, stream, context);
  const abs = path.join(root, dir);
  assertSafeRunPath(root, dir);
  if (fs.existsSync(path.join(abs, "workflow.lock.json"))) throw new Error(`工作流已经启动：${dir}`);
  if (route === "loop" && fs.existsSync(path.join(abs, "audit"))) {
    throw new Error("此 Loop 已有 v1 审计，不能把进行中的旧工作自动启动为 v2。");
  }
  if (route !== "loop") {
    const archived = path.join(context.convention.archiveDir, "workflow-runs", id);
    assertSafeRunPath(root, archived);
    if (fs.existsSync(path.join(root, archived))) throw new Error(`工作流 ID 已归档，不能重复使用：${id}`);
  }
  assertRegular(path.join(abs, "workflow.lock.json"));
  assertRegular(path.join(abs, "workflow.audit.jsonl"));
  if (fs.existsSync(abs) && route !== "loop" && fs.readdirSync(abs).length) throw new Error("工作目录已存在且非空。");
  const workflow = loadWorkflow(root, route, { stream });
  const actor = gitIdentity(root);
  const signerRole = workflow.definition.signerRole;
  const roleField = signerRole ? `role${signerRole[0].toUpperCase()}${signerRole.slice(1)}` : null;
  const roleSigners = roleField ? String(context.meta[roleField] ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) : [];
  if (roleField && !roleSigners.length) throw new Error(`指定角色签署缺少状态文件中的 ${roleField} 映射。`);
  const lock = {
    version: 2,
    id: route === "loop" ? `loop-${context.meta.activeLoop}` : id,
    route,
    ...(route === "loop" ? { loop: String(context.meta.activeLoop) } : {}),
    stream,
    statusRel: context.statusRel,
    controlDir: stream ? path.dirname(path.dirname(context.statusRel)) : path.dirname(context.statusRel),
    archiveDir: context.convention.archiveDir,
    baseCommit: gitHead(root),
    startedAt: new Date().toISOString(),
    submitter: actor,
    roleSigners,
    workflow: { ...workflow, definitionHash: digest(JSON.stringify(workflow.definition)) },
  };
  lock.lockHash = digest(JSON.stringify(lock));
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(path.join(abs, "workflow.lock.json"), `${JSON.stringify(lock, null, 2)}\n`, { flag: "wx" });
  appendEvent(root, dir, lock, { type: "started", summary: sanitizeText(confirmation.input, root), confirmedRoute: route });
  return { runDir: dir, workflowHash: workflow.hash, route, submitter: actor.email };
}

function latest(events, type, stage = null) {
  return events.filter((event) => event.type === type && (!stage || event.payload?.stage === stage)).at(-1) ?? null;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须给出非空文本。`);
  return value.trim();
}

function sanitizeText(value, root) {
  return value.replaceAll(root, "[REPO]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/\/(?:Users|home|tmp|private\/tmp|var\/folders|Volumes|workspace|workspaces|opt|mnt|srv|data|usr)\/[^\s"'`,;)}\]]+/g, "[LOCAL_PATH]")
    .replace(/\b[A-Za-z]:\\[^\s"'`,;)}\]]+/g, "[LOCAL_PATH]");
}

function cleanPayload(payload, root) {
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string") out[key] = sanitizeText(value, root);
    else if (Array.isArray(value) && value.every((item) => typeof item === "string")) out[key] = value.map((item) => sanitizeText(item, root));
    else if (value === null || typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (key === "assignedElsewhere" && value && typeof value === "object" && !Array.isArray(value)) out[key] = value;
    else throw new Error(`事件字段 ${key} 的值不受支持。`);
  }
  return out;
}

function stageReceipt(root, dir, stage) {
  const file = path.join(root, dir, `${stage}.md`);
  const text = fs.readFileSync(file, "utf8");
  const parsed = readFrontMatter(text);
  if (!parsed.ok || parsed.meta.status !== "confirmed") throw new Error(`${stage}.md 必须是 confirmed。`);
  return digest(text);
}

function prerequisiteDone(root, run, stage, candidate) {
  const { lock, events, dir } = run;
  if (LOOP_DOCS.includes(stage) && lock.route === "loop") {
    const approved = [...events].reverse().find((event) => ["stage_completed", "stage_revalidated"].includes(event.type) && event.payload?.stage === stage);
    return Boolean(approved && approved.payload.docHash === stageReceipt(root, dir, stage));
  }
  if (["deployment", "manual_test"].includes(stage)) {
    const cycle = latest(events, "cycle");
    if (cycle) return Boolean(cycle.payload.deployment && cycle.payload.retest === "PASS");
  }
  const done = latest(events, "stage_completed", stage);
  return Boolean(done && (!FINAL_STAGES.has(stage) || done.payload.candidateId === candidate?.payload.candidateId));
}

function candidateIsCurrent(root, run) {
  const candidate = latest(run.events, "candidate");
  if (!candidate) throw new Error("尚未固定稳定候选。");
  const cycle = latest(run.events, "cycle");
  if (cycle && run.events.indexOf(cycle) > run.events.indexOf(candidate)) throw new Error("候选后又有修复，必须重新固定候选并补充审查。");
  const claim = latest(run.events, "claim");
  if (claim && run.events.indexOf(claim) > run.events.indexOf(candidate)) throw new Error("候选后交付清单增加文件，必须重新固定候选并补充审查。");
  for (const type of ["decision", "impact"]) {
    const change = latest(run.events, type);
    if (change && run.events.indexOf(change) > run.events.indexOf(candidate)) throw new Error("候选后有新的产品决定或架构影响，必须修订受影响证据并重新固定候选。");
  }
  const compare = compareSource(root, candidate.payload.source);
  if (!compare.ok) throw new Error(`交付文件在候选后变化：${compare.drift.map((item) => item.path).join(" / ")}`);
  return candidate;
}

function changedDelivery(root, run, payload) {
  const changed = changedFiles(root, run.lock.baseCommit, { exclude: [run.lock.controlDir, run.lock.archiveDir] });
  const chosen = payload.files ? [...new Set(payload.files.map(safeRelative))].sort() : changed;
  if (chosen.some((file) => !changed.includes(file))) throw new Error("交付清单中有不属于本次 Git 变更的文件。");
  const priorCandidate = latest(run.events, "candidate");
  if (priorCandidate?.payload.source.files.some((item) => !chosen.includes(item.path))) throw new Error("不能从已固定的交付清单移除文件。");
  const omitted = changed.filter((file) => !chosen.includes(file));
  const assignments = payload.assignedElsewhere ?? {};
  if (omitted.length !== Object.keys(assignments).length || omitted.some((file) => !assignments[file])) throw new Error(`真实变更不能无归属地缩小交付范围：${omitted.join(" / ")}`);
  for (const [file, otherDir] of Object.entries(assignments)) {
    safeRelative(file);
    safeRelative(otherDir);
    const other = readWorkflowRun(root, otherDir);
    if (otherDir === run.dir || other.lock.stream === run.lock.stream) throw new Error(`${file} 的归属必须是另一条流的工作。`);
    const receipt = [...other.events].reverse().find((event) => ["claim", "candidate"].includes(event.type) && event.payload?.source?.files.some((item) => item.path === file));
    const item = receipt?.payload.source.files.find((entry) => entry.path === file);
    if (!item || JSON.stringify(item) !== JSON.stringify(fileReceipt(root, file))) throw new Error(`${file} 未被 ${otherDir} 当前源码清单覆盖。`);
  }
  return captureSource(root, chosen);
}

export function recordWorkflowEvent({ repoRoot, runDir, payload }) {
  const root = path.resolve(repoRoot);
  const run = readWorkflowRun(root, runDir);
  const { lock, events } = run;
  lockedStateContext(root, lock);
  if (latest(events, "stage_completed", "close")) throw new Error("已关闭工作不能再追加过程事件。");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("事件必须是 JSON 对象。");
  const type = payload.type;
  const summary = requireText(payload.summary, "summary");
  if (!["decision", "impact", "cycle", "claim", "stage_completed", "stage_revalidated", "candidate"].includes(type)) throw new Error(`v2 事件类型未知：${type}`);
  const clean = cleanPayload(payload, root);
  clean.summary = sanitizeText(summary, root);
  if (type === "decision") requireText(payload.confirmation, "产品决定的用户确认");
  if (type === "impact") requireText(payload.impact, "架构影响");
  if (type === "cycle") {
    for (const key of ["issue", "fixScope", "targetedTest", "deployment", "retest"]) requireText(payload[key], key);
    if (!["PASS", "FAIL"].includes(payload.retest)) throw new Error("retest 必须是 PASS 或 FAIL。");
  }
  if (type === "claim") {
    if (!Array.isArray(payload.files) || !payload.files.length) throw new Error("claim 必须列出真实变更文件。");
    requireText(payload.evidence, "claim evidence");
    const changed = changedFiles(root, lock.baseCommit, { exclude: [lock.controlDir, lock.archiveDir] });
    if (payload.files.some((file) => !changed.includes(file))) throw new Error("claim 文件不在实际 Git 变更中。");
    clean.source = captureSource(root, payload.files);
    delete clean.files;
  }
  if (type === "candidate") {
    if (latest(events, "cycle")?.payload.retest === "FAIL") throw new Error("最新人工复测未通过，不能固定候选。");
    if (lock.route === "loop") {
      for (const stage of LOOP_DOCS) if (!prerequisiteDone(root, run, stage, null)) throw new Error(`${stage}.md 缺少当前版本的确认记录。`);
      for (const [eventType, from] of [["decision", "requirements"], ["impact", "architecture"]]) {
        const change = latest(events, eventType);
        if (!change) continue;
        for (const stage of LOOP_DOCS.slice(LOOP_DOCS.indexOf(from))) {
          const approval = [...events].reverse().find((event) => ["stage_completed", "stage_revalidated"].includes(event.type) && event.payload?.stage === stage);
          if (!approval || events.indexOf(approval) < events.indexOf(change)) throw new Error(`${eventType} 后必须重验受影响的 ${stage} 证据；未受影响的文档内容无需重写。`);
        }
      }
    }
    if (lock.route === "hotfix") {
      const document = path.join(root, runDir, "hotfix.md");
      const parsed = readFrontMatter(fs.readFileSync(document, "utf8"));
      if (!parsed.ok || parsed.meta.status !== "confirmed") throw new Error("Hotfix 候选需要单份 confirmed 的 hotfix.md。");
      clean.hotfixDocumentHash = digest(fs.readFileSync(document));
    }
    for (const stage of lock.workflow.definition.stages.map((item) => item.id).filter((id) => !FINAL_STAGES.has(id) && !LOOP_DOCS.includes(id))) {
      if (!prerequisiteDone(root, run, stage, null)) throw new Error(`候选前缺少 ${stage} 的完成证据。`);
    }
    const source = changedDelivery(root, run, payload);
    clean.source = source;
    const previousCandidate = latest(events, "candidate");
    if (previousCandidate) {
      const previous = new Map(previousCandidate.payload.source.files.map((item) => [item.path, item]));
      clean.delta = source.files.filter((item) => JSON.stringify(item) !== JSON.stringify(previous.get(item.path))).map((item) => ({ path: item.path, before: previous.get(item.path) ?? null, after: item }));
    }
    delete clean.files;
    if (payload.assignedElsewhere) clean.assignedElsewhere = payload.assignedElsewhere;
    clean.candidateId = crypto.randomUUID();
    clean.documentHashes = lock.route === "loop" ? Object.fromEntries(LOOP_DOCS.map((stage) => [stage, stageReceipt(root, runDir, stage)])) : {};
  }
  if (type === "stage_completed" || type === "stage_revalidated") {
    const stage = payload.stage;
    const definition = lock.workflow.definition;
    const node = definition.stages.find((item) => item.id === stage);
    if (!node) throw new Error(`流程中没有阶段 ${stage}。`);
    if (type === "stage_revalidated" && (lock.route !== "loop" || !LOOP_DOCS.includes(stage) || !latest(events, "stage_completed", stage))) throw new Error("只能重验已确认的 Loop 阶段文档。");
    if (stage === "close") throw new Error("关闭请使用 workflow close，进行归档门禁核对。");
    const candidate = FINAL_STAGES.has(stage) ? candidateIsCurrent(root, run) : null;
    for (const need of node.needs) if (!prerequisiteDone(root, run, need, candidate)) throw new Error(`${stage} 尚缺依赖阶段 ${need}。`);
    requireText(payload.evidence, `${stage} evidence`);
    if (LOOP_DOCS.includes(stage) && lock.route === "loop") {
      if (stage === "requirements" && type === "stage_completed") requireText(payload.confirmation, "Requirements 用户确认");
      clean.docHash = stageReceipt(root, runDir, stage);
      const old = latest(events, "stage_completed", stage);
      if (old && old.payload.docHash !== clean.docHash && stage === "requirements" && events.indexOf(latest(events, "decision")) <= events.indexOf(old)) throw new Error("需求修订前必须先记录用户确认的产品决定。");
      if (old && old.payload.docHash !== clean.docHash && stage === "architecture" && events.indexOf(latest(events, "impact")) <= events.indexOf(old)) throw new Error("架构修订前必须先记录影响。");
    }
    if (stage === "review") {
      if (definition.review === "waived") {
        if (payload.outcome !== "WAIVED") throw new Error("此流程预先声明 Review 豁免，必须记录 WAIVED 和替代验收证据。");
      } else if (payload.outcome !== "READY_FOR_HUMAN_REVIEW") throw new Error("正式 Review 必须给出 READY_FOR_HUMAN_REVIEW。");
      if (candidate.payload.delta && !String(payload.deltaReview ?? "").trim()) throw new Error("候选修订后的 Review 必须写明新差异的补充审查证据 deltaReview。");
      clean.source = candidate.payload.source;
    }
    if (stage === "signoff") {
      const actor = gitIdentity(root);
      if (definition.signoff === "none") {
        if (payload.outcome !== "NOT_REQUIRED") throw new Error("流程预先声明免签，必须记录 NOT_REQUIRED。");
      } else if (definition.signoff === "optional" && payload.outcome === "WAIVED") {
        requireText(payload.reason, "免签理由");
        if (actor.email !== lock.submitter.email) throw new Error("只有登记提交者可决定本次免签。");
      } else {
        if (payload.outcome !== "SIGNED") throw new Error("此流程需要明确 SIGNED。");
        if (["submitter", "optional"].includes(definition.signoff) && actor.email !== lock.submitter.email) throw new Error("当前 Git 提交者不是工作启动时登记的提交者。");
        if (definition.signoff === "role" && payload.role !== definition.signerRole) throw new Error(`需要 ${definition.signerRole} 角色签署。`);
        if (definition.signoff === "role") {
          if (!lock.roleSigners.includes(actor.email)) throw new Error(`签署人未登记在启动时锁定的 ${definition.signerRole} 角色中。`);
        }
      }
    }
    if (candidate) clean.candidateId = candidate.payload.candidateId;
  }
  const event = appendEvent(root, runDir, lock, clean);
  return { runDir, eventId: event.id, type, candidateId: clean.candidateId ?? null };
}

export function closeWorkflow({ repoRoot, runDir, summary, evidence }) {
  const root = path.resolve(repoRoot);
  const run = readWorkflowRun(root, runDir);
  const candidate = candidateIsCurrent(root, run);
  if (!prerequisiteDone(root, run, "signoff", candidate)) throw new Error("关闭前缺少当前候选的签署或免签记录。");
  const archiveHashes = {};
  if (run.lock.route === "loop") {
    const context = lockedStateContext(root, run.lock);
    if (!isBlank(context.meta.activeLoop)) throw new Error("关闭前先归档 Loop 并清空 activeLoop。");
    if (String(context.meta.lastClosedLoop ?? "") !== run.lock.loop) throw new Error(`关闭前 lastClosedLoop 必须指向本轮 ${run.lock.loop}。`);
    for (const stage of LOOP_DOCS) {
      const doc = readFrontMatter(fs.readFileSync(path.join(root, runDir, `${stage}.md`), "utf8"));
      if (!doc.ok || doc.meta.status !== "archived") throw new Error(`${stage}.md 尚未归档。`);
      archiveHashes[stage] = digest(fs.readFileSync(path.join(root, runDir, `${stage}.md`)));
    }
  }
  if (["hotfix", "debug"].includes(run.lock.route)) {
    const name = `${run.lock.route}.md`;
    const file = path.join(root, runDir, name);
    const parsed = readFrontMatter(fs.readFileSync(file, "utf8"));
    if (!parsed.ok || parsed.meta.status !== "archived") throw new Error(`${name} 必须在关闭时归档。`);
    archiveHashes[name] = digest(fs.readFileSync(file));
  }
  const archiveRoot = run.lock.route === "loop"
    ? run.lock.archiveDir : path.join(run.lock.archiveDir, "workflow-runs");
  const alreadyArchived = runDir === archiveRoot || runDir.startsWith(`${archiveRoot}${path.sep}`);
  const archivedDir = alreadyArchived ? runDir : path.join(archiveRoot, path.basename(runDir));
  assertSafeRunPath(root, archivedDir);
  if (!alreadyArchived && fs.existsSync(path.join(root, archivedDir))) throw new Error(`归档目标已存在：${archivedDir}`);
  const closePayload = { type: "stage_completed", stage: "close", summary: sanitizeText(requireText(summary, "summary"), root), evidence: sanitizeText(requireText(evidence, "evidence"), root), candidateId: candidate.payload.candidateId, source: candidate.payload.source, archiveHashes };
  gitIdentity(root);
  if (!alreadyArchived) {
    fs.mkdirSync(path.dirname(path.join(root, archivedDir)), { recursive: true });
    fs.renameSync(path.join(root, runDir), path.join(root, archivedDir));
  }
  let event;
  try { event = appendEvent(root, archivedDir, run.lock, closePayload); }
  catch (error) {
    if (!alreadyArchived) {
      try { fs.renameSync(path.join(root, archivedDir), path.join(root, runDir)); }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], `关闭失败且工作目录无法自动回退；请检查 ${archivedDir}`); }
    }
    throw error;
  }
  return { runDir: archivedDir, eventId: event.id, closed: true };
}
