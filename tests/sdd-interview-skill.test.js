/**
 * sdd-interview skill 的锁。
 *
 * 锁的不是文案，是三条会悄悄漂移的契约：
 * 1. skill 里提到的阶段文档名必须挂在 convention.stageDocs 上——skill 是访谈侧
 *    唯一提到文档名的地方，和判定侧（loop-check）各说各话就是漂移。
 * 2. skill 里出现的文档状态值必须在 convention.docStatuses 白名单里。
 * 3. 不许把内容绑到字段路径（data.sN.fields 之类）——访谈产出直接落 markdown
 *    文档，出现字段路径说明混进了「步骤即状态机」的设计。
 * 以及两条内容锁：勘察分工与「不许编」是这份 skill 的存在理由，必须有锁盯着。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { DEFAULT_CONVENTION } from "../src/loop/convention.js";

const SKILL_PATH = path.resolve(import.meta.dirname, "../skills/sdd-interview/SKILL.md");
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

function skillText() {
  return fs.readFileSync(SKILL_PATH, "utf8");
}

/** skill 里合法提到、但不是阶段文档的 .md 文件（状态文件、规则文件、skill 自身）。 */
const NON_STAGE_DOC_ALLOWLIST = new Set(["status.md", "AGENTS.md", "CLAUDE.md", "SKILL.md", "README.md"]);

test("skill 存在且有 frontmatter（name/description 是 pi 注册的硬要求）", () => {
  const text = skillText();
  assert.match(text, /^---\nname: sdd-interview\ndescription: .+\n---\n/);
});

test("skill 提到的 .md 文档名：阶段文档必须在 convention.stageDocs 里，其余必须在白名单里", () => {
  const text = skillText();
  const mentioned = new Set([...text.matchAll(/\b([A-Za-z][A-Za-z-]*\.md)\b/g)].map((m) => m[1]));
  assert.ok(mentioned.size > 0, "skill 一份文档都不提，锁就空了");
  for (const name of mentioned) {
    const base = name.toLowerCase();
    const isStage = DEFAULT_CONVENTION.stageDocs.some((stage) => `${stage}.md` === base);
    assert.ok(
      isStage || NON_STAGE_DOC_ALLOWLIST.has(name),
      `${name} 既不是阶段文档（${DEFAULT_CONVENTION.stageDocs.join("/")}）也不在白名单里——文档名漂移了`,
    );
  }
});

test("四份撰写期文档每一份都被 skill 点名（少一份就是访谈大纲漏了一站）", () => {
  const text = skillText();
  for (const doc of ["requirements", "architecture", "specification", "tasks"]) {
    assert.ok(text.includes(`${doc}.md`), `skill 没有提到 ${doc}.md`);
  }
});

test("skill 里出现的 status 值必须在 docStatuses 白名单里", () => {
  const text = skillText();
  const statuses = [...text.matchAll(/status:\s*([a-z-]+)/g)].map((m) => m[1]);
  assert.ok(statuses.length > 0, "skill 不提 status 写法，访谈产出的 front-matter 就没口径");
  for (const status of statuses) {
    assert.ok(
      DEFAULT_CONVENTION.docStatuses.includes(status),
      `status: ${status} 不在白名单（${DEFAULT_CONVENTION.docStatuses.join("/")}）里`,
    );
  }
});

test("勘察分工表在场：四份文档各自的「必须去勘察」是这份 skill 的核心内容", () => {
  const text = skillText();
  assert.ok(text.includes("必须去勘察"), "分工表丢了");
  assert.ok(text.includes("源码盘点"), "architecture 的勘察项（源码盘点）丢了");
  assert.ok(text.includes("现有接口与错误语义"), "specification 的勘察项（现有接口与错误语义）丢了");
  assert.match(text, /tasks\.md[^]*?基本全部/, "tasks 基本全靠勘察这一条丢了");
});

test("「不许编」在场：抽不出来要明说，编出来的结论会被当成高级别事实用", () => {
  const text = skillText();
  // 锁的是总原则那句原话，不是「不许编」三个字出现过——分站里也重复出现这三个字，
  // 只锁出现次数会让人把总原则删了锁还绿着（变异测试实测抓到过）。
  assert.ok(text.includes("抽不出来要明说，不许编"), "总原则的诚实条款丢了");
  assert.ok(text.includes("抽不出"), "「明说抽不出什么」的要求丢了");
});

