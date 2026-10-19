import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const CHECKBOX_INSENSITIVE = "checkbox-state-insensitive-v1";
const CHECKLIST_SECTIONS = Object.freeze([
  "发布项目与顺序",
  "SQL 脚本",
  "项目配置",
  "FilerUI 配置",
  "发布后验证与回滚",
]);

const PACKAGE_FILES = Object.freeze({
  full: Object.freeze([
    "requirements.md",
    "contracts.md",
    "dependencies.md",
    "repository/tasks.md",
    "repository/implementation.md",
    "repository/verification.md",
    "repository/review.md",
    "repository/repository-receipt.json",
  ]),
  "openspec-light": Object.freeze([
    "requirements.md",
    "dependencies.md",
    "openspec/proposal.md",
    "openspec/spec.md",
    "openspec/tasks.md",
    "repository/implementation.md",
    "repository/verification.md",
  ]),
});

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function releaseChecklistDigest(bytes) {
  const normalized = bytes.toString("utf8").replace(/^(\s*-\s*)\[[ xX]\]/gm, "$1[ ]");
  return digest(Buffer.from(normalized, "utf8"));
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  const bytes = fs.readFileSync(file);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

function git(repo, args, options = {}) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: options.buffer ? undefined : "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitExists(repo, revision) {
  try {
    git(repo, ["cat-file", "-e", `${revision}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function gitBlob(repo, revision, relativePath) {
  return git(repo, ["show", `${revision}:${relativePath.replaceAll("\\", "/")}`], { buffer: true });
}

function normalizeRemote(value) {
  return String(value ?? "").trim().replace(/\/$/, "").replace(/\.git$/i, "");
}

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function packageDigest(sourceBytes, blobs) {
  const entries = [["source.json", digest(sourceBytes)], ...blobs.map(({ name, bytes }) => [name, digest(bytes)])]
    .sort(([left], [right]) => left.localeCompare(right));
  return digest(Buffer.from(entries.map(([name, hash]) => `${name}\0${hash}\n`).join(""), "utf8"));
}

function problem(check, code, detail, severity = "content") {
  return { check, code, detail, severity };
}

function parseManifest(primaryRepoRoot, manifestPath) {
  const root = path.resolve(primaryRepoRoot);
  const file = path.resolve(root, manifestPath);
  if (!inside(root, file)) throw new Error("--manifest 必须位于主仓内部。");
  const { bytes, value } = readJson(file);
  return { root, file, relative: path.relative(root, file).replaceAll("\\", "/"), dir: path.dirname(file), bytes, value };
}

function evidenceFile(root, relativePath, label, problems, check = "S5") {
  if (!relativePath || path.isAbsolute(relativePath)) {
    problems.push(problem(check, "invalid-evidence-path", `${label} 必须是主仓内相对路径。`));
    return null;
  }
  const file = path.resolve(root, relativePath);
  if (!inside(root, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    problems.push(problem(check, "missing-evidence", `${label} 不存在：${relativePath}`));
    return null;
  }
  return { path: relativePath.replaceAll("\\", "/"), sha256: digest(fs.readFileSync(file)) };
}

function receiptEvidence(evidence, parsed) {
  const absolute = path.resolve(parsed.root, evidence.path);
  return {
    path: path.relative(parsed.dir, absolute).replaceAll("\\", "/"),
    sha256: evidence.sha256,
    ...(evidence.hashMode ? { hashMode: evidence.hashMode } : {}),
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionBody(markdown, title) {
  const match = new RegExp(`^##\\s+${escapeRegExp(title)}\\s*$`, "m").exec(markdown);
  if (!match) return null;
  const rest = markdown.slice(match.index + match[0].length);
  const next = /^##\s+/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function validateReleaseChecklist(bytes, manifest, problems) {
  const markdown = bytes.toString("utf8").replace(/<!--[\s\S]*?-->/g, "");
  const demandId = String(manifest.demandId ?? "").trim();
  if (!new RegExp(`^-\\s*demandId:\\s*\`${escapeRegExp(demandId)}\`\\s*$`, "m").test(markdown)) {
    problems.push(problem("S5", "release-checklist-demand", "release-checklist.md 的 demandId 与 repositories.json 不匹配。"));
  }
  if (!/^-\s*清单状态:\s*`ready`\s*$/m.test(markdown)) {
    problems.push(problem("S5", "release-checklist-document-state", "release-checklist.md 的清单状态必须为 ready。"));
  }
  const unresolved = markdown.match(/<[^>\r\n]+>|\b(?:TBD|TODO)\b|待确认|待补充|待定/iu);
  if (unresolved) {
    problems.push(problem("S5", "release-checklist-placeholder", `release-checklist.md 仍含待定项或占位符：${unresolved[0]}`));
  }

  for (const title of CHECKLIST_SECTIONS) {
    const body = sectionBody(markdown, title);
    if (body === null) {
      problems.push(problem("S5", "release-checklist-section", `release-checklist.md 缺少“${title}”章节。`));
      continue;
    }
    const items = [...body.matchAll(/^\s*-\s+\[[ xX]\]\s+(.+)$/gm)].map((entry) => entry[1].trim());
    if (!items.length) {
      problems.push(problem("S5", "release-checklist-items", `release-checklist.md 的“${title}”没有可勾选执行项。`));
      continue;
    }
    if (["SQL 脚本", "项目配置", "FilerUI 配置"].includes(title)) {
      for (const item of items.filter((value) => /\bN\/A\b/i.test(value))) {
        if (!/N\/A\s*[—-]\s*原因[:：]\s*\S/i.test(item)) {
          problems.push(problem("S5", "release-checklist-na-reason", `release-checklist.md 的“${title}”使用 N/A 时必须写具体原因。`));
        }
      }
    }
  }

  const releaseBody = sectionBody(markdown, "发布项目与顺序") ?? "";
  for (const participant of manifest.participants ?? []) {
    const id = String(participant?.repositoryId ?? "").trim();
    if (id && !releaseBody.includes(`\`${id}\``)) {
      problems.push(problem("S5", "release-checklist-participant", `release-checklist.md 的发布顺序缺少 participant：${id}。`));
    }
  }
}

/**
 * Solo 的唯一机器判定源。它只核对可验证事实，不判断实现、验证或 Review 的语义质量。
 */
export function buildSoloCheckReport({ primaryRepoRoot, manifestPath, participantRepos = new Map() }) {
  let parsed;
  try {
    parsed = parseManifest(primaryRepoRoot, manifestPath);
  } catch (error) {
    return {
      readable: false,
      ok: false,
      severity: "unusable",
      problems: [problem("S1", "manifest-unreadable", error.message, "unusable")],
      checks: [],
    };
  }

  const manifest = parsed.value;
  const problems = [];
  const checks = [];
  const participants = Array.isArray(manifest.participants) ? manifest.participants : [];
  const mode = manifest.deliveryMode;

  if (manifest.schemaVersion !== 1) problems.push(problem("S1", "schema-version", "repositories.json.schemaVersion 必须为 1。"));
  if (manifest.protocol !== "sdd-solo@1") problems.push(problem("S1", "protocol", "repositories.json.protocol 必须为 sdd-solo@1。"));
  if (!String(manifest.demandId ?? "").trim()) problems.push(problem("S1", "demand-id", "repositories.json 缺少 demandId。"));
  if (!PACKAGE_FILES[mode]) problems.push(problem("S1", "delivery-mode", "deliveryMode 必须是 full 或 openspec-light。"));
  if (!String(manifest.primaryRepository ?? "").trim()) problems.push(problem("S1", "primary-repository", "缺少 primaryRepository。"));
  if (!COMMIT.test(String(manifest.requirementsVersion?.commit ?? ""))) problems.push(problem("S1", "requirements-commit", "requirementsVersion.commit 必须是 40 位 commit。"));
  if (!SHA256.test(String(manifest.requirementsVersion?.sha256 ?? ""))) problems.push(problem("S1", "requirements-hash", "requirementsVersion.sha256 格式无效。"));
  checks.push({ id: "S1", title: "参与清单可判定", ok: !problems.some((item) => item.check === "S1") });

  const ids = participants.map((entry) => entry?.repositoryId).filter(Boolean);
  if (!participants.length) problems.push(problem("S2", "no-participants", "participants 不能为空。"));
  if (new Set(ids).size !== ids.length) problems.push(problem("S2", "duplicate-participant", "repositoryId 必须在本需求内唯一。"));
  const primary = participants.filter((entry) => entry?.repositoryId === manifest.primaryRepository && entry?.role === "primary");
  if (primary.length !== 1) problems.push(problem("S2", "primary-count", "必须且只能有一个与 primaryRepository 匹配的 primary participant。"));
  for (const participant of participants) {
    const id = participant?.repositoryId || "(unknown)";
    if (!String(participant?.remote ?? "").trim()) problems.push(problem("S2", "remote", `${id} 缺少规范 remote。`));
    if (!COMMIT.test(String(participant?.baseline?.commit ?? ""))) problems.push(problem("S2", "baseline", `${id} 的 baseline.commit 必须是 40 位 commit。`));
    if (!String(participant?.baseline?.branch ?? "").trim()) problems.push(problem("S2", "baseline-branch", `${id} 缺少 baseline.branch。`));
    if (!String(participant?.workingBranch?.actual ?? "").trim()) problems.push(problem("S2", "working-branch", `${id} 缺少 workingBranch.actual。`));
    if (id === manifest.primaryRepository) {
      if (participant?.traceExport?.required !== false || participant?.traceExport?.state !== "not-required") {
        problems.push(problem("S2", "primary-trace-state", `${id} 是主仓，traceExport 必须为 required=false、state=not-required。`));
      }
    } else if (participant?.traceExport?.required !== true) {
      problems.push(problem("S2", "participant-trace-required", `${id} 是参与仓，traceExport.required 必须为 true。`));
    }
    const repo = id === manifest.primaryRepository ? parsed.root : participantRepos.get(id);
    if (!repo) {
      problems.push(problem("S2", "participant-binding", `${id} 缺少本次运行的 --participant ${id}=<path> 绑定。`, "unusable"));
    } else if (!gitExists(repo, participant?.baseline?.commit)) {
      problems.push(problem("S2", "baseline-unavailable", `${id} 本地仓库无法解析基线 commit ${participant?.baseline?.commit}。`, "unusable"));
    }
  }
  checks.push({ id: "S2", title: "参与仓身份、基线和运行时绑定可验证", ok: !problems.some((item) => item.check === "S2") });

  const primaryEvidence = [{ path: parsed.relative, sha256: digest(parsed.bytes) }];
  if (mode === "full") {
    for (const participant of participants) {
      const id = participant?.repositoryId || "(unknown)";
      const relative = participant?.repositoryUnitPath || `repositories/${id}/repository-receipt.json`;
      const evidence = evidenceFile(parsed.root, path.relative(parsed.root, path.resolve(parsed.dir, relative)), `${id} readiness receipt`, problems, "S3");
      if (!evidence) continue;
      primaryEvidence.push(evidence);
      try {
        const receipt = JSON.parse(fs.readFileSync(path.resolve(parsed.root, evidence.path), "utf8"));
        if (receipt.demandId !== manifest.demandId || receipt.repositoryId !== id) {
          problems.push(problem("S3", "receipt-identity", `${id} readiness receipt 的需求或仓库身份不匹配。`));
        }
        if (receipt.ready !== true || receipt.verification?.outcome !== "PASS" || receipt.review?.outcome !== "READY_FOR_HUMAN_REVIEW") {
          problems.push(problem("S3", "receipt-not-ready", `${id} readiness receipt 尚未达到 ready/PASS/READY_FOR_HUMAN_REVIEW。`));
        }
      } catch (error) {
        problems.push(problem("S3", "receipt-unreadable", `${id} readiness receipt 无法解析：${error.message}`));
      }
    }
  }
  checks.push({ id: "S3", title: mode === "full" ? "每仓 readiness receipt 已就绪" : "轻量模式不要求 readiness receipt", ok: !problems.some((item) => item.check === "S3") });

  for (const participant of participants.filter((entry) => entry?.repositoryId !== manifest.primaryRepository)) {
    const id = participant.repositoryId;
    const trace = participant.traceExport;
    const repo = participantRepos.get(id);
    if (!trace || trace.required !== true || trace.state !== "verified") {
      problems.push(problem("S4", "trace-state", `${id} 的 traceExport 必须为 required=true、state=verified。`));
      continue;
    }
    if (!repo) continue;
    if (!COMMIT.test(String(trace.sourceCommit ?? "")) || trace.sourceCommit !== manifest.requirementsVersion?.commit) {
      problems.push(problem("S4", "source-commit", `${id} 的 traceExport.sourceCommit 必须等于 requirementsVersion.commit。`));
    }
    if (!COMMIT.test(String(trace.participantCommit ?? "")) || !gitExists(repo, trace.participantCommit)) {
      problems.push(problem("S4", "participant-commit", `${id} 的追溯包 commit 不存在或格式无效。`));
      continue;
    }
    if (!SHA256.test(String(trace.packageSha256 ?? ""))) {
      problems.push(problem("S4", "package-hash", `${id} 的 traceExport.packageSha256 格式无效。`));
    }
    const packagePath = String(trace.packagePath ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (!packagePath || packagePath.includes("..")) {
      problems.push(problem("S4", "package-path", `${id} 的 packagePath 必须是仓库内相对路径。`));
      continue;
    }
    try {
      const sourceBytes = gitBlob(repo, trace.participantCommit, `${packagePath}/source.json`);
      const source = JSON.parse(sourceBytes.toString("utf8"));
      if (source.schemaVersion !== 1 || source.protocol !== "sdd-solo@1" || source.demandId !== manifest.demandId) {
        problems.push(problem("S4", "source-identity", `${id} 的 source.json 协议或需求身份不匹配。`));
      }
      if (source.deliveryMode !== mode || source.repository?.repositoryId !== id) {
        problems.push(problem("S4", "source-repository", `${id} 的 source.json 模式或仓库身份不匹配。`));
      }
      if (normalizeRemote(source.repository?.remote) !== normalizeRemote(participant.remote)) {
        problems.push(problem("S4", "source-remote", `${id} 的 source.json remote 与清单不匹配。`));
      }
      if (source.authority?.commit !== trace.sourceCommit || normalizeRemote(source.authority?.remote) !== normalizeRemote(primary[0]?.remote)) {
        problems.push(problem("S4", "source-authority", `${id} 的 source.json 权威来源与清单不匹配。`));
      }
      if (source.authority?.requirementsSha256 !== manifest.requirementsVersion?.sha256) {
        problems.push(problem("S4", "requirements-version", `${id} 的需求快照 hash 与主清单不匹配。`));
      }
      const expected = PACKAGE_FILES[mode] ?? [];
      const actual = Object.keys(source.files ?? {}).sort();
      if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
        problems.push(problem("S4", "file-set", `${id} 的追溯包文件集合不符合 ${mode} 协议。`));
      }
      const blobs = [];
      for (const name of expected) {
        const bytes = gitBlob(repo, trace.participantCommit, `${packagePath}/${name}`);
        blobs.push({ name, bytes });
        if (source.files?.[name] !== digest(bytes)) problems.push(problem("S4", "file-hash", `${id} 的 ${name} hash 不匹配。`));
      }
      const requirements = blobs.find((entry) => entry.name === "requirements.md");
      if (requirements && digest(requirements.bytes) !== manifest.requirementsVersion?.sha256) {
        problems.push(problem("S4", "requirements-snapshot", `${id} 的 requirements.md 不是清单固定的需求版本。`));
      }
      if (packageDigest(sourceBytes, blobs) !== trace.packageSha256) {
        problems.push(problem("S4", "package-digest", `${id} 的追溯包整体 hash 不匹配。`));
      }
    } catch (error) {
      problems.push(problem("S4", "package-unreadable", `${id} 无法从 commit 读取完整追溯包：${error.message}`));
    }
  }
  checks.push({ id: "S4", title: "所有参与仓追溯包已提交并逐文件校验", ok: !problems.some((item) => item.check === "S4") });

  const checklist = manifest.releaseChecklist;
  if (!checklist || checklist.state !== "ready" || !String(checklist.path ?? "").trim()) {
    problems.push(problem("S5", "release-checklist-state", "releaseChecklist 必须为 state=ready 并声明 path。"));
  } else if (path.isAbsolute(checklist.path)) {
    problems.push(problem("S5", "release-checklist-path", "releaseChecklist.path 必须是相对 repositories.json 的路径。"));
  } else {
    const checklistFile = path.resolve(parsed.dir, checklist.path);
    if (!inside(parsed.dir, checklistFile) || !fs.existsSync(checklistFile) || !fs.statSync(checklistFile).isFile()) {
      problems.push(problem("S5", "release-checklist-missing", `上线执行清单不存在或不在 manifest 目录内：${checklist.path}`));
    } else {
      const bytes = fs.readFileSync(checklistFile);
      const sha256 = releaseChecklistDigest(bytes);
      if (!SHA256.test(String(checklist.sha256 ?? "")) || checklist.sha256 !== sha256) {
        problems.push(problem("S5", "release-checklist-hash", "releaseChecklist.sha256 与当前清单的规范化 hash 不一致。"));
      }
      if (!String(checklist.preparedAt ?? "").trim() || Number.isNaN(Date.parse(checklist.preparedAt))) {
        problems.push(problem("S5", "release-checklist-time", "releaseChecklist.preparedAt 必须是可解析的时间。"));
      }
      validateReleaseChecklist(bytes, manifest, problems);
      const checklistEvidence = {
        path: path.relative(parsed.root, checklistFile).replaceAll("\\", "/"),
        sha256,
        hashMode: CHECKBOX_INSENSITIVE,
      };
      primaryEvidence.push(checklistEvidence);
    }
  }

  const closure = manifest.closure;
  if (!closure || closure.state !== "ready" || !String(closure.receiptPath ?? "").trim()) {
    problems.push(problem("S5", "closure-state", "closure 必须为 state=ready 并声明 receiptPath。"));
  }
  if (mode === "full") {
    if (closure?.aggregateReview?.outcome !== "READY_FOR_HUMAN_REVIEW") {
      problems.push(problem("S5", "aggregate-review", "full 必须有 READY_FOR_HUMAN_REVIEW 的跨仓聚合审查。"));
    }
    const evidence = evidenceFile(parsed.root, closure?.aggregateReview?.evidencePath, "跨仓聚合审查证据", problems, "S5");
    if (evidence) primaryEvidence.push(evidence);
  } else if (closure?.aggregateReview?.outcome !== "NOT_REQUIRED") {
    problems.push(problem("S5", "light-aggregate-review", "openspec-light 的 aggregateReview.outcome 必须为 NOT_REQUIRED。"));
  }
  checks.push({ id: "S5", title: "上线清单、聚合收口状态与主仓证据完整", ok: !problems.some((item) => item.check === "S5") });

  const severity = problems.some((item) => item.severity === "unusable") ? "unusable" : problems.length ? "content" : "ok";
  return {
    readable: true,
    ok: problems.length === 0,
    severity,
    protocol: "sdd-solo@1",
    repoRoot: parsed.root,
    manifestPath: parsed.relative,
    demandId: manifest.demandId ?? null,
    deliveryMode: mode ?? null,
    checks,
    problems,
    receipt: problems.length ? null : {
      schemaVersion: 1,
      protocol: "sdd-solo@1",
      demandId: manifest.demandId,
      deliveryMode: mode,
      state: "verified",
      manifestPath: parsed.relative,
      manifestSha256: digest(parsed.bytes),
      authorityCommit: manifest.requirementsVersion.commit,
      participants: participants.filter((entry) => entry.repositoryId !== manifest.primaryRepository).map((entry) => ({
        repositoryId: entry.repositoryId,
        sourceCommit: entry.traceExport.sourceCommit,
        participantCommit: entry.traceExport.participantCommit,
        packagePath: entry.traceExport.packagePath,
        packageSha256: entry.traceExport.packageSha256,
      })),
      // Paths in the receipt are relative to the manifest directory. A full demand
      // directory may move from docs/loops to docs/archive during close; keeping
      // evidence local to that directory makes the receipt survive that move.
      primaryEvidence: primaryEvidence
        .map((entry) => receiptEvidence(entry, parsed))
        .sort((left, right) => left.path.localeCompare(right.path)),
      verifiedAt: new Date().toISOString(),
    },
  };
}

export function writeSoloClosureReceipt(report) {
  if (!report?.ok || !report.receipt) throw new Error("Solo check 未通过，不能写收口凭据。");
  const manifestFile = path.resolve(report.repoRoot, report.manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const relative = manifest.closure?.receiptPath;
  if (!relative || path.isAbsolute(relative)) throw new Error("closure.receiptPath 必须是相对 manifest 目录的路径。");
  const output = path.resolve(path.dirname(manifestFile), relative);
  if (!inside(report.repoRoot, output)) throw new Error("closure.receiptPath 必须位于主仓内部。");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temp = `${output}.sdd-loop-${process.pid}.tmp`;
  fs.writeFileSync(temp, jsonBytes(report.receipt));
  fs.renameSync(temp, output);
  return output;
}

/** 在 full Loop 归档关闭时，只验证已经生成的主仓凭据及其固定证据未漂移。 */
export function validateSoloClosureReceipt(loopDir) {
  const manifestFile = path.join(loopDir, "repositories.json");
  if (!fs.existsSync(manifestFile)) return { applicable: false, ok: true };
  const { bytes: manifestBytes, value: manifest } = readJson(manifestFile);
  if (manifest.deliveryMode !== "full") return { applicable: false, ok: true };
  const relative = manifest.closure?.receiptPath;
  if (!relative || path.isAbsolute(relative)) throw new Error("Solo full 缺少合法的 closure.receiptPath。");
  const receiptFile = path.resolve(loopDir, relative);
  if (!inside(loopDir, receiptFile) || !fs.existsSync(receiptFile)) throw new Error("Solo full 缺少机器生成的收口凭据。");
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  if (receipt.schemaVersion !== 1 || receipt.protocol !== "sdd-solo@1" || receipt.state !== "verified"
    || receipt.demandId !== manifest.demandId || receipt.deliveryMode !== "full") {
    throw new Error("Solo 收口凭据的版本、协议、状态、demandId 或交付模式不匹配。");
  }
  if (receipt.authorityCommit !== manifest.requirementsVersion?.commit) {
    throw new Error("Solo 收口凭据的权威需求 commit 与参与清单不匹配。");
  }
  if (receipt.manifestSha256 !== digest(manifestBytes)) throw new Error("Solo 清单在追溯校验后发生变化，旧收口凭据失效。");

  const checklist = manifest.releaseChecklist;
  if (!checklist || checklist.state !== "ready" || !checklist.path || path.isAbsolute(checklist.path)) {
    throw new Error("Solo full 缺少合法且已就绪的上线执行清单声明。");
  }
  const checklistFile = path.resolve(loopDir, checklist.path);
  if (!inside(loopDir, checklistFile) || !fs.existsSync(checklistFile)) {
    throw new Error("Solo full 缺少上线执行清单文件。");
  }
  const checklistSha256 = releaseChecklistDigest(fs.readFileSync(checklistFile));
  if (checklist.sha256 !== checklistSha256) throw new Error("Solo 上线执行清单内容与参与清单不匹配。");

  const expectedParticipants = (manifest.participants ?? [])
    .filter((entry) => entry?.repositoryId !== manifest.primaryRepository)
    .map((entry) => ({
      repositoryId: entry.repositoryId,
      sourceCommit: entry.traceExport?.sourceCommit,
      participantCommit: entry.traceExport?.participantCommit,
      packagePath: entry.traceExport?.packagePath,
      packageSha256: entry.traceExport?.packageSha256,
    }))
    .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId));
  const actualParticipants = Array.isArray(receipt.participants)
    ? receipt.participants.map((entry) => ({
      repositoryId: entry?.repositoryId,
      sourceCommit: entry?.sourceCommit,
      participantCommit: entry?.participantCommit,
      packagePath: entry?.packagePath,
      packageSha256: entry?.packageSha256,
    })).sort((left, right) => String(left.repositoryId).localeCompare(String(right.repositoryId)))
    : null;
  if (!actualParticipants || JSON.stringify(actualParticipants) !== JSON.stringify(expectedParticipants)) {
    throw new Error("Solo 收口凭据的参与仓追溯事实与参与清单不匹配。");
  }

  if (!Array.isArray(receipt.primaryEvidence) || receipt.primaryEvidence.length === 0) {
    throw new Error("Solo 收口凭据缺少主仓固定证据。");
  }
  let includesManifest = false;
  let includesChecklist = false;
  for (const evidence of receipt.primaryEvidence) {
    if (!evidence?.path || path.isAbsolute(evidence.path) || !SHA256.test(String(evidence.sha256 ?? ""))) {
      throw new Error("Solo 收口凭据包含非法证据路径或 hash。");
    }
    const normalizedPath = evidence.path.replaceAll("\\", "/").replace(/^\.\//, "");
    if (normalizedPath === "repositories.json" && evidence.sha256 === receipt.manifestSha256) includesManifest = true;
    const file = path.resolve(loopDir, evidence.path);
    if (!inside(loopDir, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`Solo 主仓证据在追溯校验后发生变化：${evidence.path}`);
    }
    if (evidence.hashMode && evidence.hashMode !== CHECKBOX_INSENSITIVE) {
      throw new Error(`Solo 收口凭据包含未知的证据 hash 模式：${evidence.hashMode}`);
    }
    const actualDigest = evidence.hashMode === CHECKBOX_INSENSITIVE
      ? releaseChecklistDigest(fs.readFileSync(file))
      : digest(fs.readFileSync(file));
    if (normalizedPath === checklist.path.replaceAll("\\", "/")
      && evidence.hashMode === CHECKBOX_INSENSITIVE && evidence.sha256 === checklistSha256) includesChecklist = true;
    if (actualDigest !== evidence.sha256) {
      throw new Error(`Solo 主仓证据在追溯校验后发生变化：${evidence.path}`);
    }
  }
  if (!includesManifest) throw new Error("Solo 收口凭据没有固定 repositories.json。");
  if (!includesChecklist) throw new Error("Solo 收口凭据没有固定上线执行清单。");
  return { applicable: true, ok: true, receiptFile };
}

export { PACKAGE_FILES, packageDigest, releaseChecklistDigest };
