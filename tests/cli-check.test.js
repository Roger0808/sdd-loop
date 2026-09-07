/**
 * `sdd-loop check` 这个**表面**的锁（真的起进程跑，不是调判定函数）。
 *
 * 判定本身在 tests/loop-check.test.js 里锁着。这里锁的是别的东西：
 *
 * 1. **单流一个字都没变。** 这个包是全局安装的，已经在跑的单流仓库不该因为
 *    别人要分流而输出变样——文案、`--json` 的形状、退出码，三样都要原样。
 *    这条是分流那次改动的全部向后兼容承诺，而它此前没有任何机器锁：
 *    变异测试实测把单流那条直通分支改成 `if (false)`，全套测试照样绿。
 * 2. **退出码契约**（0/1/2）。0 和 1 的差别是「能不能开工」，1 和 2 的差别是
 *    「去解决矛盾」还是「判据都读不出来，别信任何结论」——都不是文案问题。
 * 3. **打错流名是用法错误**，不是「这个仓库还没有 SDD Loop 结构」。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { buildLoopCheckReport } from "../src/validation/loop-check.js";
import { EXIT_OK, EXIT_CONTENT, EXIT_UNUSABLE } from "../scripts/lib/exit-codes.mjs";

const CLI = path.resolve(import.meta.dirname, "../scripts/sdd-loop.mjs");

function git(dir, args) {
  execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
}

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function doc(status) {
  return `---\ndocument: stage\nstatus: ${status}\n---\n\n# 内容\n`;
}

function statusFile({ activeLoop = "null", lastClosedLoop = "0" } = {}) {
  return `---\nproject: t\ndocument: loop-status\nactiveLoop: ${activeLoop}\nlastClosedLoop: ${lastClosedLoop}\nnextLoop: 1\nnextPhase: requirements\n---\n\n# Loop 状态\n`;
}

/** 冲突标记 = 判据读不出来。 */
const POISONED = "---\nproject: t\n<<<<<<< HEAD\nactiveLoop: 1\n=======\nactiveLoop: 2\n>>>>>>> x\n---\n";

function commit(root) {
  git(root, ["init", "-q"]);
  git(root, ["add", "-A"]);
  git(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  return root;
}

/** 单流基线：activeLoop 为 null，loop-0 全归档。 */
function singleRepo(build) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-cli-"));
  write(root, "docs/loops/status.md", statusFile());
  for (const stage of ["requirements", "architecture", "specification", "tasks"]) {
    write(root, `docs/archive/loop-0-cleanup/${stage}.md`, doc("archived"));
  }
  if (build) build(root);
  return commit(root);
}

function streamRepo(streams) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-cli-s-"));
  for (const [name, spec] of Object.entries(streams)) {
    write(root, `docs/loops/${name}/status.md`, spec.status ?? statusFile({ activeLoop: 1, lastClosedLoop: "null" }));
    for (const [rel, content] of Object.entries(spec.files ?? {})) write(root, `docs/loops/${name}/${rel}`, content);
  }
  return commit(root);
}

const okStream = { files: { "loop-1/requirements.md": doc("confirmed") } };

