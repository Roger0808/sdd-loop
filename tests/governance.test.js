import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { readFrontMatter } from "../src/loop/front-matter.js";
import {
  fingerprintRepo,
  readAuditDirectory,
  recordGovernanceEvent,
} from "../src/governance/protocol.js";
import { buildLoopCheckReport, buildRepoCheckReport } from "../src/validation/loop-check.js";

const CLI = path.resolve(import.meta.dirname, "../scripts/sdd-loop.mjs");

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function stage(status = "confirmed", body = "# 内容\n") {
  return `---\ndocument: stage\nstatus: ${status}\n---\n\n${body}`;
}

function status({ gateStage = "requirements", gateState = "in-progress", fingerprint = "null" } = {}) {
  return `---
project: governed
document: loop-status
activeLoop: 1
lastClosedLoop: null
nextLoop: 2
nextPhase: ${gateStage}
governanceVersion: 1
gateStage: ${gateStage}
gateState: ${gateState}
gateFingerprint: ${fingerprint}
enabledExtensions: testing,pbt,security,resiliency
roleRequester: t@example.com
roleProduct: t@example.com
roleArchitect: t@example.com
roleImplementer: t@example.com
roleReviewer: t@example.com
roleApprover: t@example.com
---

# Loop 状态
`;
}

function repo(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-governance-"));
  write(root, "docs/loops/status.md", status(options));
  for (const name of ["requirements", "architecture", "specification", "tasks", "implementation", "verification"]) {
    write(root, `docs/loops/loop-1/${name}.md`, stage(name === "verification" ? "draft" : "confirmed"));
  }
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["add", "docs"]);
  git(root, ["commit", "-qm", "fixture"]);
  return root;
}

function event(root, payload, { stream = null } = {}) {
  const file = write(fs.mkdtempSync(path.join(os.tmpdir(), "sdd-event-")), "event.json", JSON.stringify(payload));
  return recordGovernanceEvent({ repoRoot: root, stream, eventFile: file });
}

function statusMeta(root) {
  const text = fs.readFileSync(path.join(root, "docs/loops/status.md"), "utf8");
  return readFrontMatter(text).meta;
}

function streamsRepo(names) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-governance-streams-"));
  for (const name of names) {
    write(root, `docs/loops/${name}/status.md`, status({ gateStage: "verification" }));
    write(root, `apps/${name}/index.js`, `export const stream = ${JSON.stringify(name)};\n`);
    for (const stageName of ["requirements", "architecture", "specification", "tasks", "implementation", "verification"]) {
      write(root, `docs/loops/${name}/loop-1/${stageName}.md`, stage(stageName === "verification" ? "draft" : "confirmed"));
    }
  }
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["add", "docs"]);
  git(root, ["commit", "-qm", "stream fixture"]);
  return root;
}

function prepareReview(root, { stream = null } = {}) {
  const options = { stream };
  event(root, { type: "governance_migrated", role: "architect", stage: "verification", reason: "存量 Loop 已进入 Verification", summary: "迁移" }, options);
  for (const [extension, extra] of Object.entries({
    testing: { outcome: "PASS", evidence: "tests pass" },
    pbt: { outcome: "PASS", evidence: "seeded", caseCount: 100, seed: 7 },
    security: { outcome: "N/A", reason: "无安全边界变化" },
    resiliency: { outcome: "N/A", reason: "无运行时依赖" },
  })) event(root, { type: "extension_evaluated", role: "implementer", extension, summary: extension, ...extra }, options);
  event(root, { type: "architecture_reconciled", role: "implementer", stage: "verification", evidence: "baseline checked", summary: "对账" }, options);
}

