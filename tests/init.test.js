/**
 * `sdd-loop init -g` 的锁。
 *
 * 一半锁「装得上」，一半锁「不越权」。后一半更要紧：安装器是唯一一个会往
 * 用户主目录写东西的子命令，它删错一个目录就是删掉别人手写的 skill。
 * 所以「占位时不动手」这条有独立命名的锁，且验的是**动手之后内容还在**，
 * 不只是「计划里标了 occupied」——标了但照删是最典型的空绿。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  planInstall,
  hasWork,
  hasConflict,
  noHostDetected,
  readPackagedSkills,
  findLegacyLinks,
  HOST_IDS,
  AGENTS_HOSTS,
} from "../src/install/plan.js";
import { applyPlan, cliOnPath, renderPlan } from "../scripts/lib/init.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO_ROOT, "scripts/sdd-loop.mjs");

/**
 * 造一个假 home。参数决定哪几个宿主「装在这台机器上」。
 * `agentsHost` 传一个宿主 id（codex / cursor / kimi …），建出它的检测目录。
 */
function fakeHome({ claude = true, agentsHost = null, pi = true, piPackages } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-home-"));
  if (claude) fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  if (agentsHost) fs.mkdirSync(path.join(home, ...AGENTS_HOST_DIR[agentsHost]), { recursive: true });
  if (pi) {
    const agentDir = path.join(home, ".pi", "agent");
    fs.mkdirSync(agentDir, { recursive: true });
    if (piPackages !== undefined) {
      fs.writeFileSync(
        path.join(agentDir, "settings.json"),
        typeof piPackages === "string" ? piPackages : JSON.stringify({ packages: piPackages }),
      );
    }
  }
  return home;
}

/**
 * 每个走共享落点的宿主，用哪个目录判断它「装了」。
 * 这份是**测试自己的**期望值，不从被测代码 import——两边各写一份才锁得住
 * 「判据被人偷偷改成按 ~/.agents/ 判」。下面有一条锁强制它与 AGENTS_HOST_IDS 同步。
 */
const AGENTS_HOST_DIR = {
  codex: [".codex"],
  copilot: [".copilot"],
  cursor: [".cursor"],
  windsurf: [".codeium", "windsurf"],
  opencode: [".config", "opencode"],
  kimi: [".kimi-code"],
  antigravity: [".gemini", "antigravity-ide"],
  droid: [".factory"],
  roo: [".roo"],
};

// env 必须显式给：Gemini 靠 PATH 上有没有 gemini 判断，不控 PATH 的话
// 「装了 gemini 的开发机」和「没装的」会跑出两种结果——测试就不是判据了。
const planFor = (home, only, env = { PATH: "" }) =>
  planInstall({ packageRoot: REPO_ROOT, home, only, env });

/** 造一个假 PATH，里面放一个可执行的同名文件，冒充某个 CLI 装好了。 */
function pathWith(binName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-bin-"));
  const bin = path.join(dir, binName);
  fs.writeFileSync(bin, "#!/bin/sh\n");
  fs.chmodSync(bin, 0o755);
  return dir;
}
const claudeHost = (plan) => plan.hosts.find((h) => h.id === "claude");
const piHost = (plan) => plan.hosts.find((h) => h.id === "pi");
const agentsHost = (plan) => plan.hosts.find((h) => h.id === "agents");

// ---------------------------------------------------------------- 装得上

test("冷启动：空 home 里两个 skill 都待建，动手后软链真的指向本包", () => {
  const home = fakeHome({ pi: false });
  const plan = planFor(home);
  const before = claudeHost(plan);

  assert.equal(before.items.length, 2, "本包有两个 skill，计划里应该都在");
  assert.ok(before.items.every((i) => i.state === "ready"), "空 home 里两个都该是待建");
  assert.ok(hasWork(plan), "有活要干");

  const results = applyPlan(plan);
  assert.ok(results.every((r) => r.ok), `动手应全部成功：${JSON.stringify(results)}`);

  for (const item of before.items) {
    const stat = fs.lstatSync(item.target);
    assert.ok(stat.isSymbolicLink(), `${item.name} 应该是软链`);
    assert.equal(
      path.resolve(path.dirname(item.target), fs.readlinkSync(item.target)),
      item.source,
      `${item.name} 的软链要指向本包里的真目录`,
    );
    assert.ok(fs.existsSync(path.join(item.target, "SKILL.md")), `顺着软链要读得到 ${item.name} 的 SKILL.md`);
  }
});

