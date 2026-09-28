import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { loadWorkflow, parseWorkflow, recommendWorkflow } from "../src/workflow/definition.js";
import { startWorkflow, recordWorkflowEvent, closeWorkflow, readWorkflowRun } from "../src/workflow/runtime.js";
import { checkProvenance } from "../src/workflow/provenance.js";
import { receiptAtCommit } from "../src/workflow/source.js";
import { buildLoopCheckReport } from "../src/validation/loop-check.js";
import { scanLoopRepo } from "../src/loop/repo-scan.js";
import { buildGovernanceChecks } from "../src/validation/governance-check.js";

function write(root, file, text) {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}
function git(root, ...args) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim(); }
function fixture({ loop = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-v2-"));
  write(root, "docs/loops/status.md", `---\nactiveLoop: ${loop ? "1" : "null"}\nlastClosedLoop: null\nnextLoop: 2\ngovernanceVersion: 2\n---\n`);
  if (loop) {
    for (const doc of ["requirements", "architecture", "specification", "tasks", "implementation", "verification"]) {
      write(root, `docs/loops/loop-1/${doc}.md`, `---\nstatus: confirmed\n---\n\n# ${doc}\n`);
    }
  }
  write(root, "src/app.js", "export const app = 1;\n");
  git(root, "init", "-q");
  git(root, "config", "user.name", "Submitter");
  git(root, "config", "user.email", "submitter@example.com");
  git(root, "add", ".");
  git(root, "commit", "-qm", "baseline");
  return root;
}
function record(root, dir, stage, evidence = stage, extra = {}) {
  return recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "stage_completed", stage, summary: stage, evidence, ...extra } });
}

test("CLI 从文件推荐与确认流程，明确 v2 入口和参数错误", () => {
  const root = fixture();
  assert.ok(buildGovernanceChecks(scanLoopRepo(root)).find((entry) => entry.id === "C6").findings.some((finding) => finding.detail.includes("不支持 governanceVersion: 2")));
  const cli = path.resolve(import.meta.dirname, "../scripts/sdd-loop.mjs");
  const request = path.join(root, "request.txt");
  fs.writeFileSync(request, "线上故障紧急修复");
  const recommend = spawnSync(process.execPath, [cli, "workflow", "recommend", "--request-file", request, "--repo", root], { encoding: "utf8" });
  assert.equal(recommend.status, 0, recommend.stderr);
  assert.equal(JSON.parse(recommend.stdout).route, "hotfix");
  const confirmed = path.join(root, "confirmed.json");
  fs.writeFileSync(confirmed, JSON.stringify({ route: "hotfix", input: "确认按 Hotfix 处理" }));
  const start = spawnSync(process.execPath, [cli, "workflow", "start", "--route", "hotfix", "--id", "HF-CLI", "--confirmation-json", confirmed, "--repo", root], { encoding: "utf8" });
  assert.equal(start.status, 0, start.stderr);
  assert.equal(JSON.parse(start.stdout).route, "hotfix");
  const invalid = spawnSync(process.execPath, [cli, "workflow", "start", "--route", "hotfix", "--id", "HF-CLI", "--confirmation-json", confirmed, "--repo", root], { encoding: "utf8" });
  assert.equal(invalid.status, 2);
});

