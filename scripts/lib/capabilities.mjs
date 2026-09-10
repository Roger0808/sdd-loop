import { buildCapabilityReport, evaluateCapabilityRequirement } from "../../src/governance/capabilities.js";
import { EXIT_OK, EXIT_UNUSABLE } from "./exit-codes.mjs";

function render(report) {
  const lines = ["sdd-loop capabilities"];
  for (const [name, capability] of Object.entries(report.capabilities)) {
    const versions = capability.supportedProtocolVersions.map((version) => `${name}@${version}`).join(" / ");
    lines.push(`${capability.available ? "✅" : "❌"} ${versions}`);
    if (capability.missingResources.length) lines.push(`   缺少：${capability.missingResources.join(" / ")}`);
  }
  return lines.join("\n");
}

export function runCapabilities(args, io, { packageRoot, home = process.env.HOME, env = process.env }) {
  const report = buildCapabilityReport(packageRoot, { host: args.host, home, env });
  const hasRequirement = Object.hasOwn(args, "require");
  const evaluation = hasRequirement ? evaluateCapabilityRequirement(report, args.require) : null;

  if (args.json) {
    io.stdout(`${JSON.stringify(evaluation ? { ...report, requirement: evaluation } : report, null, 2)}\n`);
  } else if (evaluation) {
    (evaluation.ok ? io.stdout : io.stderr)(`${evaluation.ok ? "✅" : "❌"} ${evaluation.reason}\n`);
  } else {
    const hostLine = report.hostReadiness
      ? `\n${report.hostReadiness.ready ? "✅" : "❌"} 宿主 ${report.hostReadiness.id}：${report.hostReadiness.reason}`
      : "";
    io.stdout(`${render(report)}${hostLine}\n`);
  }
  io.exit(evaluation && !evaluation.ok ? EXIT_UNUSABLE : EXIT_OK);
}
