import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  FULL_TEST_PROTOCOL_VERSION,
  RUN_STATUS,
  ALLOWED_STATUSES,
  validatePluginManifest,
  createRunBundleContext,
  buildEvidenceManifest,
  verifyEvidenceManifest,
  validateExtensionClaims,
  normalizeSuiteResult,
  validateRunResult,
  resolveCurrentGitSubject,
} from "../src/full-test/protocol.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const skillContent = () => fs.readFileSync(path.join(ROOT, "skills/sdd-full-test/SKILL.md"), "utf8");

// ---------------------------------------------------------------- 协议校验锁

test("协议：合法的 plugin.yaml 声明通过校验", () => {
  const manifest = {
    protocolVersion: FULL_TEST_PROTOCOL_VERSION,
    id: "wms-test-suite",
    version: "1.0.0",
    entrypoint: {
      argv: ["node", "tests/sdd/runner.mjs"],
    },
    profiles: {
      smoke: { suites: ["api-critical", "tenant-isolation"], timeoutMs: 60000 },
      full: { suites: ["ui", "api", "pbt", "perf"], timeoutMs: 3600000 },
    },
    requiredEnvironment: [{ name: "TEST_DB_URL", secret: true }],
    resourceLocks: ["mysql:wms-test"],
  };
  const result = validatePluginManifest(manifest);
  assert.equal(result.valid, true, `校验失败：${result.errors.join("; ")}`);
  assert.equal(result.errors.length, 0);
});

test("协议：entrypoint 拒绝任意 shell 字符串，必须为 argv 数组（防命令注入）", () => {
  for (const badEntry of [
    { argv: "node tests/sdd/runner.mjs" },
    { argv: [] },
    { argv: [""] },
    { cmd: "npm test" },
  ]) {
    const manifest = {
      protocolVersion: FULL_TEST_PROTOCOL_VERSION,
      id: "demo",
      version: "1.0.0",
      entrypoint: badEntry,
    };
    const result = validatePluginManifest(manifest);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("entrypoint.argv") || e.includes("缺少 entrypoint")));
  }
});

test("协议：requiredEnvironment 必须使用字段白名单，拒绝非布尔 secret、明文密钥与额外未知字段", () => {
  // 对抗探针：非布尔 secret 和内嵌 password
  const probe1 = {
    protocolVersion: FULL_TEST_PROTOCOL_VERSION,
    id: "demo",
    version: "1.0.0",
    entrypoint: { argv: ["node", "runner.mjs"] },
    requiredEnvironment: [
      { name: "TOKEN", secret: "plaintext-secret", password: "also-plaintext" },
    ],
  };
  const result1 = validatePluginManifest(probe1);
  assert.equal(result1.valid, false);
  assert.ok(result1.errors.some((e) => e.includes("未允许字段：password")));
  assert.ok(result1.errors.some((e) => e.includes("必须为布尔值")));

  // 非法环境变量名
  const probe2 = {
    protocolVersion: FULL_TEST_PROTOCOL_VERSION,
    id: "demo",
    version: "1.0.0",
    entrypoint: { argv: ["node", "runner.mjs"] },
    requiredEnvironment: [{ name: "lower-case-env" }],
  };
  const result2 = validatePluginManifest(probe2);
  assert.equal(result2.valid, false);
  assert.ok(result2.errors.some((e) => e.includes("必须是合法的环境变量大写标识符")));
});

test("协议：错误版本号或无效 id 格式被拒绝", () => {
  const badVersion = validatePluginManifest({
    protocolVersion: "sdd-full-test/v2",
    id: "demo",
    version: "1.0.0",
    entrypoint: { argv: ["node", "run.mjs"] },
  });
  assert.equal(badVersion.valid, false);
  assert.ok(badVersion.errors.some((e) => e.includes("不支持的协议版本")));

  const badId = validatePluginManifest({
    protocolVersion: FULL_TEST_PROTOCOL_VERSION,
    id: "Invalid_ID_Uppercase",
    version: "1.0.0",
    entrypoint: { argv: ["node", "run.mjs"] },
  });
  assert.equal(badId.valid, false);
  assert.ok(badId.errors.some((e) => e.includes("插件 id 无效")));
});

// ---------------------------------------------------------------- 状态五态锁

