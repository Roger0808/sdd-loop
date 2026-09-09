#!/usr/bin/env node
/**
 * sdd-loop — SDD Loop 的两件仪器的 CLI 表面：状态对账（check）+ 口径字典（guide）。
 *
 * 判定不在这里：check 的结论一律来自 src/validation/loop-check.js，
 * guide 的口径一律来自 src/spec-guide/dictionary.js、编号族一律来自
 * src/spec-guide/id-scan.js。本文件只负责文案与退出码——判定只有一份，
 * 字典是数据、渲染在表面，任何表面都不许自己再判/再编一次。
 *
 * 退出码沿用 D40 的契约：0 干净（或查询成功）/ 1 声明与事实矛盾 / 2 判据读不出来（或用法无效）。
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRepoCheckReport } from "../src/validation/loop-check.js";
import { runInit } from "./lib/init.mjs";
import { guideFor, listGuideTypes } from "../src/spec-guide/dictionary.js";
import { scanIdFamilies } from "../src/spec-guide/id-scan.js";
import { pickExample } from "../src/spec-guide/example.js";
import { AGENTS_HOSTS } from "../src/install/plan.js";
import { EXIT_OK, EXIT_CONTENT, EXIT_UNUSABLE } from "./lib/exit-codes.mjs";

// 共享落点服务谁，从判定源里生成——手抄一份就等着「加了宿主帮助里没有」。
const AGENTS_SERVED = AGENTS_HOSTS.map((h) => h.label).join(" / ");

const HELP = `sdd-loop — SDD Loop 的两件仪器

用法：
  sdd-loop check [--repo <dir>] [--stream <name>] [--status-file <path>] [--archive-dir <path>] [--json]
  sdd-loop guide [--type <doc.clause>] [--repo <dir>] [--docs-dir <path>] [--json]
  sdd-loop init -g [--claude] [--agents] [--openclaw] [--hermes] [--pi] [--show]

init -g：把本包装进这台机器的 agent 宿主。五个落点：
    --claude   ~/.claude/skills/   Claude Code（它不读共享目录）
    --agents   ~/.agents/skills/   走 Agent Skills 开放标准的宿主共用这一份
                                   ${AGENTS_SERVED}
    --openclaw OpenClaw；默认复用 ~/.agents/skills/，自定义 state 用 <state>/skills/
    --hermes   登记 ~/.agents/skills/ 到 Hermes skills.external_dirs
               默认配置 ${"${HERMES_HOME:-~/.hermes}"}/config.yaml
    --pi       pi 登记本包
  这是装**工具**，不是初始化仓库——初始化仓库是 sdd-init skill 的活。
  不带落点标志时装进所有检测到的落点；没检测到的跳过并说明。
  --show          只看要做什么，不动手
  绝不删任何已存在的文件或目录：位置被占着就报出来交给你。

check：把状态文件的「声明」和文件里的「事实」摆在一起比。只读，不改任何东西。
  --repo          仓库根，默认当前目录
  --status-file   状态文件相对仓库根的路径，默认 docs/loops/status.md
  --archive-dir   归档根目录，默认 docs/archive
  --stream        只判这一条流，退出码也只反映它
  分流是发现出来的，不用配置：状态文件在根上就是单流；不在、而下一层的子目录里有，
  那些子目录就是各自独立的流（各有 activeLoop、各有门禁、归档各自一个子目录）。
  多流时逐流报结论——一条流读不出来，其余各流的结论照给。

guide：写之前给要求。「我要写这一类东西，该写哪几项」+ 本仓库现有编号族 + 参考写法。
  不带 --type 时列出全部可用类型。只在写之前给要求，不做事后判定。
  --type          条款类型，例 specification.behavior
  --repo          仓库根，默认当前目录
  --docs-dir      编号族扫描目录，默认 docs

退出码：
  0  干净 / 查询成功
  1  声明与事实矛盾（check）
  2  判据读不出来（此时不给任何结论）/ 类型未知（guide）
`;

// 布尔标志：不吃后面那个 token。少一个登记，`--show <子命令>` 就会把子命令
// 当成 --show 的值吞掉，而且不报错——所以新加无值标志必须同时加进这里。
const BOOLEAN_FLAGS = new Set(["json", "help", "global", "show", "claude", "agents", "openclaw", "hermes", "pi"]);
const SHORT_FLAGS = { "-h": "help", "-g": "global" };

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (SHORT_FLAGS[token]) args[SHORT_FLAGS[token]] = true;
    else if (token.startsWith("--") && BOOLEAN_FLAGS.has(token.slice(2))) args[token.slice(2)] = true;
    else if (token.startsWith("--")) args[token.slice(2)] = argv[++i];
    else args._.push(token);
  }
  return args;
}

const STATUS_MARK = { true: "✅", false: "❌" };

/**
 * 一条流的正文（不含「仓库 / 状态文件」那两行抬头）。
 * 拆出来是为了分流模式能把同一份文案按流分节复用——**单流的输出因此一个字都没变**。
 */
