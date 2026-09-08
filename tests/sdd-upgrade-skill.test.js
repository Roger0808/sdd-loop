/**
 * sdd-upgrade skill 的锁。
 *
 * 这份 skill 与另外两份的区别是**它会改用户已经在用的文件**：补条款、挪目录。
 * init 的承重规则是「不覆盖已存在的东西」，upgrade 的核心动作恰恰是「改已存在的东西」——
 * 两条规则方向相反，所以它们分家。分家之后，安全侧的每条规矩都只剩这一份 skill 里的
 * 一句话在守，没有任何机器判定兜底。这里的锁就是那句话的唯一保险。
 *
 * 三类锁：
 * 1. 表面：frontmatter 合法（宿主按开放标准注册要它），路由不和 sdd-init 抢冷启动仓库。
 * 2. 前置门禁：四道「改到一半没法回头」的自检，逐条锁——只锁「有一节叫动手之前」是空绿。
 * 3. 边界：不删、不覆盖、不改内容、不替人确认。以及它依赖的外部文件真的存在。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { DEFAULT_CONVENTION } from "../src/loop/convention.js";

const SKILLS_ROOT = path.resolve(import.meta.dirname, "../skills");
const skill = () => fs.readFileSync(path.join(SKILLS_ROOT, "sdd-upgrade/SKILL.md"), "utf8");

/** 变更记录的路径。**测试自己写一份**——upgrade 靠它工作，init 目录里存着它，两边各写一份才锁得住搬家。 */
const CHANGELOG_REL = "sdd-init/AGENTS.md.CHANGELOG.md";

test("skill 存在且有 frontmatter（name/description 是宿主注册的硬要求）", () => {
  assert.match(skill(), /^---\nname: sdd-upgrade\ndescription: .+\n---\n/);
});

// 三份 skill 的路由靠 description 里那一句分派。upgrade 抢走冷启动仓库的后果不对称：
// 一个还没有 AGENTS.md 的仓库走 upgrade，它的第一道门禁（check 必须绿）会当场卡住，
// 用户拿到的是「你这仓库没结构」而不是「我来给你建」。
test("路由：description 把冷启动仓库退还给 sdd-init", () => {
  const front = skill().match(/^---\n([\s\S]*?)\n---\n/)[1];
  assert.ok(/已经/.test(front), "description 没说清前提是「已经在跑 SDD Loop」");
  assert.ok(front.includes("sdd-init"), "description 没把冷启动仓库指回 sdd-init——两份 skill 会抢同一个仓库");
});

test("三份 skill 的分工表在场：前提 / 核心动作 / 安全规则逐列说清", () => {
  const text = skill();
  for (const other of ["sdd-init", "sdd-interview"]) {
    assert.ok(text.includes(other), `分工表里没提 ${other}——读者分不出该走哪一份`);
    assert.ok(fs.existsSync(path.join(SKILLS_ROOT, other, "SKILL.md")), `${other} 不在包里`);
  }
  assert.ok(
    text.includes("不覆盖已存在的东西"),
    "没写清 init 的承重规则与本 skill 的核心动作方向相反——迟早有人把两者合并，打输的会是安全的那条",
  );
});

// 四道门禁一条都不能少，每条对应一种「改到一半没法回头」。
// 只锁「有『动手之前』这一节」是空绿：整节留着、四条删到剩一条，锁照样绿。
test("动手之前的四道门禁逐条在场（check 绿 / worktree 干净 / 存基准 / 没人在干活）", () => {
  const text = skill();
  const start = text.indexOf("## 动手之前");
  assert.ok(start !== -1, "「动手之前」一节丢了");
  const section = text.slice(start, text.indexOf("\n## ", start + 1));

  assert.ok(/sdd-loop check/.test(section), "第 1 道（check 必须绿）丢了——在已经声明与事实不符的仓库上挪目录，分不出新红是搬错还是本来就红");
  assert.ok(section.includes("判据读不出来"), "没区分「报红」和「读不出来」：后者说明状态文件被污染，读到的 activeLoop 是猜的");
  assert.ok(/git status/.test(section), "第 2 道（工作区干净）丢了——移动文件混在别人的改动里没法单独回退");
  // 「存下来」和「基准」要分开锁：只锁「基准」两个字，把动词从「存下来」改成
  // 「看一眼」照样绿——而看过就忘正是没有基准的那种状态（变异测试实测）。
  assert.ok(section.includes("存下来"), "第 3 道没要求把 check 输出**存下来**，看一眼就忘等于没有基准");
  assert.ok(section.includes("基准"), "没说清存下来是干什么用的，这一步会被当成仪式跳过");
  assert.ok(section.includes("别人正在这个仓库里干活"), "第 4 道（确认没人在干活）丢了——迁形态会让别人手上的路径当场失效");
});