// 已有文档导入是访谈的另一个入口（抽取的来源可以是文档而不只是对话）。
// 四条规矩每条都对应一种真实损坏，所以逐条锁原话：只锁「出现过关键词」
// 会让人把规矩删了锁还绿着。
test("已有文档导入：四条规矩逐条在场（替人确认/丢内容/硬塞/编空缺，每条都损坏真相源）", () => {
  const text = skillText();
  assert.ok(text.includes("这是映射不是搬家"), "「映射不是搬家」这条定性丢了——搬家心态会照抄章节结构");
  assert.ok(text.includes("一条都不替人确认"), "「不替人确认」丢了：替人确认等于替人签字");
  assert.ok(text.includes("一个字都不许丢"), "「一个字都不许丢」丢了：悄悄扔内容用户永远不会知道少了什么");
  assert.ok(text.includes("不许硬塞进条款里凑数"), "「不许硬塞」丢了：塞进去的会被下游当规格用");
  assert.ok(text.includes("不确定的映射问用户"), "「不确定就问」丢了：悄悄选等于替用户做了没记录的决定");
});

// 站数漂移真实发生过：同一份文件里，大纲标题手抄的数字和别处推算出来的对不上，
// 而没有任何一层会发现——文案和结构各说各话，两边都「看起来对」。
// 所以数字不许手抄，必须由实际的站数推出来。
const CN_NUMERAL = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