test("路线推荐需确认；项目与流级 workflow.md 完整覆盖并拒绝依赖环", () => {
  assert.equal(recommendWorkflow("人工手测持续报 bug").route, "debug");
  assert.equal(recommendWorkflow("线上故障紧急修复").route, "hotfix");
  assert.equal(recommendWorkflow("新增一个功能").route, "loop");
  const root = fixture();
  const builtin = loadWorkflow(root, "hotfix");
  write(root, "docs/sdd/workflows/hotfix/workflow.md", fs.readFileSync(path.resolve(import.meta.dirname, "../workflows/hotfix/workflow.md"), "utf8").replace("signoff: submitter", "signoff: none"));
  assert.equal(loadWorkflow(root, "hotfix").definition.signoff, "none");
  write(root, "docs/sdd/workflows/maker/hotfix/workflow.md", fs.readFileSync(path.resolve(import.meta.dirname, "../workflows/hotfix/workflow.md"), "utf8").replace("signoff: submitter", "signoff: optional"));
  assert.equal(loadWorkflow(root, "hotfix", { stream: "maker" }).definition.signoff, "optional");
  assert.notEqual(loadWorkflow(root, "hotfix").hash, builtin.hash);
  const dir = startWorkflow({ repoRoot: root, route: "hotfix", id: "LOCK-1", confirmation: { route: "hotfix", input: "确认当前流程" } }).runDir;
  write(root, "docs/sdd/workflows/hotfix/workflow.md", fs.readFileSync(path.resolve(import.meta.dirname, "../workflows/hotfix/workflow.md"), "utf8"));
  assert.equal(readWorkflowRun(root, dir).lock.workflow.definition.signoff, "none", "启动后的配置编辑不能重释已锁定工作");
  const lockFile = path.join(root, dir, "workflow.lock.json");
  const corrupted = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  corrupted.submitter.email = "forged@example.com";
  fs.writeFileSync(lockFile, JSON.stringify(corrupted));
  assert.throws(() => readWorkflowRun(root, dir), /摘要不匹配/);
  const text = fs.readFileSync(path.resolve(import.meta.dirname, "../workflows/hotfix/workflow.md"), "utf8");
  assert.throws(() => parseWorkflow(text.replace("needs: [signoff]", "needs: [close]"), "hotfix"), /自引用|依赖环/);
});

test("多轮手测轻记录后一次正式审查；兄弟文件无关而共享文件变化要补审", () => {
  const root = fixture({ loop: true });
  assert.throws(() => startWorkflow({ repoRoot: root, route: "loop", confirmation: { route: "hotfix", input: "确认" } }), /确认/);
  const started = startWorkflow({ repoRoot: root, route: "loop", confirmation: { route: "loop", input: "确认标准 Loop" } });
  const dir = started.runDir;
  for (const stage of ["requirements", "architecture", "specification", "tasks", "implementation"]) record(root, dir, stage, stage, stage === "requirements" ? { confirmation: "确认本轮需求" } : {});
  for (const issue of ["bug A", "bug B"]) {
    recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "cycle", summary: issue, issue, fixScope: "src/app.js", targetedTest: "node test", deployment: "test-v1", retest: "PASS" } });
  }
  record(root, dir, "verification");
  write(root, "src/app.js", "export const app = 2;\n");
  const candidate = recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "candidate", summary: "稳定候选" } });
  assert.ok(candidate.candidateId);
  record(root, dir, "final_test");
  record(root, dir, "reconciliation");
  record(root, dir, "review", "independent review", { outcome: "READY_FOR_HUMAN_REVIEW" });
  record(root, dir, "signoff", "submitter approval", { outcome: "SIGNED" });
  write(root, "src/sibling.js", "export const sibling = 1;\n");
  assert.equal(buildLoopCheckReport(root).checks.find((entry) => entry.id === "C8").ok, true);
  write(root, "src/app.js", "export const app = 3;\n");
  assert.equal(buildLoopCheckReport(root).checks.find((entry) => entry.id === "C8").ok, false);
  recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "cycle", summary: "review correction", issue: "shared file", fixScope: "src/app.js", targetedTest: "node test", deployment: "test-v2", retest: "PASS" } });
  // The sibling's new file must be explicitly attributed before the new candidate.
  assert.throws(() => recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "candidate", summary: "new candidate", files: ["src/app.js"] } }), /不能无归属/);
});