// 动作一整个建立在变更记录那张探针表上。文件被搬走或改名，upgrade 会去读一个
// 不存在的清单，然后要么什么都不补，要么退回整份 diff——那正是它明确不做的事。
test("变更记录是动作一的真相源：skill 指的那份文件真的在", () => {
  const text = skill();
  assert.ok(text.includes("AGENTS.md.CHANGELOG.md"), "没指向变更记录，动作一就没有清单可核");
  assert.ok(
    fs.existsSync(path.join(SKILLS_ROOT, CHANGELOG_REL)),
    `skill 让 agent 去读 ${CHANGELOG_REL}，但那个文件不在`,
  );
  assert.ok(text.includes("探针"), "没解释探针怎么用，agent 会退回整份 diff");
});

// 整份 diff 会把用户合法的自有改动（改过的路径、按形态删掉的条款、自己加的内容）
// 全报成差异。噪音一多人就整段跳过——本仓的老结论：假警报比漏报更致命。
test("不整份 diff：只核清单上的条款，理由写在正文里", () => {
  const text = skill();
  assert.ok(text.includes("不要整份 diff"), "「不整份 diff」这条丢了");
  assert.ok(text.includes("假警报比漏报更致命"), "没写清理由，下次会被当成偷懒改成「稳妥起见全量比一遍」");
  assert.ok(text.includes("合法"), "没说清用户的自有改动是合法的，agent 会把它们当成要修复的漂移");
});

// 搜不到 ≠ 该补。单人独占的仓库不需要「确认人的决定权」，仍是单流的不需要「归档按流分」。
// 补进去的后果是规则说的和仓库实际形态对不上——一份声明了分流规则的单流仓库，
// 下一个人读到的是一份自相矛盾的门禁。
test("按档判断该不该补：不适用的条款不许补，判据同 sdd-init 第 2 步", () => {
  const text = skill();
  assert.ok(text.includes("搜不到**不等于**该补"), "「搜不到不等于该补」丢了——agent 会把分流条款塞进单流仓库");
  assert.ok(text.includes("常驻"), "没有常驻这一档，就没有「任何项目都该补」的那一类");
  assert.ok(text.includes("多人档") && text.includes("分流档"), "三档不全，判断就没有依据");
  assert.ok(text.includes("不适用的不要补"), "没有显式禁止，缺省行为就是全补");
  assert.ok(text.includes("不是几个人"), "拿不准形态时的判据没有落到「范围能不能切分」上");
});

test("动作一只加不改：逐字复制、保持原有顺序、一个字都不许删", () => {
  const text = skill();
  assert.ok(text.includes("逐字复制"), "「逐字复制模板原话」丢了——改写会让声明与判据对不上");
  assert.ok(text.includes("不重排"), "没禁止重排，「顺手整理」会把用户的自有内容搅乱");
  assert.ok(text.includes("一个字都不许删"), "没有把动作限定成「只加」");
  assert.ok(text.includes("等用户点头"), "没要求逐条摆给用户确认就动手");
});

test("已分流仓库即使只做条款对齐，也必须修掉旧的根状态入口", () => {
  const text = skill();
  const beforeActions = text.slice(0, text.indexOf("## 动作一"));
  assert.ok(
    beforeActions.includes("只选动作一") && beforeActions.includes("已经是分流"),
    "兼容检查只藏在形态迁移里——用户只选条款对齐时会跳过，旧根路径继续和分流入口打架",
  );
  assert.ok(beforeActions.includes("docs/loops/status.md"), "没点名要清掉的是哪个旧根状态入口");
  assert.ok(text.includes("分流状态入口兼容检查"), "前置要求没有落到一个可执行的检查步骤");
});

// 归档按流分不是整齐，是判据：check 拿 loop- + lastClosedLoop 当前缀去归档根里扫，
// 共用一个归档根时 A 流会去校验 B 流的文档——错误归属，成片假警报。
test("形态迁移：归档必须跟着按流分，理由是判据不是整齐", () => {
  const text = skill();
  assert.ok(text.includes("归档必须跟着按流分"), "归档这一步丢了");
  assert.ok(text.includes(DEFAULT_CONVENTION.archiveDir), `没给出归档根 ${DEFAULT_CONVENTION.archiveDir} 的迁移路径`);
  assert.ok(
    text.includes(DEFAULT_CONVENTION.loopDirPrefix) && text.includes("lastClosedLoop"),
    "没写清 check 是拿什么前缀扫归档的，这条会被当成洁癖删掉",
  );
  assert.ok(text.includes("假警报"), "没写清共用归档根的后果");
});

