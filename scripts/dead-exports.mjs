#!/usr/bin/env node
// 导出级可达性扫描器。用法：node scripts/dead-exports.mjs（零依赖）。
//
// src/ 的可达性有两条判据，这个脚本是第二条：
//
// 判据一（模块级，人工跑）：从两个活入口出发，沿静态相对 import 递归展开，扫全 src/。
//   入口只有 scripts/sdd-loop.mjs 和 extensions/sdd-loop/index.ts。
//   盲区是动态 import() 拼路径和裸模块名——删任何模块前补一次
//   `grep -rn "<文件名>" src/ scripts/ extensions/` 兜底。
//
// 判据二（导出级，本脚本）：src/ 的具名导出，若在 src/+scripts/+extensions/ 的
//   **去注释**源码里零引用，即为死导出。
//
// 两条判据都有一条共同前提：**tests/ 不算存活理由**。死代码有测试仍是死代码；
// 删模块时它的测试随功能一起退役。
//
// 为什么必须先剥注释：裸词计数对定义所在文件只减 1 次，于是任何导出只要在自己
// 头注里被提过一次，就凑够「定义 1 + 注释 1 − 1 = 1」判活。实测这样藏住过好几个
// 真死导出。教训是「删除前人工 grep 剔注释」只是复核动作，要等已经起疑才会触发，
// 本身不产生发现力——判据要进扫描器，否则别假装它是判据。
//
// 剥注释的坑：字符串里的 "http://..." 不许被剥——行注释只认「// 前面不是冒号」。
// import 声明里的名字仍计为引用（保守方向：宁可漏报，不把「import 了没调用」报死——
// 那是 unused-import 层的粒度，不是本判据的）。
//
// 当前基线：TOTAL: 12  DEAD: 0。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

function walk(dir, pattern, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pattern, out);
    else if (pattern.test(e.name)) out.push(p);
  }
  return out;
}

const srcFiles = walk(path.join(repoRoot, "src"), /\.(js|mjs)$/);
const exp = new Map();
for (const f of srcFiles) {
  const s = strip(fs.readFileSync(f, "utf8"));
  for (const m of s.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)) exp.set(m[1], path.relative(repoRoot, f));
  for (const m of s.matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g)) exp.set(m[1], path.relative(repoRoot, f));
}

const prod = ["src", "scripts", "extensions"].flatMap((d) => walk(path.join(repoRoot, d), /\.(js|mjs|ts)$/));
const blob = prod.map((f) => ({ f: path.relative(repoRoot, f), s: strip(fs.readFileSync(f, "utf8")) }));

let dead = 0;
for (const [name, def] of exp) {
  let uses = 0;
  for (const { f, s } of blob) {
    const c = (s.match(new RegExp("\\b" + name + "\\b", "g")) || []).length;
    uses += Math.max(0, f === def ? c - 1 : c);
  }
  if (uses === 0) { dead++; console.log(`${name}  (${def})`); }
}
console.log(`TOTAL: ${exp.size}  DEAD: ${dead}`);