test("幂等：装完再算一次全是 already，再动手一次也不报错", () => {
  const home = fakeHome({ pi: false });
  applyPlan(planFor(home));

  const again = planFor(home);
  assert.ok(claudeHost(again).items.every((i) => i.state === "already"), "已装好的应该认出来，不该再报待建");
  assert.equal(hasWork(again), false, "没活了");
  assert.deepEqual(applyPlan(again), [], "没活时动手应该什么都不做");
});

test("要装哪些 skill 来自 package.json 的 pi.skills，不是代码里硬编码的清单", () => {
  const real = readPackagedSkills(REPO_ROOT);
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.deepEqual(
    real.map((s) => s.name),
    pkg.pi.skills.map((rel) => path.basename(rel)),
    "计划里的 skill 必须与 pi.skills 一一对应——两处各写一份就等着漂",
  );

  // 换一个只登记了一个 skill 的假包，计划必须跟着变（证明真的在读，不是抄常量）。
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-pkg-"));
  fs.mkdirSync(path.join(fake, "skills", "only-one"), { recursive: true });
  fs.writeFileSync(path.join(fake, "package.json"), JSON.stringify({ pi: { skills: ["./skills/only-one"] } }));
  assert.deepEqual(
    readPackagedSkills(fake).map((s) => s.name),
    ["only-one"],
  );
});

// ---------------------------------------------------------------- 不越权

test("不删真实目录：同名位置是用户自己的 skill 时，动手之后它的内容原样还在", () => {
  const home = fakeHome({ pi: false });
  const mine = path.join(home, ".claude", "skills", "sdd-init");
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, "SKILL.md"), "我自己写的，别动");

  const plan = planFor(home);
  const occupied = claudeHost(plan).items.find((i) => i.name === "sdd-init");
  assert.equal(occupied.state, "occupied", "真实目录必须报成占位");
  assert.ok(hasConflict(plan));

  applyPlan(plan);

  assert.equal(
    fs.readFileSync(path.join(mine, "SKILL.md"), "utf8"),
    "我自己写的，别动",
    "安装器把用户自己的 skill 删了/覆盖了——这是这个子命令能造成的最大伤害",
  );
  assert.ok(fs.lstatSync(mine).isDirectory(), "它还应该是个真目录，不该被换成软链");

  // 没被占的那个照样要装上：一处冲突不该拖累另一处。
  const other = claudeHost(planFor(home)).items.find((i) => i.name === "sdd-interview");
  assert.equal(other.state, "already", "另一个 skill 应该照常装好");
});