test("关闭后的同文件改动由后续交付负责；溯源区分覆盖、漂移和未归属", () => {
  const root = fixture();
  const base = git(root, "rev-parse", "HEAD");
  const dir = startWorkflow({ repoRoot: root, route: "hotfix", id: "HF-1", confirmation: { route: "hotfix", input: "确认独立修复" } }).runDir;
  write(root, "src/app.js", "export const app = 2;\n");
  write(root, `${dir}/hotfix.md`, "---\nstatus: confirmed\n---\n\n# Hotfix\n");
  record(root, dir, "implementation");
  record(root, dir, "deployment");
  record(root, dir, "manual_test");
  recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "candidate", summary: "稳定候选" } });
  record(root, dir, "final_test");
  record(root, dir, "reconciliation");
  record(root, dir, "review", "AI review", { outcome: "READY_FOR_HUMAN_REVIEW" });
  record(root, dir, "signoff", "submitter", { outcome: "SIGNED" });
  write(root, "src/app.js", "export const app = 3;\n");
  recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "cycle", summary: "review correction", issue: "late bug", fixScope: "src/app.js", targetedTest: "targeted PASS", deployment: "test-v2", retest: "PASS" } });
  recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "candidate", summary: "修订候选" } });
  record(root, dir, "final_test", "final test rerun");
  record(root, dir, "reconciliation", "architecture rerun");
  assert.throws(() => record(root, dir, "review", "review again", { outcome: "READY_FOR_HUMAN_REVIEW" }), /deltaReview/);
  record(root, dir, "review", "review again", { outcome: "READY_FOR_HUMAN_REVIEW", deltaReview: "仅复审 src/app.js 中 app 值的变化" });
  record(root, dir, "signoff", "submitter signed revised candidate", { outcome: "SIGNED" });
  write(root, `${dir}/hotfix.md`, "---\nstatus: archived\n---\n\n# Hotfix\n");
  closeWorkflow({ repoRoot: root, runDir: dir, summary: "完成", evidence: "人工验收" });
  git(root, "add", ".");
  git(root, "commit", "-qm", "deliver");
  const head = git(root, "rev-parse", "HEAD");
  assert.equal(checkProvenance(root, { base, head }).rows.find((row) => row.path === "src/app.js").classification, "covered");
  write(root, "src/app.js", "export const app = 4;\n");
  write(root, "src/unowned.js", "export const unowned = 1;\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "later");
  const later = git(root, "rev-parse", "HEAD");
  const classifications = Object.fromEntries(checkProvenance(root, { base: head, head: later }).rows.map((row) => [row.path, row.classification]));
  assert.equal(classifications["src/app.js"], "drifted");
  assert.equal(classifications["src/unowned.js"], "unattributed");
  const next = startWorkflow({ repoRoot: root, route: "hotfix", id: "HF-2", confirmation: { route: "hotfix", input: "确认后续交付" } }).runDir;
  write(root, `${next}/hotfix.md`, "---\nstatus: confirmed\n---\n\n# Later Fix\n");
  write(root, "src/app.js", "export const app = 5;\n");
  for (const stage of ["implementation", "deployment", "manual_test"]) record(root, next, stage);
  recordWorkflowEvent({ repoRoot: root, runDir: next, payload: { type: "candidate", summary: "后续稳定候选" } });
  for (const stage of ["final_test", "reconciliation"]) record(root, next, stage);
  record(root, next, "review", "later review", { outcome: "READY_FOR_HUMAN_REVIEW" });
  record(root, next, "signoff", "later signoff", { outcome: "SIGNED" });
  write(root, `${next}/hotfix.md`, "---\nstatus: archived\n---\n\n# Later Fix\n");
  closeWorkflow({ repoRoot: root, runDir: next, summary: "后续关闭", evidence: "已验收" });
  git(root, "add", ".");
  git(root, "commit", "-qm", "later reviewed delivery");
  assert.equal(checkProvenance(root, { base: later, head: git(root, "rev-parse", "HEAD") }).rows.find((row) => row.path === "src/app.js")?.classification, "covered");
});

test("需求和架构只修订受影响文档，下游通过短证据重验", () => {
  const root = fixture({ loop: true });
  const dir = startWorkflow({ repoRoot: root, route: "loop", confirmation: { route: "loop", input: "确认" } }).runDir;
  for (const stage of ["requirements", "architecture", "specification", "tasks", "implementation"]) record(root, dir, stage, "confirmed", stage === "requirements" ? { confirmation: "确认原需求" } : {});
  record(root, dir, "deployment");
  record(root, dir, "manual_test");
  record(root, dir, "verification");
  recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "decision", summary: "产品行为更新", confirmation: "确认调整响应" } });
  write(root, `${dir}/requirements.md`, "---\nstatus: confirmed\n---\n\n# Revised requirement\n");
  record(root, dir, "requirements", "changed clauses confirmed", { confirmation: "确认新条款" });
  write(root, "src/app.js", "export const app = 2;\n");
  assert.throws(() => recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "candidate", summary: "first candidate" } }), /重验受影响的 architecture/);
  for (const stage of ["architecture", "specification", "tasks", "implementation", "verification"]) recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "stage_revalidated", stage, summary: `revalidate ${stage}`, evidence: "受影响条款已核对，内容无需修改" } });
  recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "impact", summary: "架构边界调整", impact: "模块依赖调整" } });
  write(root, `${dir}/architecture.md`, "---\nstatus: confirmed\n---\n\n# Revised architecture\n");
  record(root, dir, "architecture", "new architecture confirmed");
  for (const stage of ["specification", "tasks", "implementation", "verification"]) recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "stage_revalidated", stage, summary: `revalidate ${stage}`, evidence: "按新架构核对" } });
  assert.ok(recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "candidate", summary: "stable" } }).candidateId);
});

