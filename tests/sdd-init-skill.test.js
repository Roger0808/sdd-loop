/**
 * sdd-init skill 与它的两份模板的锁。
 *
 * 这里锁的东西比 sdd-interview 那份更硬，因为 AGENTS.md 模板是**承重墙**：
 * loop-check.js 执行的就是它写的那条「矛盾时停下请人确认」。模板和判定各改各的，
 * 结果是仓库声明的规则与检查的判据对不上——检查还绿着，但它判的不是仓库承诺的东西。
 * 那比没有检查更坏。所以三类锁：
 *
 * 1. 跨文件锁：模板声明的规则 ≡ loop-check.js 执行的规则（原话逐字比）；
 *    模板里的路径、状态白名单、阶段文档名 ≡ convention.js。
 * 2. 分层锁：CLAUDE.md 模板只转引、不复制条款——复制必漂移，是这份设计的全部理由。
 * 3. 行为锁：SKILL.md 的几条会被「优化」掉的硬约束（逐字复制、不覆盖、不产内容、不建空壳）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { DEFAULT_CONVENTION } from "../src/loop/convention.js";
import { guideFor, listGuideTypes } from "../src/spec-guide/dictionary.js";

const SKILL_DIR = path.resolve(import.meta.dirname, "../skills/sdd-init");
const read = (name) => fs.readFileSync(path.join(SKILL_DIR, name), "utf8");

const skill = () => read("SKILL.md");
const agentsTemplate = () => read("AGENTS.md.template");
const claudeTemplate = () => read("CLAUDE.md.template");

/** loop-check 执行的那条规则的原话。模板和判定必须是同一句。 */
const ENFORCED_RULE = "如果状态文件、活跃目录和阶段文档互相矛盾，应停止相关工作并请求用户确认。";

// ---------------------------------------------------------------- 表面形状

test("skill 存在且有 frontmatter（name/description 是 pi 注册的硬要求）", () => {
  assert.match(skill(), /^---\nname: sdd-init\ndescription: .+\n---\n/);
});

// 模板不叫 AGENTS.md / CLAUDE.md 是刻意的：skill 目录会被软链进 ~/.claude/skills/，
// 真名会被宿主当成生效的规则文件读走，于是这个包自己的仓库规则变成了别人的规则。
test("模板文件在场，且不用会被宿主自动读走的真名", () => {
  const names = fs.readdirSync(SKILL_DIR).sort();
  assert.deepEqual(names, ["AGENTS.md.template", "CLAUDE.md.template", "SKILL.md"]);
});

test("模板留了占位符，落地时必须替换（写死项目名等于把上一个项目的上下文发给所有人）", () => {
  const text = agentsTemplate();
  assert.ok(text.includes("{{PROJECT_NAME}}"), "项目名占位符丢了");
  assert.ok(text.includes("{{PROJECT_CONTEXT}}"), "项目上下文占位符丢了——仓库概览就没有落点了");
});

// ---------------------------------------------------------------- 跨文件锁

test("承重墙：AGENTS.md 模板声明的规则与 loop-check.js 执行的规则是同一句原话", () => {
  const judge = fs.readFileSync(path.resolve(import.meta.dirname, "../src/validation/loop-check.js"), "utf8");
  assert.ok(judge.includes(ENFORCED_RULE), "loop-check.js 里那句被执行的规则原话变了");
  assert.ok(
    agentsTemplate().includes(ENFORCED_RULE),
    "AGENTS.md 模板没有声明这条规则——check 就成了在判一个仓库从没承诺过的东西",
  );
});

test("AGENTS.md 模板里的路径与 convention.js 的默认值一致", () => {
  const text = agentsTemplate();
  assert.ok(text.includes(DEFAULT_CONVENTION.statusFile), `模板没指向状态文件 ${DEFAULT_CONVENTION.statusFile}`);
  assert.ok(text.includes(DEFAULT_CONVENTION.archiveDir), `模板没提到归档目录 ${DEFAULT_CONVENTION.archiveDir}`);
});

test("AGENTS.md 模板的文档状态白名单 ≡ convention.docStatuses（一个不多一个不少）", () => {
  const line = agentsTemplate().split("\n").find((l) => l.includes("文档状态只允许使用"));
  assert.ok(line, "「文档状态只允许使用 …」这一行丢了——C3 判的就是这套状态");
  const declared = [...line.matchAll(/`([a-z]+)`/g)].map((m) => m[1]);
  assert.deepEqual(
    [...declared].sort(),
    [...DEFAULT_CONVENTION.docStatuses].sort(),
    "模板声明的状态与 convention.docStatuses 对不上",
  );
});