function closeLoop(root, { stream = null, deliveryScope = null } = {}) {
  const options = { stream };
  prepareReview(root, options);
  event(root, {
    type: "review_completed",
    role: "reviewer",
    stage: "verification",
    outcome: "READY_FOR_HUMAN_REVIEW",
    evidence: "read-only review",
    summary: "审查",
    ...(stream ? { deliveryScope: deliveryScope ?? [`apps/${stream}`] } : {}),
  }, options);
  event(root, { type: "human_signed", role: "approver", stage: "verification", summary: "签署" }, options);

  const loopRoot = stream ? `docs/loops/${stream}` : "docs/loops";
  const archiveRoot = stream ? `docs/archive/${stream}` : "docs/archive";
  for (const stageName of ["requirements", "architecture", "specification", "tasks", "implementation", "verification"]) {
    const file = path.join(root, loopRoot, `loop-1/${stageName}.md`);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/status: (?:confirmed|draft)/, "status: archived"));
  }
  fs.mkdirSync(path.join(root, archiveRoot), { recursive: true });
  fs.renameSync(path.join(root, loopRoot, "loop-1"), path.join(root, archiveRoot, "loop-1-done"));
  const statusPath = path.join(root, loopRoot, "status.md");
  fs.writeFileSync(statusPath, fs.readFileSync(statusPath, "utf8")
    .replace("activeLoop: 1", "activeLoop: null")
    .replace("lastClosedLoop: null", "lastClosedLoop: 1"));
  event(root, { type: "loop_closed", role: "approver", stage: "verification", summary: "关闭" }, options);
}

test("stage approve 停在 awaiting-continue，后续独立 continue 才推进 nextPhase", () => {
  const root = repo();
  event(root, { type: "intent_captured", role: "requester", stage: "requirements", summary: "记录原始目标", input: "建立治理流程" });
  const approved = event(root, {
    type: "stage_approved",
    role: "product",
    stage: "requirements",
    summary: "需求已由产品确认",
  });
  assert.equal(statusMeta(root).gateState, "awaiting-continue");
  assert.equal(statusMeta(root).nextPhase, "requirements", "审批本身不得推进阶段");
  assert.match(approved.auditFile, /^docs\/loops\/loop-1\/audit\/.+\.jsonl$/);

  event(root, {
    type: "continue_authorized",
    role: "architect",
    stage: "requirements",
    summary: "用户在后续对话授权进入架构",
  });
  const meta = statusMeta(root);
  assert.equal(meta.gateState, "in-progress");
  assert.equal(meta.gateStage, "architecture");
  assert.equal(meta.nextPhase, "architecture");
  const architecture = path.join(root, "docs/loops/loop-1/architecture.md");
  fs.writeFileSync(architecture, fs.readFileSync(architecture, "utf8").replace("status: confirmed", "status: draft"));
  const report = buildLoopCheckReport(root);
  assert.equal(report.ok, true, JSON.stringify(report.problems, null, 2));
});

test("阶段文档在 approve 后变化会使 Continue 和 check 同时失败", () => {
  const root = repo();
  event(root, { type: "stage_approved", role: "product", stage: "requirements", summary: "确认" });
  fs.appendFileSync(path.join(root, "docs/loops/loop-1/requirements.md"), "\n后来改变\n");

  assert.throws(
    () => event(root, { type: "continue_authorized", role: "product", stage: "requirements", summary: "继续" }),
    /旧审批已失效/,
  );
  const report = buildLoopCheckReport(root);
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((problem) => problem.detail.includes("旧审批已经失效")));
});

test("已经 Continue 的早期阶段文档后来变化，C8 仍会抓到旧审批失效", () => {
  const root = repo();
  event(root, { type: "intent_captured", role: "requester", stage: "requirements", summary: "原始目标", input: "目标" });
  event(root, { type: "stage_approved", role: "product", stage: "requirements", summary: "确认" });
  event(root, { type: "continue_authorized", role: "architect", stage: "requirements", summary: "进入架构" });
  fs.appendFileSync(path.join(root, "docs/loops/loop-1/requirements.md"), "\n越过门禁修改\n");
  const report = buildLoopCheckReport(root);
  assert.ok(report.problems.some((problem) => problem.detail.includes("requirements.md 缺少有效的审批/Continue 指纹")));
});

test("Git 身份必须匹配 status.md 中声明的项目角色", () => {
  const root = repo();
  git(root, ["config", "user.email", "outsider@example.com"]);
  assert.throws(
    () => event(root, { type: "stage_approved", role: "product", stage: "requirements", summary: "越权" }),
    /没有登记为 product/,
  );
});

