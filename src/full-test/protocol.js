import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const FULL_TEST_PROTOCOL_VERSION = "sdd-full-test/v1";

export const RUN_STATUS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  BLOCKED: "BLOCKED",
  ERROR: "ERROR",
  CANCELLED: "CANCELLED",
});

export const ALLOWED_STATUSES = Object.freeze(Object.values(RUN_STATUS));

const VALID_ID_PATTERN = /^[a-z][a-z0-9-_]*$/;
const VALID_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const MANIFEST_LINE_PATTERN = /^([0-9a-f]{64})  ([^\r\n]+)$/;
const FORBIDDEN_VERDICT_PATTERN = /^(pass|fail|failed|verdict|approved|confirmed|rejected|success)$/i;

const REQUIRED_BUNDLE_FILES = Object.freeze(["plan.json", "result.json"]);
const ALLOWED_REQUIRED_ENV_KEYS = Object.freeze(["name", "secret"]);
const ALLOWED_CLAIM_KEYS = Object.freeze(["extension", "evidenceIds", "facts"]);

function isSafeRelativePath(p) {
  if (typeof p !== "string" || !p.trim()) return false;
  if (path.isAbsolute(p)) return false;
  const normalized = p.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.startsWith("./")) return false;
  const segments = normalized.split("/");
  if (segments.includes("..") || segments.includes("")) return false;
  return true;
}

/**
 * 校验测试插件清单（plugin.yaml / plugin.json 解析后的对象）。
 *
 * 核心安全边界：
 * 1. entrypoint 必须为 argv 数组，拒绝任意 shell 字符串。
 * 2. requiredEnvironment 使用字段白名单（只允许 name 和 boolean 类型的 secret），拒绝额外明文字段。
 * 3. 严格遵循协议版本 sdd-full-test/v1。
 */
