/**
 * sdd-loop pi 扩展的锁。
 *
 * 两类锁，对应两条红线：
 * 1. 行为锁：两个工具在干净/矛盾/不可读三种仓库形状下给出与 CLI 一致的结论
 *   （判定来自 loop-check.js，扩展只是另一个表面）。
 * 2. 源码锁：判定与口径只许 import，不许在扩展里再长一份——「判定只有一份」
 *   在这条线上的形态就是 import 清单。同 upstream-context-sites.test.js 的传统。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";

const [major, minor] = process.versions.node.split(".").map(Number);
const canStripTypes = major > 22 || (major === 22 && minor >= 18);
const skip = canStripTypes ? false : `需要 Node ≥ 22.18 的 type stripping 才能 import index.ts（当前 ${process.versions.node}）`;

const EXTENSION_PATH = path.resolve(import.meta.dirname, "../extensions/sdd-loop/index.ts");

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function doc(status) {
  return `---\ndocument: stage\nstatus: ${status}\n---\n\n# 内容\n`;
}

function statusFile() {
  return `---\nproject: t\ndocument: loop-status\nactiveLoop: null\nlastClosedLoop: 0\nnextLoop: 1\nnextPhase: requirements\n---\n\n# Loop 状态\n`;
}

/** 干净仓库：loop-0 全归档。build 回调用来造矛盾/污染。 */
function makeRepo(build) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-ext-"));
  write(root, "docs/loops/status.md", statusFile());
  write(root, "docs/archive/loop-0-x/requirements.md", doc("archived"));
  write(root, "docs/archive/loop-0-x/specification.md", doc("archived"));
  if (build) build(root);
  return root;
}

async function loadExtension() {
  const tools = new Map();
  const commands = new Map();
  const sent = [];
  const pi = {
    registerTool(def) { tools.set(def.name, def); },
    registerCommand(name, def) { commands.set(name, def); },
    sendUserMessage(text) { sent.push(text); },
    exec() { return Promise.resolve(); },
  };
  const mod = await import("../extensions/sdd-loop/index.ts");
  mod.default(pi);
  return { tools, commands, sent };
}

const toolText = (result) => result.content.map((c) => c.text).join("\n");

// ---------------------------------------------------------------- 表面形状

test("扩展面：恰好两个工具 + /sdd 命令（12 工具 → 2 工具）", { skip }, async () => {
  const { tools, commands } = await loadExtension();
  assert.deepEqual([...tools.keys()].sort(), ["sdd_loop_check", "sdd_spec_guide"]);
  assert.ok(commands.has("sdd"), "/sdd 命令没注册");
});

// ---------------------------------------------------------------- sdd_loop_check

test("sdd_loop_check：干净仓库 → 结论干净，details 带报告数据", { skip }, async () => {
  const { tools } = await loadExtension();
  const root = makeRepo();
  const result = await tools.get("sdd_loop_check").execute("t", { repo: root }, null, null, { cwd: root });
  const text = toolText(result);
  assert.ok(text.includes("干净"), text);
  assert.equal(result.details.report.ok, true);
  assert.equal(result.details.report.readable, true);
});

test("sdd_loop_check：声明与事实矛盾 → 逐条列出，判定与 CLI 同源", { skip }, async () => {
  const { tools } = await loadExtension();
  const root = makeRepo((r) => write(r, "docs/archive/loop-0-x/tasks.md", doc("confirmed")));
  const result = await tools.get("sdd_loop_check").execute("t", { repo: root }, null, null, { cwd: root });
  const text = toolText(result);
  assert.equal(result.details.report.ok, false);
  assert.ok(text.includes("tasks.md"), "矛盾要逐条点名");
  assert.ok(text.includes("archived"), "期望状态要写出来");
});

test("sdd_loop_check：front-matter 有冲突标记 → 判据读不出来，不给结论", { skip }, async () => {
  const { tools } = await loadExtension();
  const root = makeRepo((r) => {
    write(r, "docs/loops/status.md", "---\nproject: t\n<<<<<<< HEAD\nactiveLoop: 1\n=======\nactiveLoop: null\n>>>>>>> other\n---\n\n# x\n");
  });
  const result = await tools.get("sdd_loop_check").execute("t", { repo: root }, null, null, { cwd: root });
  const text = toolText(result);
  assert.equal(result.details.report.readable, false);
  assert.ok(text.includes("判据读不出来") || text.includes("读不出来"), "不可读要明说");
  assert.ok(!text.includes("干净"), "读不出来时不许给「干净」结论");
});

// 这条锁的是一次真实事故：渲染无条件说「被污染…先请人解决文件本身」，
// 于是空仓库的用户被要求去「解决」一个不存在的文件，模型照做并停工。
// 冷启动是正常起点，文案必须把它和「文件坏了」分开，否则 agent 只会照着停。
test("sdd_loop_check：空仓库 → 说冷启动并指出由 agent 去建，不许说「先请人解决文件本身」", { skip }, async () => {
  const { tools } = await loadExtension();
  const root = makeRepo(() => {});
  fs.rmSync(path.join(root, "docs"), { recursive: true, force: true });
  const result = await tools.get("sdd_loop_check").execute("t", { repo: root }, null, null, { cwd: root });
  const text = toolText(result);
  assert.equal(result.details.report.reason, "missing-status");
  assert.ok(text.includes("还没有 SDD Loop 结构"), "要说清这是没结构，不是文件坏了");
  assert.ok(!text.includes("先请人解决文件本身"), "冷启动甩这句话＝让用户去修一个不存在的文件");
  assert.ok(text.includes("由你落地"), "要点名由 agent 落地——工具只读，等它建等不到");
  assert.ok(text.includes("sdd-init"), "要指向初始化 skill，否则 agent 得自己发明一份 AGENTS.md");
});