test("候选前兄弟流文件只有被另一流的真实源码认领才能排除", () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "docs/loops/maker"), { recursive: true });
  fs.renameSync(path.join(root, "docs/loops/status.md"), path.join(root, "docs/loops/maker/status.md"));
  write(root, "docs/loops/storage/status.md", "---\nactiveLoop: null\nlastClosedLoop: null\ngovernanceVersion: 2\n---\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "split streams");
  const maker = startWorkflow({ repoRoot: root, stream: "maker", route: "hotfix", id: "M-1", confirmation: { route: "hotfix", input: "确认 maker" } }).runDir;
  const storage = startWorkflow({ repoRoot: root, stream: "storage", route: "hotfix", id: "S-1", confirmation: { route: "hotfix", input: "确认 storage" } }).runDir;
  write(root, "src/maker.js", "export const maker = 1;\n");
  write(root, "src/storage.js", "export const storage = 1;\n");
  write(root, `${maker}/hotfix.md`, "---\nstatus: confirmed\n---\n\n# Maker Hotfix\n");
  recordWorkflowEvent({ repoRoot: root, runDir: storage, payload: { type: "claim", summary: "storage 认领", evidence: "storage 修复", files: ["src/storage.js"] } });
  for (const stage of ["implementation", "deployment", "manual_test"]) record(root, maker, stage);
  const result = recordWorkflowEvent({ repoRoot: root, runDir: maker, payload: { type: "candidate", summary: "maker 稳定候选", files: ["src/maker.js"], assignedElsewhere: { "src/storage.js": storage } } });
  assert.ok(result.candidateId);
  write(root, "src/storage.js", "export const storage = 2;\n");
  assert.throws(() => recordWorkflowEvent({ repoRoot: root, runDir: maker, payload: { type: "candidate", summary: "retry", files: ["src/maker.js"], assignedElsewhere: { "src/storage.js": storage } } }), /未被.*当前源码清单覆盖/);
});

test("指定角色签署锁定启动时邮箱，提交者签署策略不写死项目审批人", () => {
  const root = fixture();
  const builtin = fs.readFileSync(path.resolve(import.meta.dirname, "../workflows/hotfix/workflow.md"), "utf8");
  write(root, "docs/sdd/workflows/hotfix/workflow.md", builtin.replace("signoff: submitter", "signoff: role\nsignerRole: reviewer"));
  const statusFile = path.join(root, "docs/loops/status.md");
  fs.writeFileSync(statusFile, fs.readFileSync(statusFile, "utf8").replace("governanceVersion: 2", "governanceVersion: 2\nroleReviewer: reviewer@example.com"));
  const dir = startWorkflow({ repoRoot: root, route: "hotfix", id: "HF-ROLE", confirmation: { route: "hotfix", input: "确认角色签署" } }).runDir;
  write(root, `${dir}/hotfix.md`, "---\nstatus: confirmed\n---\n\n# Fix\n");
  write(root, "src/app.js", "export const app = 2;\n");
  for (const stage of ["implementation", "deployment", "manual_test"]) record(root, dir, stage);
  recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "candidate", summary: "稳定候选" } });
  record(root, dir, "final_test");
  record(root, dir, "reconciliation");
  record(root, dir, "review", "reviewed", { outcome: "READY_FOR_HUMAN_REVIEW" });
  assert.throws(() => record(root, dir, "signoff", "wrong actor", { outcome: "SIGNED", role: "reviewer" }), /未登记/);
  git(root, "config", "user.email", "reviewer@example.com");
  record(root, dir, "signoff", "designated reviewer", { outcome: "SIGNED", role: "reviewer" });
  assert.equal(buildLoopCheckReport(root).checks.find((entry) => entry.id === "C10").ok, true);
});

