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

import { planInstall, hasWork, hasConflict, noHostDetected, readPackagedSkills, HOST_IDS } from "../src/install/plan.js";
import { applyPlan, cliOnPath } from "../scripts/lib/init.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO_ROOT, "scripts/sdd-loop.mjs");

/** 造一个假 home。hosts 决定哪几个宿主「装在这台机器上」。 */
function fakeHome({ claude = true, pi = true, piPackages } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-home-"));
  if (claude) fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
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

const planFor = (home, only) => planInstall({ packageRoot: REPO_ROOT, home, only });
const claudeHost = (plan) => plan.hosts.find((h) => h.id === "claude");
const piHost = (plan) => plan.hosts.find((h) => h.id === "pi");

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

test("--claude / --pi 限定宿主：只算被点名的那个", () => {
  const home = fakeHome();
  assert.deepEqual(planFor(home, ["claude"]).hosts.map((h) => h.id), ["claude"]);
  assert.deepEqual(planFor(home, ["pi"]).hosts.map((h) => h.id), ["pi"]);
  assert.deepEqual(planFor(home).hosts.map((h) => h.id), HOST_IDS, "不点名就是全部宿主");
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
function spawnCli(args, home) {
  const env = { ...process.env };
  if (home) env.HOME = home;
  return spawnSync("node", [CLI, ...args], { encoding: "utf8", env });
}