test("状态：严格收敛为五态，拒绝 PARTIAL、N/A 或未知状态", () => {
  assert.deepEqual(ALLOWED_STATUSES, ["PASS", "FAIL", "BLOCKED", "ERROR", "CANCELLED"]);
  assert.ok(!ALLOWED_STATUSES.includes("PARTIAL"), "严禁将模糊的 PARTIAL 作为执行状态");
  assert.ok(!ALLOWED_STATUSES.includes("N/A"), "N/A 属于工程扩展评价结论，不属于测试执行状态");

  const passSuite = normalizeSuiteResult({ id: "s1", status: "PASS", durationMs: 120 });
  assert.equal(passSuite.status, RUN_STATUS.PASS);

  for (const bad of ["PARTIAL", "N/A", "UNKNOWN", "OK", "FAILED"]) {
    assert.throws(() => normalizeSuiteResult({ id: "bad", status: bad }), /包含非法状态/);
  }
});

// ---------------------------------------------------------------- 不可变证据包与防篡改锁

test("不可变证据：buildEvidenceManifest 生成 sha256 清单，内容篡改时校验失败", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-test-bundle-"));
  const logsDir = path.join(tmp, "logs");
  const evidenceDir = path.join(tmp, "evidence");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });

  fs.writeFileSync(path.join(tmp, "plan.json"), JSON.stringify({ profile: "smoke" }), "utf8");
  fs.writeFileSync(
    path.join(tmp, "result.json"),
    JSON.stringify({
      protocolVersion: FULL_TEST_PROTOCOL_VERSION,
      runStatus: "PASS",
      cleanup: { attempted: true, verified: true },
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(logsDir, "api.log"), "all tests passed\n", "utf8");
  fs.writeFileSync(path.join(evidenceDir, "metrics.json"), JSON.stringify({ qps: 100 }), "utf8");

  // 生成 manifest
  const manifestMap = buildEvidenceManifest(tmp);
  assert.ok("plan.json" in manifestMap);
  assert.ok("result.json" in manifestMap);
  assert.ok("logs/api.log" in manifestMap);
  assert.ok("evidence/metrics.json" in manifestMap);
  assert.ok(fs.existsSync(path.join(tmp, "manifest.sha256")));

  // 校验完好
  const initialVerify = verifyEvidenceManifest(tmp);
  assert.equal(initialVerify.verified, true);
  assert.deepEqual(initialVerify.mismatches, []);
  assert.deepEqual(initialVerify.missing, []);
  assert.deepEqual(initialVerify.errors, []);

  // 篡改一个文件
  fs.appendFileSync(path.join(logsDir, "api.log"), "tampered content");
  const tamperedVerify = verifyEvidenceManifest(tmp);
  assert.equal(tamperedVerify.verified, false);
  assert.ok(tamperedVerify.mismatches.includes("logs/api.log"));

  // 删除一个文件
  fs.unlinkSync(path.join(tmp, "plan.json"));
  const missingVerify = verifyEvidenceManifest(tmp);
  assert.equal(missingVerify.verified, false);
  assert.ok(missingVerify.missing.includes("plan.json"));
});

