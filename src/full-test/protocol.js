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
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const RUN_ID_PATTERN = /^run-[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MANIFEST_LINE_PATTERN = /^([0-9a-f]{64})  ([^\r\n]+)$/;
const FORBIDDEN_VERDICT_PATTERN = /^(pass|fail|failed|verdict|approved|confirmed|rejected|success)$/i;
const SECRET_ARG_PATTERN = /^--?(?:password|passwd|token|secret|api[-_]?key|credential)(?:=|$)/i;
const SHELL_EXECUTABLE_PATTERN = /^(?:ba|da|k|z)?sh$|^fish$|^cmd(?:\.exe)?$|^(?:power)?shell$|^pwsh$/i;
const SHELL_COMMAND_FLAG_PATTERN = /^(?:-c|--command|\/c|-command|-encodedcommand)$/i;

const REQUIRED_BUNDLE_FILES = Object.freeze(["plan.json", "result.json"]);
const ALLOWED_PLUGIN_KEYS = Object.freeze([
  "protocolVersion",
  "id",
  "version",
  "description",
  "entrypoint",
  "profiles",
  "requiredEnvironment",
  "resourceLocks",
  "isolation",
]);
const ALLOWED_ENTRYPOINT_KEYS = Object.freeze(["argv"]);
const ALLOWED_PROFILE_KEYS = Object.freeze(["suites", "timeoutMs"]);
const ALLOWED_ISOLATION_KEYS = Object.freeze(["strategy", "cleanupRequired"]);
const ALLOWED_REQUIRED_ENV_KEYS = Object.freeze(["name", "secret"]);
const ALLOWED_CLAIM_KEYS = Object.freeze(["extension", "evidenceIds", "facts"]);
const GIT_MAX_BUFFER = 128 * 1024 * 1024;

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

  const unknownManifestKeys = Object.keys(manifest).filter((key) => !ALLOWED_PLUGIN_KEYS.includes(key));
  if (unknownManifestKeys.length > 0) {
    errors.push(`插件清单包含未允许字段：${unknownManifestKeys.join(", ")}（严禁通过额外字段内嵌凭据或私有配置）。`);
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

  if (manifest.description !== undefined && (typeof manifest.description !== "string" || !manifest.description.trim())) {
    errors.push("插件 description 必须为非空字符串。");
  }

  if (!manifest.entrypoint || typeof manifest.entrypoint !== "object") {
    errors.push("缺少 entrypoint 配置。");
  } else {
    const unknownEntrypointKeys = Object.keys(manifest.entrypoint).filter((key) => !ALLOWED_ENTRYPOINT_KEYS.includes(key));
    if (unknownEntrypointKeys.length > 0) {
      errors.push(`entrypoint 包含未允许字段：${unknownEntrypointKeys.join(", ")}（只允许 argv）。`);
    }
    const { argv } = manifest.entrypoint;
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((arg) => typeof arg === "string" && arg.trim().length > 0)) {
      errors.push("entrypoint.argv 必须是非空字符串数组（安全约束：禁止任意 shell 字符串）。");
    } else if (argv.some((arg) => SECRET_ARG_PATTERN.test(arg.trim()))) {
      errors.push("entrypoint.argv 严禁内嵌 password/token/secret/api-key/credential 等凭据参数；请改用 requiredEnvironment 声明环境变量名称。");
    } else {
      const executable = path.basename(argv[0]);
      if (SHELL_EXECUTABLE_PATTERN.test(executable) && argv.slice(1).some((arg) => SHELL_COMMAND_FLAG_PATTERN.test(arg))) {
        errors.push("entrypoint.argv 严禁通过 shell -c、cmd /c 或 PowerShell -Command 执行内联命令；请直接列出可执行文件与参数。");
      }
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
        const unknownProfileKeys = Object.keys(profile).filter((key) => !ALLOWED_PROFILE_KEYS.includes(key));
        if (unknownProfileKeys.length > 0) {
          errors.push(`profile "${profileName}" 包含未允许字段：${unknownProfileKeys.join(", ")}（只允许 suites, timeoutMs）。`);
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

  if (manifest.isolation !== undefined) {
    if (!manifest.isolation || typeof manifest.isolation !== "object" || Array.isArray(manifest.isolation)) {
      errors.push("isolation 必须为对象。");
    } else {
      const unknownIsolationKeys = Object.keys(manifest.isolation).filter((key) => !ALLOWED_ISOLATION_KEYS.includes(key));
      if (unknownIsolationKeys.length > 0) {
        errors.push(`isolation 包含未允许字段：${unknownIsolationKeys.join(", ")}（只允许 strategy, cleanupRequired）。`);
      }
      if (typeof manifest.isolation.strategy !== "string" || !manifest.isolation.strategy.trim()) {
        errors.push("isolation.strategy 必须为非空字符串。");
      }
      if (manifest.isolation.cleanupRequired !== true) {
        errors.push("isolation.cleanupRequired 必须为 true，确保 teardown 平账不可绕过。");
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
    const gitText = (args) => execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      maxBuffer: GIT_MAX_BUFFER,
    });
    const gitBuffer = (args) => execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "buffer",
      maxBuffer: GIT_MAX_BUFFER,
    });
    const head = gitText(["rev-parse", "HEAD"]).trim();
    if (!GIT_SHA_PATTERN.test(head)) {
      throw new Error(`Git HEAD 无效：${head}`);
    }

    const status = gitBuffer(["status", "--porcelain=v2", "-z", "--untracked-files=all"]);
    const stagedDiff = gitBuffer(["diff", "--cached", "--binary", "--no-ext-diff", "--full-index", "--"]);
    const unstagedDiff = gitBuffer(["diff", "--binary", "--no-ext-diff", "--full-index", "--"]);
    const untrackedOutput = gitBuffer(["ls-files", "--others", "--exclude-standard", "-z"]);
    const untrackedPaths = untrackedOutput
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .sort();

    const hash = crypto.createHash("sha256");
    const addPart = (label, value) => {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
      hash.update(`${label}\0${bytes.length}\0`);
      hash.update(bytes);
      hash.update("\0");
    };
    addPart("status", status);
    addPart("staged-diff", stagedDiff);
    addPart("unstaged-diff", unstagedDiff);

    for (const rel of untrackedPaths) {
      const fullPath = path.join(repoRoot, rel);
      const stat = fs.lstatSync(fullPath);
      addPart("untracked-path", rel);
      addPart("untracked-mode", `${stat.mode}:${stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : "other"}`);
      if (stat.isSymbolicLink()) {
        addPart("untracked-target", fs.readlinkSync(fullPath));
      } else if (stat.isFile()) {
        addPart("untracked-content", fs.readFileSync(fullPath));
      }
    }

    return { head, fingerprint: hash.digest("hex"), clean: status.length === 0 };
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
  if (typeof profile !== "string" || !profile.trim()) {
    throw new Error("createRunBundleContext: profile 必须为非空字符串。");
  }
  if (!Array.isArray(suites) || suites.length === 0 || !suites.every((suite) => typeof suite === "string" && suite.trim())) {
    throw new Error("createRunBundleContext: suites 必须是至少包含一项的非空字符串数组。");
  }

  if (head !== undefined && (typeof head !== "string" || !GIT_SHA_PATTERN.test(head))) {
    throw new Error(`createRunBundleContext: 必须提供合法的 40 位 Git HEAD，收到：${head || "(空)"}。`);
  }
  if (fingerprint !== undefined && (typeof fingerprint !== "string" || !SHA256_PATTERN.test(fingerprint))) {
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
  if (!gitFingerprint || typeof gitFingerprint !== "string" || !SHA256_PATTERN.test(gitFingerprint)) {
    throw new Error(`createRunBundleContext: 必须提供合法的 64 位工作区指纹，收到：${gitFingerprint || "(空)"}。`);
  }

  const now = new Date();
  const entropy = crypto.randomBytes(4).toString("hex");
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const runId = `run-${timestamp}-${entropy}`;

  return {
    runId,
    protocolVersion: FULL_TEST_PROTOCOL_VERSION,
    createdAt: now.toISOString(),
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
 * 计算 manifest.sha256 本身的摘要，供调用方记录到证据包之外作为可信锚点。
 */
export function calculateEvidenceManifestSha256(bundleDir) {
  const manifestPath = path.join(path.resolve(bundleDir), "manifest.sha256");
  const stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("manifest.sha256 必须是普通文件，严禁目录或软链。");
  }
  return crypto.createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex");
}

const CONTEXT_KEYS = Object.freeze(["runId", "protocolVersion", "createdAt", "subject", "profile", "suites"]);
const PLAN_KEYS = Object.freeze([...CONTEXT_KEYS, "skippedSuites"]);
const SUBJECT_KEYS = Object.freeze(["head", "fingerprint", "stream", "loop"]);

function validateStringList(value, label, { nonEmpty = false, safePaths = false } = {}) {
  const errors = [];
  if (!Array.isArray(value)) {
    return [`${label} 必须为字符串数组。`];
  }
  if (nonEmpty && value.length === 0) {
    errors.push(`${label} 至少必须包含一项。`);
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !item.trim()) {
      errors.push(`${label}[${index}] 必须为非空字符串。`);
    } else if (safePaths && !isSafeRelativePath(item)) {
      errors.push(`${label}[${index}] 必须是证据包内的安全相对路径：${item}`);
    }
  }
  if (value.length !== new Set(value).size) {
    errors.push(`${label} 严禁包含重复项。`);
  }
  return errors;
}

function validateRunContext(context, label, { allowSkippedSuites = false } = {}) {
  const errors = [];
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return [`${label} 必须为对象。`];
  }

  const allowedKeys = allowSkippedSuites ? PLAN_KEYS : CONTEXT_KEYS;
  const unknownKeys = Object.keys(context).filter((key) => !allowedKeys.includes(key));
  if ("repoRoot" in context) {
    errors.push(`安全违规：${label} 严禁归档本机绝对路径 repoRoot。`);
  }
  if (unknownKeys.length > 0) {
    errors.push(`${label} 包含未允许字段：${unknownKeys.join(", ")}。`);
  }
  if (typeof context.runId !== "string" || !RUN_ID_PATTERN.test(context.runId)) {
    errors.push(`${label}.runId 必须是以 run- 开头的非空运行标识。`);
  }
  if (context.protocolVersion !== FULL_TEST_PROTOCOL_VERSION) {
    errors.push(`${label}.protocolVersion 必须为 ${FULL_TEST_PROTOCOL_VERSION}。`);
  }
  if (typeof context.createdAt !== "string" || !Number.isFinite(Date.parse(context.createdAt))) {
    errors.push(`${label}.createdAt 必须是合法的时间字符串。`);
  }
  if (typeof context.profile !== "string" || !context.profile.trim()) {
    errors.push(`${label}.profile 必须为非空字符串。`);
  }
  errors.push(...validateStringList(context.suites, `${label}.suites`, { nonEmpty: true }));

  const subject = context.subject;
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) {
    errors.push(`${label}.subject 必须为对象。`);
  } else {
    const unknownSubjectKeys = Object.keys(subject).filter((key) => !SUBJECT_KEYS.includes(key));
    if (unknownSubjectKeys.length > 0) {
      errors.push(`${label}.subject 包含未允许字段：${unknownSubjectKeys.join(", ")}。`);
    }
    if (typeof subject.head !== "string" || !GIT_SHA_PATTERN.test(subject.head)) {
      errors.push(`${label}.subject.head 必须是合法的 40 位 Git HEAD。`);
    }
    if (typeof subject.fingerprint !== "string" || !SHA256_PATTERN.test(subject.fingerprint)) {
      errors.push(`${label}.subject.fingerprint 必须是合法的 64 位工作区指纹。`);
    }
    for (const field of ["stream", "loop"]) {
      if (!(subject[field] === null || (typeof subject[field] === "string" && subject[field].trim()))) {
        errors.push(`${label}.subject.${field} 必须为 null 或非空字符串。`);
      }
    }
  }

  if (allowSkippedSuites) {
    errors.push(...validateStringList(context.skippedSuites, `${label}.skippedSuites`));
    if (Array.isArray(context.suites) && Array.isArray(context.skippedSuites)) {
      const overlap = context.suites.filter((suite) => context.skippedSuites.includes(suite));
      if (overlap.length > 0) {
        errors.push(`${label}.suites 与 skippedSuites 严禁重叠：${overlap.join(", ")}。`);
      }
    }
  }
  return errors;
}

/**
 * 校验 plan.json：它必须是 createRunBundleContext 生成的上下文加 skippedSuites。
 */
export function validateRunPlan(plan) {
  const errors = validateRunContext(plan, "plan.json", { allowSkippedSuites: true });
  return { valid: errors.length === 0, errors };
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

  if (typeof result.runId !== "string" || !RUN_ID_PATTERN.test(result.runId)) {
    errors.push("result.runId 必须是以 run- 开头的非空运行标识。");
  }

  if (!result.cleanup || typeof result.cleanup !== "object" || Array.isArray(result.cleanup)) {
    errors.push("result.json 缺少 cleanup 现场清理与平账记录。");
  } else {
    if (typeof result.cleanup.attempted !== "boolean" || typeof result.cleanup.verified !== "boolean") {
      errors.push("result.cleanup 必须包含布尔类型的 attempted 与 verified 字段。");
    }
    if (result.cleanup.attempted !== true) {
      errors.push("安全违规：teardown 必须进入 finally 路径，cleanup.attempted 必须为 true。");
    }
    if (result.cleanup.verified !== true && result.runStatus !== RUN_STATUS.ERROR) {
      errors.push("安全违规：cleanup.verified 未验证通过时，运行状态必须为 ERROR。");
    }
  }

  if (!Array.isArray(result.suiteResults)) {
    errors.push("result.suiteResults 必须为数组。");
    if (result.runStatus === RUN_STATUS.PASS) {
      errors.push("安全违规：PASS 结果至少必须包含一个已执行 suite。");
    }
  } else {
    const normalizedSuites = [];
    for (const [index, suite] of result.suiteResults.entries()) {
      try {
        normalizedSuites.push(normalizeSuiteResult(suite));
      } catch (e) {
        errors.push(`suiteResults[${index}]: ${e.message}`);
      }
    }
    const suiteIds = normalizedSuites.map((suite) => suite.id);
    if (suiteIds.length !== new Set(suiteIds).size) {
      errors.push("result.suiteResults 严禁包含重复 suite id。");
    }
    if (result.runStatus === RUN_STATUS.PASS) {
      if (normalizedSuites.length === 0) {
        errors.push("安全违规：PASS 结果至少必须包含一个已执行 suite。");
      }
      if (normalizedSuites.some((suite) => suite.status !== RUN_STATUS.PASS)) {
        errors.push("安全违规：总体 PASS 时所有 suite 状态都必须为 PASS。");
      }
    }
    if (result.runStatus === RUN_STATUS.FAIL && !normalizedSuites.some((suite) => suite.status === RUN_STATUS.FAIL)) {
      errors.push("总体 FAIL 时至少必须有一个 suite 状态为 FAIL。");
    }
  }

  errors.push(...validateRunContext(result.context, "result.context"));
  if (result.context && result.runId && result.context.runId !== result.runId) {
    errors.push("result.runId 必须与 result.context.runId 一致。");
  }

  if (result.extensionClaims !== undefined) {
    const claimValidation = validateExtensionClaims(result.extensionClaims);
    if (!claimValidation.valid) {
      errors.push(...claimValidation.errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 验证证据包目录下的 manifest.sha256 与文件完整性。
 * 包含：路径越界检查、符号链接拒绝、必需文件存在性、哈希完整性与 plan/result 契约验证。
 */
export function verifyEvidenceManifest(bundleDir, { expectedManifestSha256 } = {}) {
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
  let manifestSha256;
  try {
    manifestSha256 = calculateEvidenceManifestSha256(absDir);
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

  if (expectedManifestSha256 !== undefined) {
    if (typeof expectedManifestSha256 !== "string" || !SHA256_PATTERN.test(expectedManifestSha256)) {
      errors.push("外部 manifest SHA-256 锚点必须是 64 位十六进制字符串。");
    } else if (manifestSha256 !== expectedManifestSha256.toLowerCase()) {
      errors.push(`manifest.sha256 与外部锚点不一致：期望 ${expectedManifestSha256.toLowerCase()}，实际 ${manifestSha256}。`);
    }
  }

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
    if (expected.has(relPath)) {
      errors.push(`manifest.sha256 重复登记路径：${relPath}`);
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

  let planData;
  let resultData;

  // 深度验证 plan.json 契约
  const planJsonPath = path.join(absDir, "plan.json");
  if (fs.existsSync(planJsonPath)) {
    try {
      planData = JSON.parse(fs.readFileSync(planJsonPath, "utf8"));
      const planValidation = validateRunPlan(planData);
      if (!planValidation.valid) {
        errors.push(...planValidation.errors);
      }
    } catch (err) {
      errors.push(`plan.json 损坏：${err.message}`);
    }
  }

  // 深度验证 result.json 的契约
  const resultJsonPath = path.join(absDir, "result.json");
  if (fs.existsSync(resultJsonPath)) {
    try {
      resultData = JSON.parse(fs.readFileSync(resultJsonPath, "utf8"));
      const resultValidation = validateRunResult(resultData);
      if (!resultValidation.valid) {
        errors.push(...resultValidation.errors);
      }
    } catch (err) {
      errors.push(`result.json 损坏：${err.message}`);
    }
  }

  if (planData && resultData) {
    if (resultData.runId !== planData.runId) {
      errors.push("result.runId 与 plan.json.runId 不一致。");
    }
    for (const key of CONTEXT_KEYS) {
      if (JSON.stringify(resultData.context?.[key]) !== JSON.stringify(planData[key])) {
        errors.push(`result.context.${key} 与 plan.json.${key} 不一致。`);
      }
    }

    if (Array.isArray(resultData.suiteResults) && Array.isArray(planData.suites)) {
      const planned = new Set(planData.suites);
      const completed = new Set();
      for (const suite of resultData.suiteResults) {
        if (suite && typeof suite.id === "string") {
          completed.add(suite.id);
          if (!planned.has(suite.id)) {
            errors.push(`result.suiteResults 包含未在 plan.json 选择的 suite：${suite.id}。`);
          }
        }
      }
      if (resultData.runStatus === RUN_STATUS.PASS) {
        for (const suiteId of planned) {
          if (!completed.has(suiteId)) {
            errors.push(`总体 PASS 但缺少已计划 suite 的结果：${suiteId}。`);
          }
        }
      }
    }
  }

  if (resultData?.extensionClaims && Array.isArray(resultData.extensionClaims)) {
    for (const [claimIndex, claim] of resultData.extensionClaims.entries()) {
      if (!Array.isArray(claim?.evidenceIds)) continue;
      for (const evidenceId of claim.evidenceIds) {
        if (typeof evidenceId === "string" && isSafeRelativePath(evidenceId) && !expected.has(evidenceId)) {
          errors.push(`extensionClaims[${claimIndex}] 引用的证据未登记在清单中：${evidenceId}。`);
        }
      }
    }
  }

  if (Array.isArray(resultData?.suiteResults)) {
    for (const [suiteIndex, suite] of resultData.suiteResults.entries()) {
      if (!Array.isArray(suite?.evidenceFiles)) continue;
      for (const evidenceFile of suite.evidenceFiles) {
        if (typeof evidenceFile === "string" && isSafeRelativePath(evidenceFile) && !expected.has(evidenceFile)) {
          errors.push(`suiteResults[${suiteIndex}] 引用的证据未登记在清单中：${evidenceFile}。`);
        }
      }
    }
  }

  const verified = mismatches.length === 0 && missing.length === 0 && errors.length === 0;
  return { verified, manifestSha256, anchored: expectedManifestSha256 !== undefined, mismatches, missing, errors };
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
    } else {
      errors.push(...validateStringList(claim.evidenceIds, `extensionClaims[${index}].evidenceIds`, {
        nonEmpty: true,
        safePaths: true,
      }));
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
  if (!suite || typeof suite !== "object" || Array.isArray(suite)) {
    throw new Error("normalizeSuiteResult: suite 必须是非空对象。");
  }
  if (typeof suite.id !== "string" || !suite.id.trim()) {
    throw new Error("normalizeSuiteResult: suite.id 必须为非空字符串。");
  }
  const id = suite.id;
  const rawStatus = String(suite.status || "").toUpperCase();
  if (!ALLOWED_STATUSES.includes(rawStatus)) {
    throw new Error(`normalizeSuiteResult: 套件 "${id}" 包含非法状态 "${suite.status}"；允许：${ALLOWED_STATUSES.join(" / ")}。`);
  }

  for (const countField of ["passedCount", "failedCount"]) {
    if (suite[countField] !== undefined && (!Number.isInteger(suite[countField]) || suite[countField] < 0)) {
      throw new Error(`normalizeSuiteResult: suite "${id}" 的 ${countField} 必须为非负整数。`);
    }
  }
  if (suite.durationMs !== undefined && (!Number.isFinite(suite.durationMs) || suite.durationMs < 0)) {
    throw new Error(`normalizeSuiteResult: suite "${id}" 的 durationMs 必须为非负有限数值。`);
  }
  if (rawStatus === RUN_STATUS.PASS && (suite.failedCount ?? 0) !== 0) {
    throw new Error(`normalizeSuiteResult: suite "${id}" 状态为 PASS 时 failedCount 必须为 0。`);
  }
  if (suite.command !== undefined) {
    const commandItems = Array.isArray(suite.command) ? suite.command : [suite.command];
    if (!commandItems.every((item) => typeof item === "string" && item.trim())) {
      throw new Error(`normalizeSuiteResult: suite "${id}" 的 command 必须为非空字符串数组。`);
    }
  }
  if (suite.evidenceFiles !== undefined) {
    const evidenceErrors = validateStringList(suite.evidenceFiles, `suite "${id}".evidenceFiles`, { safePaths: true });
    if (evidenceErrors.length > 0) {
      throw new Error(evidenceErrors.join(" "));
    }
  }

  return {
    id,
    status: rawStatus,
    durationMs: suite.durationMs ?? 0,
    command: Array.isArray(suite.command) ? [...suite.command] : suite.command ? [suite.command] : [],
    passedCount: suite.passedCount ?? 0,
    failedCount: suite.failedCount ?? 0,
    evidenceFiles: Array.isArray(suite.evidenceFiles) ? [...suite.evidenceFiles] : [],
    error: suite.error ? String(suite.error) : null,
  };
}