test("站数只有一个真相：文案里声明的站数 ≡ 实际提问站的数量", () => {
  const text = skillText();
  const stations = [...text.matchAll(/^### 第 (\d+) 站/gm)].map((m) => Number(m[1]));
  assert.ok(stations.length > 0, "一个提问站都没有，这条锁就空了");
  assert.deepEqual(stations, stations.map((_, i) => i), "提问站编号必须从 0 起且连续——跳号说明有站被删了但编号没收");

  const declared = CN_NUMERAL[stations.length];
  // 只数「声明站数」，不数指代（「这一站」「每一站」）——把指代算成声明，
  // 任何一句正常的行文都会把这条锁弄红，锁就会被当成噪音删掉。
  const claims = [...text.matchAll(/(?<![这那每本同上下前后另某全])([零一二三四五六七八九十])站/g)].map((m) => m[1]);
  assert.ok(claims.length >= 2, "至少要在 frontmatter 和大纲标题两处声明站数，否则读者只能自己数");
  for (const claim of claims) {
    assert.equal(claim, declared, `文案说「${claim}站」，但实际有 ${stations.length} 个提问站（第 0~${stations.length - 1} 站）`);
  }
});

// 拆任务 skill 自己就写着「访谈几乎给不了东西」——把它编成提问站，
// 读者会以为还有一轮问题要答，而实际上那一站没有问题可问。
test("拆任务不算提问站：它勘察为主，编进站数会让人以为还有一轮提问", () => {
  const text = skillText();
  assert.ok(!/### 第 \d+ 站[：:]\s*拆任务/.test(text), "拆任务被编成了提问站");
  assert.ok(text.includes("拆任务"), "拆任务整节丢了——tasks.md 就没有产出口了");
  assert.ok(text.includes("不是提问站"), "没有明说它不是提问站，下次还会被数进去");
});

// 用户实测事故：带着一份 PRD 走导入路径，模型读完直接报「第 0/1 站完成」，
// 而第 0 站的公司背景（行业/发展阶段/经营模式/业务规模/当前工具/当前痛点）一条都没问——
// PRD 里没有，于是既没进文档，也没进缺口清单，静默消失。根因是三处措辞把
// 「读」写成了「问」的替代品、把「原文没有」直接判成「留空」。这三处各上一把锁。
test("导入路径不许拿「读」替代「问」：勘察项和该问的都一项不减", () => {
  const text = skillText();
  const start = text.indexOf("## 已有文档");
  assert.ok(start !== -1, "已有文档导入一节丢了");
  const section = text.slice(start, text.indexOf("\n## ", start + 1));
  // 锚到本节内那一行：只查全文 includes 会被别处的同类措辞顶掉（vacuous green 实测过）。
  const line = section.split("\n").find((l) => l.includes("不是「问」的替代品"));
  assert.ok(line, "没有明说「读原文不是问的替代品」——这正是公司背景消失的那一句");
  assert.ok(line.includes("该问的也一项都不减"), "只说了勘察不减，没说该问的不减，等于只堵了一半");
});

test("「原文没有」只有两个去向（问用户 / 去勘察），静默留空不是选项", () => {
  const text = skillText();
  assert.ok(text.includes("静默留空不在选项里"), "没有把「静默留空」显式排除掉，它就是默认行为");
  assert.ok(
    text.includes("用户脑子里有的就当场问"),
    "没说清「用户能答的当场问」——这一类会被和「等勘察」混成一堆留空",
  );
  assert.ok(
    text.includes("问过了，用户也答不上来"),
    "没说清留空的唯一合法前提是「问过」，「没问过就留空」还会再发生",
  );
});

test("第 0 站的公司背景标着访谈专属：带文档来的也要问", () => {
  const text = skillText();
  const start = text.indexOf("### 第 0 站");
  assert.ok(start !== -1, "第 0 站丢了");
  const section = text.slice(start, text.indexOf("\n### ", start + 1));
  assert.ok(section.includes("访谈专属"), "第 0 站没标「访谈专属」——导入路径会把整站跳过");
  for (const item of ["行业", "发展阶段", "经营模式", "业务规模", "当前工具", "当前痛点"]) {
    assert.ok(section.includes(item), `公司背景少了「${item}」——实测消失的就是这一组`);
  }
});

// 事故里模型报的是「第 0/1 站完成」——它自己认为完成了。没有「完成」的定义，
// 「跳过了六个问题」和「问完了」在它眼里长得一样。这条门禁给「完成」下定义。
test("站级门禁在场：有该问没问的，这一站就不算完成", () => {
  const text = skillText();
  const line = text.split("\n").find((l) => l.includes("不算完成"));
  assert.ok(line, "没有给「一站完成」下定义——模型会把跳过当完成（实测报过「第 0/1 站完成」）");
  assert.ok(line.includes("没问完"), "「不算完成」的条件不是「没问完」，门禁就管不到静默跳过");
  assert.ok(text.includes("不要报「第 N 站完成」"), "没有明确禁止在没问完时宣告完成");
});

// 第二次实测事故：SKILL 修好之后，agent 接手上一版流程留下的 requirements.md，
// 报「sdd_loop_check 干净 → 等你确认」，公司背景依然没补。上一版的门禁写的是
// 「每站收尾前自查」——它假定 agent 正在走那一站；接手别人的 draft 时那个触发点
// 根本没触发。而且它把补问表述成「从第 0 站重新问」，用户以为要作废已有成果。
test("开局第三种局面在场：门禁那份文档已存在且是 draft（接手草稿）", () => {
  const text = skillText();
  const start = text.indexOf("## 开局");
  assert.ok(start !== -1, "「接手已有 draft」这一节丢了——它是 check 干净但文档有洞时的唯一指引");
  const section = text.slice(start, text.indexOf("\n## ", start + 1));
  assert.ok(section.includes("不许直接问「确认吗」"), "没有禁止跳过自查直接请求确认——实测就是这么把洞签进 confirmed 的");
  assert.ok(
    section.includes("干净 ≠ 这份文档问全了"),
    "没有切断「check 干净 → 可以确认」这条错误推理；check 只对账声明与事实，从不读条款内容",
  );
});

test("补问是增量的：不许把补问表述成从头重来", () => {
  const text = skillText();
  assert.ok(text.includes("补问是增量的，不是推倒重来"), "没有明说补问 ≠ 重来");
  // 正反例必须都在：只写「要增量」而不给反例，模型照样会写出「从第 0 站重新问」。
  assert.ok(text.includes("重新问"), "没有把「重新问」这个反例写出来，下次还会这么措辞");
  assert.ok(text.includes("一条不动"), "没给出「已写好的条款一条不动」这个正例措辞，用户仍会以为要作废成果");
  assert.ok(
    /draft 上补是免费的/.test(text),
    "没讲清时机的成本差：draft 上补免费，confirmed 之后补要重走确认",
  );
});

test("站级自查覆盖接手场景：文档已存在 ≠ 这一站问完了", () => {
  const text = skillText();
  const line = text.split("\n").find((l) => l.includes("接手别人写的 draft"));
  assert.ok(line, "站级门禁只覆盖「自己走这一站」，接手草稿时不触发——第二次事故就出在这个缺口");
  assert.ok(
    line.includes("不等于"),
    "没有把「文档已存在」和「这一站问完了」显式拆开，它们还会被当成一回事",
  );
});

// 缺口分类要求出现在三个位置，各管一个时机：总原则（每份文档写完时）、
// 导入路径的收尾报告、整轮收尾。逐区锚定而不是全文 includes——变异测试实测过：
// 只删总原则那句，锁靠收尾那句照样绿（vacuous green）。
const GAP_SECTIONS = [
  ["## 总原则", "每份文档写完时的缺口分类"],
  ["## 已有文档", "导入路径的收尾报告"],
  ["## 收尾", "整轮收尾的缺口交代"],
];

test("缺口清单必须按去向分类：问过答不上来 / 还没问 / 等勘察（三个时机各一处）", () => {
  const text = skillText();
  for (const [heading, what] of GAP_SECTIONS) {
    const start = text.indexOf(`\n${heading}`);
    assert.ok(start !== -1, `${heading} 一节丢了`);
    const end = text.indexOf("\n## ", start + 1);
    const section = text.slice(start, end === -1 ? text.length : end);
    assert.ok(section.includes("还没问的"), `${what}：缺了「还没问的」这一类——它会被并进「待勘察」消失掉`);
    assert.ok(
      /答不上来/.test(section),
      `${what}：没有区分「问过答不上来」和「没问过」——这是这条锁的全部意义`,
    );
  }
  // 「还没问的」必须要求把问题摆出来。只写「待补充」正是实测那份报告的写法：
  // 五条留空全是勘察项，一条访谈项都没有，读的人分不出哪些该他答。
  // 这一条故意是全文级（「至少一处要求列问题」）而不是逐区：删掉其中一处时另一处仍成立，
  // 规矩没丢，锁就该保持绿——逐区会在规矩仍然成立时报红，那是假警报。
  assert.match(
    text,
    /还没问的[^\n]*把问题(直接)?列出来/,
    "「还没问的」没要求列出问题，等于只报了个数，用户还是不知道该答什么",
  );
});

// 命令名是宿主特有的：pi 用 registerCommand 注册 `/sdd` 带子命令，Claude Code 按
// skill 名注册，所以是 `/sdd-init`。skill 正文里只报一个宿主的命令名，另一个宿主的
// 用户会拿到一条不存在的命令——冷启动时被指向死路。
test("跨宿主命令名：提到 /sdd init 的地方必须同时给出 Claude Code 的 /sdd-init", () => {
  const text = skillText();
  const lines = text.split("\n").filter((l) => /\/sdd init/.test(l));
  assert.ok(lines.length > 0, "skill 不再指引去初始化了？这条锁需要跟着改");
  for (const line of lines) {
    assert.ok(
      line.includes("/sdd-init"),
      `只报了 pi 的 \`/sdd init\`，没给 Claude Code 的 \`/sdd-init\`——那个宿主的用户跑不起来：\n  ${line}`,
    );
  }
});

test("旧模型痕迹不许进 skill：没有字段路径绑定，没有 prd_* 工具引用", () => {
  const text = skillText();
  assert.ok(!/\bdata\.s\d/.test(text), "出现了 data.sN 字段路径——步骤状态机的残骸");
  assert.ok(!/prd_(step|project)_/.test(text), "出现了 prd_* 工具名——旧扩展的残骸");
  assert.ok(!/intent\.rawDemand/.test(text), "出现了 intro 步的字段路径");
});

test("写之前查口径：skill 必须把 guide 指给访谈者", () => {
  const text = skillText();
  assert.ok(/sdd-loop guide --type/.test(text), "skill 没有指引「写之前先跑 sdd-loop guide 查口径与编号族」");
});

// P16-2 的锁随旧 skill 退役后挪到这里（判据原话：包边界要显式——分发什么是决定，
// 不是「目录里有什么就发什么」的副作用。曾经整目录注册把 8 个维护者自用技能
// 塞给了每个安装者）。
test("pi.skills 显式列出本包技能，且与 skills/ 下的真目录一一对应", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const realSkills = fs.readdirSync(path.join(REPO_ROOT, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => `./skills/${entry.name}`)
    .sort();
  assert.deepEqual([...pkg.pi.skills].sort(), realSkills, "skills/ 下的真目录（非符号链接）必须与 pi.skills 一一对应");
});