test("审计输入脱敏、隐藏仓库绝对路径并保持哈希链", () => {
  const root = repo();
  const result = event(root, {
    type: "change_decision",
    role: "architect",
    summary: `配置在 ${root}，另一个 worktree 在 /Volumes/worktrees/customer，password=hunter2`,
    input: 'Bearer abcdefghijklmnopqrstuvwxyz，JSON 是 {"password":"JSON_SECRET"}',
    evidence: "-----BEGIN PRIVATE KEY-----\nTOP_SECRET_KEY_MATERIAL\n-----END PRIVATE KEY-----",
    minimalCounterexample: "secret=counterexample-token",
  });
  const text = fs.readFileSync(path.join(root, result.auditFile), "utf8");
  assert.ok(!text.includes("hunter2"));
  assert.ok(!text.includes("abcdefghijklmnopqrstuvwxyz"));
  assert.ok(!text.includes("JSON_SECRET"));
  assert.ok(!text.includes("TOP_SECRET_KEY_MATERIAL"));
  assert.ok(!text.includes("/Volumes/worktrees/customer"));
  assert.ok(!text.includes("counterexample-token"));
  assert.ok(!text.includes(root));
  assert.ok(text.includes("[REDACTED]") && text.includes("[REPO]") && text.includes("[LOCAL_PATH]"));
  const stored = JSON.parse(text);
  assert.equal(stored.payload.summaryRedacted, true);
  assert.deepEqual(readAuditDirectory(path.join(root, "docs/loops/loop-1")).issues, []);
});

test("代码指纹只排除 Loop 审计分片，不忽略业务 audit 目录", () => {
  const root = repo();
  const options = {
    statusRel: "docs/loops/status.md",
    excludePrefixes: ["docs/loops/loop-1/audit"],
  };
  const before = fingerprintRepo(root, options);
  write(root, "src/audit/rules.js", "export const auditRule = 1;\n");
  const after = fingerprintRepo(root, options);
  assert.notEqual(after, before);
});

test("代码指纹包含 Git 可执行位，chmod 会使旧审查失效", () => {
  const root = repo();
  const script = write(root, "scripts/run.sh", "#!/bin/sh\nexit 0\n");
  fs.chmodSync(script, 0o644);
  git(root, ["add", "scripts/run.sh"]);
  const before = fingerprintRepo(root);
  fs.chmodSync(script, 0o755);
  const after = fingerprintRepo(root);
  assert.notEqual(after, before);
});

test("审计事件被改写后 C7 报哈希失效", () => {
  const root = repo();
  const result = event(root, { type: "change_decision", role: "architect", summary: "原决定" });
  const file = path.join(root, result.auditFile);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("原决定", "篡改决定"));
  const report = buildLoopCheckReport(root);
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((problem) => problem.detail.includes("eventHash")));
});

test("合法 JSON 但不是对象的审计行由 C7 报告，不让 check 崩溃", () => {
  const root = repo();
  const result = event(root, { type: "change_decision", role: "architect", summary: "原决定" });
  fs.appendFileSync(path.join(root, result.auditFile), "null\n");
  const report = buildLoopCheckReport(root);
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((problem) => problem.detail.includes("不是合法的审计事件对象")));
});

test("审计目录和分片拒绝软链，不能借治理写入口改仓库外文件", () => {
  const root = repo();
  const outside = write(fs.mkdtempSync(path.join(os.tmpdir(), "sdd-outside-")), "outside.jsonl", "outside\n");
  const auditDir = path.join(root, "docs/loops/loop-1/audit");
  fs.mkdirSync(auditDir, { recursive: true });
  fs.symlinkSync(outside, path.join(auditDir, "escape.jsonl"));

  assert.throws(
    () => event(root, { type: "change_decision", role: "architect", summary: "不能写软链" }),
    /审计分片必须是普通文件/,
  );
  assert.equal(fs.readFileSync(outside, "utf8"), "outside\n");
  assert.ok(buildLoopCheckReport(root).problems.some((problem) => problem.detail.includes("拒绝跟随软链")));
});

