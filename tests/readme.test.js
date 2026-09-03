/**
 * README 的锁（两份：README.md 英文、README_zh.md 简体中文）。
 *
 * README 是给使用者看的唯一入口，它抄了三类会漂的数字与名字：
 * 站数、条款类型、命令名。手抄的数字漂过不止一次——首页写一个数、大纲写另一个，
 * 两边都言之凿凿。所以这里一律从真相源（SKILL.md、guide 的实际输出、CLI 的
 * 子命令表、安装计划里的宿主表）推导，不做字面比对：字面比对只能锁住
 * 「两处一致」，锁不住「都错了」。
 *
 * 分了语言之后多一类漂：**一份改了另一份没改**。所以每条锁都对两份都跑一遍，
 * 只有「这个数字用什么写法表达」按语言分（中文数词 / 阿拉伯数字），
 * 数字本身仍然来自同一个真相源。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { DEFAULT_CONVENTION } from "../src/loop/convention.js";
import { AGENTS_HOSTS } from "../src/install/plan.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const SKILL = read("skills/sdd-interview/SKILL.md");

/** 两份 README 都要过全部锁。加一份译本就往这里加一行。 */
const READMES = [
  { file: "README.md", lang: "en", text: read("README.md") },
  { file: "README_zh.md", lang: "zh", text: read("README_zh.md") },
];

const CN_NUMERAL = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