function run(args) {
  const r = spawnSync(process.execPath, [CLI, "check", ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// ---------------------------------------------------------------- 单流原样

// 分流的每一处渲染分叉都在这条锁的对面。它盯的不是「输出好不好看」，
// 是「有没有人在单流路径上加了新东西」——加了就是所有存量仓库一起变样。
test("单流：文案只有仓库 / 状态文件 / 正文三段，不冒出任何分流的壳", () => {
  const { code, out } = run(["--repo", singleRepo()]);
  assert.equal(code, EXIT_OK, "干净仓库必须退出 0");
  const lines = out.split("\n");
  assert.match(lines[0], /^仓库 \//, "第一行是仓库路径");
  assert.match(lines[1], /^状态文件 /, "第二行是状态文件路径");
  assert.equal(lines[2], "", "第三行空行");
  for (const shell of ["分流：", "── 流 ", "总结论"]) {
    assert.ok(!out.includes(shell), `单流输出里冒出了分流的「${shell}」——所有存量仓库的输出当场变样`);
  }
});

test("单流：--json 吐的就是那份单流报告本身，没有聚合外壳", () => {
  const root = singleRepo();
  const { code, out } = run(["--repo", root, "--json"]);
  assert.equal(code, EXIT_OK);
  const parsed = JSON.parse(out);
  // 逐字段比，而不是只查几个键：多包一层 { mode, streams } 会让所有下游脚本
  // （report.problems、report.readable）一次性全部读到 undefined。
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(buildLoopCheckReport(root))));
  assert.equal(parsed.mode, undefined, "单流的 JSON 里不该有 mode——那是聚合对象的字段");
  assert.equal(parsed.streams, undefined, "单流的 JSON 里不该有 streams");
});

test("单流：退出码 0/1/2 分别对应干净 / 有矛盾 / 判据读不出来", () => {
  assert.equal(run(["--repo", singleRepo()]).code, EXIT_OK);

  const dangling = singleRepo((r) => write(r, "docs/loops/status.md", statusFile({ activeLoop: 9 })));
  assert.equal(run(["--repo", dangling]).code, EXIT_CONTENT, "activeLoop 悬空是矛盾，退出 1");

  const poisoned = singleRepo((r) => write(r, "docs/loops/status.md", POISONED));
  const bad = run(["--repo", poisoned]);
  assert.equal(bad.code, EXIT_UNUSABLE, "判据读不出来退出 2");
  assert.ok(!bad.out.includes("下一步"), "读不出来时不许给任何结论");
});

// ---------------------------------------------------------------- 分流

test("分流：逐流一节，末尾一句总结论，退出码取最坏的一档", () => {
  const root = streamRepo({
    maker: okStream,
    "admin-console": { status: statusFile({ activeLoop: 7, lastClosedLoop: "null" }) },
  });
  const { code, out } = run(["--repo", root]);
  assert.equal(code, EXIT_CONTENT, "一条流有矛盾，整体退出 1");
  assert.match(out, /分流：2 条/, "抬头没说有几条流，读者不知道下面为什么有两段");
  assert.ok(out.includes("── 流 maker ──"), "缺 maker 那一节");
  assert.ok(out.includes("── 流 admin-console ──"), "缺 admin-console 那一节");
  assert.ok(out.includes("总结论"), "缺总结论——逐流看完还要自己汇总");
});

test("分流：一条流读不出来，其余各流的结论照样印出来，退出码升到 2", () => {
  // 「读不出来」是最坏的一档，但它不该顺手把别人的结论也吞掉：
  // 那等于一条流的合并冲突瘫痪整个仓库的门禁。
  const root = streamRepo({ maker: okStream, "admin-console": { status: POISONED } });
  const { code, out } = run(["--repo", root]);
  assert.equal(code, EXIT_UNUSABLE);
  assert.ok(out.includes("── 流 maker ──"), "干净那条流的小节没了");
  assert.match(out, /流 maker[\s\S]*下一步/, "maker 判据没问题，它的结论必须照给");
});

test("分流：--stream 只判指名那条，别的流报红也不影响它的退出码", () => {
  const root = streamRepo({ maker: okStream, "admin-console": { status: POISONED } });
  const { code, out } = run(["--repo", root, "--stream", "maker"]);
  assert.equal(code, EXIT_OK, "指名的那条流是干净的，就该退出 0");
  assert.ok(!out.includes("admin-console"), "指名一条流时不该把别的流也印出来");
  // 抬头是读者用来判断「有没有漏看」的那一行。这个仓库有两条流，只判了一条，
  // 抬头写「分流：1 条」就是句假话——读者据此以为自己看全了。
  assert.ok(!out.includes("分流：1 条"), "指名一条流时抬头谎报了仓库只有一条流");
  assert.match(out, /只判一条流：maker/, "抬头没说清这一趟只判了指名的那条");
});

// 打错流名走下去只会得到「这个仓库还没有 SDD Loop 结构」，用户会照着去
// 初始化一个已经初始化过的仓库——那是不可逆的一步，而错因是个拼写。
test("分流：--stream 打错名字是用法错误，不许说成「还没有 SDD Loop 结构」", () => {
  const root = streamRepo({ maker: okStream, "admin-console": okStream });
  const { code, out, err } = run(["--repo", root, "--stream", "makerr"]);
  assert.equal(code, EXIT_UNUSABLE);
  assert.ok(err.includes("makerr"), "没有回显打错的那个名字");
  assert.ok(err.includes("maker") && err.includes("admin-console"), "没有列出可用的流名，用户只能去翻目录");
  assert.ok(!`${out}${err}`.includes("还没有 SDD Loop 结构"), "把拼错说成了冷启动");
});

test("--stream 不是布尔开关：流名不许被当成开关的值吃掉", () => {
  // BOOLEAN_FLAGS 里多写一个 "stream"，`--stream maker` 会变成「开关 --stream=true
  // + 位置参数 maker」，然后 true 被当成流名去查，用户拿到「没有名为 true 的流」。
  // 这里锁的是正向：给了一个**存在**的流名，就不许报流名不存在。
  // 反向断言（「输出里没有别的流」）挡不住它——退化路径同样什么都不印。
  const root = streamRepo({ maker: okStream, "admin-console": { status: POISONED } });
  const { err } = run(["--repo", root, "--stream", "maker"]);
  assert.ok(!err.includes("没有名为"), `maker 是真实存在的流，不该被报成不存在：${err.trim()}`);
});