test("Verification 必须逐项给出扩展证据，PBT 无库时仍记录 cases 与 seed", () => {
  const root = repo({ gateStage: "verification" });
  const report = buildLoopCheckReport(root);
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((entry) => entry.id === "C9").findings.length, 4);

  event(root, { type: "extension_evaluated", role: "implementer", extension: "testing", outcome: "PASS", evidence: "node --test passed", summary: "测试完成" });
  event(root, { type: "extension_evaluated", role: "implementer", extension: "pbt", outcome: "PASS", evidence: "node:test + seeded generator", caseCount: 2000, seed: 20260909, summary: "属性测试完成" });
  event(root, { type: "extension_evaluated", role: "implementer", extension: "security", outcome: "N/A", reason: "纯离线 Markdown 格式修改，无输入或权限边界", summary: "安全适用性判断" });
  event(root, { type: "extension_evaluated", role: "implementer", extension: "resiliency", outcome: "N/A", reason: "没有长期运行服务和外部依赖", summary: "韧性适用性判断" });
  assert.equal(buildLoopCheckReport(root).checks.find((entry) => entry.id === "C9").ok, true);
});

test("代码变化会使旧的工程扩展证据失效，READY review 被拒绝", () => {
  const root = repo({ gateStage: "verification" });
  event(root, { type: "governance_migrated", role: "architect", stage: "verification", reason: "存量迁移", summary: "迁移" });
  for (const [extension, extra] of Object.entries({
    testing: { outcome: "PASS", evidence: "tests pass" },
    pbt: { outcome: "PASS", evidence: "seeded", caseCount: 100, seed: 1 },
    security: { outcome: "N/A", reason: "无安全边界" },
    resiliency: { outcome: "N/A", reason: "无运行时" },
  })) event(root, { type: "extension_evaluated", role: "implementer", extension, summary: extension, ...extra });
  write(root, "src/new-behavior.js", "export const changed = true;\n");
  event(root, { type: "architecture_reconciled", role: "implementer", stage: "verification", evidence: "已回写", summary: "对账" });
  assert.throws(
    () => event(root, { type: "review_completed", role: "reviewer", stage: "verification", outcome: "READY_FOR_HUMAN_REVIEW", evidence: "审查", summary: "ready" }),
    /工程扩展 testing 尚未通过/,
  );
});

test("AI Review 指纹、人工签署与关闭事件形成完整门禁", () => {
  const root = repo({ gateStage: "verification" });
  event(root, { type: "governance_migrated", role: "architect", stage: "verification", reason: "存量 Loop 已进入 Verification，历史对话不可可靠补录", summary: "从当前事实启用治理" });
  for (const [extension, extra] of Object.entries({
    testing: { outcome: "PASS", evidence: "all tests passed" },
    pbt: { outcome: "PASS", evidence: "seeded generator", caseCount: 1000, seed: 7 },
    security: { outcome: "N/A", reason: "无安全边界变化" },
    resiliency: { outcome: "N/A", reason: "无运行时依赖" },
  })) {
    event(root, { type: "extension_evaluated", role: "implementer", extension, summary: `${extension} 完成`, ...extra });
  }
  event(root, { type: "architecture_reconciled", role: "implementer", stage: "verification", evidence: "docs/architecture/overview.md 与 change surface", summary: "长期架构已按最终代码回写" });
  event(root, { type: "review_completed", role: "reviewer", stage: "verification", outcome: "READY_FOR_HUMAN_REVIEW", evidence: "独立只读审查无阻断发现", summary: "AI review 完成" });
  assert.equal(statusMeta(root).gateState, "ready-for-human-review");
  assert.equal(statusMeta(root).gateFingerprint, fingerprintRepo(root, {
    statusRel: "docs/loops/status.md",
    excludePrefixes: ["docs/loops/loop-1/audit"],
  }));
  const reviewed = buildLoopCheckReport(root);
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed.problems, null, 2));

  event(root, { type: "human_signed", role: "approver", stage: "verification", summary: "人工通过当前指纹" });
  assert.throws(
    () => event(root, { type: "loop_closed", role: "approver", stage: "verification", summary: "过早关闭" }),
    /先归档阶段文档并清空 activeLoop/,
  );
  for (const name of ["requirements", "architecture", "specification", "tasks", "implementation", "verification"]) {
    const file = path.join(root, `docs/loops/loop-1/${name}.md`);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/status: (?:confirmed|draft)/, "status: archived"));
  }
  fs.mkdirSync(path.join(root, "docs/archive"), { recursive: true });
  fs.renameSync(path.join(root, "docs/loops/loop-1"), path.join(root, "docs/archive/loop-1-done"));
  const statusPath = path.join(root, "docs/loops/status.md");
  fs.writeFileSync(statusPath, fs.readFileSync(statusPath, "utf8")
    .replace("activeLoop: 1", "activeLoop: null")
    .replace("lastClosedLoop: null", "lastClosedLoop: 1"));
  event(root, { type: "loop_closed", role: "approver", stage: "verification", summary: "归档完成并关闭 Loop" });
  assert.equal(statusMeta(root).gateState, "closed");
  const closed = buildLoopCheckReport(root);
  assert.equal(closed.ok, true, JSON.stringify(closed.problems, null, 2));
});

