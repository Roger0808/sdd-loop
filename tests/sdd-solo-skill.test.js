import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOLO = path.join(ROOT, "skills/sdd-solo");

test("sdd-solo 是已打包且 frontmatter 合法的 Skill", () => {
  const skill = fs.readFileSync(path.join(SOLO, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
  assert.match(skill, /^---\nname: sdd-solo\ndescription: .+\n---\n/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.ok(pkg.pi.skills.includes("./skills/sdd-solo"));
});

test("sdd-solo 锁定单人单会话多仓边界和完整门禁", () => {
  const skill = fs.readFileSync(path.join(SOLO, "SKILL.md"), "utf8");
  for (const claim of [
    "所有访谈、确认、实现、验证和收口都在这一场对话完成",
    "不要求用户切换仓库",
    "不得把参与仓当成 stream",
    "最新远程 `master`",
    "Requirements 梳理完成后、进入实现前",
    "每仓进行只读 AI 代码审查",
    "跨仓聚合审查",
    "只组织一次最终人工审批",
    "上线执行清单",
    "只读追溯包",
    "sdd-loop solo check ... --write-receipt",
    "不得事后补录冒充当时已过门禁",
    "不得复制主仓 `status.md`",
    "worktree",
  ]) assert.ok(skill.includes(claim), `sdd-solo 漏了关键约束：${claim}`);
});

test("sdd-solo references 与模板完整可读", () => {
  for (const file of ["participant-manifest.md", "repository-unit.md", "trace-export.md", "openspec-light.md", "release-checklist.md"]) {
    assert.ok(fs.statSync(path.join(SOLO, "references", file)).isFile(), `缺少 reference：${file}`);
  }
  for (const file of ["repositories.json", "repository-receipt.json", "source.json", "solo-closure-receipt.json"]) {
    const value = JSON.parse(fs.readFileSync(path.join(SOLO, "assets", file), "utf8"));
    assert.equal(typeof value, "object", `${file} 必须是 JSON 对象`);
  }
  assert.ok(fs.statSync(path.join(SOLO, "assets", "release-checklist.md")).isFile());
});

test("sdd-solo 先澄清需求，再基于风险标准一次确认交付模式", () => {
  const skill = fs.readFileSync(path.join(SOLO, "SKILL.md"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(SOLO, "assets", "repositories.json"), "utf8"));

  for (const claim of [
    "先完成需求澄清，再推荐交付模式",
    "建议答案和代码依据",
    "需求确认 + 推荐模式",
    "需求业务逻辑简单时，即使涉及多个仓库也不因此升级为 `full`",
    "仓库数量、预计代码行数、是否触及跨仓调用都不是 `full` 判定条件",
    "新增可选字段、兼容性接口扩展",
    "只有存在需要独立架构/治理门禁的实质复杂度时才推荐 `full`",
    "不得把“未知”直接等同于“复杂”",
    "用户始终可以把 `openspec-light` 提升为 `full`",
  ]) assert.ok(skill.includes(claim), `sdd-solo 漏了模式选择约束：${claim}`);

  assert.equal(manifest.deliveryMode, null);
  assert.deepEqual(Object.keys(manifest.modeDecision), [
    "recommendedMode",
    "confirmedMode",
    "confirmedBy",
    "confirmedAt",
    "reasons",
    "riskAssessment",
  ]);
  assert.equal(manifest.modeDecision.riskAssessment.breakingContractOrCutoverRisk, "unknown");
  assert.equal(manifest.modeDecision.riskAssessment.complexDataMigrationRisk, "unknown");
  assert.equal(manifest.modeDecision.riskAssessment.explicitFullGovernanceRequired, "unknown");
  assert.ok(!Object.hasOwn(manifest.modeDecision.riskAssessment, "crossRepositoryContractRisk"));
});

test("openspec-light 确认后连续生成、实施和验证，并在归档前停下", () => {
  const light = fs.readFileSync(path.join(SOLO, "references", "openspec-light.md"), "utf8");

  for (const claim of [
    "Proposal → Spec → Tasks → Apply → Verification → Release Checklist → Trace Export → Solo Check → 结果报告",
    "业务逻辑简单且边界清楚时，多仓需求仍应优先使用本路径",
    "向后兼容的 API、事件或消息扩展",
    "不得在 Proposal、Spec、Tasks 之间再次要求用户确认",
    "不得把独立 AI Review、Architecture Baseline、readiness receipt 或跨仓聚合审查设为必经门禁",
    "等待用户验收并明确同意后",
    "才执行 OpenSpec Archive",
    "sdd-loop solo check",
    "立即停止轻量路径并建议升级为 `full`",
  ]) assert.ok(light.includes(claim), `openspec-light 漏了关键行为：${claim}`);
});

test("上线清单同时覆盖部署事实、N/A 理由与执行勾选", () => {
  const reference = fs.readFileSync(path.join(SOLO, "references", "release-checklist.md"), "utf8");
  const template = fs.readFileSync(path.join(SOLO, "assets", "release-checklist.md"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(SOLO, "assets", "repositories.json"), "utf8"));

  for (const title of ["发布项目与顺序", "SQL 脚本", "项目配置", "FilerUI 配置", "发布后验证与回滚"]) {
    assert.ok(template.includes(`## ${title}`), `上线清单缺少章节：${title}`);
  }
  assert.match(reference, /ready.*不表示实际发布已经执行/s);
  assert.match(reference, /\[ \].*\[x\]/s);
  assert.match(reference, /N\/A.*具体原因/s);
  assert.match(reference, /只把已有复选项.*不会改变固定的计划指纹/s);
  assert.deepEqual(manifest.releaseChecklist, {
    path: "release-checklist.md",
    state: "draft",
    sha256: null,
    preparedAt: null,
  });
});

test("中英文 README 同步说明 sdd-solo 双模式", () => {
  const zh = fs.readFileSync(path.join(ROOT, "README_zh.md"), "utf8");
  const en = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  for (const text of [zh, en]) {
    assert.ok(text.includes("openspec-light"));
    assert.ok(text.includes("full"));
  }
  assert.match(zh, /需求确认.*推荐模式/);
  assert.match(en, /requirements.*recommended mode/i);
});

test("sdd-solo 从一次需求身份确认派生对话名和跨仓标准分支", () => {
  const skill = fs.readFileSync(path.join(SOLO, "SKILL.md"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(SOLO, "assets", "repositories.json"), "utf8"));
  const receipt = JSON.parse(fs.readFileSync(path.join(SOLO, "assets", "repository-receipt.json"), "utf8"));

  assert.equal(manifest.naming.conversationTitle, "[SDD Solo][<demand-id>] <demand-title>");
  assert.equal(manifest.naming.branchTemplate, "feature/{yyMMdd}_{demandId}_{shortTitle}");
  assert.equal(manifest.naming.canonicalBranch, "feature/<yyMMdd>_<demand-id>_<short-title>");
  assert.deepEqual(Object.keys(receipt.branch), ["expected", "actual", "disposition", "exceptionReason"]);
  assert.match(skill, /日期取首次生成命名的日期并写入清单，后续继续需求时不得随当天日期重算/);
  assert.match(skill, /不得为了命名统一强制切换、重建或搬移改动/);
  assert.match(skill, /对话标题不是治理门禁/);
});
