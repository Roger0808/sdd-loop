/**
 * README 的锁。
 *
 * README 是给使用者看的唯一入口，它抄了三类会漂的数字与名字：
 * 站数、条款类型、命令名。手抄的数字漂过不止一次——首页写一个数、大纲写另一个，
 * 两边都言之凿凿。所以这里一律从真相源（SKILL.md、guide 的实际输出、CLI 的
 * 子命令表）推导，不做字面比对：字面比对只能锁住「两处一致」，锁不住「都错了」。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { DEFAULT_CONVENTION } from "../src/loop/convention.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const README = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
const SKILL = fs.readFileSync(
  path.join(REPO_ROOT, "skills/sdd-interview/SKILL.md"),
  "utf8",
);

const CN_NUMERAL = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

test("README 声明的站数 ≡ SKILL.md 里实际的提问站数", () => {
  const stations = [...SKILL.matchAll(/^### 第 (\d+) 站/gm)].map((m) => Number(m[1]));
  assert.ok(stations.length > 0, "SKILL.md 一个提问站都没有，这条锁就空了");
  const declared = CN_NUMERAL[stations.length];
  const claims = [...README.matchAll(/(?<![这那每本同上下前后另某全])([零一二三四五六七八九十])站/g)]
    .map((m) => m[1]);
  assert.ok(claims.length > 0, "README 没有声明站数，读者只能自己数");
  for (const claim of claims) {
    assert.equal(
      claim,
      declared,
      `README 写「${claim}站」，但 SKILL.md 实际有 ${stations.length} 个提问站`,
    );
  }
});

test("README 的七站表 ≡ SKILL.md 的站标题（顺序与名字都不许漂）", () => {
  const skillTitles = [...SKILL.matchAll(/^### 第 (\d+) 站：(.+)$/gm)].map((m) => m[2].trim());
  // README 用 `**0 · 需求起点与公司背景**` 的写法列在表格里。
  const readmeTitles = [...README.matchAll(/\*\*(\d+) · ([^*]+)\*\*/g)].map((m) => m[2].trim());
  assert.deepEqual(
    readmeTitles,
    skillTitles,
    "README 的站名与 SKILL.md 对不上——两处各说各话，用户按 README 走会找不到对应的站",
  );
});

test("README 声明的条款类型数与清单 ≡ guide 实际支持的", () => {
  const out = execFileSync("node", ["scripts/sdd-loop.mjs", "guide"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const real = [...out.matchAll(/^ {4}([a-z]+\.[a-z-]+)/gm)].map((m) => m[1]);
  assert.ok(real.length > 0, "guide 一个类型都没列出来，这条锁就空了");

  const declared = README.match(/全部 (\d+) 种条款类型/);
  assert.ok(declared, "README 没有声明条款类型总数");
  assert.equal(
    Number(declared[1]),
    real.length,
    `README 写「${declared[1]} 种」，guide 实际支持 ${real.length} 种`,
  );

  // 短名逐个在场：README 按文档分组只写短名（`entity-table` 实体与字段表）。
  for (const full of real) {
    const short = full.split(".")[1];
    assert.ok(
      README.includes(`\`${short}\``),
      `README 的类型清单漏了 ${full}——用户查不到这一类的口径`,
    );
  }
});

test("README 提到的阶段文档名都在 convention.stageDocs 里", () => {
  const mentioned = new Set(
    [...README.matchAll(/\b([a-z][a-z-]*)\.md\b/g)].map((m) => m[1]),
  );
  const allowed = new Set([
    ...DEFAULT_CONVENTION.stageDocs,
    "status", "agents", "claude", "readme",
  ]);
  for (const name of mentioned) {
    assert.ok(
      allowed.has(name),
      `README 提到 ${name}.md，它既不是阶段文档（${DEFAULT_CONVENTION.stageDocs.join("/")}）也不在白名单里`,
    );
  }
});

test("README 里的 sdd-loop 命令都是真实子命令", () => {
  // 反引号可有可无：README 的命令主要出现在 ```bash 代码块里，那里没有反引号。
  // 变异测试实测过：只匹配行内代码时，往代码块里塞一个不存在的子命令抓不到。
  // 首字符必须是字母，`--type` 之类的选项才不会被当成子命令。
  const cmds = new Set(
    [...README.matchAll(/\bsdd-loop ([a-z][a-z-]*)/g)].map((m) => m[1]),
  );
  assert.ok(cmds.size > 0, "README 一条 sdd-loop 命令都不给，这条锁就空了");
  for (const c of cmds) {
    assert.ok(
      ["check", "guide"].includes(c),
      `README 写了 \`sdd-loop ${c}\`，但 CLI 只有 check / guide 两个子命令`,
    );
  }
});

test("README 承诺的本地文件都存在（安装步骤与链接不许断）", () => {
  for (const p of [...README.matchAll(/\]\((?!https?:)([^)]+)\)/g)].map((m) => m[1])) {
    const clean = p.split("#")[0];
    if (!clean) continue;
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, clean)),
      `README 链接到 ${clean}，但文件不存在`,
    );
  }
  // 安装步骤软链的两个 skill 目录必须真的在包里。
  for (const d of ["skills/sdd-init", "skills/sdd-interview"]) {
    assert.ok(
      README.includes(d) && fs.existsSync(path.join(REPO_ROOT, d)),
      `README 的安装步骤引用了 ${d}，它必须真实存在`,
    );
  }
});
