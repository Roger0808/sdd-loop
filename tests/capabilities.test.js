import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { buildCapabilityReport, evaluateCapabilityRequirement } from "../src/governance/capabilities.js";
import { EXIT_OK, EXIT_UNUSABLE } from "../scripts/lib/exit-codes.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "scripts/sdd-loop.mjs");

function run(args, { home = process.env.HOME } = {}) {
  const result = spawnSync(process.execPath, [CLI, "capabilities", ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function installedAgentsHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-capability-home-"));
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  const skillsDir = path.join(home, ".agents", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  for (const rel of pkg.pi.skills) {
    const source = path.resolve(ROOT, rel);
    fs.symlinkSync(source, path.join(skillsDir, path.basename(source)));
  }
  return home;
}

test("capabilities --json 给出可机读 governance@1 与完整打包资源", () => {
  const result = run(["--json"]);
  assert.equal(result.code, EXIT_OK, result.err);
  const report = JSON.parse(result.out);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.capabilities.governance.available, true);
  assert.deepEqual(report.capabilities.governance.supportedProtocolVersions, [1]);
  assert.deepEqual(report.capabilities.governance.checks, ["C6", "C7", "C8", "C9", "C10"]);
  assert.deepEqual(report.capabilities.governance.engineeringExtensions, ["testing", "pbt", "security", "resiliency"]);
  assert.deepEqual(report.capabilities.governance.missingResources, []);
  assert.equal(report.capabilities.hotfix.available, true);
  assert.deepEqual(report.capabilities.hotfix.supportedProtocolVersions, [1]);
  assert.deepEqual(report.capabilities.hotfix.checks, ["H1", "H2", "H3", "H4", "H5"]);
  assert.equal(report.capabilities.debug.available, true);
  assert.deepEqual(report.capabilities.debug.supportedProtocolVersions, [1]);
  assert.deepEqual(report.capabilities.debug.checks, ["H1", "H2", "H3", "H4", "H5"]);
  assert.equal(report.capabilities["full-test"].available, true);
  assert.deepEqual(report.capabilities["full-test"].supportedProtocolVersions, [1]);
  assert.deepEqual(report.capabilities["full-test"].missingResources, []);
});

test("hotfix@1 独立验证 sdd-hotfix，新增 Skill 不使 governance@1 依赖它", () => {
  const home = installedAgentsHome();
  assert.equal(run(["--require", "hotfix@1", "--host", "agents"], { home }).code, EXIT_OK);
  fs.unlinkSync(path.join(home, ".agents", "skills", "sdd-hotfix"));
  assert.equal(run(["--require", "governance@1", "--host", "agents"], { home }).code, EXIT_OK);
  const missingHotfix = run(["--require", "hotfix@1", "--host", "agents"], { home });
  assert.equal(missingHotfix.code, EXIT_UNUSABLE);
  assert.match(missingHotfix.err, /sdd-hotfix/);
});

test("full-test@1 独立验证 sdd-full-test，新增 Skill 不使 governance@1 或 hotfix@1 依赖它", () => {
  const home = installedAgentsHome();
  assert.equal(run(["--require", "full-test@1", "--host", "agents"], { home }).code, EXIT_OK);
  fs.unlinkSync(path.join(home, ".agents", "skills", "sdd-full-test"));
  assert.equal(run(["--require", "governance@1", "--host", "agents"], { home }).code, EXIT_OK);
  assert.equal(run(["--require", "hotfix@1", "--host", "agents"], { home }).code, EXIT_OK);
  const missingFullTest = run(["--require", "full-test@1", "--host", "agents"], { home });
  assert.equal(missingFullTest.code, EXIT_UNUSABLE);
  assert.match(missingFullTest.err, /sdd-full-test/);
});

test("debug@1 独立验证 sdd-debug，且不改变 governance@1 或 hotfix@1 的依赖", () => {
  const home = installedAgentsHome();
  assert.equal(run(["--require", "debug@1", "--host", "agents"], { home }).code, EXIT_OK);
  fs.unlinkSync(path.join(home, ".agents", "skills", "sdd-debug"));
  assert.equal(run(["--require", "governance@1", "--host", "agents"], { home }).code, EXIT_OK);
  assert.equal(run(["--require", "hotfix@1", "--host", "agents"], { home }).code, EXIT_OK);
  const missingDebug = run(["--require", "debug@1", "--host", "agents"], { home });
  assert.equal(missingDebug.code, EXIT_UNUSABLE);
  assert.match(missingDebug.err, /sdd-debug/);
});

test("--require governance@1 同时验证协议与当前宿主 Skill 安装", () => {
  const home = installedAgentsHome();
  const supported = run(["--require", "governance@1", "--host", "agents"], { home });
  assert.equal(supported.code, EXIT_OK, supported.err);
  assert.match(supported.out, /governance@1 可用/);

  const missingHome = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-capability-missing-home-"));
  fs.mkdirSync(path.join(missingHome, ".codex"), { recursive: true });
  const missing = run(["--require", "governance@1", "--host", "agents"], { home: missingHome });
  assert.equal(missing.code, EXIT_UNUSABLE);
  assert.match(missing.err, /宿主尚未安装完整/);

  for (const args of [
    ["--require", "governance@1"],
    ["--require", "governance@1", "--host", "unknown"],
    ["--require", "governance@2", "--host", "agents"],
    ["--require", "unknown@1", "--host", "agents"],
    ["--require", "governance", "--host", "agents"],
    ["--require"],
  ]) {
    const result = run(args, { home });
    assert.equal(result.code, EXIT_UNUSABLE, `${args.join(" ")} 不应通过`);
    assert.ok(result.err.trim(), `${args.join(" ")} 应说明失败原因`);
  }
});

test("能力报告检查实际打包资源，不能只靠硬编码版本号报可用", () => {
  const incompleteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-capability-"));
  const report = buildCapabilityReport(incompleteRoot);
  assert.equal(report.capabilities.governance.available, false);
  assert.ok(report.capabilities.governance.missingResources.length > 0);
  const requirement = evaluateCapabilityRequirement(report, "governance@1");
  assert.equal(requirement.ok, false);
  assert.match(requirement.reason, /不完整/);
});