test("不可变证据探针：拒绝空包、缺少必需文件、路径穿越、软链与 manifest 为目录", () => {
  // 1. 空目录或只有空的 manifest.sha256
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-test-empty-"));
  fs.writeFileSync(path.join(emptyDir, "manifest.sha256"), "", "utf8");
  const verifyEmpty = verifyEvidenceManifest(emptyDir);
  assert.equal(verifyEmpty.verified, false);
  assert.ok(verifyEmpty.errors.some((e) => e.includes("为空")));

  // 2. manifest.sha256 引用 ../outside.txt（路径穿越）
  const traversalDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-test-traversal-"));
  fs.writeFileSync(path.join(traversalDir, "plan.json"), "{}", "utf8");
  fs.writeFileSync(path.join(traversalDir, "result.json"), JSON.stringify({
    protocolVersion: FULL_TEST_PROTOCOL_VERSION,
    runStatus: "PASS",
    cleanup: { attempted: true, verified: true },
  }), "utf8");
  const fakeHash = "a".repeat(64);
  fs.writeFileSync(
    path.join(traversalDir, "manifest.sha256"),
    `${fakeHash}  ../outside.txt\n${fakeHash}  plan.json\n${fakeHash}  result.json\n`,
    "utf8",
  );
  const verifyTraversal = verifyEvidenceManifest(traversalDir);
  assert.equal(verifyTraversal.verified, false);
  assert.ok(verifyTraversal.errors.some((e) => e.includes("安全违规") && e.includes("不安全的路径")));

  // 3. 证据包内包含外部软链
  const symlinkDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-test-symlink-"));
  fs.writeFileSync(path.join(symlinkDir, "plan.json"), "{}", "utf8");
  fs.writeFileSync(path.join(symlinkDir, "result.json"), JSON.stringify({
    protocolVersion: FULL_TEST_PROTOCOL_VERSION,
    runStatus: "PASS",
    cleanup: { attempted: true, verified: true },
  }), "utf8");
  const outsideTarget = path.join(os.tmpdir(), "sdd-outside-file.txt");
  fs.writeFileSync(outsideTarget, "outside", "utf8");
  try {
    fs.symlinkSync(outsideTarget, path.join(symlinkDir, "link.txt"));
    assert.throws(() => buildEvidenceManifest(symlinkDir), /严禁包含符号链接/);
  } finally {
    if (fs.existsSync(outsideTarget)) fs.unlinkSync(outsideTarget);
  }

  // 4. manifest.sha256 是目录，必须受控报错，严禁崩溃
  const dirAsManifest = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-test-dir-manifest-"));
  fs.mkdirSync(path.join(dirAsManifest, "manifest.sha256"));
  const verifyDirManifest = verifyEvidenceManifest(dirAsManifest);
  assert.equal(verifyDirManifest.verified, false);
  assert.ok(verifyDirManifest.errors.some((e) => e.includes("普通文件")));

  // 5. plan.json 损坏时，受控返回错误，fail closed
  const corruptPlanDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-test-corrupt-plan-"));
  fs.writeFileSync(path.join(corruptPlanDir, "plan.json"), "{ invalid json", "utf8");
  fs.writeFileSync(path.join(corruptPlanDir, "result.json"), JSON.stringify({
    protocolVersion: FULL_TEST_PROTOCOL_VERSION,
    runStatus: "PASS",
    cleanup: { attempted: true, verified: true },
  }), "utf8");
  const planHash = crypto.createHash("sha256").update("{ invalid json").digest("hex");
  const resultHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(corruptPlanDir, "result.json"))).digest("hex");
  fs.writeFileSync(path.join(corruptPlanDir, "manifest.sha256"), `${planHash}  plan.json\n${resultHash}  result.json\n`, "utf8");
  const verifyCorruptPlan = verifyEvidenceManifest(corruptPlanDir);
  assert.equal(verifyCorruptPlan.verified, false);
  assert.ok(verifyCorruptPlan.errors.some((e) => e.includes("plan.json 损坏")));
});

test("不可变证据探针：result.json 必须满足五态、平账验证，且 cleanup 未通过时不得声称 PASS", () => {
  // 1. 非法状态 PARTIAL
  const invalidStatus = validateRunResult({
    protocolVersion: FULL_TEST_PROTOCOL_VERSION,
    runStatus: "PARTIAL",
    cleanup: { attempted: true, verified: true },
  });
  assert.equal(invalidStatus.valid, false);
  assert.ok(invalidStatus.errors.some((e) => e.includes("运行状态非法")));

  // 2. cleanup.verified: false 却宣布 PASS
  const fakePass = validateRunResult({
    protocolVersion: FULL_TEST_PROTOCOL_VERSION,
    runStatus: "PASS",
    cleanup: { attempted: true, verified: false },
  });
  assert.equal(fakePass.valid, false);
  assert.ok(fakePass.errors.some((e) => e.includes("cleanup.verified 未验证通过时，运行状态严禁宣布为 PASS")));

  // 3. 正确的平账失败应该标记为 ERROR 或 FAIL
  const validError = validateRunResult({
    protocolVersion: FULL_TEST_PROTOCOL_VERSION,
    runStatus: "ERROR",
    cleanup: { attempted: true, verified: false },
  });
  assert.equal(validError.valid, true);
});

// ---------------------------------------------------------------- 多对多扩展索赔与反越权锁

test("扩展索赔探针：顶层或 facts 内部嵌套判定字段（status/verdict 等）均被严厉拦截", () => {
  const validClaims = [
    {
      extension: "pbt",
      evidenceIds: ["logs/pbt.log"],
      facts: { property: "库存守恒", caseCount: 1000, seed: 12345 },
    },
    {
      extension: "resiliency",
      evidenceIds: ["logs/perf.log"],
      facts: { concurrency: 50, p95Ms: 40, deadlocks: 0 },
    },
  ];
  const validResult = validateExtensionClaims(validClaims);
  assert.equal(validResult.valid, true);

  // 对抗探针 1：顶层注入 status: PASS
  const topLevelInjection = [
    {
      extension: "security",
      status: "PASS",
      evidenceIds: ["ev"],
      facts: { checkedEndpoints: 10 },
    },
  ];
  const topResult = validateExtensionClaims(topLevelInjection);
  assert.equal(topResult.valid, false);
  assert.ok(topResult.errors.some((e) => e.includes("未允许顶层字段：status")));

  // 对抗探针 2：facts 内部深层嵌套注入 status: PASS
  const nestedInjection = [
    {
      extension: "security",
      evidenceIds: ["ev"],
      facts: { assessment: { status: "PASS" } },
    },
  ];
  const nestedResult = validateExtensionClaims(nestedInjection);
  assert.equal(nestedResult.valid, false);
  assert.ok(nestedResult.errors.some((e) => e.includes("越权") && e.includes("判定字段或判定值")));
});