function renderReportBody(report) {
  const lines = [];

  if (!report.readable) {
    const coldStart = report.reason === "missing-status";
    lines.push(
      coldStart
        ? "结论：这个仓库还没有 SDD Loop 结构，没有状态可对账。"
        : "结论：判据读不出来，不给状态结论。",
    );
    lines.push("");
    for (const problem of report.problems) {
      const where = problem.line ? `${problem.file}:${problem.line}` : problem.file;
      lines.push(`  ✖ ${where}`);
      lines.push(`    ${problem.detail}`);
      if (problem.text) lines.push(`    > ${problem.text}`);
    }
    lines.push("");
    lines.push(
      coldStart
        ? `起步：在支持本包的 agent 里跑 /sdd init（或加载 sdd-init skill），由它落地 AGENTS.md（门禁规则，本工具执行的就是它）、CLAUDE.md 与 ${report.statusPath}。状态文件在别处就用 --status-file 指过去。本工具只读，不替你建。`
        : "处理：front-matter 是门禁判据，被污染时一切结论都建立在猜上。先解决文件本身，再重跑。",
    );
    return lines.join("\n");
  }

  lines.push(report.ok ? "结论：干净。" : `结论：有 ${report.problems.length} 处声明与事实不符。`);
  lines.push("");

  for (const entry of report.checks) {
    if (entry.id === "C4") continue;
    lines.push(`${entry.id} ${STATUS_MARK[entry.ok]} ${entry.title}`);
    for (const finding of entry.findings) lines.push(`     ${finding.detail}`);
  }

  lines.push("");
  const next = report.nextStep;
  if (next?.kind === "start-new") {
    const target = next.loop ? `Loop ${next.loop} / ${next.phase || "requirements"}` : "由用户明确新目标后开启";
    lines.push(`下一步：${target}`);
  } else if (next?.kind === "continue") {
    const stages = next.stages.map((s) => `${s.name}=${s.status || "(空)"}`).join("  ");
    lines.push(`下一步：继续 Loop ${next.loop}（${next.dir}）`);
    if (stages) lines.push(`        阶段状态：${stages}`);
    if (next.blockedAt) lines.push(`        当前门禁：${next.blockedAt}`);
  }

  if (report.advisories.length) {
    lines.push("");
    lines.push("提醒（不影响结论）：");
    for (const item of report.advisories) lines.push(`  ⓘ ${item.detail}`);
  }

  if (!report.ok) {
    lines.push("");
    lines.push("规则要求：状态文件、活跃目录与阶段文档矛盾时，应停止相关工作并请求用户确认。");
  }
  return lines.join("\n");
}

function renderText(report) {
  return [`仓库 ${report.repoRoot}`, `状态文件 ${report.statusPath}`, "", renderReportBody(report)].join("\n");
}

/** 分流模式：每条流一个小节，各渲染各的结论；最后汇总，不改任何一条流的结论。 */
function renderRepoText(repo) {
  const lines = [];
  lines.push(`仓库 ${repo.repoRoot}`);
  // 指名了 --stream 时抬头必须说清「只判了这一条」。写成「分流：1 条」是句假话：
  // 仓库里可能有七条，这一趟只判了一条——而抬头正是读者用来判断「有没有漏看」的那一行。
  const names = repo.streams.map((s) => s.name).join(" / ");
  lines.push(repo.requestedStream ? `只判一条流：${names}（--stream）` : `分流：${repo.streams.length} 条（${names}）`);
  lines.push("");

  for (const { name, report } of repo.streams) {
    lines.push(`── 流 ${name} ──`);
    lines.push(`状态文件 ${report.statusPath}`);
    lines.push("");
    lines.push(renderReportBody(report));
    lines.push("");
  }

  const parts = [];
  if (repo.unreadableStreams.length) {
    parts.push(`${repo.unreadableStreams.join(" / ")} 的判据读不出来（这几条不给结论）`);
  }
  if (repo.problemCount) {
    const scope = repo.unreadableStreams.length ? "其余各流" : "各流";
    parts.push(`${scope}共 ${repo.problemCount} 处声明与事实不符`);
  }
  lines.push(parts.length ? `总结论：${parts.join("；")}。` : "总结论：各流都干净。");
  return lines.join("\n");
}

// ---------------------------------------------------------------- guide

const FORM_LABEL = { "two-part": "两段式", "three-part": "三段式", "wildcard-only": "仅通配引用" };
const FORM_ORDER = ["two-part", "three-part", "wildcard-only"];