test("已关闭 Loop 的漂移只能由 Approver 以当前交付指纹明确接受", () => {
  const root = repo({ gateStage: "verification" });
  closeLoop(root);
  write(root, "src/later.js", "export const later = 1;\n");
  assert.ok(buildLoopCheckReport(root).problems.some((problem) => problem.detail.includes("Loop 关闭后")));

  assert.throws(
    () => event(root, { type: "closure_drift_accepted", role: "approver", summary: "接受漂移", evidence: "src/later.js" }),
    /必须说明接受漂移的 reason/,
  );
  assert.throws(
    () => event(root, { type: "closure_drift_accepted", role: "approver", summary: "接受漂移", reason: "后续合法交付" }),
    /必须在 evidence 中列出/,
  );
  event(root, {
    type: "closure_drift_accepted",
    role: "approver",
    summary: "接受已关闭 Loop 之后的合法交付",
    reason: "这是后续独立范围的已审交付",
    evidence: "核对 src/later.js，不修改原 Loop 归档和签署事实",
  });
  assert.equal(buildLoopCheckReport(root).ok, true);
  assert.throws(
    () => event(root, {
      type: "closure_drift_accepted", role: "approver", summary: "重复接受", reason: "重复", evidence: "相同交付",
    }),
    /最近一次关闭\/接受时一致/,
  );

  write(root, "src/later-again.js", "export const laterAgain = 2;\n");
  assert.ok(buildLoopCheckReport(root).problems.some((problem) => problem.detail.includes("Loop 关闭后")));
});

test("closure_drift_accepted 不能在 Loop 关闭前预先记录", () => {
  const root = repo({ gateStage: "verification" });
  assert.throws(
    () => event(root, {
      type: "closure_drift_accepted",
      role: "approver",
      summary: "预先放行未来变化",
      reason: "错误预授权",
      evidence: "尚无变化",
    }),
    /只能追加到已经关闭并归档的 Loop/,
  );
});

test("分流 READY review 必须声明本轮真实 deliveryScope", () => {
  const root = streamsRepo(["maker"]);
  prepareReview(root, { stream: "maker" });
  assert.throws(
    () => event(root, {
      type: "review_completed",
      role: "reviewer",
      stage: "verification",
      outcome: "READY_FOR_HUMAN_REVIEW",
      evidence: "read-only review",
      summary: "漏掉交付范围",
    }, { stream: "maker" }),
    /必须提供非空 deliveryScope/,
  );
  assert.throws(
    () => event(root, {
      type: "review_completed",
      role: "reviewer",
      stage: "verification",
      outcome: "READY_FOR_HUMAN_REVIEW",
      evidence: "read-only review",
      summary: "危险范围",
      deliveryScope: ["../outside"],
    }, { stream: "maker" }),
    /不是安全的仓库相对路径/,
  );
  assert.throws(
    () => event(root, {
      type: "review_completed",
      role: "reviewer",
      stage: "verification",
      outcome: "READY_FOR_HUMAN_REVIEW",
      evidence: "read-only review",
      summary: "空范围",
      deliveryScope: ["apps/not-a-real-stream"],
    }, { stream: "maker" }),
    /没有匹配任何 Git 已知文件/,
  );
  assert.throws(
    () => event(root, {
      type: "review_completed",
      role: "reviewer",
      stage: "verification",
      outcome: "READY_FOR_HUMAN_REVIEW",
      evidence: "read-only review",
      summary: "控制目录",
      deliveryScope: ["docs/loops/maker"],
    }, { stream: "maker" }),
    /不能覆盖 Loop 控制或归档目录/,
  );
  assert.throws(
    () => event(root, {
      type: "review_completed",
      role: "reviewer",
      stage: "verification",
      outcome: "READY_FOR_HUMAN_REVIEW",
      evidence: "read-only review",
      summary: "通配符",
      deliveryScope: ["apps/maker/**"],
    }, { stream: "maker" }),
    /不支持通配符/,
  );
});