// ---------------------------------------------------------------- 上下文与真实 Git 绑定锁

test("上下文：createRunBundleContext 强制要求合法 40 位 Git HEAD 与 64 位指纹，且不泄露绝对路径", () => {
  const gitSubject = resolveCurrentGitSubject(ROOT);
  assert.ok(/^[0-9a-f]{40}$/i.test(gitSubject.head));
  assert.ok(/^[0-9a-f]{64}$/i.test(gitSubject.fingerprint));

  // 1. 自动提取当前仓库的真实 HEAD 与指纹
  const ctxAuto = createRunBundleContext({
    repoRoot: ROOT,
    profile: "smoke",
    suites: ["suite-1"],
  });
  assert.equal(ctxAuto.subject.head, gitSubject.head);
  assert.equal(ctxAuto.subject.fingerprint, gitSubject.fingerprint);
  assert.ok(!("repoRoot" in ctxAuto), "证据包不得归档本机绝对 repoRoot 路径（防止私有路径泄露）");

  // 2. 拒绝伪造的 7 位伪 HEAD
  assert.throws(
    () => createRunBundleContext({ repoRoot: ROOT, head: "abc1234", fingerprint: "0".repeat(64) }),
    /必须提供合法的 40 位 Git HEAD/,
  );

  // 3. 拒绝与仓库真实 HEAD 不一致的伪造 40 位 HEAD
  assert.throws(
    () => createRunBundleContext({ repoRoot: ROOT, head: "0".repeat(40), fingerprint: gitSubject.fingerprint }),
    /与 repoRoot 真实 HEAD .* 不一致/,
  );

  // 4. 验证 result.json 中 context 的安全约束：严禁包含本机绝对路径 repoRoot
  const invalidContextResult = validateRunResult({
    protocolVersion: FULL_TEST_PROTOCOL_VERSION,
    runStatus: "PASS",
    cleanup: { attempted: true, verified: true },
    context: {
      repoRoot: "/Users/secret/repo",
      subject: { head: gitSubject.head, fingerprint: gitSubject.fingerprint },
    },
  });
  assert.equal(invalidContextResult.valid, false);
  assert.ok(invalidContextResult.errors.some((e) => e.includes("严禁归档本机绝对路径 repoRoot")));
});

// ---------------------------------------------------------------- Skill 文档契约锁

test("Skill 契约：定位于证据执行器，严守生命周期、目录可配置与失败分流红线", () => {
  const text = skillContent();
  assert.match(text, /^---\nname: sdd-full-test\ndescription: .+\n---\n/);
  assert.ok(text.includes("证据执行器"), "没写清核心定位是证据执行器");
  assert.ok(text.includes("不代替人或独立 reviewer 下通过结论"), "没声明反越权边界");
  assert.ok(text.includes("finally"), "生命周期没锁定 teardown 必须在 finally 路径");
  assert.ok(text.includes("清理失败判定为 `ERROR`"), "没锁定清理失败必须为 ERROR");
  assert.ok(text.includes("manifest.sha256"), "没声明不可变清单 manifest.sha256");

  // 消除硬编码目录约定绑定
  assert.ok(text.includes("不硬编码任何项目的目录约定"), "未声明遵循不硬编码目录约定");
  assert.ok(text.includes("SDD_TEST_PLUGIN") || text.includes("testPluginManifest"), "未提供可配置的清单路径支持");

  for (const status of ["PASS", "FAIL", "BLOCKED", "ERROR", "CANCELLED"]) {
    assert.ok(text.includes(`\`${status}\``), `Skill 文档缺状态定义 ${status}`);
  }

  // 失败分流红线：规格变更必须退回前期阶段，严禁直接改用例
  assert.ok(text.includes("已确认业务规格需要变化"), "缺少第四类失败分流（规格变更）");
  assert.ok(text.includes("严禁以“用例修正”为名直接在用例文件中修改预期"), "缺少禁止直接改答案的红线");
  assert.ok(text.includes("退回前期阶段"), "未指示规格变更需退回前期阶段重新审批");
});
