/**
 * README 的锁（两份：README.md 英文、README_zh.md 简体中文）。
 *
 * README 是给使用者看的唯一入口，它会引用几类容易漂的数字与名字：
 * 站数、命令名、安装宿主。手抄的数字漂过不止一次——首页写一个数、大纲写另一个，
 * 两边都言之凿凿。所以这里一律从真相源（SKILL.md、CLI 的子命令表、
 * 安装计划里的宿主表）推导，不做字面比对：字面比对只能锁住
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

import { DEFAULT_CONVENTION } from "../src/loop/convention.js";
import { AGENTS_HOSTS, HOST_IDS } from "../src/install/plan.js";

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

test("README 提供 guide 入口，但不复制会漂的完整条款字典", () => {
  for (const { file, text } of READMES) {
    assert.ok(text.includes("sdd-loop guide"), `${file} 没提供 guide 入口`);
    assert.ok(
      text.includes("sdd-loop guide --type specification.entity-table"),
      `${file} 没提供按类型查询的示例`,
    );
  }
});

test("README 的宿主表 ≡ 安装计划支持的宿主——加了宿主漏改一份译本，用户就以为不支持", () => {
  for (const { file, text } of READMES) {
    assert.ok(text.includes("Claude Code"), `${file} 没提 Claude Code`);
    assert.ok(text.includes("OpenClaw"), `${file} 没提 OpenClaw`);
    assert.ok(text.includes("Hermes Agent"), `${file} 没提 Hermes Agent`);
    assert.ok(text.includes("| pi |"), `${file} 没提 pi`);
    for (const host of AGENTS_HOSTS) {
      assert.ok(text.includes(host.label), `${file} 的宿主表漏了 ${host.label}`);
    }
  }
});

test("README 提到的阶段文档名都在 convention.stageDocs 里", () => {
  const allowed = new Set([
    ...DEFAULT_CONVENTION.stageDocs,
    "status", "agents", "candidate", "claude", "readme", "overview", "stream", "opt-in",
  ]);
  for (const { file, text } of READMES) {
    for (const [, name] of text.matchAll(/\b([a-z][a-z-]*)\.md\b/g)) {
      assert.ok(
        allowed.has(name),
        `${file} 提到 ${name}.md，它既不是阶段文档（${DEFAULT_CONVENTION.stageDocs.join("/")}）也不在白名单里`,
      );
    }
  }
});

test("双语 README 用图表说明治理停点和四项工程扩展", () => {
  for (const { file, text } of READMES) {
    assert.ok(text.includes("awaiting_continue"), `${file} 没画出审批后的停止状态`);
    assert.ok(text.includes("audit/*.jsonl"), `${file} 没说明分片审计落点`);
    for (const extension of ["Testing", "PBT", "Security", "Resiliency"]) {
      assert.ok(text.includes(extension), `${file} 漏了 ${extension}`);
    }
    assert.ok(text.includes("seed"), `${file} 没说明无 PBT 库时的确定性证据`);
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

test("README 写清四个工作流命令及对应 Skill", () => {
  const routes = [
    ["/sdd init", "sdd-init"],
    ["/sdd", "sdd-interview"],
    ["/sdd upgrade", "sdd-upgrade"],
    ["/sdd review", "sdd-review"],
  ];
  for (const { file, text } of READMES) {
    for (const [route, skill] of routes) {
      assert.ok(text.includes(`\`${route}\``), `${file} 漏了 ${route}`);
      assert.ok(text.includes(`\`${skill}\``), `${file} 漏了 ${skill}`);
    }
    for (const doc of DEFAULT_CONVENTION.stageDocs.slice(0, 4)) {
      assert.ok(text.includes(`\`${doc}.md\``), `${file} 没写访谈产出的 ${doc}.md`);
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

test("README 同时提供完整安装、Skills-only 安装和对应更新方式", () => {
  for (const { file, text } of READMES) {
    for (const command of [
      "npm install",
      "npm link",
      "sdd-loop init -g",
      "npx skills@latest add Roger0808/sdd-loop -g",
      "git pull --ff-only",
      "npx skills@latest update -g",
    ]) {
      assert.ok(text.includes(command), `${file} 漏了 ${command}`);
    }
    assert.ok(text.includes("sdd-upgrade"), `${file} 没说明项目规则升级与安装包更新的区别`);
  }
});

test("README 承诺的本地文件都存在（安装步骤与链接不许断）", () => {
  for (const { file, text } of READMES) {
    for (const [, p] of text.matchAll(/\]\((?!https?:)([^)]+)\)/g)) {
      const clean = p.split("#")[0];
      if (!clean) continue;
      assert.ok(fs.existsSync(path.join(REPO_ROOT, clean)), `${file} 链接到 ${clean}，但文件不存在`);
    }
    // 安装步骤软链的每个 skill 目录必须真的在包里。
    for (const d of ["skills/sdd-init", "skills/sdd-interview", "skills/sdd-upgrade", "skills/sdd-review"]) {
      assert.ok(
        text.includes(d) && fs.existsSync(path.join(REPO_ROOT, d)),
        `${file} 的安装步骤引用了 ${d}，它必须真实存在`,
      );
    }
  }
});

test("双语 README 同步覆盖核心生命周期、安装路由与 AGENTS 分类", () => {
  const sharedClaims = [
    "sdd-review",
    "Worktree Ready",
    "Architecture Baseline",
    "Architecture Reconciliation",
    "AI Review",
    "Human Review",
    "READY_FOR_HUMAN_REVIEW",
    "--hermes",
    "--openclaw",
    "/sdd upgrade",
    "/sdd review",
    "KEEP_SDD_CANONICAL",
    "NOT_TESTABLE_SAFELY",
    "OPENCLAW_STATE_DIR",
  ];
  for (const claim of sharedClaims) {
    for (const { file, text } of READMES) assert.ok(text.includes(claim), `${file} 漏了 ${claim}`);
  }
});

test("Worktree、架构对账和审查流程位于安装说明之前", () => {
  for (const { file, lang, text } of READMES) {
    const install = text.indexOf(lang === "zh" ? "## 安装" : "## Installation");
    assert.ok(install > 0, `${file} 没有安装章节`);
    for (const claim of ["Worktree Ready", "Architecture Reconciliation", "AI Review", "Human Review"]) {
      const index = text.indexOf(claim);
      assert.ok(index >= 0 && index < install, `${file} 的 ${claim} 没有在安装前讲清楚`);
    }
    for (const evidence of [
      "stream + Loop",
      "implementation.md",
      "verification.md",
      "READY_FOR_HUMAN_REVIEW",
      "CHANGES_REQUIRED",
      "NOT_REVIEWABLE_SAFELY",
    ]) {
      assert.ok(text.includes(evidence), `${file} 漏了 ${evidence}`);
    }
  }
});

test("README 的宿主徽章数量由安装计划推导", () => {
  const total = AGENTS_HOSTS.length + 3; // Claude Code + Hermes Agent + pi
  assert.match(READMES[0].text, new RegExp(`hosts-${total}(?:-|%20)`));
  assert.match(READMES[1].text, new RegExp(`宿主-${total}%20个`));
});

test("README 的安装限定标志覆盖每个安装落点", () => {
  for (const { file, text } of READMES) {
    for (const id of HOST_IDS) assert.ok(text.includes(`--${id}`), `${file} 漏了 --${id}`);
  }
});