test("不动别人的软链：指向别处的同名软链，动手之后指向不变", () => {
  const home = fakeHome({ pi: false });
  const skillsDir = path.join(home, ".claude", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  const elsewhere = path.join(home, "somewhere-else");
  fs.mkdirSync(elsewhere);
  const link = path.join(skillsDir, "sdd-interview");
  fs.symlinkSync(elsewhere, link);

  const plan = planFor(home);
  const item = claudeHost(plan).items.find((i) => i.name === "sdd-interview");
  assert.equal(item.state, "occupied", "指向别处的软链是占位，不是「已装好」");
  assert.match(item.detail, /已有软链指向/);

  applyPlan(plan);
  assert.equal(path.resolve(skillsDir, fs.readlinkSync(link)), elsewhere, "别人的软链被改了");
});

test("--show 只看不做：跑完之后主目录里一个文件都没多", () => {
  const home = fakeHome({ pi: false });
  const snapshot = () => fs.readdirSync(path.join(home, ".claude"), { recursive: true }).sort();
  const before = snapshot();

  const out = spawnCli(["init", "-g", "--show"], home).stdout;

  assert.match(out, /sdd-init/, "--show 得把要做什么说出来");
  assert.deepEqual(snapshot(), before, "--show 动了盘——预览就不再是预览");
});

// ---------------------------------------------------------------- 判据读不出来

test("pi 的 settings.json 坏了：报「不知道」，不谎报「没装」", () => {
  const home = fakeHome({ claude: false, piPackages: "{ 这不是 JSON" });
  const host = piHost(planFor(home));
  assert.equal(host.installed, null, "读不出来必须是 null——报 false 会让安装器去重装一个可能已经在的东西");
  assert.equal(hasWork(planFor(home)), false, "不知道装没装时不该擅自动手");
});

test("pi 已登记：settings 里的相对路径要按 ~/.pi/agent/ 解析后再比", () => {
  const home = fakeHome({ claude: false });
  const rel = path.relative(path.join(home, ".pi", "agent"), REPO_ROOT);
  fs.writeFileSync(
    path.join(home, ".pi", "agent", "settings.json"),
    JSON.stringify({ packages: [rel] }),
  );
  assert.equal(piHost(planFor(home)).installed, true, "相对路径没解析对，已装的包会被当成没装");

  // 登记的是别的包时不能误判成已装。
  fs.writeFileSync(
    path.join(home, ".pi", "agent", "settings.json"),
    JSON.stringify({ packages: ["../../somewhere/other-pkg"] }),
  );
  assert.equal(piHost(planFor(home)).installed, false);
});

test("宿主没装：跳过并说明理由，不当成失败，也不拖累另一个宿主", () => {
  const home = fakeHome({ pi: false });
  const plan = planFor(home);
  assert.equal(piHost(plan).detected, false);
  assert.match(piHost(plan).reason, /看不到 pi/);
  assert.equal(claudeHost(plan).detected, true, "另一个宿主该照常算");
  assert.equal(noHostDetected(plan), false);
});

test("一个宿主都没有：说清楚什么也没做，退出码 2", () => {
  const home = fakeHome({ claude: false, pi: false });
  assert.equal(noHostDetected(planFor(home)), true);

  const res = spawnCli(["init", "-g"], home);
  assert.equal(res.status, 2, "什么都没装成不是「干净」");
  assert.match(res.stdout, /一个宿主都没检测到/);
});

// ---------------------------------------------------------------- 共享落点

test("每个走开放标准的宿主都能单独触发共享落点，且软链只建一份", () => {
  // 一个宿主一条锁：加了宿主忘了写检测判据，这里就红。
  for (const [id, seg] of Object.entries(AGENTS_HOST_DIR)) {
    const home = fakeHome({ claude: false, agentsHost: id, pi: false });
    const plan = planFor(home);
    const host = agentsHost(plan);

    assert.equal(host.detected, true, `只装了 ${id}（${path.join(...seg)}）时该认出共享落点`);
    assert.ok(
      host.serves.some((s) => s.id === id),
      `共享落点得说清楚它在服务谁，缺了 ${id}`,
    );
    assert.equal(host.dir, path.join(home, ".agents", "skills"), "落点是开放标准的共用用户级目录");

    assert.ok(applyPlan(plan).every((r) => r.ok));
    assert.deepEqual(
      fs.readdirSync(host.dir).sort(),
      ["sdd-init", "sdd-interview"],
      `${id}：共享落点里该正好两个 skill`,
    );
    for (const item of host.items) {
      assert.ok(fs.lstatSync(item.target).isSymbolicLink());
      assert.ok(
        fs.existsSync(path.join(item.target, "SKILL.md")),
        `顺着软链要读得到 ${item.name} 的 SKILL.md——开放标准认的是 SKILL.md`,
      );
    }
    assert.equal(hasWork(planFor(home)), false, `${id}：装完就该没活了`);
  }
});

test("Gemini 按 PATH 上有没有 gemini 判，不按 ~/.gemini/ 在不在判", () => {
  // 实测的假阳性：Antigravity IDE 也用 ~/.gemini/，一台没装 Gemini CLI 的机器上
  // 这个目录连同 GEMINI.md、settings.json 都在。按目录判会说「装了」。
  const home = fakeHome({ claude: false, pi: false });
  fs.mkdirSync(path.join(home, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(home, ".gemini", "GEMINI.md"), "别的工具写的");

  const host = agentsHost(planFor(home));
  assert.equal(host.detected, false, "只有 ~/.gemini/ 目录不能算 Gemini CLI 装了");

  const withGemini = agentsHost(planFor(home, null, { PATH: pathWith("gemini") }));
  assert.equal(withGemini.detected, true, "PATH 上有 gemini 就该认出来");
  assert.deepEqual(withGemini.serves.map((s) => s.id), ["gemini"], "此时只该认出 Gemini CLI 一个");
});

test("检测判据一律不看 ~/.agents/ 本身——那目录谁都可能建", () => {
  // 按共用目录判等于「有人用过任意一个宿主」就说全都装了：一次误判会让安装器
  // 往一台其实没有任何开放标准宿主的机器上装东西。判据必须落在宿主自己的地盘。
  const home = fakeHome({ claude: false, pi: false });
  fs.mkdirSync(path.join(home, ".agents", "skills"), { recursive: true });
  fs.writeFileSync(path.join(home, ".agents", "skills", "someone-else.md"), "别的工具写的");

  const host = agentsHost(planFor(home));
  assert.equal(host.detected, false, "只有 ~/.agents/ 目录不能算任何宿主装了");
  assert.deepEqual(host.serves, [], "一个都没检测到时 serves 是空的");
  assert.match(host.reason, /\.agents/, "得说清楚哪个落点没人读");

  applyPlan(planFor(home));
  assert.deepEqual(
    fs.readdirSync(path.join(home, ".agents", "skills")),
    ["someone-else.md"],
    "没检测到宿主就不该往共用目录里写东西",
  );
});

test("AGENTS_HOST_DIR 与代码里的宿主清单同步——加了宿主忘了加锁，上面那条就空转", () => {
  // gemini 靠 PATH 判、没有目录判据，所以单列出来；其余每个都必须在表里。
  assert.deepEqual(
    [...Object.keys(AGENTS_HOST_DIR), "gemini"].sort(),
    AGENTS_HOSTS.map((h) => h.id).sort(),
    "宿主清单变了但测试的期望表没跟上",
  );
});

test("--help 里的共享落点宿主名单来自判定源——加了宿主帮助里就有，不用手抄", () => {
  const help = spawnCli(["--help"]).stdout;
  for (const host of AGENTS_HOSTS) {
    assert.ok(help.includes(host.label), `--help 没提 ${host.label}，用户不知道 --agents 装给谁`);
  }
});

test("Cursor 的「不跟进软链」提醒要露到计划里，不能装了不说", () => {
  // 本包就是软链装法。社区多份报告说 Cursor 不跟进软链——照实说，
  // 不假装装上了就一定能用。
  const home = fakeHome({ claude: false, agentsHost: "cursor", pi: false });
  const out = renderPlan(planFor(home));
  assert.match(out, /Cursor/);
  assert.match(out, /软链/, "Cursor 那条注解没渲染出来，用户会以为一定能用");
});

test("共享落点会说清楚这一份软链在服务谁", () => {
  const home = fakeHome({ claude: false, agentsHost: "codex", pi: false });
  fs.mkdirSync(path.join(home, ".factory"), { recursive: true });
  const out = renderPlan(planFor(home));
  assert.match(out, /Codex/);
  assert.match(out, /Factory Droid/, "两个宿主共用一份软链时都要点名，否则用户不知道装给谁了");
});

test("不越权对共享落点一样成立：占位的真实目录动手之后内容还在", () => {
  const home = fakeHome({ claude: false, agentsHost: "codex", pi: false });
  const mine = path.join(home, ".agents", "skills", "sdd-init");
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, "SKILL.md"), "我自己写的，别动");

  const plan = planFor(home);
  assert.equal(agentsHost(plan).items.find((i) => i.name === "sdd-init").state, "occupied");

  applyPlan(plan);
  assert.equal(fs.readFileSync(path.join(mine, "SKILL.md"), "utf8"), "我自己写的，别动");
  assert.ok(fs.lstatSync(mine).isDirectory(), "它还应该是个真目录，不该被换成软链");
});