test("形态迁移：全程 git mv，activeLoop 的值不动", () => {
  const text = skill();
  assert.ok(/git mv/.test(text), "没要求 git mv——cp + rm 会断掉历史，以后追溯不到需求是什么时候确认的");
  assert.ok(text.includes("`activeLoop` 的值不动"), "没说清编号不变，会有人顺手当成关 Loop 重编号");
  assert.ok(text.includes("只把**现有的那条**安置好"), "没有「按需长出来」，迁移会一次建七条空流");
});

test("worktree 迁移只允许当前已实施 Loop 一次性豁免，下一 Loop 不继承", () => {
  const text = skill();
  const start = text.indexOf("### 5. 建立 worktree 规则的过渡");
  assert.ok(start !== -1, "缺少 worktree 迁移过渡规则");
  const section = text.slice(start, text.indexOf("\n## ", start + 1));
  assert.ok(section.includes("独立分支和 worktree"));
  assert.ok(section.includes("已在主工作区进入 Implementation"));
  assert.ok(section.includes("只对本 Loop 有效"));
  assert.ok(section.includes("下一 Loop 不得继承"));
  assert.ok(section.includes("尚未进入 Implementation 的 Loop 不得使用这个豁免"));
});

test("AGENTS 审计只生成 /tmp Candidate，删除移动合并逐项授权且不改宿主配置", () => {
  const text = skill();
  assert.ok(text.includes("AGENTS.md.AUDIT.md"));
  assert.ok(text.includes("/tmp/sdd-loop-agents-<repo>-<timestamp>/"));
  assert.ok(text.includes("删除、移动、合并逐项"));
  for (const boundary of [".claude/", ".codex/", ".agents/", "模型", "权限", "MCP", "宿主配置"]) {
    assert.ok(text.includes(boundary), `审计边界缺 ${boundary}`);
  }
});

test("形态迁移默认不改任何阶段文档里的 Loop 引用", () => {
  const text = skill();
  const start = text.indexOf("**阶段文档（");
  const end = text.indexOf("）里的「Loop N」默认不改", start);
  assert.ok(start !== -1 && end !== -1, "没有明确阶段文档里的 Loop 引用默认不改");
  const protectedDocs = text.slice(start, end);
  for (const stage of DEFAULT_CONVENTION.stageDocs) {
    assert.ok(
      protectedDocs.includes(stage),
      `阶段文档保护清单漏了 ${stage}.md——它可能被静默改正文却保留旧 confirmed`,
    );
  }
  assert.ok(text.includes("重新留痕"), "用户真要改 confirmed 文档时，没有要求重新走确认留痕");
});

test("边界：不删、不动业务内容、不替人确认、不解决矛盾、一次只升一个仓库", () => {
  const text = skill();
  const start = text.indexOf("## 明确不做");
  assert.ok(start !== -1, "「明确不做」一节丢了");
  const section = text.slice(start);
  for (const [what, why] of [
    ["不删任何文件或目录", "删了就不可逆，包括你认为是残留的"],
    ["不动业务内容", "阶段文档的正文和 status 都不是这份 skill 的事"],
    ["不替用户确认", "迁移不改任何文档的确认状态"],
    ["不解决 check 报出来的矛盾", "那是人的活，而且动手前 check 就该是绿的"],
    ["不碰别的仓库", "一次只升一个"],
  ]) {
    assert.ok(section.includes(what), `边界少了「${what}」——${why}`);
  }
});

// 没有基准就没有「没搞坏」的证据。而「多出来一条新的不一致」最容易被
// 「大概是因为分流了吧」解释掉——那句话必须在正文里被显式挡掉。
test("收尾拿动手前存的基准逐条比，多出任何一条新的不一致都算搬错", () => {
  const text = skill();
  const start = text.indexOf("## 收尾");
  assert.ok(start !== -1, "收尾验证一节丢了");
  const section = text.slice(start, text.indexOf("\n## ", start + 1));
  assert.ok(section.includes("逐条比"), "没要求和基准逐条比，收尾就只剩「看起来还行」");
  assert.ok(section.includes("就是搬错了"), "没把「多出一条新的不一致」定性成错误");
  assert.ok(section.includes("大概是因为分流了吧"), "没挡掉那句最顺手的解释，它会把真错误洗掉");
  assert.ok(section.includes("没补的条款"), "收尾没要求摆出因形态不适用而没补的条款——用户以后转形态时不知道还欠什么");
});
