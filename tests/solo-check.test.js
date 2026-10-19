import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import {
  PACKAGE_FILES,
  packageDigest,
  releaseChecklistDigest,
  validateSoloClosureReceipt,
} from "../src/solo/validation.js";

const CLI = path.resolve(import.meta.dirname, "../scripts/sdd-loop.mjs");

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function initRepo(root, remote) {
  fs.mkdirSync(root, { recursive: true });
  git(root, ["init", "-q", "-b", "master"]);
  git(root, ["config", "user.name", "Solo Test"]);
  git(root, ["config", "user.email", "solo@example.com"]);
  git(root, ["remote", "add", "origin", remote]);
  write(root, "README.md", "fixture\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-qm", "initial"]);
  return git(root, ["rev-parse", "HEAD"]);
}

function runSolo(primary, participant, manifestPath, extra = []) {
  return spawnSync(process.execPath, [
    CLI,
    "solo",
    "check",
    "--repo",
    primary,
    "--manifest",
    manifestPath,
    ...(participant ? ["--participant", `service=${participant}`] : []),
    ...extra,
    "--json",
  ], { encoding: "utf8" });
}

function releaseChecklist(demandId, repositories) {
  const releases = repositories.map((repositoryId, index) =>
    `- [ ] ${index + 1}. \`${repositoryId}\` — 环境：\`test\`；发布物/版本来源：\`current branch\`；前置：\`${index ? repositories[index - 1] : "none"}\`；动作：\`deploy\`；验证：\`smoke test\``).join("\n");
  return Buffer.from(`# 上线执行清单：${demandId} Test

- demandId: \`${demandId}\`
- 清单状态: \`ready\`
- 目标环境: \`test\`
- 执行负责人: \`Solo Test\`
- 计划窗口: \`not scheduled\`

## 发布项目与顺序

${releases}

## SQL 脚本

- [x] N/A — 原因：本需求不涉及数据库变更。

## 项目配置

- [x] N/A — 原因：本需求不涉及项目配置变更。

## FilerUI 配置

- [x] N/A — 原因：本需求不涉及 FilerUI 配置。

## 发布后验证与回滚

- [ ] 冒烟与业务核对：\`exercise the changed flow\`
- [ ] 监控观察：\`watch errors for 15 minutes\`
- [ ] 回滚触发条件：\`new errors\`；回滚顺序：\`reverse release order\`；负责人：\`Solo Test\`
`, "utf8");
}

function makeLightFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-solo-check-"));
  const primary = path.join(root, "primary");
  const participant = path.join(root, "service");
  const primaryRemote = "https://example.invalid/primary.git";
  const participantRemote = "https://example.invalid/service.git";
  initRepo(primary, primaryRemote);
  const participantBaseline = initRepo(participant, participantRemote);

  const requirementsBytes = Buffer.from("# Confirmed requirements\n\nREQ-1: keep the trace package.\n", "utf8");
  write(primary, "requirements.md", requirementsBytes);
  git(primary, ["add", "requirements.md"]);
  git(primary, ["commit", "-qm", "confirm requirements"]);
  const authorityCommit = git(primary, ["rev-parse", "HEAD"]);
  const requirementsSha256 = digest(requirementsBytes);
  const checklistBytes = releaseChecklist("D-1", ["primary", "service"]);

  const packagePath = "docs/sdd/demands/D-1";
  const blobs = PACKAGE_FILES["openspec-light"].map((name) => {
    const bytes = name === "requirements.md" ? requirementsBytes : Buffer.from(`# ${name}\n`, "utf8");
    write(participant, `${packagePath}/${name}`, bytes);
    return { name, bytes };
  });
  const source = {
    schemaVersion: 1,
    protocol: "sdd-solo@1",
    demandId: "D-1",
    deliveryMode: "openspec-light",
    repository: { repositoryId: "service", remote: participantRemote },
    authority: {
      remote: primaryRemote,
      requirementsPath: "requirements.md",
      commit: authorityCommit,
      requirementsSha256,
    },
    changeId: "D-1",
    exportedAt: "2026-09-29T00:00:00.000Z",
    files: Object.fromEntries(blobs.map(({ name, bytes }) => [name, digest(bytes)])),
  };
  const sourceBytes = Buffer.from(`${JSON.stringify(source, null, 2)}\n`, "utf8");
  write(participant, `${packagePath}/source.json`, sourceBytes);
  const packageSha256 = packageDigest(sourceBytes, blobs);
  git(participant, ["add", packagePath]);
  git(participant, ["commit", "-qm", "export trace package"]);
  const participantCommit = git(participant, ["rev-parse", "HEAD"]);

  const manifestPath = "openspec/changes/d-1/sdd-solo/repositories.json";
  write(primary, "openspec/changes/d-1/sdd-solo/release-checklist.md", checklistBytes);
  const manifest = {
    schemaVersion: 1,
    protocol: "sdd-solo@1",
    demandId: "D-1",
    primaryRepository: "primary",
    deliveryMode: "openspec-light",
    requirementsVersion: { commit: authorityCommit, sha256: requirementsSha256 },
    releaseChecklist: {
      path: "release-checklist.md",
      state: "ready",
      sha256: releaseChecklistDigest(checklistBytes),
      preparedAt: "2026-09-29T00:00:00.000Z",
    },
    participants: [
      {
        repositoryId: "primary",
        remote: primaryRemote,
        role: "primary",
        baseline: { branch: "master", commit: authorityCommit },
        workingBranch: { actual: "master" },
        traceExport: { required: false, state: "not-required" },
      },
      {
        repositoryId: "service",
        remote: participantRemote,
        role: "participant",
        baseline: { branch: "master", commit: participantBaseline },
        workingBranch: { actual: "master" },
        traceExport: {
          required: true,
          state: "verified",
          packagePath,
          sourceCommit: authorityCommit,
          participantCommit,
          packageSha256,
          verifiedAt: "2026-09-29T00:00:00.000Z",
        },
      },
    ],
    closure: {
      state: "ready",
      aggregateReview: { outcome: "NOT_REQUIRED" },
      receiptPath: "solo-closure-receipt.json",
    },
  };
  write(primary, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { root, primary, participant, manifestPath, manifest };
}