export function validatePluginManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { valid: false, errors: ["插件清单必须是非空对象。"] };
  }

  if (manifest.protocolVersion !== FULL_TEST_PROTOCOL_VERSION) {
    errors.push(`不支持的协议版本 "${manifest.protocolVersion || "(空)"}"；期望 "${FULL_TEST_PROTOCOL_VERSION}"。`);
  }

  if (!manifest.id || typeof manifest.id !== "string" || !VALID_ID_PATTERN.test(manifest.id)) {
    errors.push(`插件 id 无效："${manifest.id || "(空)"}"；必须匹配 ${VALID_ID_PATTERN}。`);
  }

  if (!manifest.version || typeof manifest.version !== "string") {
    errors.push("插件 version 必须为非空字符串。");
  }

  if (!manifest.entrypoint || typeof manifest.entrypoint !== "object") {
    errors.push("缺少 entrypoint 配置。");
  } else {
    const { argv } = manifest.entrypoint;
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((arg) => typeof arg === "string" && arg.trim().length > 0)) {
      errors.push("entrypoint.argv 必须是非空字符串数组（安全约束：禁止任意 shell 字符串）。");
    }
  }

  if (manifest.requiredEnvironment !== undefined) {
    if (!Array.isArray(manifest.requiredEnvironment)) {
      errors.push("requiredEnvironment 必须为数组。");
    } else {
      for (const [index, env] of manifest.requiredEnvironment.entries()) {
        if (!env || typeof env !== "object" || Array.isArray(env)) {
          errors.push(`requiredEnvironment[${index}] 必须为纯对象。`);
          continue;
        }

        const unknownKeys = Object.keys(env).filter((k) => !ALLOWED_REQUIRED_ENV_KEYS.includes(k));
        if (unknownKeys.length > 0) {
          errors.push(`requiredEnvironment[${index}] 包含未允许字段：${unknownKeys.join(", ")}（只允许 name, secret）。`);
        }

        if (typeof env.name !== "string" || !VALID_ENV_NAME_PATTERN.test(env.name)) {
          errors.push(`requiredEnvironment[${index}].name 必须是合法的环境变量大写标识符（匹配 ${VALID_ENV_NAME_PATTERN}）。`);
        }

        if ("secret" in env && typeof env.secret !== "boolean") {
          errors.push(`requiredEnvironment[${index}].secret 必须为布尔值（boolean）。`);
        }
      }
    }
  }

  if (manifest.resourceLocks !== undefined) {
    if (!Array.isArray(manifest.resourceLocks) || !manifest.resourceLocks.every((lock) => typeof lock === "string" && lock.trim())) {
      errors.push("resourceLocks 必须为非空字符串数组。");
    }
  }

  if (manifest.profiles !== undefined) {
    if (typeof manifest.profiles !== "object" || Array.isArray(manifest.profiles)) {
      errors.push("profiles 必须为对象。");
    } else {
      for (const [profileName, profile] of Object.entries(manifest.profiles)) {
        if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
          errors.push(`profile "${profileName}" 必须为对象。`);
          continue;
        }
        if (profile.suites !== undefined) {
          if (!Array.isArray(profile.suites) || !profile.suites.every((s) => typeof s === "string")) {
            errors.push(`profile "${profileName}".suites 必须为字符串数组。`);
          }
        }
        if (profile.timeoutMs !== undefined) {
          if (typeof profile.timeoutMs !== "number" || profile.timeoutMs <= 0 || !Number.isInteger(profile.timeoutMs)) {
            errors.push(`profile "${profileName}".timeoutMs 必须为正整数。`);
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 提取真实 Git 仓库的 HEAD 与工作区修改指纹，杜绝调用方伪造。
 */
export function resolveCurrentGitSubject(repoRoot) {
  try {
    const head = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (!GIT_SHA_PATTERN.test(head)) {
      throw new Error(`Git HEAD 无效：${head}`);
    }
    const statusShort = execFileSync("git", ["-C", repoRoot, "status", "--porcelain"], { encoding: "utf8" });
    const fingerprint = crypto.createHash("sha256").update(statusShort).digest("hex");
    return { head, fingerprint, clean: statusShort.trim().length === 0 };
  } catch (error) {
    throw new Error(`无法从 ${repoRoot} 解析 Git 状态：${error.message}`);
  }
}

/**
 * 为一次测试运行生成绑定的上下文与 runId。
 * 强制校验 HEAD 与 fingerprint 真实性，且证据中不归档本机绝对 repoRoot 路径。
 */
export function createRunBundleContext({
  repoRoot,
  stream = null,
  loop = null,
  head,
  fingerprint,
  profile = "smoke",
  suites = [],
} = {}) {
  if (!repoRoot || typeof repoRoot !== "string") {
    throw new Error("createRunBundleContext: 必须提供 repoRoot。");
  }

  if (head !== undefined && (typeof head !== "string" || !GIT_SHA_PATTERN.test(head))) {
    throw new Error(`createRunBundleContext: 必须提供合法的 40 位 Git HEAD，收到：${head || "(空)"}。`);
  }
  if (fingerprint !== undefined && (typeof fingerprint !== "string" || !/^[0-9a-f]{64}$/i.test(fingerprint))) {
    throw new Error(`createRunBundleContext: 必须提供合法的 64 位工作区指纹，收到：${fingerprint || "(空)"}。`);
  }

  const resolved = resolveCurrentGitSubject(repoRoot);
  const gitHead = head || resolved.head;
  const gitFingerprint = fingerprint || resolved.fingerprint;

  if (head && head !== resolved.head) {
    throw new Error(`createRunBundleContext: 调用方声明的 head (${head}) 与 repoRoot 真实 HEAD (${resolved.head}) 不一致。`);
  }
  if (fingerprint && fingerprint !== resolved.fingerprint) {
    throw new Error(`createRunBundleContext: 调用方声明的 fingerprint (${fingerprint}) 与 repoRoot 真实指纹 (${resolved.fingerprint}) 不一致。`);
  }

  if (!gitHead || typeof gitHead !== "string" || !GIT_SHA_PATTERN.test(gitHead)) {
    throw new Error(`createRunBundleContext: 必须提供合法的 40 位 Git HEAD，收到：${gitHead || "(空)"}。`);
  }
  if (!gitFingerprint || typeof gitFingerprint !== "string" || !/^[0-9a-f]{64}$/i.test(gitFingerprint)) {
    throw new Error(`createRunBundleContext: 必须提供合法的 64 位工作区指纹，收到：${gitFingerprint || "(空)"}。`);
  }

  const entropy = crypto.randomBytes(4).toString("hex");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = `run-${timestamp}-${entropy}`;

  return {
    runId,
    protocolVersion: FULL_TEST_PROTOCOL_VERSION,
    createdAt: new Date().toISOString(),
    subject: {
      head: gitHead,
      fingerprint: gitFingerprint,
      stream: stream ? String(stream) : null,
      loop: loop ? String(loop) : null,
    },
    profile: String(profile),
    suites: Array.isArray(suites) ? [...suites] : [],
  };
}

function walkBundleFiles(dir, baseDir = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: false });
  for (const name of entries) {
    const full = path.join(dir, name);
    const lstat = fs.lstatSync(full);
    if (lstat.isSymbolicLink()) {
      throw new Error(`安全违规：证据包严禁包含符号链接（symlink）：${path.relative(baseDir, full)}`);
    }
    if (lstat.isDirectory()) {
      walkBundleFiles(full, baseDir, out);
    } else if (lstat.isFile()) {
      const rel = path.relative(baseDir, full).replace(/\\/g, "/");
      if (rel !== "manifest.sha256") {
        out.push(rel);
      }
    }
  }
  return out;
}

/**
 * 遍历证据包目录，计算所有文件的 SHA-256 并生成 manifest.sha256。
 */
export function buildEvidenceManifest(bundleDir) {
  const absDir = path.resolve(bundleDir);
  if (!fs.existsSync(absDir)) {
    throw new Error(`buildEvidenceManifest: 目录不存在：${absDir}`);
  }

  const files = walkBundleFiles(absDir).sort();
  if (files.length === 0) {
    throw new Error("buildEvidenceManifest: 证据包为空，至少必须包含 plan.json 与 result.json。");
  }

  for (const required of REQUIRED_BUNDLE_FILES) {
    if (!files.includes(required)) {
      throw new Error(`buildEvidenceManifest: 证据包缺少必需文件 ${required}。`);
    }
  }

  const manifestMap = {};
  const lines = [];

  for (const rel of files) {
    if (!isSafeRelativePath(rel)) {
      throw new Error(`buildEvidenceManifest: 证据包包含不安全的相对路径：${rel}`);
    }
    const filePath = path.join(absDir, rel);
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    manifestMap[rel] = hash;
    lines.push(`${hash}  ${rel}`);
  }

  const manifestContent = `${lines.join("\n")}\n`;
  fs.writeFileSync(path.join(absDir, "manifest.sha256"), manifestContent, "utf8");
  return manifestMap;
}

/**
 * 校验 result.json 的结构与五态契约。
 */
export function validateRunResult(result) {
  const errors = [];
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { valid: false, errors: ["result.json 必须是非空对象。"] };
  }

  if (result.protocolVersion !== FULL_TEST_PROTOCOL_VERSION) {
    errors.push(`result.json 协议版本不匹配："${result.protocolVersion}"；期望 "${FULL_TEST_PROTOCOL_VERSION}"。`);
  }

  if (!ALLOWED_STATUSES.includes(result.runStatus)) {
    errors.push(`result.json 运行状态非法："${result.runStatus}"；允许五态：${ALLOWED_STATUSES.join(" / ")}。`);
  }

  if (!result.cleanup || typeof result.cleanup !== "object") {
    errors.push("result.json 缺少 cleanup 现场清理与平账记录。");
  } else {
    if (typeof result.cleanup.attempted !== "boolean" || typeof result.cleanup.verified !== "boolean") {
      errors.push("result.cleanup 必须包含布尔类型的 attempted 与 verified 字段。");
    }
    // 核心平账锁：未通过平账验证时，严禁判定为 PASS
    if (result.cleanup.verified !== true && result.runStatus === RUN_STATUS.PASS) {
      errors.push("安全违规：cleanup.verified 未验证通过时，运行状态严禁宣布为 PASS（必须为 ERROR 或 FAIL）。");
    }
  }

  if (result.suiteResults !== undefined) {
    if (!Array.isArray(result.suiteResults)) {
      errors.push("result.suiteResults 必须为数组。");
    } else {
      for (const [index, suite] of result.suiteResults.entries()) {
        try {
          normalizeSuiteResult(suite);
        } catch (e) {
          errors.push(`suiteResults[${index}]: ${e.message}`);
        }
      }
    }
  }

  if (result.context !== undefined) {
    if (!result.context || typeof result.context !== "object") {
      errors.push("result.context 必须为对象。");
    } else {
      if ("repoRoot" in result.context) {
        errors.push("安全违规：result.context 严禁归档本机绝对路径 repoRoot。");
      }
      if (result.context.subject) {
        const { subject } = result.context;
        if (!subject || typeof subject !== "object") {
          errors.push("result.context.subject 必须为对象。");
        } else {
          if (!subject.head || !GIT_SHA_PATTERN.test(subject.head)) {
            errors.push(`result.context.subject.head 必须是合法的 40 位 Git HEAD。`);
          }
          if (!subject.fingerprint || !/^[0-9a-f]{64}$/i.test(subject.fingerprint)) {
            errors.push(`result.context.subject.fingerprint 必须是合法的 64 位工作区指纹。`);
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 验证证据包目录下的 manifest.sha256 与文件完整性。
 * 包含：路径越界检查、符号链接拒绝、必需文件存在性、哈希防篡改与 result.json 契约验证。
 */
export function verifyEvidenceManifest(bundleDir) {
  if (!bundleDir || typeof bundleDir !== "string") {
    return { verified: false, mismatches: [], missing: ["bundleDir 路径无效"], errors: ["bundleDir 路径无效"] };
  }
  const absDir = path.resolve(bundleDir);
  if (!fs.existsSync(absDir)) {
    return { verified: false, mismatches: [], missing: ["证据包目录不存在"], errors: [`目录不存在：${absDir}`] };
  }

  let dirStat;
  try {
    dirStat = fs.lstatSync(absDir);
  } catch (err) {
    return { verified: false, mismatches: [], missing: [], errors: [err.message] };
  }
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
    return { verified: false, mismatches: [], missing: [], errors: ["证据包必须是实体目录，严禁软链"] };
  }

  const manifestPath = path.join(absDir, "manifest.sha256");
  if (!fs.existsSync(manifestPath)) {
    return { verified: false, mismatches: [], missing: ["manifest.sha256"], errors: ["缺少 manifest.sha256 清单文件"] };
  }

  let manifestStat;
  try {
    manifestStat = fs.lstatSync(manifestPath);
  } catch (err) {
    return { verified: false, mismatches: [], missing: [], errors: [err.message] };
  }
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    return { verified: false, mismatches: [], missing: [], errors: ["manifest.sha256 必须是普通文件，严禁目录或软链"] };
  }

  let content;
  try {
    content = fs.readFileSync(manifestPath, "utf8").trim();
  } catch (err) {
    return { verified: false, mismatches: [], missing: [], errors: [`无法读取清单：${err.message}`] };
  }

  if (!content) {
    return { verified: false, mismatches: [], missing: [], errors: ["manifest.sha256 为空，证据包无效"] };
  }

  const lines = content.split("\n");
  const expected = new Map();
  const mismatches = [];
  const missing = [];
  const errors = [];

  for (const [lineIndex, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(MANIFEST_LINE_PATTERN);
    if (!match) {
      errors.push(`manifest.sha256 第 ${lineIndex + 1} 行格式非法（应为 "<64位哈希>  <相对路径>"）：${line}`);
      continue;
    }
    const [, expHash, relPath] = match;
    if (!isSafeRelativePath(relPath)) {
      errors.push(`安全违规：manifest.sha256 引用了不安全的路径（越界或绝对路径）：${relPath}`);
      continue;
    }
    expected.set(relPath, expHash);
  }

  if (errors.length > 0) {
    return { verified: false, mismatches, missing, errors };
  }

  for (const req of REQUIRED_BUNDLE_FILES) {
    if (!expected.has(req)) {
      missing.push(req);
      errors.push(`清单未登记必需文件：${req}`);
    }
  }

  for (const [rel, expHash] of expected) {
    const filePath = path.join(absDir, rel);
    if (!fs.existsSync(filePath)) {
      missing.push(rel);
      continue;
    }
    try {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) {
        errors.push(`安全违规：证据文件严禁为符号链接：${rel}`);
        continue;
      }
      const actualHash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
      if (actualHash !== expHash) {
        mismatches.push(rel);
      }
    } catch (err) {
      errors.push(`读取文件失败 ${rel}：${err.message}`);
    }
  }

  try {
    const actualFiles = new Set(walkBundleFiles(absDir));
    for (const actual of actualFiles) {
      if (!expected.has(actual)) {
        mismatches.push(`未在清单记录的多余文件: ${actual}`);
      }
    }
  } catch (err) {
    errors.push(err.message);
  }

  // 深度验证 plan.json 格式
  const planJsonPath = path.join(absDir, "plan.json");
  if (fs.existsSync(planJsonPath)) {
    try {
      JSON.parse(fs.readFileSync(planJsonPath, "utf8"));
    } catch (err) {
      errors.push(`plan.json 损坏：${err.message}`);
    }
  }

  // 深度验证 result.json 的契约
  const resultJsonPath = path.join(absDir, "result.json");
  if (fs.existsSync(resultJsonPath)) {
    try {
      const resultData = JSON.parse(fs.readFileSync(resultJsonPath, "utf8"));
      const resultValidation = validateRunResult(resultData);
      if (!resultValidation.valid) {
        errors.push(...resultValidation.errors);
      }
    } catch (err) {
      errors.push(`result.json 损坏：${err.message}`);
    }
  }

  const verified = mismatches.length === 0 && missing.length === 0 && errors.length === 0;
  return { verified, mismatches, missing, errors };
}

function hasVerdictContent(value) {
  if (!value) return false;
  if (typeof value === "string") {
    return FORBIDDEN_VERDICT_PATTERN.test(value.trim());
  }
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return value.some(hasVerdictContent);
    }
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_VERDICT_PATTERN.test(k.trim())) return true;
      if (hasVerdictContent(v)) return true;
    }
  }
  return false;
}

/**
 * 校验 extensionClaims：确保插件仅声明客观事实索引，不越权自行裁定扩展 PASS。
 * 实施顶层白名单与 facts 深度防越权递归检查。
 */
export function validateExtensionClaims(claims) {
  const errors = [];
  if (!Array.isArray(claims)) {
    return { valid: false, errors: ["extensionClaims 必须为数组。"] };
  }

  for (const [index, claim] of claims.entries()) {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
      errors.push(`extensionClaims[${index}] 必须为纯对象。`);
      continue;
    }

    const unknownKeys = Object.keys(claim).filter((k) => !ALLOWED_CLAIM_KEYS.includes(k));
    if (unknownKeys.length > 0) {
      errors.push(`extensionClaims[${index}] 包含未允许顶层字段：${unknownKeys.join(", ")}（严禁顶层注入判定字段）。`);
    }

    if (!claim.extension || typeof claim.extension !== "string" || !claim.extension.trim()) {
      errors.push(`extensionClaims[${index}] 缺少 extension 标识。`);
    }
    if (!Array.isArray(claim.evidenceIds) || claim.evidenceIds.length === 0) {
      errors.push(`extensionClaims[${index}] 缺少 evidenceIds 事实依据列表。`);
    }
    if (!claim.facts || typeof claim.facts !== "object" || Array.isArray(claim.facts)) {
      errors.push(`extensionClaims[${index}] 缺少 facts 客观事实声明。`);
    } else {
      if (hasVerdictContent(claim.facts)) {
        errors.push(`extensionClaims[${index}].facts 越权：插件只能声明客观事实，不得嵌套包含判定字段或判定值（如 pass/verdict 等）。`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 规范化单项 Suite 的结果对象。
 */
export function normalizeSuiteResult(suite) {
  if (!suite || typeof suite !== "object") {
    throw new Error("normalizeSuiteResult: suite 必须是非空对象。");
  }
  const id = String(suite.id || "anonymous");
  const rawStatus = String(suite.status || "").toUpperCase();
  if (!ALLOWED_STATUSES.includes(rawStatus)) {
    throw new Error(`normalizeSuiteResult: 套件 "${id}" 包含非法状态 "${suite.status}"；允许：${ALLOWED_STATUSES.join(" / ")}。`);
  }

  return {
    id,
    status: rawStatus,
    durationMs: typeof suite.durationMs === "number" && suite.durationMs >= 0 ? suite.durationMs : 0,
    command: Array.isArray(suite.command) ? suite.command.map(String) : suite.command ? [String(suite.command)] : [],
    passedCount: typeof suite.passedCount === "number" ? suite.passedCount : 0,
    failedCount: typeof suite.failedCount === "number" ? suite.failedCount : 0,
    evidenceFiles: Array.isArray(suite.evidenceFiles) ? suite.evidenceFiles.map(String) : [],
    error: suite.error ? String(suite.error) : null,
  };
}