const stationCount = () => {
  const stations = [...SKILL.matchAll(/^### 第 (\d+) 站/gm)];
  assert.ok(stations.length > 0, "SKILL.md 一个提问站都没有，这条锁就空了");
  return stations.length;
};

test("两份 README 都在，且互相链得到——译本掉了首页的语言切换就是死链", () => {
  for (const { file, text } of READMES) {
    for (const other of READMES) {
      assert.ok(
        text.includes(`href="${other.file}"`),
        `${file} 没有指向 ${other.file} 的语言切换链接`,
      );
    }
  }
});

test("README 声明的站数 ≡ SKILL.md 里实际的提问站数", () => {
  const n = stationCount();
  for (const { file, lang, text } of READMES) {
    // 中文写「七站」，英文写「7-station」/「7 stations」——写法按语言分，
    // 数字来自同一个真相源。
    const claims =
      lang === "zh"
        ? [...text.matchAll(/(?<![这那每本同上下前后另某全])([零一二三四五六七八九十])站/g)].map(
            (m) => CN_NUMERAL.indexOf(m[1]),
          )
        : [...text.matchAll(/(\d+)[- ]stations?\b/gi)].map((m) => Number(m[1]));

    assert.ok(claims.length > 0, `${file} 没有声明站数，读者只能自己数`);
    for (const claim of claims) {
      assert.equal(claim, n, `${file} 写了 ${claim} 站，但 SKILL.md 实际有 ${n} 个提问站`);
    }
  }
});

test("README 的站表 ≡ SKILL.md 的站（中文连标题一起锁，英文锁编号与顺序）", () => {
  const skillTitles = [...SKILL.matchAll(/^### 第 (\d+) 站：(.+)$/gm)].map((m) => ({
    no: m[1],
    title: m[2].trim(),
  }));

  for (const { file, lang, text } of READMES) {
    // README 用 `**0 · 需求起点与公司背景**` 的写法列在表格里。
    const rows = [...text.matchAll(/\*\*(\d+) · ([^*]+)\*\*/g)].map((m) => ({
      no: m[1],
      title: m[2].trim(),
    }));

    if (lang === "zh") {
      assert.deepEqual(
        rows,
        skillTitles,
        `${file} 的站名与 SKILL.md 对不上——两处各说各话，用户按 README 走会找不到对应的站`,
      );
    } else {
      // 译本的标题当然不同字，但站编号与顺序必须一样：少一站、串一站都是错的。
      assert.deepEqual(
        rows.map((r) => r.no),
        skillTitles.map((r) => r.no),
        `${file} 的站编号或顺序与 SKILL.md 对不上`,
      );
      assert.ok(
        rows.every((r) => r.title.length > 0),
        `${file} 有站没写标题`,
      );
    }
  }
});

test("README 声明的条款类型数与清单 ≡ guide 实际支持的", () => {
  const out = execFileSync("node", ["scripts/sdd-loop.mjs", "guide"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const real = [...out.matchAll(/^ {4}([a-z]+\.[a-z-]+)/gm)].map((m) => m[1]);
  assert.ok(real.length > 0, "guide 一个类型都没列出来，这条锁就空了");

  for (const { file, lang, text } of READMES) {
    const declared = lang === "zh" ? text.match(/全部 (\d+) 种条款类型/) : text.match(/All (\d+) clause types/);
    assert.ok(declared, `${file} 没有声明条款类型总数`);
    assert.equal(
      Number(declared[1]),
      real.length,
      `${file} 写「${declared[1]}」，guide 实际支持 ${real.length} 种`,
    );

    // 短名逐个在场：README 按文档分组只写短名（`entity-table`）。
    for (const full of real) {
      const short = full.split(".")[1];
      assert.ok(
        text.includes(`\`${short}\``),
        `${file} 的类型清单漏了 ${full}——用户查不到这一类的口径`,
      );
    }
  }
});

test("README 的宿主表 ≡ 安装计划支持的宿主——加了宿主漏改一份译本，用户就以为不支持", () => {
  for (const { file, text } of READMES) {
    assert.ok(text.includes("Claude Code"), `${file} 没提 Claude Code`);
    for (const host of AGENTS_HOSTS) {
      assert.ok(text.includes(host.label), `${file} 的宿主表漏了 ${host.label}`);
    }
  }
});

test("README 提到的阶段文档名都在 convention.stageDocs 里", () => {
  const allowed = new Set([...DEFAULT_CONVENTION.stageDocs, "status", "agents", "claude", "readme"]);
  for (const { file, text } of READMES) {
    for (const [, name] of text.matchAll(/\b([a-z][a-z-]*)\.md\b/g)) {
      assert.ok(
        allowed.has(name),
        `${file} 提到 ${name}.md，它既不是阶段文档（${DEFAULT_CONVENTION.stageDocs.join("/")}）也不在白名单里`,
      );
    }
  }
});

test("README 里的 sdd-loop 命令都是真实子命令", () => {
  // 真相源是 CLI 的分发处本身（`command === "…"`），不是这里手写的清单——
  // 手写清单就是下一个会漂的数字。
  const cli = read("scripts/sdd-loop.mjs");
  const real = new Set([...cli.matchAll(/command === "([a-z][a-z-]*)"/g)].map((m) => m[1]));
  assert.ok(real.size > 0, "从 CLI 里一个子命令都没解析出来，这条锁就空了");

  for (const { file, text } of READMES) {
    // 反引号可有可无：README 的命令主要出现在 ```bash 代码块里，那里没有反引号。
    // 变异测试实测过：只匹配行内代码时，往代码块里塞一个不存在的子命令抓不到。
    // 首字符必须是字母，`--type` 之类的选项才不会被当成子命令。
    const cmds = new Set([...text.matchAll(/\bsdd-loop ([a-z][a-z-]*)/g)].map((m) => m[1]));
    assert.ok(cmds.size > 0, `${file} 一条 sdd-loop 命令都不给，这条锁就空了`);
    for (const c of cmds) {
      assert.ok(real.has(c), `${file} 写了 \`sdd-loop ${c}\`，但 CLI 的子命令只有 ${[...real].join(" / ")}`);
    }
    // 反向：CLI 有的子命令，README 得提到——装不上的命令等于没有。
    for (const c of real) {
      assert.ok(cmds.has(c), `CLI 有 \`sdd-loop ${c}\`，${file} 一个字没写——用户不会知道它存在`);
    }
  }
});

test("README 的安装步骤与 help 都指向 init -g，不再教人手工 ln -s", () => {
  for (const { file, text } of READMES) {
    assert.match(text, /sdd-loop init -g/, `${file} 的安装步骤得给出 init -g`);
    assert.doesNotMatch(
      text,
      /ln -s .*skills/,
      `${file} 还在教手工软链——安装器和手工步骤并存，用户照着手工那条走就绕过了占位检查`,
    );
  }
});

test("README 承诺的本地文件都存在（安装步骤与链接不许断）", () => {
  for (const { file, text } of READMES) {
    for (const [, p] of text.matchAll(/\]\((?!https?:)([^)]+)\)/g)) {
      const clean = p.split("#")[0];
      if (!clean) continue;
      assert.ok(fs.existsSync(path.join(REPO_ROOT, clean)), `${file} 链接到 ${clean}，但文件不存在`);
    }
    // 安装步骤软链的两个 skill 目录必须真的在包里。
    for (const d of ["skills/sdd-init", "skills/sdd-interview"]) {
      assert.ok(
        text.includes(d) && fs.existsSync(path.join(REPO_ROOT, d)),
        `${file} 的安装步骤引用了 ${d}，它必须真实存在`,
      );
    }
  }
});
