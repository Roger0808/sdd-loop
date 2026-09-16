import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";

import { nextHotfixIdentity } from "../src/hotfix/layout.js";
import { resolveConvention, conventionForStream } from "../src/loop/convention.js";
import { recordGovernanceEvent } from "../src/governance/protocol.js";
import { buildLoopCheckReport } from "../src/validation/loop-check.js";

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
}

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function status() {
  return `---
project: hotfix-test
document: loop-status
activeLoop: null
lastClosedLoop: null
nextLoop: 1
nextPhase: requirements
governanceVersion: 1
gateStage: requirements
gateState: in-progress
gateFingerprint: null
enabledExtensions: testing,pbt,security,resiliency
roleRequester: test@example.com
roleProduct: test@example.com
roleArchitect: test@example.com
roleImplementer: test@example.com
roleReviewer: test@example.com
roleApprover: test@example.com
---
`;
}

function hotfix(id = "HF-20260916-01", extra = "", baseCommit = "BASE") {
  return `---
document: hotfix
hotfixId: ${id}
status: confirmed
hotfixState: implementation
reviewRoute: current-subagent
baseBranch: main
baseCommit: ${baseCommit}
fixFingerprint: null
architectureImpact: none
openedAt: 2026-09-16T00:00:00Z
updatedAt: 2026-09-16T00:00:00Z
---

# ${id}
## 1. 问题、影响与复现
问题。
## 2. 修复范围与非目标
范围。
## 3. 风险提示及用户确认
已确认。
## 4. 实施摘要与回滚方法
回滚提交。
## 5. Testing/PBT/Security/Resiliency 证据
证据。
## 6. Architecture Impact
none。
## 7. AI Review
待审。
## 8. Human Sign-off
待签。
${extra}`;
}

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-hotfix-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Test User");
  git(root, "config", "user.email", "test@example.com");
  write(root, "docs/loops/status.md", status());
  write(root, "app.txt", "base\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  return root;
}

function record(root, payload, options = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdd-hotfix-event-")), "event.json");
  fs.writeFileSync(file, JSON.stringify(payload), "utf8");
  try {
    return recordGovernanceEvent({ repoRoot: root, eventFile: file, hotfix: "HF-20260916-01", ...options });
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

test("编号按流和日期扫描活跃与归档后递增，自定义路径仍由 convention 派生", () => {
const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-hotfix-number-"));
  const convention = resolveConvention({ statusFile: "state/live/status.md", archiveDir: "state/done" });
  write(root, "state/live/hotfix/hotfix-20260916-01.md", hotfix());
  write(root, "state/done/hotfix/hotfix-20260916-03.md", hotfix("HF-20260916-03"));
  assert.deepEqual(nextHotfixIdentity(root, convention, "2026-09-16"), {
    hotfixId: "HF-20260916-04", fileName: "hotfix-20260916-04.md", sequence: 4,
  });
  const split = conventionForStream("api", { statusFile: "state/live/status.md", archiveDir: "state/done" });
  write(root, "state/live/api/hotfix/hotfix-20260916-02.md", hotfix("HF-20260916-02"));
  assert.equal(nextHotfixIdentity(root, split, "2026-09-16").hotfixId, "HF-20260916-03");
});

test("内部编号 CLI 返回派生路径，并在分流仓库要求显式 stream", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-hotfix-cli-"));
  write(root, "docs/loops/api/status.md", status());
  write(root, "docs/loops/api/hotfix/hotfix-20260916-01.md", hotfix());
  const cli = path.resolve(import.meta.dirname, "../scripts/sdd-loop.mjs");
  const missing = spawnSync(process.execPath, [cli, "_hotfix", "next", "--repo", root, "--date", "2026-09-16"], { encoding: "utf8" });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--stream/);
  const result = spawnSync(process.execPath, [cli, "_hotfix", "next", "--repo", root, "--stream", "api", "--date", "2026-09-16"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    hotfixId: "HF-20260916-02",
    fileName: "hotfix-20260916-02.md",
    sequence: 2,
    stream: "api",
    activeDir: "docs/loops/api/hotfix",
    archiveDir: "docs/archive/api/hotfix",
  });
});

test("没有 Hotfix 时报告形状不增加 hotfixes 或 H 检查", () => {
  const root = repo();
  const report = buildLoopCheckReport(root);
  assert.equal("hotfixes" in report, false);
  assert.equal(report.checks.some((entry) => entry.id.startsWith("H")), false);
});