// ---------------------------------------------------------------- sdd_spec_guide

test("sdd_spec_guide：已知类型 → 口径 + 编号族 + 参考写法", { skip }, async () => {
  const { tools } = await loadExtension();
  const root = makeRepo((r) => write(r, "docs/archive/loop-0-x/specification.md", `${doc("archived")}\n### BND-001 边界\n`));
  const result = await tools.get("sdd_spec_guide").execute("t", { type: "specification.behavior", repo: root }, null, null, { cwd: root });
  const text = toolText(result);
  assert.ok(text.includes("适用边界"), "口径没出来");
  assert.ok(text.includes("BND-*"), "编号族没出来");
  assert.equal(result.details.entry.doc, "specification");
  assert.ok(result.details.idScan.families.length >= 1);
});

test("sdd_spec_guide：未知类型 → 抛出带可用类型清单的错误，不猜", { skip }, async () => {
  const { tools } = await loadExtension();
  await assert.rejects(
    () => tools.get("sdd_spec_guide").execute("t", { type: "specification.nope" }, null, null, { cwd: "/tmp" }),
    (error) => {
      assert.ok(error.message.includes("specification.behavior"), "错误里要列出可用类型");
      return true;
    },
  );
});

test("sdd_spec_guide：不带 type → 返回全部类型清单", { skip }, async () => {
  const { tools } = await loadExtension();
  const result = await tools.get("sdd_spec_guide").execute("t", {}, null, null, { cwd: "/tmp" });
  const text = toolText(result);
  assert.ok(text.includes("specification.behavior"));
  assert.ok(text.includes("requirements.goal"));
});

// ---------------------------------------------------------------- /sdd

test("/sdd：加载访谈 skill——发出的人话里必须点到 sdd-interview", { skip }, async () => {
  const { commands, sent } = await loadExtension();
  await commands.get("sdd").handler("", { cwd: "/tmp", ui: { notify() {} } });
  assert.equal(sent.length, 1, "/sdd 应发一条引导消息");
  assert.ok(sent[0].includes("sdd-interview"), "引导消息没点到访谈 skill");
  assert.ok(!sent[0].includes("sdd-init"), "不带参数的 /sdd 不该去加载初始化 skill");
});

// 两条路径产出的东西性质不同（init 建约定 / 访谈产内容），分叉丢了就会变成
// 「一个命令兼职两件事」——冷启动时访谈 skill 被要求去建 AGENTS.md，越界且没有模板可用。
test("/sdd init：走初始化 skill，不是访谈", { skip }, async () => {
  const { commands, sent } = await loadExtension();
  await commands.get("sdd").handler("init", { cwd: "/tmp", ui: { notify() {} } });
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes("sdd-init"), "/sdd init 没点到初始化 skill");
  assert.ok(!sent[0].includes("sdd-interview"), "/sdd init 不该顺手启动访谈——它只建结构");
  assert.ok(sent[0].includes("AGENTS.md"), "初始化引导没点名 AGENTS.md（门禁规则，承重墙）");
});

// 访谈那条路自己也得认得冷启动：否则模型读完 check 的「还没有结构」会自行决定怎么办。
test("/sdd：引导消息交代冷启动该转去 init，不许自己开始访谈", { skip }, async () => {
  const { commands, sent } = await loadExtension();
  await commands.get("sdd").handler("", { cwd: "/tmp", ui: { notify() {} } });
  assert.ok(sent[0].includes("/sdd init"), "没告诉模型冷启动时把用户指向 /sdd init");
});

// ---------------------------------------------------------------- 判定只有一份（源码锁）

test("判定只有一份：扩展 import 判定与口径，不许自己再长一份", () => {
  const src = readFileSync(EXTENSION_PATH, "utf8");
  assert.ok(src.includes('from "../../src/validation/loop-check.js"'), "check 判定必须来自 loop-check.js");
  assert.ok(src.includes('from "../../src/spec-guide/dictionary.js"'), "口径必须来自 dictionary.js");
  assert.ok(src.includes('from "../../src/spec-guide/id-scan.js"'), "编号族必须来自 id-scan.js");
  assert.ok(src.includes('from "../../src/spec-guide/example.js"'), "参考写法选取策略与 CLI 共享（example.js），不复制");
  // 反向：front-matter 解析不许用旧的那份（静默跳过冲突标记的那一份）。
  // 锁 import 来源而不是字符串出现——注释里解释「为什么不用它」是合法且必要的。
  assert.ok(!/from\s+["'][^"']*spec-file/.test(src), "不许 import src/render/spec-file.js——它的解析器会静默吞冲突标记");
});
