import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  BUILTIN_EXTENSIONS,
  GOVERNANCE_ROLES,
  GOVERNANCE_VERSION,
  REVIEW_OUTCOMES,
  fingerprintRepo,
  governanceRoleField,
  readAuditPath,
  splitList,
  validateEventAuthorization,
} from "../governance/protocol.js";
import { HOTFIX_FILE_PATTERN, hotfixAuditDir, scanHotfixes } from "../hotfix/layout.js";

const STATES = new Set(["implementation", "ready-for-human-review", "review-blocked", "human-approved", "closed"]);
const STATUSES = new Set(["draft", "confirmed", "archived"]);
const ROUTES = new Set(["current-subagent", "external-agent"]);
const REQUIRED_FIELDS = [
  "document", "hotfixId", "status", "hotfixState", "baseBranch", "baseCommit",
  "fixFingerprint", "architectureImpact", "openedAt", "updatedAt",
];
const REQUIRED_SECTIONS = [
  "问题、影响与复现", "修复范围与非目标", "风险提示及用户确认", "实施摘要与回滚方法",
  "Testing/PBT/Security/Resiliency 证据", "Architecture Impact", "AI Review", "Human Sign-off",
];
const DEBUG_REQUIRED_FIELDS = ["route", "acceptanceMode", "reviewStatus"];
const DEBUG_REQUIRED_SECTIONS = [
  "问题与手测过程", "修复摘要与回滚方法", "最终测试、部署与人工验收", "Architecture Impact", "Review Waiver",
];

function check(id, title, severity = "problem") {
  return { id, title, severity, ok: true, findings: [] };
}

function fail(entry, detail, extra = {}) {
  entry.ok = false;
  entry.findings.push({ detail, ...extra });
}

function latest(events, type) {
  return events.filter((event) => event.type === type).at(-1) ?? null;
}

function codeFingerprint(repoRoot, convention) {
  return fingerprintRepo(repoRoot, {
    statusRel: convention.statusFile,
    excludePrefixes: [path.dirname(convention.statusFile), convention.archiveDir],
  });
}

function eventBelongs(event, hotfixId) {
  return event.context?.hotfix === hotfixId;
}