test("Claude Code 单独走自己的落点，与共享落点不重叠", () => {
  // 实查 claude 可执行体：`.claude/skills` 296 次、`.agents/skills` 零次——它不读
  // 共用目录。反过来，一个宿主也绝不能两个落点都装：实测宿主不去重，同名 skill
  // 同时在品牌目录和共用目录里会被列两遍，模型看到两个同名 skill。
  const home = fakeHome({ claude: true, agentsHost: "codex", pi: false });
  applyPlan(planFor(home));

  for (const dir of [path.join(home, ".claude", "skills"), path.join(home, ".agents", "skills")]) {
    assert.deepEqual(fs.readdirSync(dir).sort(), ["sdd-init", "sdd-interview"], `${dir} 没装齐`);
  }
  assert.equal(fs.existsSync(path.join(home, ".codex", "skills")), false, "不该再往品牌目录里装");
});

test("旧版留在品牌目录里的软链只报不删，且只认指向本包的那些", () => {
  const home = fakeHome({ claude: false, agentsHost: "codex", pi: false });
  const skills = readPackagedSkills(REPO_ROOT);
  const legacyDir = path.join(home, ".codex", "skills");
  fs.mkdirSync(legacyDir, { recursive: true });
  const elsewhere = path.join(home, "somewhere-else");
  fs.mkdirSync(elsewhere);

  // 三个干扰项都占着**本包 skill 的同名位置**——放别的名字等于没测，
  // 扫描只按 skill 名找，永远看不到它们。
  //   .codex/skills/sdd-init      旧版软链，指向本包 → 该报
  //   .codex/skills/sdd-interview 用户自己的真目录   → 不该报
  //   .gemini/skills/sdd-init     指向别处的软链     → 不该报
  fs.symlinkSync(skills[0].source, path.join(legacyDir, skills[0].name));
  const mine = path.join(legacyDir, skills[1].name);
  fs.mkdirSync(mine);
  fs.writeFileSync(path.join(mine, "SKILL.md"), "我自己写的");
  const geminiLegacy = path.join(home, ".gemini", "skills");
  fs.mkdirSync(geminiLegacy, { recursive: true });
  fs.symlinkSync(elsewhere, path.join(geminiLegacy, skills[0].name));

  const found = findLegacyLinks({ home, skills });
  assert.deepEqual(
    found.map((f) => `${f.label}/${f.name}`),
    [`Codex/${skills[0].name}`],
    "只该报指向本包的旧版软链——别人的目录、指向别处的软链都轮不到我们评论",
  );

  const plan = planFor(home);
  assert.match(renderPlan(plan), /rm /, "旧版落点得给出可执行的处理办法");

  applyPlan(plan);
  assert.deepEqual(
    fs.readdirSync(legacyDir).sort(),
    [skills[0].name, skills[1].name].sort(),
    "安装器把品牌目录里的东西删了——它只该报，不该删",
  );
  assert.equal(fs.readFileSync(path.join(mine, "SKILL.md"), "utf8"), "我自己写的");
  assert.equal(
    path.resolve(geminiLegacy, fs.readlinkSync(path.join(geminiLegacy, skills[0].name))),
    elsewhere,
    "别人的软链被改了",
  );
});