test("自定义状态和归档路径在启动后仍用于记录与关闭", () => {
  const root = fixture();
  const overrides = { statusFile: "project/state/status.md", archiveDir: "project/history" };
  fs.mkdirSync(path.join(root, "project/state"), { recursive: true });
  fs.renameSync(path.join(root, "docs/loops/status.md"), path.join(root, overrides.statusFile));
  const dir = startWorkflow({ repoRoot: root, route: "hotfix", id: "HF-CUSTOM", confirmation: { route: "hotfix", input: "确认" }, overrides }).runDir;
  write(root, `${dir}/hotfix.md`, "---\nstatus: confirmed\n---\n\n# Fix\n");
  write(root, "src/app.js", "export const app = 2;\n");
  for (const stage of ["implementation", "deployment", "manual_test"]) record(root, dir, stage);
  recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "candidate", summary: "候选" } });
  for (const stage of ["final_test", "reconciliation"]) record(root, dir, stage);
  record(root, dir, "review", "审查", { outcome: "READY_FOR_HUMAN_REVIEW" });
  record(root, dir, "signoff", "签署", { outcome: "SIGNED" });
  write(root, `${dir}/hotfix.md`, "---\nstatus: archived\n---\n\n# Fix\n");
  assert.equal(closeWorkflow({ repoRoot: root, runDir: dir, summary: "关闭", evidence: "验收" }).closed, true);
});

test("候选后新增产品决定或架构影响会阻止旧候选签署", () => {
  const root = fixture();
  const dir = startWorkflow({ repoRoot: root, route: "hotfix", id: "HF-DECISION", confirmation: { route: "hotfix", input: "确认" } }).runDir;
  write(root, `${dir}/hotfix.md`, "---\nstatus: confirmed\n---\n\n# Fix\n");
  write(root, "src/app.js", "export const app = 2;\n");
  for (const stage of ["implementation", "deployment", "manual_test"]) record(root, dir, stage);
  recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "candidate", summary: "候选" } });
  recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "decision", summary: "产品行为调整", confirmation: "用户确认" } });
  assert.throws(() => record(root, dir, "final_test"), /重新固定候选/);
  const report = buildLoopCheckReport(root);
  assert.equal(report.checks.find((entry) => entry.id === "C8").ok, false);
});

test("提交区间溯源只使用该区间首次关闭的收据", () => {
  const root = fixture();
  const deliver = (id, value) => {
    const dir = startWorkflow({ repoRoot: root, route: "hotfix", id, confirmation: { route: "hotfix", input: "确认" } }).runDir;
    write(root, `${dir}/hotfix.md`, "---\nstatus: confirmed\n---\n\n# Fix\n");
    write(root, "src/app.js", `export const app = ${value};\n`);
    for (const stage of ["implementation", "deployment", "manual_test"]) record(root, dir, stage);
    recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "candidate", summary: "候选" } });
    for (const stage of ["final_test", "reconciliation"]) record(root, dir, stage);
    record(root, dir, "review", "审查", { outcome: "READY_FOR_HUMAN_REVIEW" });
    record(root, dir, "signoff", "签署", { outcome: "SIGNED" });
    write(root, `${dir}/hotfix.md`, "---\nstatus: archived\n---\n\n# Fix\n");
    closeWorkflow({ repoRoot: root, runDir: dir, summary: "关闭", evidence: "验收" });
    git(root, "add", ".");
    git(root, "commit", "-qm", id);
    return git(root, "rev-parse", "HEAD");
  };
  deliver("HF-FIRST", 2);
  write(root, "src/app.js", "export const app = 3;\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "intermediate change");
  const base = git(root, "rev-parse", "HEAD");
  const head = deliver("HF-SECOND", 2);
  const row = checkProvenance(root, { base, head }).rows.find((item) => item.path === "src/app.js");
  assert.equal(row?.classification, "covered");
  assert.deepEqual(row.claims.filter((claim) => claim.inRange).map((claim) => claim.run.includes("HF-SECOND")), [true]);
});