test("Hotfix 从一次授权连续到 AI Review、人工签署和归档关闭", () => {
  const root = repo();
  const ordinaryStatus = fs.readFileSync(path.join(root, "docs/loops/status.md"), "utf8");
  const baseCommit = git(root, "rev-parse", "HEAD");
  git(root, "switch", "-c", "hotfix/test");
  write(root, "docs/loops/hotfix/hotfix-20260916-01.md", hotfix("HF-20260916-01", "", baseCommit));
  record(root, { type: "hotfix_authorized", role: "requester", summary: "确认范围和风险", input: "确认，使用当前 subagent", reviewRoute: "current-subagent" });
  write(root, "app.txt", "fixed\n");
  record(root, { type: "implementation_completed", role: "implementer", summary: "修复完成" });
  for (const extension of ["testing", "pbt", "security", "resiliency"]) {
    record(root, {
      type: "extension_evaluated", role: "implementer", summary: `${extension} 完成`, extension,
      outcome: "PASS", evidence: `${extension} evidence`, ...(extension === "pbt" ? { caseCount: 20, seed: 7 } : {}),
    });
  }
  record(root, {
    type: "review_completed", role: "reviewer", summary: "独立审查完成", evidence: "read-only review",
    outcome: "READY_FOR_HUMAN_REVIEW", reviewRoute: "current-subagent",
  });
  let report = buildLoopCheckReport(root);
  assert.equal(report.checks.find((entry) => entry.id === "H3").ok, true, report.checks.find((entry) => entry.id === "H3").findings.map((item) => item.detail).join("\n"));
  assert.equal(report.checks.find((entry) => entry.id === "H4").ok, true);
  assert.equal(fs.readFileSync(path.join(root, "docs/loops/status.md"), "utf8"), ordinaryStatus, "Hotfix 不得覆盖普通 Loop 状态");
  write(root, "app.txt", "changed after review\n");
  report = buildLoopCheckReport(root);
  assert.equal(report.checks.find((entry) => entry.id === "H4").ok, false, "代码变化必须使旧 Review 失效");
  write(root, "app.txt", "fixed\n");
  record(root, { type: "human_signed", role: "approver", summary: "人工签署当前指纹" });

  const activeDoc = path.join(root, "docs/loops/hotfix/hotfix-20260916-01.md");
  const archivedDoc = path.join(root, "docs/archive/hotfix/hotfix-20260916-01.md");
  fs.mkdirSync(path.dirname(archivedDoc), { recursive: true });
  fs.renameSync(activeDoc, archivedDoc);
  fs.mkdirSync(path.join(root, "docs/archive/hotfix/audit"), { recursive: true });
  fs.renameSync(
    path.join(root, "docs/loops/hotfix/audit/hotfix-20260916-01"),
    path.join(root, "docs/archive/hotfix/audit/hotfix-20260916-01"),
  );
  const archived = fs.readFileSync(archivedDoc, "utf8").replace("status: confirmed", "status: archived");
  fs.writeFileSync(archivedDoc, archived, "utf8");
  record(root, { type: "hotfix_closed", role: "approver", summary: "归档关闭" });

  report = buildLoopCheckReport(root);
  assert.equal(report.ok, true, report.problems.map((item) => item.detail).join("\n"));
  assert.equal(report.hotfixes[0].location, "archive");
  assert.equal(report.nextStep.kind, "start-new", "Hotfix 不得推进普通 Loop");
});

test("重复 ID、不可读审计和代码变化分别使 Hotfix 检查失败", () => {
  const root = repo();
  write(root, "docs/loops/hotfix/hotfix-20260916-01.md", hotfix());
  write(root, "docs/archive/hotfix/hotfix-20260916-01.md", hotfix());
  const duplicate = buildLoopCheckReport(root);
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.problems.map((item) => item.detail).join("\n"), /重复 Hotfix ID/);

  fs.rmSync(path.join(root, "docs/archive"), { recursive: true });
  write(root, "docs/loops/hotfix/audit/hotfix-20260916-01/bad.jsonl", "not-json\n");
  const unreadable = buildLoopCheckReport(root);
  assert.equal(unreadable.severity, "unusable");
});

test("审计哈希篡改是内容矛盾，畸形 JSON 才是不可读", () => {
  const root = repo();
  git(root, "switch", "-c", "hotfix/tamper-test");
  write(root, "docs/loops/hotfix/hotfix-20260916-01.md", hotfix("HF-20260916-01", "", git(root, "rev-parse", "HEAD")));
  const result = record(root, { type: "hotfix_authorized", role: "requester", summary: "确认", input: "确认风险", reviewRoute: "current-subagent" });
  const audit = path.join(root, result.auditFile);
  const event = JSON.parse(fs.readFileSync(audit, "utf8"));
  event.payload.summary = "tampered";
  fs.writeFileSync(audit, `${JSON.stringify(event)}\n`, "utf8");
  let report = buildLoopCheckReport(root);
  assert.equal(report.severity, "problem");
  fs.writeFileSync(audit, "not-json\n", "utf8");
  report = buildLoopCheckReport(root);
  assert.equal(report.severity, "unusable");
});

test("sdd-hotfix skill 固定一次启动确认、单文档、四项扩展和关闭门禁", () => {
  const text = fs.readFileSync(path.resolve(import.meta.dirname, "../skills/sdd-hotfix/SKILL.md"), "utf8");
  for (const phrase of [
    "首次响应：只读勘察并停下", "一次确认", "hotfix_authorized", "current-subagent", "external-agent",
    "Testing 必须 `PASS`", "architecture_reconciled", "human_signed", "hotfix_closed", "不修改 `activeLoop`",
  ]) assert.ok(text.includes(phrase), `skill 缺少：${phrase}`);
});