test("AGENTS.md 模板的阶段门禁小节 ≡ convention.stageDocs（顺序也要一致）", () => {
  const text = agentsTemplate();
  const gate = text.slice(text.indexOf("## 阶段门禁"), text.indexOf("## 事实优先级"));
  assert.ok(gate.length > 0, "「阶段门禁」一节丢了");
  const headings = [...gate.matchAll(/^### (\w+)/gm)].map((m) => m[1].toLowerCase());
  assert.deepEqual(
    headings,
    [...DEFAULT_CONVENTION.stageDocs],
    "门禁小节与 stageDocs 对不上——仓库承诺的阶段和判定认的阶段分家了",
  );
});

// 「Migration」在这套东西里是两个词，实测被混成一个：
//   源项目迁移  项目属性，init 时按项目类型删留，迁完就没了
//   数据模型变更 每轮属性，只要还有库就随时会回来
// 只有前者时，一个非迁移类项目 init 时把「迁移」整块删掉，之后哪一轮改表结构都没人管——
// 三处门禁（Architecture / Verification / 工作区与 Git）里唯一提到数据库的是最后那条，
// 而它讲的是执行命令前先确认目标，不是设计与文档。
test("schema 变更是常驻条款：Architecture 与 Verification 各有一条，且不带「源项目迁移」删除标记", () => {
  const text = agentsTemplate();
  const gate = (name) => {
    const start = text.indexOf(`### ${name}`);
    const rest = text.slice(start + 1);
    const end = rest.search(/\n#{2,3} /);
    return rest.slice(0, end === -1 ? undefined : end);
  };
  const arch = gate("Architecture");
  assert.ok(arch.includes("数据模型"), "Architecture 门禁没有 schema 变更条款");
  assert.ok(arch.includes("回滚"), "变更要求里没有回滚路径——不可逆变更就没有兜底");
  assert.ok(gate("Verification").includes("回滚"), "Verification 没要求验证回滚路径");
  // 常驻性：这两条一旦带上删除标记，非迁移项目 init 时会连它们一起删掉。
  for (const [name, body] of [["Architecture", arch], ["Verification", gate("Verification")]]) {
    for (const line of body.split("\n")) {
      if (!line.includes("数据模型") && !line.includes("数据迁移")) continue;
      assert.ok(!line.includes("源项目迁移"), `${name} 的 schema 条款被标成了源项目迁移专属，会被 init 删掉：${line}`);
    }
  }
});

test("术语分家：模板把「源项目迁移」和「数据模型变更」的去留说清楚了", () => {
  const text = agentsTemplate();
  assert.ok(text.includes("源项目迁移"), "A 类的标记名没改——和 schema 变更撞名，会被一起删");
  assert.ok(!text.includes("迁移类项目才保留"), "旧的含糊标记还在");
  assert.ok(text.includes("别一起删"), "落地引导没交代两者的去留差别");
});

// 门禁说「必须写这四项」，字典得能在写之前把这四项摆出来，否则要求没有着落。
test("承重墙（口径侧）：门禁要求的 schema 变更，字典里有对应类型可查", () => {
  assert.ok(
    listGuideTypes().includes("architecture.schema-change"),
    "字典缺 architecture.schema-change——AGENTS.md 要求写的东西没有口径可查",
  );
  const entry = guideFor("architecture.schema-change");
  assert.equal(entry.doc, "architecture", "落点必须是 architecture.md，与门禁所在的阶段一致");
  for (const item of ["变更清单", "迁移步骤", "回滚"]) {
    assert.ok(entry.summary.includes(item), `口径条目的 summary 缺「${item}」——与门禁条款对不上`);
  }
});

// 「不涉及时明说」是这条门禁能用的全部理由：它把「想过了、不需要」和「忘了」分开。
// 同源于 loop-check 把 missing-status 与 unreadable 分开、git 不可用返回 null 不谎报 0。
test("留空不等于不涉及：不改数据模型时必须明写一句，否则分不出是想过了还是忘了", () => {
  const text = agentsTemplate();
  assert.ok(text.includes("本轮不涉及数据模型变更"), "「不涉及时明说」的原话丢了");
  assert.ok(text.includes("留空等于没判断过"), "没写清为什么要明说，下次会被当成啰嗦删掉");
});

// ---------------------------------------------------------------- 分层锁

test("CLAUDE.md 模板只转引 AGENTS.md，不复制任何条款", () => {
  const text = claudeTemplate();
  assert.ok(/\[AGENTS\.md\]\(AGENTS\.md\)/.test(text), "没有指向 AGENTS.md 的链接——转引层没转到任何地方");
  // 复制条款是唯一的失败模式：两份规则必然漂移，漂移之后没人知道哪份算数。
  assert.ok(!text.includes("文档状态只允许使用"), "状态白名单被复制进 CLAUDE.md 了");
  assert.ok(!text.includes("## 事实优先级"), "事实优先级被复制进 CLAUDE.md 了");
  assert.ok(!text.includes("## 阶段门禁"), "阶段门禁被复制进 CLAUDE.md 了");
  assert.ok(!text.includes(ENFORCED_RULE), "被执行的那条规则被复制进 CLAUDE.md 了");
});

test("CLAUDE.md 模板给出两件仪器的入口（check 开局 / guide 写之前）", () => {
  const text = claudeTemplate();
  assert.ok(text.includes("sdd-loop check"), "开局对账入口丢了");
  assert.ok(/sdd-loop guide --type/.test(text), "写之前查口径的入口丢了");
});

// ---------------------------------------------------------------- 行为锁

test("逐字复制：模板不许被「优化措辞」——改写会让声明与判据对不上", () => {
  const text = skill();
  assert.ok(text.includes("逐字复制"), "「逐字复制」这条要求丢了");
  assert.ok(
    text.includes("条款本身不要改写"),
    "「条款本身不要改写」丢了——只说逐字复制，模型会理解成「照着意思写一遍」",
  );
});

test("不覆盖已有文件：AGENTS.md / CLAUDE.md 已存在时是用户的东西", () => {
  const text = skill();
  assert.ok(text.includes("不要覆盖"), "「不要覆盖」丢了——初始化把用户的规则文件冲掉是不可逆损坏");
  assert.ok(text.includes("已有 AGENTS.md"), "已有 AGENTS.md 的分支没交代");
});

test("init 只建结构不产内容：这是它与 sdd-interview 的分界", () => {
  const text = skill();
  assert.ok(text.includes("一个字的业务内容都不要在这一步写"), "「不产业务内容」这条分界丢了");
  assert.ok(text.includes("sdd-interview"), "没有交棒给访谈 skill，用户会卡在结构建完之后");
});

test("不预建空壳阶段文档：AGENTS.md 的文档规则明确禁止，init 自己不许先破例", () => {
  const text = skill();
  assert.ok(text.includes("不要预先创建空壳阶段文档"), "「不预建空壳」丢了");
  assert.ok(
    agentsTemplate().includes("不提前创建后续阶段的空壳文档"),
    "模板里对应的那条文档规则丢了——SKILL 的约束就没有出处了",
  );
});

// 端到端 smoke 实测出来的：init 建了 docs/loops/loop-1/ 之后 check 立刻报
// 「目录存在但没有任何被跟踪的文件（悬空指针）」，退出 1——初始化产出一个当场变红的仓库。
// 空目录进不了 git 是根因，所以 init 只留 activeLoop: null，目录由访谈第 0 站连文档一起建。
test("init 不建 Loop 目录：activeLoop 起步为 null，否则初始化完成即报悬空指针", () => {
  const text = skill();
  assert.ok(text.includes("activeLoop: null"), "样例状态文件的 activeLoop 不是 null——建了目录才对得上，而目录不该建");
  assert.ok(text.includes("不要预先建"), "「不要预先建 Loop 目录」丢了");
  assert.ok(text.includes("悬空指针"), "没写清后果，下次还会有人顺手把目录建上");
  assert.ok(text.includes("退出码 0"), "第 5 步没说清验收标准是干净——红的会被当成「待会儿访谈就好了」放过去");
});

// activeLoop 的值是编号本身，目录名 = loopDirPrefix + 值。实测踩过：写 activeLoop: loop-1
// 会被解析成 docs/loops/loop-loop-1，check 报悬空指针，而错因看起来像工具的问题。
test("activeLoop 的取值陷阱写进了 SKILL（写成 loop-1 会造出 loop-loop-1）", () => {
  const text = skill();
  assert.ok(text.includes("编号本身"), "「值是编号本身」这条提示丢了");
  assert.ok(
    text.includes(`${DEFAULT_CONVENTION.loopDirPrefix}${DEFAULT_CONVENTION.loopDirPrefix}1`),
    "反例（loop-loop-1）丢了——只说抽象规则挡不住这个错",
  );
});

test("front-matter 必需字段：SKILL 给的状态文件样例带齐 requiredStatusFields", () => {
  const text = skill();
  for (const field of DEFAULT_CONVENTION.requiredStatusFields) {
    assert.ok(text.includes(`${field}:`), `样例状态文件缺 ${field} —— 缺了 check 直接判读不出来`);
  }
});

test("污染与冷启动分开：读不出来时不许初始化，更不许覆盖", () => {
  const text = skill();
  assert.ok(text.includes("判据读不出来"), "污染分支没交代");
  assert.ok(text.includes("不要初始化"), "污染时「不要初始化」丢了——覆盖一个被污染的状态文件会毁掉冲突现场");
});