test("旧分流 Loop 可在首次漂移接受时补录 deliveryScope，之后不再受兄弟范围影响", () => {
  const root = repo({ gateStage: "verification" });
  closeLoop(root);

  fs.mkdirSync(path.join(root, "docs/loops/maker"), { recursive: true });
  fs.renameSync(path.join(root, "docs/loops/status.md"), path.join(root, "docs/loops/maker/status.md"));
  fs.mkdirSync(path.join(root, "docs/archive/maker"), { recursive: true });
  fs.renameSync(path.join(root, "docs/archive/loop-1-done"), path.join(root, "docs/archive/maker/loop-1-done"));
  write(root, "apps/maker/index.js", "export const maker = 1;\n");
  assert.equal(buildRepoCheckReport(root).ok, false);

  event(root, {
    type: "closure_drift_accepted",
    role: "approver",
    summary: "接受存量 Loop 漂移并建立保护范围",
    reason: "旧关闭事件没有 deliveryScope",
    evidence: "核对 apps/maker 为本 Loop 的实际交付范围",
    deliveryScope: ["apps/maker"],
  }, { stream: "maker" });
  assert.equal(buildRepoCheckReport(root).ok, true);

  write(root, "apps/another-stream/index.js", "export const another = 1;\n");
  assert.equal(buildRepoCheckReport(root).ok, true, "兄弟流范围变化不应再让 maker 变红");
  write(root, "apps/maker/changed.js", "export const changed = 2;\n");
  assert.equal(buildRepoCheckReport(root).ok, false, "maker 自己的保护范围变化仍必须报 C10");
});

test("分流只校验本轮 deliveryScope，兄弟流推进不会让已关闭 Loop 变红", () => {
  const root = streamsRepo(["maker", "storage-service"]);
  closeLoop(root, { stream: "maker" });
  closeLoop(root, { stream: "storage-service" });
  assert.equal(buildRepoCheckReport(root).ok, true);

  write(root, "apps/maker/change.js", "export const changed = true;\n");
  let report = buildRepoCheckReport(root);
  assert.equal(report.problemCount, 1, "maker 自己的交付漂移只能让 maker 报 C10");
  assert.equal(report.streams.find((entry) => entry.name === "maker").report.ok, false);
  assert.equal(report.streams.find((entry) => entry.name === "storage-service").report.ok, true);

  const acceptance = {
    type: "closure_drift_accepted",
    role: "approver",
    summary: "接受其他流的合法交付",
    reason: "已核对为独立范围",
    evidence: "apps/maker/change.js；不涉及当前流归档",
  };
  event(root, acceptance, { stream: "maker" });
  report = buildRepoCheckReport(root);
  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.throws(
    () => event(root, { ...acceptance, deliveryScope: ["apps/storage-service"] }, { stream: "maker" }),
    /deliveryScope 不能在关闭后被缩小或替换/,
  );

  write(root, "apps/storage-service/change.js", "export const storageChanged = true;\n");
  report = buildRepoCheckReport(root);
  assert.equal(report.streams.find((entry) => entry.name === "maker").report.ok, true);
  assert.equal(report.streams.find((entry) => entry.name === "storage-service").report.ok, false);
});

test("PBT PASS 缺 seed 或样本数时拒绝记录，而没有 PBT 库不构成 N/A 理由", () => {
  const root = repo({ gateStage: "verification" });
  assert.throws(
    () => event(root, { type: "extension_evaluated", role: "implementer", extension: "pbt", outcome: "PASS", evidence: "random cases", summary: "PBT" }),
    /caseCount 和 seed/,
  );
  assert.throws(
    () => event(root, { type: "extension_evaluated", role: "implementer", extension: "pbt", outcome: "N/A", summary: "没有库" }),
    /必须给出 reason/,
  );
  assert.throws(
    () => event(root, { type: "extension_evaluated", role: "implementer", extension: "pbt", outcome: "N/A", reason: "没有 PBT 库", summary: "没有库" }),
    /本身不是 N\/A 理由/,
  );
});

