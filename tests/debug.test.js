import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

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
project: debug-test
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

function debugHotfix(baseCommit) {
  return `---
document: hotfix
hotfixId: HF-20260922-01
route: debug
status: archived
hotfixState: human-approved
acceptanceMode: manual-test
reviewStatus: waived
baseBranch: main
baseCommit: ${baseCommit}
fixFingerprint: null
architectureImpact: none
openedAt: 2026-09-22T00:00:00Z
updatedAt: 2026-09-22T01:00:00Z
---

# HF-20260922-01

## 1. 问题与手测过程
用户连续手测并报告问题。

## 2. 修复摘要与回滚方法
修复 app.txt；回滚方法是恢复基线内容。

## 3. 最终测试、部署与人工验收
定向测试通过，测试环境部署版本 v2，用户手测通过并要求开始收口。

## 4. Architecture Impact
none。

## 5. Review Waiver
MANUAL_TEST_ACCEPTED_NO_INDEPENDENT_REVIEW；没有独立 AI Review。
`;
}

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-debug-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Test User");
  git(root, "config", "user.email", "test@example.com");
  write(root, "docs/loops/status.md", status());
  write(root, "app.txt", "base\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  return root;
}

function record(root, payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-debug-event-"));
  const file = path.join(dir, "event.json");
  fs.writeFileSync(file, JSON.stringify(payload), "utf8");
  try {
    return recordGovernanceEvent({ repoRoot: root, eventFile: file, hotfix: "HF-20260922-01" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("Debug 收口直接反写归档 Hotfix，以人工验收和 Review 豁免关闭", () => {
  const root = repo();
  const ordinaryStatus = fs.readFileSync(path.join(root, "docs/loops/status.md"), "utf8");
  const baseCommit = git(root, "rev-parse", "HEAD");
  write(root, "app.txt", "fixed after manual test\n");
  write(root, "docs/archive/hotfix/hotfix-20260922-01.md", debugHotfix(baseCommit));

  const result = record(root, {
    type: "debug_closed",
    role: "approver",
    summary: "人工测试完成，关闭 Debug Hotfix",
    input: "全部测完，开始收口",
    evidence: "定向测试 PASS；测试环境 v2；人工手测通过；Architecture Impact none",
  });

  assert.equal(result.event.type, "debug_closed");
  assert.ok(result.event.codeFingerprint?.startsWith("sha256:"));
  const doc = fs.readFileSync(path.join(root, "docs/archive/hotfix/hotfix-20260922-01.md"), "utf8");
  assert.match(doc, /hotfixState: closed/);
  assert.match(doc, /fixFingerprint: sha256:[a-f0-9]{64}/);
  assert.equal(fs.readFileSync(path.join(root, "docs/loops/status.md"), "utf8"), ordinaryStatus, "Debug 不得推进普通 Loop");

  const report = buildLoopCheckReport(root);
  assert.equal(report.ok, true, report.problems.map((item) => item.detail).join("\n"));
  assert.equal(report.hotfixes[0].meta.route, "debug");
  assert.equal(report.checks.find((entry) => entry.id === "H4").ok, true);
});

test("Debug 路由拒绝伪造标准 Hotfix Review 事件", () => {
  const root = repo();
  write(root, "docs/archive/hotfix/hotfix-20260922-01.md", debugHotfix(git(root, "rev-parse", "HEAD")));
  assert.throws(
    () => record(root, {
      type: "review_completed",
      role: "reviewer",
      summary: "伪造 Review",
      evidence: "none",
      outcome: "READY_FOR_HUMAN_REVIEW",
      reviewRoute: "current-subagent",
    }),
    /只接受 debug_closed/,
  );
});

test("debug_closed 必须保留用户收口原文和最终证据", () => {
  const root = repo();
  write(root, "docs/archive/hotfix/hotfix-20260922-01.md", debugHotfix(git(root, "rev-parse", "HEAD")));
  assert.throws(
    () => record(root, {
      type: "debug_closed",
      role: "approver",
      summary: "缺少证据",
      input: "开始收口",
    }),
    /必须记录最终测试、部署、人工验收与架构对账 evidence/,
  );
});

test("sdd-debug skill 固定调试循环、风险边界和一次收口语义", () => {
  const text = fs.readFileSync(path.resolve(import.meta.dirname, "../skills/sdd-debug/SKILL.md"), "utf8");
  for (const phrase of [
    "governanceVersion: 1", "roleApprover", "缺失时只说明用 `/sdd upgrade`", "不自动修改",
    "不要创建 Hotfix 文档", "不因修改文件、模块或服务超出原 Loop", "开始收口", "不要再索要第二次确认",
    "route: debug", "acceptanceMode: manual-test", "reviewStatus: waived", "debug_closed",
    "MANUAL_TEST_ACCEPTED_NO_INDEPENDENT_REVIEW", "不记录 `review_completed`",
  ]) assert.ok(text.includes(phrase), `skill 缺少：${phrase}`);
});

test("sdd-upgrade 条款对齐能从 changelog 发现并补入 Debug AGENTS 规则", () => {
  const template = fs.readFileSync(path.resolve(import.meta.dirname, "../skills/sdd-init/AGENTS.md.template"), "utf8");
  const changelog = fs.readFileSync(path.resolve(import.meta.dirname, "../skills/sdd-init/AGENTS.md.CHANGELOG.md"), "utf8");
  const upgrade = fs.readFileSync(path.resolve(import.meta.dirname, "../skills/sdd-upgrade/SKILL.md"), "utf8");
  for (const probe of [
    "Debug 与普通 Loop 并行",
    "不因超出原 Loop 的预测改动面而另设门禁",
    "MANUAL_TEST_ACCEPTED_NO_INDEPENDENT_REVIEW",
  ]) {
    assert.ok(template.includes(probe), `AGENTS 模板缺少 Debug 探针：${probe}`);
    assert.ok(changelog.includes(`\`${probe}\``), `upgrade changelog 缺少 Debug 探针：${probe}`);
  }
  assert.ok(upgrade.includes("AGENTS.md.CHANGELOG.md"));
  assert.ok(upgrade.includes("用户点头才写"), "升级仍必须在用户确认候选后更新 AGENTS.md");
  assert.ok(template.includes("不得拖到“开始收口”才发现无法关闭"), "升级后的 AGENTS 必须让旧项目在 Debug 启动时 fail-fast");
  assert.ok(upgrade.includes("规则已对齐、通道尚未启用"), "只做条款对齐时不得把缺治理的旧项目宣称为 Debug 可用");
  assert.ok(upgrade.includes("用户没有选择动作四时不得顺手启用治理"), "条款对齐不能暗中扩张为治理升级");
});