test("我们的 SKILL.md front-matter 满足 Agent Skills 标准（name + description）", () => {
  // Gemini 与 Claude Code 都按这个标准发现 skill：缺 name/description 就不会被发现，
  // 而且不会报错——装是装上了，用的时候找不到，最难查。
  for (const rel of readPackagedSkills(REPO_ROOT).map((s) => s.source)) {
    const text = fs.readFileSync(path.join(rel, "SKILL.md"), "utf8");
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, `${path.basename(rel)}/SKILL.md 没有 front-matter`);
    assert.match(fm[1], /^name:\s*\S+/m, `${path.basename(rel)} 缺 name`);
    assert.match(fm[1], /^description:\s*\S+/m, `${path.basename(rel)} 缺 description`);
  }
});

// ---------------------------------------------------------------- CLI 表面

test("init 不带 -g 时不猜：指向 sdd-init skill，退出码 2", () => {
  const res = spawnCli(["init"]);
  assert.equal(res.status, 2, "用法无效是退出码 2");
  assert.match(res.stderr, /sdd-init/, "得告诉用户初始化仓库该找谁，不能只说「不支持」");
});

test("--show 的退出码可用于脚本判断：装好了 0，没装好 1", () => {
  const empty = fakeHome({ pi: false });
  assert.equal(spawnCli(["init", "-g", "--show"], empty).status, 1, "还没装好该是 1");

  applyPlan(planFor(empty));
  assert.equal(spawnCli(["init", "-g", "--show"], empty).status, 0, "装好了该是 0");
});