test("治理事件不能绕过生命周期写到错误阶段", () => {
  const root = repo();
  assert.throws(
    () => event(root, { type: "architecture_reconciled", role: "implementer", evidence: "过早", summary: "过早对账" }),
    /只能在 Verification/,
  );
  assert.throws(
    () => event(root, { type: "change_decision", role: "architect", stage: "operations", summary: "不存在的阶段" }),
    /事件阶段不合法/,
  );
});

test("项目扩展：无 opt-in 必须启用，有 opt-in 可以保持关闭", () => {
  const root = repo();
  write(root, "docs/sdd/extensions/api/compatibility.md", "---\nextension: compatibility\nstages: architecture,specification,verification\n---\n\n# 兼容规则\n");
  let c6 = buildLoopCheckReport(root).checks.find((entry) => entry.id === "C6");
  assert.ok(c6.findings.some((finding) => finding.detail.includes("必须始终启用")));

  write(root, "docs/sdd/extensions/api/compatibility.opt-in.md", "---\nextension: compatibility\n---\n\n本轮是否改变公共 API？\n");
  c6 = buildLoopCheckReport(root).checks.find((entry) => entry.id === "C6");
  assert.ok(!c6.findings.some((finding) => finding.detail.includes("必须始终启用")));
});

test("项目扩展与内置扩展重名时报告冲突，不静默覆盖", () => {
  const root = repo();
  write(root, "docs/sdd/extensions/custom/pbt.md", "---\nextension: pbt\nstages: verification\n---\n\n# shadow\n");
  const report = buildLoopCheckReport(root);
  assert.ok(report.problems.some((problem) => problem.detail.includes("与内置扩展重名")));
});

test("内部 CLI 从 event JSON 记录事件，不把原始输入放进命令行", () => {
  const root = repo();
  const file = write(fs.mkdtempSync(path.join(os.tmpdir(), "sdd-cli-event-")), "event.json", JSON.stringify({
    type: "change_decision",
    role: "architect",
    summary: "采用兼容增强",
    input: "password=do-not-store",
  }));
  const result = spawnSync(process.execPath, [CLI, "_governance", "record", "--repo", root, "--event-json", file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.ok(output.auditFile.endsWith(".jsonl"));
  const stored = fs.readFileSync(path.join(root, output.auditFile), "utf8");
  assert.ok(!stored.includes("do-not-store"));
});

test("分流仓库必须指定 stream，并把审计写入该流的 Loop", () => {
  const root = repo();
  const streamRoot = path.join(root, "docs/loops/maker");
  fs.mkdirSync(streamRoot, { recursive: true });
  fs.renameSync(path.join(root, "docs/loops/status.md"), path.join(streamRoot, "status.md"));
  fs.renameSync(path.join(root, "docs/loops/loop-1"), path.join(streamRoot, "loop-1"));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "split fixture"]);

  assert.throws(
    () => event(root, { type: "change_decision", role: "architect", summary: "缺少分流" }),
    /请用 --stream/,
  );
  const result = event(root, { type: "change_decision", role: "architect", summary: "maker 决策" }, { stream: "maker" });
  assert.match(result.auditFile, /^docs\/loops\/maker\/loop-1\/audit\/.+\.jsonl$/);
});

test("存量 Loop 用 governance_migrated 声明起点，不要求伪造早期阶段事件", () => {
  const root = repo({ gateStage: "implementation" });
  let report = buildLoopCheckReport(root);
  assert.ok(report.problems.some((problem) => problem.detail.includes("不能伪造原始意图")));
  event(root, {
    type: "governance_migrated",
    role: "architect",
    stage: "implementation",
    reason: "升级时已在实施阶段，早期审批发生在治理启用前",
    summary: "记录治理迁移起点",
  });
  report = buildLoopCheckReport(root);
  assert.ok(!report.problems.some((problem) => problem.detail.includes("审批/Continue 指纹")));
});
