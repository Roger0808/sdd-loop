/**
 * `sdd-loop init -g` 的执行与文案层。
 *
 * 判定不在这里：该做什么一律来自 src/install/plan.js。本文件只负责
 * 「照计划动手」和「把计划说成人话」——`--show` 与真跑读的是同一个计划对象，
 * 预览和实际不会各说各的。
 *
 * 动手的边界（和 check/guide 的只读不同，这是安装器）：
 * - 只写宿主的配置目录（~/.claude/skills、pi 的 settings），**不碰用户的仓库**。
 * - 只新建软链。占着位置的东西一概不动——尤其不删真实目录，那可能是用户
 *   自己写的同名 skill。冲突交给人，安装器不替人做减法。
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { planInstall, hasWork, hasConflict, noHostDetected, HOST_IDS, ITEM_STATES } from "../../src/install/plan.js";
import { EXIT_OK, EXIT_CONTENT, EXIT_UNUSABLE } from "./exit-codes.mjs";

const { ITEM_READY, ITEM_ALREADY, ITEM_OCCUPIED } = ITEM_STATES;

/** `sdd-loop` 在不在 PATH 上。不在的话 skill 装了也查不了口径。 */
export function cliOnPath(env = process.env) {
  for (const dir of (env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    try {
      fs.accessSync(path.join(dir, "sdd-loop"), fs.constants.X_OK);
      return true;
    } catch {
      /* 下一个 */
    }
  }
  return false;
}

/**
 * 照计划动手。只处理 ready 的项，其余原样返回。
 * 返回每一步的实际结果——报告照实说，不照计划说。
 */
export function applyPlan(plan, { runCommand = defaultRunCommand } = {}) {
  const results = [];
  for (const host of plan.hosts) {
    if (!host.detected) continue;

    if (host.kind === "symlink") {
      for (const item of host.items) {
        if (item.state !== ITEM_READY) continue;
        try {
          fs.mkdirSync(path.dirname(item.target), { recursive: true });
          fs.symlinkSync(item.source, item.target);
          results.push({ host: host.id, name: item.name, ok: true, action: "linked" });
        } catch (err) {
          results.push({ host: host.id, name: item.name, ok: false, action: "linked", error: err.message });
        }
      }
      continue;
    }

    if (host.installed === false) {
      try {
        runCommand(host.command);
        results.push({ host: host.id, name: "package", ok: true, action: "installed" });
      } catch (err) {
        results.push({ host: host.id, name: "package", ok: false, action: "installed", error: err.message });
      }
    }
  }
  return results;
}

function defaultRunCommand([cmd, ...args]) {
  execFileSync(cmd, args, { stdio: "inherit" });
}

// ---------------------------------------------------------------- 文案

const MARK = { [ITEM_READY]: "＋", [ITEM_ALREADY]: "✅", [ITEM_OCCUPIED]: "⚠️" };

export function renderPlan(plan, { applied = null } = {}) {
  const lines = [];
  lines.push(`本包 ${plan.packageRoot}`);
  lines.push("");

  for (const host of plan.hosts) {
    if (!host.detected) {
      lines.push(`${host.label}  — 跳过：${host.reason}`);
      lines.push("");
      continue;
    }

    if (host.kind === "symlink") {
      lines.push(`${host.label}  ${host.dir}`);
      for (const item of host.items) {
        const done = applied?.find((r) => r.host === host.id && r.name === item.name);
        if (done) {
          lines.push(done.ok ? `  ✅ ${item.name}  已建软链` : `  ❌ ${item.name}  建软链失败：${done.error}`);
        } else {
          lines.push(`  ${MARK[item.state]} ${item.name}${item.state === ITEM_OCCUPIED ? `  ${item.detail}` : ""}`);
        }
      }
    } else {
      lines.push(`${host.label}  ${host.settingsPath}`);
      const done = applied?.find((r) => r.host === host.id);
      if (done) {
        lines.push(done.ok ? "  ✅ 已登记本包" : `  ❌ 登记失败：${done.error}`);
      } else if (host.installed === null) {
        lines.push("  ⚠️ settings.json 读不出来——装没装无法判断，不动它");
      } else if (host.installed) {
        lines.push("  ✅ 已登记本包");
      } else {
        lines.push(`  ＋ 待执行：${host.command.join(" ")}`);
      }
    }
    lines.push("");
  }

  if (hasConflict(plan)) {
    lines.push("⚠️ 有位置被别的东西占着。安装器不删任何已存在的文件或目录——");
    lines.push("   确认那不是你要的东西之后，自己删掉再重跑。");
    lines.push("");
  }

  if (!cliOnPath()) {
    lines.push("⚠️ `sdd-loop` 不在 PATH 上。访谈过程中要用它查口径，缺了那一步是空的：");
    lines.push(`     cd ${plan.packageRoot} && npm link`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------- 入口

export function runInit(args, { home = process.env.HOME, packageRoot, stdout, stderr, exit }) {
  if (!args.global) {
    stderr(
      [
        "sdd-loop init 目前只支持 -g / --global：把本包装进这台机器的 agent 宿主。",
        "",
        "要把某个**仓库**初始化成按 SDD Loop 运行，那是 sdd-init skill 的活",
        "（Claude Code 里 /sdd-init，pi 里 /sdd init）——它要按仓库现状判断、",
        "不覆盖你已有的 AGENTS.md，不是一条命令能替你决定的。",
        "",
      ].join("\n"),
    );
    return exit(EXIT_UNUSABLE);
  }

  // --claude / --pi 限定宿主；都不给就是全部检测到的宿主。
  const only = HOST_IDS.filter((id) => args[id]);
  const plan = planInstall({ packageRoot, home, only });

  if (plan.unusable) {
    stderr(`用不了：${plan.unusable}\n`);
    return exit(EXIT_UNUSABLE);
  }

  if (noHostDetected(plan)) {
    stdout(`${renderPlan(plan)}\n\n一个宿主都没检测到，什么也没做。\n`);
    return exit(EXIT_UNUSABLE);
  }

  if (args.show) {
    stdout(`${renderPlan(plan)}\n`);
    if (hasConflict(plan)) return exit(EXIT_CONTENT);
    return exit(hasWork(plan) ? EXIT_CONTENT : EXIT_OK);
  }

  const applied = applyPlan(plan);
  stdout(`${renderPlan(plan, { applied })}\n`);

  if (applied.some((r) => !r.ok)) return exit(EXIT_CONTENT);
  if (hasConflict(plan)) return exit(EXIT_CONTENT);
  return exit(EXIT_OK);
}