test("宿主标志限定范围：只算被点名的那个", () => {
  const home = fakeHome();
  for (const id of HOST_IDS) {
    assert.deepEqual(planFor(home, [id]).hosts.map((h) => h.id), [id], `--${id} 应该只算 ${id}`);
  }
  assert.deepEqual(planFor(home).hosts.map((h) => h.id), HOST_IDS, "不点名就是全部宿主");
});

test("每个宿主都有对应的 CLI 标志——加了宿主忘了加标志，用户点不到它", () => {
  const cli = fs.readFileSync(path.join(REPO_ROOT, "scripts/sdd-loop.mjs"), "utf8");
  const flags = cli.match(/const BOOLEAN_FLAGS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(flags, "解析不出 BOOLEAN_FLAGS，这条锁就空了");
  for (const id of HOST_IDS) {
    assert.ok(flags[1].includes(`"${id}"`), `HOST_IDS 里有 ${id}，但 CLI 没登记 --${id}`);
  }
});

test("布尔标志不吞掉后面的 token（--show 之后还能跟别的参数）", () => {
  const home = fakeHome({ pi: false });
  // 若 --show 把 --claude 当成自己的值吃掉，这里就会连 claude 都限定不上。
  const res = spawnCli(["init", "-g", "--show", "--claude"], home);
  assert.match(res.stdout, /Claude Code/);
  assert.doesNotMatch(res.stdout, /^pi {2}/m, "点名了 --claude，不该再算 pi");
});

test("cliOnPath：PATH 上有可执行的 sdd-loop 才算数", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-bin-"));
  assert.equal(cliOnPath({ PATH: dir }), false, "空目录不该算有");

  const bin = path.join(dir, "sdd-loop");
  fs.writeFileSync(bin, "#!/bin/sh\n");
  assert.equal(cliOnPath({ PATH: dir }), false, "没有执行位的不算——装了也跑不起来");

  fs.chmodSync(bin, 0o755);
  assert.equal(cliOnPath({ PATH: dir }), true);
});

// 必须用 spawnSync：execFileSync 在非零退出时抛异常，而这里好几条锁验的
// 正是非零退出码——用 execFileSync 会把「退出码对不对」变成「有没有抛」。
function spawnCli(args, home, pathDir = "") {
  const env = { ...process.env, PATH: pathDir };
  if (home) env.HOME = home;
  // 用 process.execPath 而不是 "node"：PATH 被清空后 "node" 就找不到了。
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env });
}