function renderGuideText({ type, entry, idScan, example }) {
  const lines = [];
  lines.push(`${type} ｜ ${entry.title} ｜ 落点 ${entry.doc}.md`);
  lines.push("");
  lines.push(entry.summary);
  for (const line of entry.lines) lines.push(`  · ${line}`);
  lines.push("");

  const withIds = FORM_ORDER
    .map((form) => ({ form, families: idScan.families.filter((f) => f.form === form) }))
    .filter((group) => group.families.length);

  if (!withIds.length) {
    lines.push(`本仓库还没有编号族（扫描 ${idScan.docsDir}/ 无命中）。`);
    lines.push("  第一条编号自定前缀：两段式 BND-001 或三段式 DEL-DIR-001；定下之后沿用，不要另起体系。");
    return lines.join("\n");
  }

  lines.push(`本仓库现有编号族（扫描 ${idScan.docsDir}/ 得到）：`);
  for (const group of withIds) {
    const prefixes = group.families.map((f) => `${f.prefix}-*`).join(" ");
    lines.push(`  ${FORM_LABEL[group.form]}  ${prefixes}`);
  }
  lines.push("  新增条款沿用同族前缀，不要另起体系。");

  if (example) {
    lines.push("");
    lines.push(`参考写法：${example.file}:${example.line}  ${example.text}`);
  }
  return lines.join("\n");
}

function renderGuideList() {
  const lines = ["可用类型（--type 取其一）：", ""];
  let lastDoc = null;
  for (const type of listGuideTypes()) {
    const entry = guideFor(type);
    if (entry.doc !== lastDoc) {
      lines.push(`  ${entry.doc}.md`);
      lastDoc = entry.doc;
    }
    lines.push(`    ${type.padEnd(36)}${entry.title}`);
  }
  return lines.join("\n");
}

function runGuide(args) {
  const type = args.type;
  if (!type) {
    process.stdout.write(`${renderGuideList()}\n`);
    process.exit(EXIT_OK);
  }
  const entry = guideFor(type);
  if (!entry) {
    process.stderr.write(`未知类型：${type}\n\n${renderGuideList()}\n`);
    process.exit(EXIT_UNUSABLE);
  }

  const repoRoot = path.resolve(args.repo || process.cwd());
  const scanOptions = {};
  if (args["docs-dir"]) scanOptions.docsDir = args["docs-dir"];
  const idScan = scanIdFamilies(repoRoot, scanOptions);
  const example = pickExample(entry, idScan.families);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ type, entry, idScan, example }, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderGuideText({ type, entry, idScan, example })}\n`);
  }
  process.exit(EXIT_OK);
}

// ---------------------------------------------------------------- check

function runCheck(args) {
  const repoRoot = path.resolve(args.repo || process.cwd());
  const overrides = {};
  if (args["status-file"]) overrides.statusFile = args["status-file"];
  if (args["archive-dir"]) overrides.archiveDir = args["archive-dir"];

  const repo = buildRepoCheckReport(repoRoot, overrides, { stream: args.stream });

  if (repo.unknownStream) {
    const available = repo.availableStreams.length
      ? `本仓库的流：${repo.availableStreams.join(" / ")}`
      : "本仓库不是分流形态——没有发现任何流，--stream 无从谈起。";
    process.stderr.write(`没有名为 ${repo.unknownStream} 的流。${available}\n`);
    process.exit(EXIT_UNUSABLE);
  }

  // 单流原路返回：报告对象、文案、JSON 形状与分流引入之前**逐字相同**。
  // 这个包是全局安装的，已经在跑的单流仓库不该因为别人要分流而输出变样。
  if (repo.mode === "single") {
    const report = repo.streams[0].report;
    if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else process.stdout.write(`${renderText(report)}\n`);
    if (!report.readable) process.exit(EXIT_UNUSABLE);
    process.exit(report.ok ? EXIT_OK : EXIT_CONTENT);
  }

  if (args.json) process.stdout.write(`${JSON.stringify(repo, null, 2)}\n`);
  else process.stdout.write(`${renderRepoText(repo)}\n`);

  if (repo.severity === "unusable") process.exit(EXIT_UNUSABLE);
  process.exit(repo.ok ? EXIT_OK : EXIT_CONTENT);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (args.help || !command) {
    process.stdout.write(HELP);
    process.exit(command ? EXIT_OK : EXIT_UNUSABLE);
  }
  if (command === "check") return runCheck(args);
  if (command === "guide") return runGuide(args);
  if (command === "init") {
    return runInit(args, {
      packageRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      stdout: (s) => process.stdout.write(s),
      stderr: (s) => process.stderr.write(s),
      exit: (code) => process.exit(code),
    });
  }

  process.stderr.write(`未知命令：${command}\n\n${HELP}`);
  process.exit(EXIT_UNUSABLE);
}

main();
