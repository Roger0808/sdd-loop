import path from "node:path";
import { buildSoloCheckReport, writeSoloClosureReceipt } from "../../src/solo/validation.js";
import { EXIT_CONTENT, EXIT_OK, EXIT_UNUSABLE } from "./exit-codes.mjs";

function bindings(value) {
  const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const result = new Map();
  for (const item of values) {
    const index = String(item).indexOf("=");
    if (index <= 0 || index === String(item).length - 1) throw new Error(`--participant 格式无效：${item}；应为 <repositoryId>=<path>。`);
    result.set(String(item).slice(0, index), path.resolve(String(item).slice(index + 1)));
  }
  return result;
}

function render(report) {
  const lines = [report.ok ? "结论：Solo 收口证据完整。" : `结论：Solo 收口有 ${report.problems.length} 处问题。`, ""];
  for (const check of report.checks) lines.push(`${check.ok ? "✅" : "❌"} ${check.id} ${check.title}`);
  for (const item of report.problems) lines.push(`  ✖ ${item.code}: ${item.detail}`);
  return lines.join("\n");
}

export function runSolo(args, io) {
  if (args._[1] !== "check") {
    io.stderr("用法：sdd-loop solo check --manifest <path> [--repo <primary>] [--participant <id=path> ...] [--write-receipt] [--json]\n");
    return io.exit(EXIT_UNUSABLE);
  }
  if (!args.manifest) {
    io.stderr("solo check 必须提供 --manifest。\n");
    return io.exit(EXIT_UNUSABLE);
  }
  let participantRepos;
  try {
    participantRepos = bindings(args.participant);
  } catch (error) {
    io.stderr(`${error.message}\n`);
    return io.exit(EXIT_UNUSABLE);
  }
  const report = buildSoloCheckReport({
    primaryRepoRoot: path.resolve(args.repo || process.cwd()),
    manifestPath: args.manifest,
    participantRepos,
  });
  if (args["write-receipt"] && report.ok) {
    try {
      report.receiptPath = writeSoloClosureReceipt(report);
    } catch (error) {
      report.ok = false;
      report.severity = "unusable";
      report.problems.push({ check: "S5", code: "receipt-write", detail: error.message, severity: "unusable" });
    }
  }
  io.stdout(`${args.json ? JSON.stringify(report, null, 2) : render(report)}\n`);
  if (report.severity === "unusable") return io.exit(EXIT_UNUSABLE);
  return io.exit(report.ok ? EXIT_OK : EXIT_CONTENT);
}
