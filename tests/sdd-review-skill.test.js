import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { DEFAULT_CONVENTION } from "../src/loop/convention.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const review = () => fs.readFileSync(path.join(ROOT, "skills/sdd-review/SKILL.md"), "utf8");
const template = () => fs.readFileSync(path.join(ROOT, "skills/sdd-init/AGENTS.md.template"), "utf8");
const audit = () => fs.readFileSync(path.join(ROOT, "skills/sdd-init/AGENTS.md.AUDIT.md"), "utf8");

test("sdd-review 有可发现 frontmatter，且不宣称负责修复或人工确认", () => {
  const text = review();
  assert.match(text, /^---\nname: sdd-review\ndescription: .+\n---\n/);
  const front = text.match(/^---\n([\s\S]*?)\n---/)[1];
  assert.ok(front.includes("不负责修复"));
  assert.ok(front.includes("不替人工确认"));
});

test("六阶段协议保持不变，新节点是流程门禁而不是新阶段文档", () => {
  assert.deepEqual(DEFAULT_CONVENTION.stageDocs, [
    "requirements", "architecture", "specification", "tasks", "implementation", "verification",
  ]);
  for (const invented of ["worktree-ready", "architecture-reconciliation", "ai-review", "human-review"]) {
    assert.ok(!DEFAULT_CONVENTION.stageDocs.includes(invented));
  }
});

test("审查入口必须有实施基线，不允许猜存量 Loop 的基线", () => {
  const text = review();
  for (const item of ["基线分支", "基线 commit", "当前分支", "任务范围"]) assert.ok(text.includes(item));
  assert.ok(text.includes("不从 merge-base 或日期猜"));
});

test("指纹覆盖未提交改动，关键事实改变会使旧审查失效", () => {
  const text = review();
  assert.ok(text.includes("git status --short"));
  assert.ok(text.includes("diff 的哈希"));
  assert.ok(text.includes("未跟踪文件清单与内容哈希"));
  assert.ok(text.includes("不为了审查强制提交"));
  assert.ok(text.includes("旧审查失效"));
});

test("verification 四节、三个 AI 结论和人工签字门禁都在", () => {
  const text = review();
  for (const section of ["Automated Verification", "Architecture Reconciliation & Change Surface", "AI Code Review", "Human Review Packet"]) {
    assert.ok(text.includes(section), `verification 缺 ${section}`);
  }
  for (const verdict of ["READY_FOR_HUMAN_REVIEW", "CHANGES_REQUIRED", "NOT_REVIEWABLE_SAFELY"]) {
    assert.equal(text.split(verdict).length - 1 >= 1, true, `缺结论 ${verdict}`);
  }
  for (const trace of ["确认人", "时间", "审查版本", "指纹"]) assert.ok(text.includes(trace));
  assert.ok(text.includes("人工明确通过"));
});

test("缺基线、架构未回写、测试或 AI 审查失败都不能进入人工通过", () => {
  const text = review();
  assert.match(text, /实施基线缺失[\s\S]*Architecture Baseline 尚未完成反向对账[\s\S]*NOT_REVIEWABLE_SAFELY/);
  assert.match(text, /自动化验证失败[\s\S]*reviewer 有阻断发现[\s\S]*CHANGES_REQUIRED/);
  assert.ok(text.includes("两者都不得进入人工通过或关闭 Loop"));
});

test("review 逐项复核四个工程扩展，并规定没有 PBT 库时的降级路径", () => {
  const text = review();
  for (const extension of ["Testing", "PBT", "Security", "Resiliency"]) assert.ok(text.includes(extension));
  for (const event of ["architecture_reconciled", "extension_evaluated", "review_completed", "human_signed", "loop_closed"]) {
    assert.ok(text.includes(event), `缺审计事件 ${event}`);
  }
  assert.ok(text.includes("确定性随机生成器"));
  assert.ok(text.includes("没有 PBT 库不构成 N/A 理由"));
});

test("AGENTS 模板对单流常驻架构/审查门禁，worktree 只在分流整节", () => {
  const text = template();
  assert.ok(text.includes("必须建立或审查长期 Architecture Baseline"));
  assert.ok(text.includes("必须加载 `sdd-review`"));
  const streamSection = text.slice(text.indexOf("## 流的划分与跨流改动"), text.indexOf("## 阶段门禁"));
  assert.ok(streamSection.includes("每个 stream + Loop 必须使用独立 Git 分支和 worktree"));
  assert.ok(streamSection.includes("单流：删掉本节整节"));
});

test("AGENTS 审计规范有八分类、Candidate 隔离、逐项授权和四结论", () => {
  const text = audit();
  for (const category of [
    "KEEP_SDD_CANONICAL", "KEEP_PROJECT_SPECIFIC", "DUPLICATED", "STALE",
    "MODEL_OR_HOST_SPECIFIC", "BELONGS_IN_AGENT_CONFIG", "CANONICAL_ELSEWHERE", "UNCLEAR",
  ]) assert.ok(text.includes(category));
  assert.ok(text.includes("/tmp/sdd-loop-agents-<repo>-<timestamp>/"));
  assert.ok(text.includes("删除、移动或合并必须逐项"));
  for (const verdict of ["RECOMMEND_ADOPTION", "NEEDS_REVISION", "KEEP_CURRENT", "NOT_TESTABLE_SAFELY"]) {
    assert.ok(text.includes(verdict));
  }
});