test("solo check verifies committed participant trace packages and writes a closure receipt", (t) => {
  const fixture = makeLightFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const result = runSolo(fixture.primary, fixture.participant, fixture.manifestPath, ["--write-receipt"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.checks.find((entry) => entry.id === "S4").ok, true);
  assert.ok(fs.existsSync(path.join(fixture.primary, "openspec/changes/d-1/sdd-solo/solo-closure-receipt.json")));

  const checklist = path.join(fixture.primary, "openspec/changes/d-1/sdd-solo/release-checklist.md");
  fs.writeFileSync(checklist, fs.readFileSync(checklist, "utf8").replace("- [ ] 1.", "- [x] 1."));
  const afterTick = runSolo(fixture.primary, fixture.participant, fixture.manifestPath);
  assert.equal(afterTick.status, 0, afterTick.stderr || afterTick.stdout);
});

test("solo check fails closed when trace state, runtime binding, or package digest is invalid", async (t) => {
  await t.test("trace export is still pending", (subtest) => {
    const fixture = makeLightFixture();
    subtest.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    fixture.manifest.participants[1].traceExport.state = "pending";
    write(fixture.primary, fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
    const result = runSolo(fixture.primary, fixture.participant, fixture.manifestPath);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /trace-state/);
  });

  await t.test("participant path is not supplied", (subtest) => {
    const fixture = makeLightFixture();
    subtest.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const result = runSolo(fixture.primary, null, fixture.manifestPath);
    assert.equal(result.status, 2);
    assert.match(result.stdout, /participant-binding/);
  });

  await t.test("recorded package digest does not match committed package", (subtest) => {
    const fixture = makeLightFixture();
    subtest.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    fixture.manifest.participants[1].traceExport.packageSha256 = `sha256:${"0".repeat(64)}`;
    write(fixture.primary, fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
    const result = runSolo(fixture.primary, fixture.participant, fixture.manifestPath);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /package-digest/);
  });

  await t.test("release checklist contains an unresolved item", (subtest) => {
    const fixture = makeLightFixture();
    subtest.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const checklist = path.join(fixture.primary, "openspec/changes/d-1/sdd-solo/release-checklist.md");
    fs.appendFileSync(checklist, "\nTODO: confirm production window\n");
    fixture.manifest.releaseChecklist.sha256 = releaseChecklistDigest(fs.readFileSync(checklist));
    write(fixture.primary, fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
    const result = runSolo(fixture.primary, fixture.participant, fixture.manifestPath);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /release-checklist-placeholder/);
  });
});

test("full loop close rejects a missing or drifted Solo closure receipt", (t) => {
  const loopDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-solo-close-"));
  t.after(() => fs.rmSync(loopDir, { recursive: true, force: true }));
  const evidence = write(loopDir, "aggregate-review.md", "READY_FOR_HUMAN_REVIEW\n");
  const checklistBytes = releaseChecklist("D-2", ["primary", "service"]);
  const checklist = write(loopDir, "release-checklist.md", checklistBytes);
  const checklistSha256 = releaseChecklistDigest(checklistBytes);
  const manifest = {
    schemaVersion: 1,
    protocol: "sdd-solo@1",
    demandId: "D-2",
    primaryRepository: "primary",
    deliveryMode: "full",
    requirementsVersion: { commit: "1".repeat(40), sha256: `sha256:${"2".repeat(64)}` },
    releaseChecklist: {
      path: "release-checklist.md",
      state: "ready",
      sha256: checklistSha256,
      preparedAt: "2026-09-29T00:00:00.000Z",
    },
    participants: [
      {
        repositoryId: "primary",
        role: "primary",
        traceExport: { required: false, state: "not-required" },
      },
      {
        repositoryId: "service",
        role: "participant",
        traceExport: {
          required: true,
          state: "verified",
          sourceCommit: "1".repeat(40),
          participantCommit: "3".repeat(40),
          packagePath: "docs/sdd/demands/D-2",
          packageSha256: `sha256:${"4".repeat(64)}`,
        },
      },
    ],
    closure: { state: "ready", receiptPath: "solo-closure-receipt.json" },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  write(loopDir, "repositories.json", manifestBytes);

  assert.throws(() => validateSoloClosureReceipt(loopDir), /缺少机器生成的收口凭据/);

  write(loopDir, "solo-closure-receipt.json", `${JSON.stringify({
    schemaVersion: 1,
    protocol: "sdd-solo@1",
    demandId: "D-2",
    deliveryMode: "full",
    state: "verified",
    manifestSha256: digest(manifestBytes),
    authorityCommit: "1".repeat(40),
    participants: [{
      repositoryId: "service",
      sourceCommit: "1".repeat(40),
      participantCommit: "3".repeat(40),
      packagePath: "docs/sdd/demands/D-2",
      packageSha256: `sha256:${"4".repeat(64)}`,
    }],
    primaryEvidence: [
      { path: "repositories.json", sha256: digest(manifestBytes) },
      { path: "aggregate-review.md", sha256: digest(fs.readFileSync(evidence)) },
      { path: "release-checklist.md", sha256: checklistSha256, hashMode: "checkbox-state-insensitive-v1" },
    ],
  }, null, 2)}\n`);
  assert.equal(validateSoloClosureReceipt(loopDir).ok, true);

  fs.writeFileSync(checklist, fs.readFileSync(checklist, "utf8").replace("- [ ] 1.", "- [x] 1."));
  assert.equal(validateSoloClosureReceipt(loopDir).ok, true);

  const receiptFile = path.join(loopDir, "solo-closure-receipt.json");
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  receipt.participants = [];
  fs.writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
  assert.throws(() => validateSoloClosureReceipt(loopDir), /参与仓追溯事实与参与清单不匹配/);
  receipt.participants = [{
    repositoryId: "service",
    sourceCommit: "1".repeat(40),
    participantCommit: "3".repeat(40),
    packagePath: "docs/sdd/demands/D-2",
    packageSha256: `sha256:${"4".repeat(64)}`,
  }];
  fs.writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);

  fs.appendFileSync(evidence, "drift\n");
  assert.throws(() => validateSoloClosureReceipt(loopDir), /主仓证据在追溯校验后发生变化/);
});