function sectionContent(body, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(body).match(new RegExp(`^##\\s+(?:\\d+\\.\\s+)?${escaped}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "m"));
  return match?.[1]?.trim() ?? "";
}

function commitExists(repoRoot, revision) {
  try {
    execFileSync("git", ["-C", repoRoot, "rev-parse", "--verify", `${revision}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function buildHotfixChecks(scan) {
  const hotfixes = scanHotfixes(scan.repoRoot, scan.convention);
  if (!hotfixes.files.length && !hotfixes.issues.length) return { checks: [], files: [], unusable: false };

  const h1 = check("H1", "Hotfix 文件、ID、流归属与审计可读", "unusable");
  const h2 = check("H2", "用户授权、项目角色与审查策略完整");
  const h3 = check("H3", "修复、回滚、验证与架构证据对应当前指纹");
  const h4 = check("H4", "AI Review 或 Debug 豁免与人工验收对应当前指纹");
  const h5 = check("H5", "Hotfix 活跃/归档状态完整且不影响普通 Loop");
  let unusable = false;

  for (const issue of hotfixes.issues) {
    unusable = true;
    fail(h1, `${issue.file} 不是可读的仓库内普通目录。`, issue);
  }

  const byId = new Map();
  const current = codeFingerprint(scan.repoRoot, scan.convention);
  if (String(scan.status.meta.governanceVersion ?? "") !== GOVERNANCE_VERSION) {
    fail(h2, `Hotfix 要求 status.md 启用 governanceVersion: ${GOVERNANCE_VERSION}。`, { file: scan.status.path });
  }
  for (const role of GOVERNANCE_ROLES) {
    const field = governanceRoleField(role);
    if (!splitList(scan.status.meta[field]).length) fail(h2, `Hotfix 缺少项目角色映射 ${field}。`, { file: scan.status.path });
  }
  for (const file of hotfixes.files) {
    if (!file.ok) {
      unusable = true;
      for (const issue of file.issues) {
        fail(h1, `${file.path}${issue.line ? `:${issue.line}` : ""} ${issue.detail || "读不出来或不是普通文件。"}`, {
          file: file.path, line: issue.line, kind: issue.kind,
        });
      }
      continue;
    }
    const meta = file.meta;
    const debugRoute = meta.route === "debug";
    if (String(meta.route ?? "").trim() && !debugRoute) {
      fail(h1, `${file.path} 的 route 不受支持：${meta.route}。`, { file: file.path });
    }
    for (const field of [...REQUIRED_FIELDS, ...(debugRoute ? DEBUG_REQUIRED_FIELDS : ["reviewRoute"])]) {
      if (!String(meta[field] ?? "").trim()) fail(h1, `${file.path} 缺少 ${field}。`, { file: file.path, field });
    }
    const match = file.name.match(HOTFIX_FILE_PATTERN);
    const expectedId = match ? `HF-${match[1]}-${match[2]}` : null;
    if (!expectedId) fail(h1, `${file.path} 文件名必须是 hotfix-YYYYMMDD-NN.md。`, { file: file.path });
    if (expectedId && meta.hotfixId !== expectedId) fail(h1, `${file.path} 的 hotfixId 应为 ${expectedId}。`, { file: file.path });
    if (meta.document !== "hotfix") fail(h1, `${file.path} 的 document 必须是 hotfix。`, { file: file.path });
    if (!STATUSES.has(meta.status)) fail(h1, `${file.path} 的 status 不合法：${meta.status || "(空)"}。`, { file: file.path });
    if (!STATES.has(meta.hotfixState)) fail(h1, `${file.path} 的 hotfixState 不合法：${meta.hotfixState || "(空)"}。`, { file: file.path });
    if (debugRoute) {
      if (meta.acceptanceMode !== "manual-test") fail(h2, `${file.path} 的 Debug 路由必须使用 acceptanceMode: manual-test。`, { file: file.path });
      if (meta.reviewStatus !== "waived") fail(h4, `${file.path} 的 Debug 路由必须明确 reviewStatus: waived。`, { file: file.path });
      if (String(meta.reviewRoute ?? "").trim()) fail(h2, `${file.path} 的 Debug 路由不得伪造 reviewer 路径。`, { file: file.path });
    } else if (!ROUTES.has(meta.reviewRoute)) {
      fail(h2, `${file.path} 必须选择 current-subagent 或 external-agent reviewer 路径。`, { file: file.path });
    }
    if (!["none", "updated"].includes(meta.architectureImpact)) fail(h3, `${file.path} 的 architectureImpact 必须是 none 或 updated。`, { file: file.path });
    if (meta.baseCommit && !commitExists(scan.repoRoot, meta.baseCommit)) fail(h2, `${file.path} 的 baseCommit 不是可解析的 Git commit：${meta.baseCommit}。`, { file: file.path });
    const openedAt = Date.parse(meta.openedAt);
    const updatedAt = Date.parse(meta.updatedAt);
    if (!Number.isFinite(openedAt) || !Number.isFinite(updatedAt) || updatedAt < openedAt) {
      fail(h1, `${file.path} 的 openedAt/updatedAt 必须是有序的 ISO-8601 时间。`, { file: file.path });
    }
    for (const section of debugRoute ? DEBUG_REQUIRED_SECTIONS : REQUIRED_SECTIONS) {
      if (!file.body.includes(section)) fail(h1, `${file.path} 缺少固定章节「${section}」。`, { file: file.path });
    }
    const bucket = byId.get(meta.hotfixId) ?? [];
    bucket.push(file.path);
    byId.set(meta.hotfixId, bucket);

    const auditDir = path.join(scan.repoRoot, hotfixAuditDir(file));
    const audit = readAuditPath(auditDir);
    if (!audit.exists) fail(h1, `${hotfixAuditDir(file)} 审计目录不存在。`, { file: hotfixAuditDir(file) });
    for (const issue of audit.issues) {
      if (["unreadable-audit-dir", "unreadable-audit-file", "unsafe-audit-dir", "unsafe-audit-file", "invalid-audit-json", "invalid-audit-event"].includes(issue.kind)) {
        unusable = true;
      }
      fail(h1, `${path.relative(scan.repoRoot, issue.file)}${issue.line ? `:${issue.line}` : ""} 审计不可读、哈希失效或路径不安全。`, issue);
    }
    const events = audit.events.filter((event) => eventBelongs(event, meta.hotfixId));
    for (const event of audit.events) {
      if (!eventBelongs(event, meta.hotfixId)) fail(h1, `${path.relative(scan.repoRoot, event._file)}:${event._line} 绑定了错误的 Hotfix。`, { file: event._file, line: event._line });
      if (!validateEventAuthorization(scan.status.meta, event)) fail(h2, `${path.relative(scan.repoRoot, event._file)}:${event._line} 的角色、Git 身份或事件授权不匹配。`, { file: event._file, line: event._line });
    }

    const expectedFingerprint = file.location === "active" ? current : meta.fixFingerprint;
    if (debugRoute) {
      const debugClosedEvents = events.filter((event) => event.type === "debug_closed");
      const debugClosed = debugClosedEvents.at(-1);
      if (debugClosedEvents.length !== 1) fail(h2, `${meta.hotfixId} 必须恰好有一次 debug_closed，当前 ${debugClosedEvents.length} 次。`, { file: file.path });
      if (events.some((event) => event.type !== "debug_closed")) {
        fail(h4, `${meta.hotfixId} 的 Debug 路由只能包含 debug_closed，不得混入标准 Hotfix 或 Loop 事件。`, { file: file.path });
      }
      if (!debugClosed || debugClosed.codeFingerprint !== expectedFingerprint) {
        fail(h4, `${meta.hotfixId} 缺少当前指纹的 debug_closed 人工验收。`, { file: file.path });
      }
      if (!String(debugClosed?.payload?.input ?? "").trim() || !String(debugClosed?.payload?.evidence ?? "").trim()) {
        fail(h3, `${meta.hotfixId} 的 debug_closed 缺少用户收口原文或最终证据。`, { file: file.path });
      }
      if (!/回滚/.test(sectionContent(file.body, "修复摘要与回滚方法"))) fail(h3, `${meta.hotfixId} 缺少明确回滚方法。`, { file: file.path });
      if (!sectionContent(file.body, "最终测试、部署与人工验收")) fail(h3, `${meta.hotfixId} 缺少最终测试、部署与人工验收事实。`, { file: file.path });
    } else {
      const authorizations = events.filter((event) => event.type === "hotfix_authorized");
      const authorized = authorizations.at(-1);
      if (authorizations.length !== 1) fail(h2, `${meta.hotfixId} 必须恰好有一次 hotfix_authorized，当前 ${authorizations.length} 次。`, { file: file.path });
      if (authorized?.payload?.reviewRoute !== meta.reviewRoute) fail(h2, `${meta.hotfixId} 的 reviewer 路径与启动授权不一致。`, { file: file.path });
      const authorizedBranch = String(authorized?.context?.branch ?? "");
      const baseBranch = String(meta.baseBranch ?? "").replace(/^refs\/(?:heads|remotes)\//, "").replace(/^origin\//, "");
      if (!authorizedBranch || authorizedBranch === "DETACHED" || authorizedBranch === baseBranch || authorizedBranch === baseBranch.split("/").at(-1)) {
        fail(h2, `${meta.hotfixId} 没有在区别于 baseBranch 的独立分支或 worktree 上启动。`, { file: file.path });
      }
      if (!latest(events, "implementation_completed")) fail(h3, `${meta.hotfixId} 缺少 implementation_completed。`, { file: file.path });
      if (!/回滚/.test(sectionContent(file.body, "实施摘要与回滚方法"))) fail(h3, `${meta.hotfixId} 缺少明确回滚方法。`, { file: file.path });
      for (const extension of BUILTIN_EXTENSIONS) {
        const evaluation = events.filter((event) => event.type === "extension_evaluated" && event.payload?.extension === extension).at(-1);
        if (!evaluation) {
          fail(h3, `${meta.hotfixId} 的 ${extension} 缺少证据。`, { file: file.path, extension });
          continue;
        }
        if (evaluation.codeFingerprint !== expectedFingerprint) fail(h3, `${meta.hotfixId} 的 ${extension} 证据不对应当前修复指纹。`, { extension });
        const outcome = evaluation.payload?.outcome;
        if (extension === "testing" && outcome !== "PASS") fail(h3, `${meta.hotfixId} 的 Testing 必须 PASS。`, { extension });
        if (extension !== "testing" && !["PASS", "N/A"].includes(outcome)) fail(h3, `${meta.hotfixId} 的 ${extension} 必须 PASS 或给出 N/A。`, { extension });
        if (outcome === "N/A" && !String(evaluation.payload?.reason ?? "").trim()) fail(h3, `${meta.hotfixId} 的 ${extension} N/A 缺少理由。`, { extension });
      }
      if (meta.architectureImpact === "updated") {
        const reconciled = latest(events, "architecture_reconciled");
        if (!reconciled || reconciled.codeFingerprint !== expectedFingerprint) fail(h3, `${meta.hotfixId} 声明 architectureImpact: updated，但缺少当前指纹的 architecture_reconciled。`, { file: file.path });
      }

      const review = latest(events, "review_completed");
      if (["ready-for-human-review", "human-approved", "closed"].includes(meta.hotfixState)) {
        if (!review || review.payload?.outcome !== "READY_FOR_HUMAN_REVIEW" || review.codeFingerprint !== expectedFingerprint) {
          fail(h4, `${meta.hotfixId} 缺少当前指纹的 READY_FOR_HUMAN_REVIEW。`, { file: file.path });
        }
        if (review?.payload?.reviewRoute !== meta.reviewRoute) fail(h4, `${meta.hotfixId} 的 AI Review 路径与启动选择不一致。`, { file: file.path });
      }
      if (meta.hotfixState === "review-blocked" && review && !REVIEW_OUTCOMES.includes(review.payload?.outcome)) {
        fail(h4, `${meta.hotfixId} 的 AI Review 结论不合法。`, { file: file.path });
      }
      if (["human-approved", "closed"].includes(meta.hotfixState)) {
        const signed = latest(events, "human_signed");
        if (!signed || signed.codeFingerprint !== expectedFingerprint || signed.timestamp < review?.timestamp) {
          fail(h4, `${meta.hotfixId} 缺少 AI Review 后、对应当前指纹的 human_signed。`, { file: file.path });
        }
      }
    }

    if (file.location === "active" && (meta.status === "archived" || meta.hotfixState === "closed")) {
      fail(h5, `${meta.hotfixId} 已关闭却仍在活跃 Hotfix 目录。`, { file: file.path });
    }
    if (file.location === "archive") {
      if (meta.status !== "archived" || meta.hotfixState !== "closed") fail(h5, `${meta.hotfixId} 已在归档目录，但状态不是 archived/closed。`, { file: file.path });
      const closed = latest(events, debugRoute ? "debug_closed" : "hotfix_closed");
      if (!closed || closed.codeFingerprint !== meta.fixFingerprint) fail(h5, `${meta.hotfixId} 缺少归档指纹对应的 ${debugRoute ? "debug_closed" : "hotfix_closed"}。`, { file: file.path });
    }
    if (meta.hotfixState !== "implementation" && meta.fixFingerprint !== expectedFingerprint) {
      fail(h3, `${meta.hotfixId} 的 fixFingerprint 不对应当前修复内容。`, { file: file.path });
    }
  }

  for (const [id, files] of byId) {
    if (id && files.length > 1) fail(h1, `同一流存在重复 Hotfix ID ${id}：${files.join(" / ")}。`, { hotfixId: id, files });
  }
  return { checks: [h1, h2, h3, h4, h5], files: hotfixes.files, unusable };
}