test("Hotfix 与 Debug 关闭后进入归档，check 继续审计且归档 ID 不可复用", () => {
  for (const route of ["hotfix", "debug"]) {
    const root = fixture();
    const id = `${route}-ARCHIVED`;
    const active = startWorkflow({ repoRoot: root, route, id, confirmation: { route, input: "确认" } }).runDir;
    write(root, "src/app.js", "export const app = 2;\n");
    if (route === "hotfix") write(root, `${active}/hotfix.md`, "---\nstatus: confirmed\n---\n\n# Fix\n");
    for (const stage of ["implementation", "deployment", "manual_test"]) record(root, active, stage);
    recordWorkflowEvent({ repoRoot: root, runDir: active, payload: { type: "candidate", summary: "稳定候选" } });
    for (const stage of ["final_test", "reconciliation"]) record(root, active, stage);
    record(root, active, "review", "正式审查或替代验收", { outcome: route === "debug" ? "WAIVED" : "READY_FOR_HUMAN_REVIEW" });
    record(root, active, "signoff", "提交者签署", { outcome: "SIGNED" });
    write(root, `${active}/${route}.md`, `---\nstatus: archived\n---\n\n# ${route}\n`);
    const closed = closeWorkflow({ repoRoot: root, runDir: active, summary: "关闭", evidence: "人工验收" });
    assert.equal(closed.runDir, `docs/archive/workflow-runs/${id}`);
    assert.equal(fs.existsSync(path.join(root, active)), false);
    assert.equal(buildLoopCheckReport(root).checks.find((entry) => entry.id === "C7").ok, true);
    assert.throws(() => startWorkflow({ repoRoot: root, route, id, confirmation: { route, input: "再次确认" } }), /已归档/);
    const auditFile = path.join(root, closed.runDir, "workflow.audit.jsonl");
    fs.appendFileSync(auditFile, "tampered\n");
    assert.equal(buildLoopCheckReport(root).checks.find((entry) => entry.id === "C7").ok, false);
  }
});

test("归档目标冲突时 close 不追加审计且保留活跃目录", () => {
  const root = fixture();
  const id = "HF-COLLISION";
  const dir = startWorkflow({ repoRoot: root, route: "hotfix", id, confirmation: { route: "hotfix", input: "确认" } }).runDir;
  write(root, "src/app.js", "export const app = 2;\n");
  write(root, `${dir}/hotfix.md`, "---\nstatus: confirmed\n---\n\n# Fix\n");
  for (const stage of ["implementation", "deployment", "manual_test"]) record(root, dir, stage);
  recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "candidate", summary: "候选" } });
  for (const stage of ["final_test", "reconciliation"]) record(root, dir, stage);
  record(root, dir, "review", "审查", { outcome: "READY_FOR_HUMAN_REVIEW" });
  record(root, dir, "signoff", "签署", { outcome: "SIGNED" });
  write(root, `${dir}/hotfix.md`, "---\nstatus: archived\n---\n\n# Fix\n");
  fs.mkdirSync(path.join(root, "docs/archive/workflow-runs", id), { recursive: true });
  const before = readWorkflowRun(root, dir).events.length;
  assert.throws(() => closeWorkflow({ repoRoot: root, runDir: dir, summary: "关闭", evidence: "验收" }), /归档目标已存在/);
  assert.equal(readWorkflowRun(root, dir).events.length, before);
  assert.equal(fs.existsSync(path.join(root, dir)), true);
});

test("归档扫描目录损坏或软链时返回治理问题而不是异常", () => {
  const fileRoot = fixture();
  write(fileRoot, "docs/archive", "not a directory");
  assert.equal(buildLoopCheckReport(fileRoot).checks.find((entry) => entry.id === "C7").ok, false);
  const linkRoot = fixture();
  fs.symlinkSync(path.join(linkRoot, "src"), path.join(linkRoot, "docs/archive"));
  assert.equal(buildLoopCheckReport(linkRoot).checks.find((entry) => entry.id === "C7").ok, false);
  const childRoot = fixture();
  fs.mkdirSync(path.join(childRoot, "docs/loops/workflow-runs"), { recursive: true });
  fs.symlinkSync(path.join(childRoot, "src"), path.join(childRoot, "docs/loops/workflow-runs", "linked-run"));
  assert.equal(buildLoopCheckReport(childRoot).checks.find((entry) => entry.id === "C7").ok, false);
});

