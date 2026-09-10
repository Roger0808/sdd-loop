import fs from "node:fs";
import path from "node:path";

import { HOST_IDS, ITEM_STATES, planInstall } from "../install/plan.js";
import { BUILTIN_EXTENSIONS, GOVERNANCE_VERSION } from "./protocol.js";

export const CAPABILITY_SCHEMA_VERSION = 1;

const GOVERNANCE_RESOURCES = Object.freeze([
  "scripts/lib/governance.mjs",
  "src/validation/governance-check.js",
  "skills/sdd-init/SKILL.md",
  "skills/sdd-interview/SKILL.md",
  "skills/sdd-upgrade/SKILL.md",
  "skills/sdd-review/SKILL.md",
  "skills/sdd-init/AGENTS.md.template",
  "skills/sdd-init/AGENTS.md.CHANGELOG.md",
  "skills/sdd-init/references/extensions/README.md",
  ...BUILTIN_EXTENSIONS.map((name) => `skills/sdd-init/references/extensions/${name}.md`),
]);

function summarizeHostReadiness(packageRoot, { host, home, env }) {
  if (!host) return null;
  if (!HOST_IDS.includes(host)) {
    return {
      id: host,
      ready: false,
      reason: `未知宿主：${host}；可用值：${HOST_IDS.join(" / ")}。`,
    };
  }

  const plan = planInstall({ packageRoot, home, env, only: [host] });
  if (plan.unusable) return { id: host, ready: false, reason: plan.unusable };
  const target = plan.hosts.find((entry) => entry.id === host);
  if (!target?.detected) {
    return { id: host, ready: false, reason: target?.reason || `没有检测到 ${host} 宿主。` };
  }

  const pending = [];
  const conflicts = [];
  for (const item of target.items ?? []) {
    if (item.state === ITEM_STATES.ITEM_READY) pending.push(item.name);
    if (item.state === ITEM_STATES.ITEM_OCCUPIED) conflicts.push(item.name);
  }
  if (target.kind === "hermes") {
    if (target.configState === ITEM_STATES.ITEM_READY) pending.push("skills.external_dirs");
    if (target.configState === ITEM_STATES.ITEM_OCCUPIED) conflicts.push("skills.external_dirs");
  }
  if (target.kind === "command") {
    if (target.installed === false) pending.push("package registration");
    if (target.installed === null) conflicts.push("package registration");
  }

  if (conflicts.length) {
    return {
      id: host,
      ready: false,
      reason: `宿主安装状态冲突或无法判定：${conflicts.join(" / ")}。`,
      pending,
      conflicts,
    };
  }
  if (pending.length) {
    return {
      id: host,
      ready: false,
      reason: `宿主尚未安装完整：${pending.join(" / ")}；请先运行 sdd-loop init -g --${host}。`,
      pending,
      conflicts,
    };
  }
  return { id: host, ready: true, reason: `${host} 宿主已安装全部治理 Skills。`, pending, conflicts };
}

export function buildCapabilityReport(packageRoot, options = {}) {
  const root = path.resolve(packageRoot);
  const missingResources = GOVERNANCE_RESOURCES.filter((rel) => {
    try {
      return !fs.statSync(path.join(root, rel)).isFile();
    } catch {
      return true;
    }
  });
  const protocolVersion = Number(GOVERNANCE_VERSION);
  const report = {
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    package: "sdd-loop",
    capabilities: {
      governance: {
        available: missingResources.length === 0,
        supportedProtocolVersions: [protocolVersion],
        checks: ["C6", "C7", "C8", "C9", "C10"],
        engineeringExtensions: [...BUILTIN_EXTENSIONS],
        missingResources,
      },
    },
  };
  const hostReadiness = summarizeHostReadiness(root, {
    host: options.host,
    home: options.home ?? process.env.HOME,
    env: options.env ?? process.env,
  });
  if (hostReadiness) report.hostReadiness = hostReadiness;
  return report;
}

export function evaluateCapabilityRequirement(report, requirement) {
  const match = String(requirement ?? "").match(/^([a-z][a-z0-9-]*)@([1-9]\d*)$/);
  if (!match) {
    return { ok: false, reason: `能力要求格式无效：${requirement || "(空)"}；应为 <name>@<protocol-version>。` };
  }
  const [, name, rawVersion] = match;
  const version = Number(rawVersion);
  const capability = report.capabilities[name];
  if (!capability) return { ok: false, name, version, reason: `未知能力：${name}@${version}。` };
  if (!capability.available) {
    return {
      ok: false,
      name,
      version,
      reason: `${name}@${version} 不完整；缺少：${capability.missingResources.join(" / ") || "运行组件"}。`,
    };
  }
  if (!capability.supportedProtocolVersions.includes(version)) {
    return {
      ok: false,
      name,
      version,
      reason: `${name}@${version} 不受支持；可用协议：${capability.supportedProtocolVersions.join(" / ") || "无"}。`,
    };
  }
  if (!report.hostReadiness) {
    return {
      ok: false,
      name,
      version,
      reason: `缺少 --host；可用值：${HOST_IDS.join(" / ")}。能力门禁必须同时验证当前宿主能发现治理 Skills。`,
    };
  }
  if (!report.hostReadiness.ready) {
    return {
      ok: false,
      name,
      version,
      reason: `${name}@${version} 的包资源可用，但 ${report.hostReadiness.id} 宿主未就绪：${report.hostReadiness.reason}`,
    };
  }
  return { ok: true, name, version, reason: `${name}@${version} 可用。` };
}

export { HOST_IDS as CAPABILITY_HOST_IDS };