test("v2 过程审计的 summary 不泄露本机路径和密钥文本", () => {
  const root = fixture();
  const dir = startWorkflow({ repoRoot: root, route: "debug", id: "DEBUG-REDACT", confirmation: { route: "debug", input: "确认调试" } }).runDir;
  recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: {
    type: "decision", summary: `检查 ${root}/secret.txt api_key=topsecretvalue`, confirmation: "用户已确认调整",
  } });
  const audit = fs.readFileSync(path.join(root, dir, "workflow.audit.jsonl"), "utf8");
  assert.equal(audit.includes(root), false);
  assert.equal(audit.includes("topsecretvalue"), false);
  assert.match(audit, /REDACTED/);
  assert.equal(buildLoopCheckReport(root).checks.find((entry) => entry.id === "C7").ok, true);
});

test("Loop 关闭要求 lastClosedLoop 指针并自动归档历史快照", () => {
  const root = fixture({ loop: true });
  const dir = startWorkflow({ repoRoot: root, route: "loop", confirmation: { route: "loop", input: "确认" } }).runDir;
  for (const stage of ["requirements", "architecture", "specification", "tasks", "implementation"]) {
    record(root, dir, stage, stage, stage === "requirements" ? { confirmation: "确认需求" } : {});
  }
  for (const stage of ["deployment", "manual_test", "verification"]) record(root, dir, stage);
  write(root, "src/app.js", "export const app = 2;\n");
  recordWorkflowEvent({ repoRoot: root, runDir: dir, payload: { type: "candidate", summary: "候选" } });
  for (const stage of ["final_test", "reconciliation"]) record(root, dir, stage);
  record(root, dir, "review", "审查", { outcome: "READY_FOR_HUMAN_REVIEW" });
  record(root, dir, "signoff", "签署", { outcome: "SIGNED" });
  for (const stage of ["requirements", "architecture", "specification", "tasks", "implementation", "verification"]) {
    const file = path.join(root, dir, `${stage}.md`);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: confirmed", "status: archived"));
  }
  const statusFile = path.join(root, "docs/loops/status.md");
  fs.writeFileSync(statusFile, fs.readFileSync(statusFile, "utf8").replace("activeLoop: 1", "activeLoop: null"));
  assert.throws(() => closeWorkflow({ repoRoot: root, runDir: dir, summary: "关闭", evidence: "验收" }), /lastClosedLoop/);
  fs.writeFileSync(statusFile, fs.readFileSync(statusFile, "utf8").replace("lastClosedLoop: null", "lastClosedLoop: 1"));
  const closed = closeWorkflow({ repoRoot: root, runDir: dir, summary: "关闭", evidence: "验收" });
  assert.equal(closed.runDir, "docs/archive/loop-1");
  assert.equal(buildLoopCheckReport(root).checks.find((entry) => entry.id === "C10").ok, true);
  write(root, "src/app.js", "export const app = 3;\n");
  assert.equal(buildLoopCheckReport(root).checks.find((entry) => entry.id === "C8").ok, true);
});

test("已有 v1 审计的活跃 Loop 不允许通过改状态版本直接重启为 v2", () => {
  const root = fixture({ loop: true });
  write(root, "docs/loops/loop-1/audit/000.jsonl", "{}");
  assert.throws(() => startWorkflow({ repoRoot: root, route: "loop", confirmation: { route: "loop", input: "确认" } }), /已有 v1 审计/);
});

test("Git 收据支持合法的换行文件名", () => {
  const root = fixture();
  const file = "src/multi\nline.js";
  write(root, file, "export const value = 1;\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "newline path");
  const receipt = receiptAtCommit(root, git(root, "rev-parse", "HEAD"), file);
  assert.equal(receipt?.path, file);
  assert.equal(receipt?.kind, "regular");
});
