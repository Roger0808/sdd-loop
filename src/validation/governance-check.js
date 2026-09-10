import path from "node:path";

import { isBlank } from "../loop/front-matter.js";
import {
  BUILTIN_EXTENSIONS,
  GOVERNANCE_ROLES,
  GOVERNANCE_STATES,
  GOVERNANCE_VERSION,
  REVIEW_OUTCOMES,
  fingerprintFile,
  fingerprintRepo,
  governanceRoleField,
  readAuditDirectory,
  scanProjectExtensions,
  splitList,
  validateEventAuthorization,
} from "../governance/protocol.js";

const SEVERITY = "problem";

function check(id, title) {
  return { id, title, severity: SEVERITY, ok: true, findings: [] };
}

function fail(entry, detail, extra = {}) {
  entry.ok = false;
  entry.findings.push({ detail, ...extra });
}

function latest(events, type) {
  return events.filter((event) => event.type === type).at(-1) ?? null;
}

function activeLoopDir(scan) {
  if (!scan.active?.exists) return null;
  return path.join(scan.repoRoot, scan.active.dir);
}

function auditForScan(scan) {
  const active = activeLoopDir(scan);
  if (active) return readAuditDirectory(active);
  for (const closed of scan.closed?.archiveDirs ?? []) {
    const audit = readAuditDirectory(path.join(scan.repoRoot, closed.dir));
    if (audit.exists) return audit;
  }
  return { exists: false, files: [], events: [], issues: [] };
}

function expectedStageFingerprint(scan) {
  const stage = scan.status.meta.gateStage;
  const dir = activeLoopDir(scan);
  if (!dir || !stage) return null;
  return fingerprintFile(path.join(dir, `${stage}.md`));
}

function fingerprintCurrentCode(scan, audit) {
  const auditPrefixes = audit.files.length
    ? [...new Set(audit.files.map((file) => path.relative(scan.repoRoot, path.dirname(file))))]
    : scan.active
      ? [path.join(scan.active.dir, "audit")]
      : [];
  return fingerprintRepo(scan.repoRoot, {
    statusRel: scan.status.path,
    excludePrefixes: auditPrefixes,
  });
}

/**
 * 治理检查只在 status.md 显式选择 governanceVersion 后启用。
 * 旧仓库不走到这里，C1-C5 的报告形状和输出因此保持原样。
 */
export function buildGovernanceChecks(scan) {
  const meta = scan.status.meta;
  if (isBlank(meta.governanceVersion)) return [];

  const c6 = check("C6", "治理状态与审批门禁一致");
  const c7 = check("C7", "角色身份与 append-only 审计可信");
  const c8 = check("C8", "阶段、代码与审查指纹有效");
  const c9 = check("C9", "工程质量扩展有证据或合理 N/A");
  const c10 = check("C10", "AI Review 与人工关闭门禁完整");

  if (String(meta.governanceVersion) !== GOVERNANCE_VERSION) {
    fail(c6, `不支持 governanceVersion: ${meta.governanceVersion}；当前只支持 ${GOVERNANCE_VERSION}。`, {
      file: scan.status.path,
    });
  }
  if (!scan.convention.stageDocs.includes(meta.gateStage)) {
    fail(c6, `gateStage 必须是六阶段之一，当前是 ${meta.gateStage || "(空)"}。`, { file: scan.status.path });
  }
  if (!GOVERNANCE_STATES.includes(meta.gateState)) {
    fail(c6, `gateState 不合法：${meta.gateState || "(空)"}。`, { file: scan.status.path });
  }
  for (const role of GOVERNANCE_ROLES) {
    const field = governanceRoleField(role);
    if (!splitList(meta[field]).length) fail(c6, `治理模式缺少角色映射 ${field}。`, { file: scan.status.path });
  }

  const enabled = splitList(meta.enabledExtensions);
  for (const extension of BUILTIN_EXTENSIONS) {
    if (!enabled.includes(extension)) {
      fail(c6, `内置扩展 ${extension} 必须默认启用；不适用应在 Verification 记录 N/A 与理由。`, {
        file: scan.status.path,
      });
    }
  }
  const projectExtensions = scanProjectExtensions(scan.repoRoot);
  for (const issue of projectExtensions.issues) {
    const names = issue.files?.map((file) => path.relative(scan.repoRoot, file)).join(" / ");
    const rel = issue.file ? path.relative(scan.repoRoot, issue.file) : names;
    const detail = issue.kind === "duplicate-extension"
      ? `项目扩展 ${issue.name} 重名：${names}。`
      : issue.kind === "builtin-extension-conflict"
        ? `项目扩展 ${issue.name} 与内置扩展重名：${rel}。`
      : issue.kind === "orphan-opt-in"
          ? `${rel} 没有对应的完整扩展规则。`
          : issue.kind === "invalid-extension-name"
            ? `项目扩展名不合法：${issue.name}（${rel}）。`
            : issue.kind === "extension-name-mismatch"
              ? `${rel} 的 extension 字段必须与文件名 ${issue.name} 一致。`
              : issue.kind === "invalid-extension-stages"
                ? `${rel} 的 stages 必须是非空的六阶段逗号列表。`
                : issue.kind === "invalid-extension-file"
                  ? `${rel} 的 front-matter 不可读。`
            : `项目扩展目录读不出来：${rel}。`;
    fail(c6, detail, { file: rel, kind: issue.kind });
  }
  for (const [name, file] of projectExtensions.definitions) {
    if (!projectExtensions.optIns.has(name) && !enabled.includes(name)) {
      fail(c6, `项目扩展 ${name} 没有 opt-in 文件，因此必须始终启用。`, { file: path.relative(scan.repoRoot, file) });
    }
  }
  for (const extension of enabled) {
    if (!BUILTIN_EXTENSIONS.includes(extension) && !projectExtensions.definitions.has(extension)) {
      fail(c6, `enabledExtensions 声明了不存在的项目扩展 ${extension}。`, { file: scan.status.path });
    }
  }

  const audit = auditForScan(scan);
  if (scan.active && !audit.exists) {
    fail(c7, `活跃 Loop ${scan.active.dir} 缺少 audit/ 审计目录。`, { dir: scan.active.dir });
  }
  for (const issue of audit.issues) {
    const label = issue.kind === "invalid-audit-json"
      ? "不是合法 JSON"
      : issue.kind === "invalid-audit-event"
        ? "不是合法的审计事件对象"
      : issue.kind === "broken-audit-chain"
        ? "previousEventHash 断链"
        : issue.kind === "invalid-event-hash"
          ? "eventHash 与内容不一致"
          : issue.kind === "unsafe-audit-dir" || issue.kind === "unsafe-audit-file"
            ? "不是仓库内普通文件/目录，拒绝跟随软链"
            : "审计内容读不出来";
    fail(c7, `${path.relative(scan.repoRoot, issue.file)}${issue.line ? `:${issue.line}` : ""} ${label}。`, issue);
  }
  for (const event of audit.events) {
    const rel = path.relative(scan.repoRoot, event._file);
    if (!event.id || !event.timestamp || event.version !== 1) {
      fail(c7, `${rel}:${event._line} 缺少事件 ID、时间或版本。`, { file: rel, line: event._line });
    }
    if (!validateEventAuthorization(meta, event)) {
      fail(c7, `${rel}:${event._line} 的角色、Git 身份或事件授权不匹配。`, { file: rel, line: event._line });
    }
    const persisted = { ...event };
    delete persisted._file;
    delete persisted._line;
    if (JSON.stringify(persisted).includes(scan.repoRoot)) {
      fail(c7, `${rel}:${event._line} 记录了本机仓库绝对路径。`, { file: rel, line: event._line });
    }
  }
  const migration = latest(audit.events, "governance_migrated");
  if (scan.active && !latest(audit.events, "intent_captured") && !migration) {
    fail(c7, "活跃 Loop 缺少 intent_captured；存量 Loop 必须改为记录 governance_migrated，不能伪造原始意图。", {
      dir: scan.active.dir,
    });
  }

  if (meta.gateState === "awaiting-continue") {
    const approved = latest(audit.events, "stage_approved");
    const migratedApproval = migration?.context?.stage === meta.gateStage ? migration : null;
    const approval = approved?.context?.stage === meta.gateStage ? approved : migratedApproval;
    if (!approval) {
      fail(c6, `gateState 是 awaiting-continue，但缺少 ${meta.gateStage} 的 stage_approved 事件。`, {
        file: scan.status.path,
      });
    }
    const actual = expectedStageFingerprint(scan);
    if (!actual || actual !== meta.gateFingerprint || approval?.artifactFingerprint !== actual) {
      fail(c8, `${meta.gateStage}.md 在审批后发生变化，旧审批已经失效。`, { file: scan.status.path });
    }
  }

  if (scan.active && meta.gateState === "in-progress") {
    const currentDoc = scan.active.stageDocs.find((doc) => doc.name === meta.gateStage);
    if (currentDoc?.status === "confirmed") {
      fail(c6, `${meta.gateStage}.md 已是 confirmed，但 gateState 仍是 in-progress；必须记录审批并停在 awaiting-continue。`, {
        file: currentDoc.path,
      });
    }
  }

  if (scan.active && scan.convention.stageDocs.includes(meta.gateStage)) {
    const gateIndex = scan.convention.stageDocs.indexOf(meta.gateStage);
    const migrationIndex = migration && scan.convention.stageDocs.includes(migration.context?.stage)
      ? scan.convention.stageDocs.indexOf(migration.context.stage)
      : -1;
    for (const [index, stage] of scan.convention.stageDocs.entries()) {
      if (index >= gateIndex || index < migrationIndex) continue;
      const continued = audit.events.filter((event) => event.type === "continue_authorized" && event.context?.stage === stage).at(-1);
      const file = path.join(activeLoopDir(scan), `${stage}.md`);
      const current = fingerprintFile(file);
      if (!continued || !current || continued.artifactFingerprint !== current) {
        fail(c8, `${stage}.md 缺少有效的审批/Continue 指纹，或在通过后发生变化。`, { file: path.relative(scan.repoRoot, file) });
      }
    }
  }

  const review = latest(audit.events, "review_completed");
  if (["ready-for-human-review", "human-approved", "closed"].includes(meta.gateState)) {
    if (!review || review.payload?.outcome !== "READY_FOR_HUMAN_REVIEW") {
      fail(c10, `${meta.gateState} 必须有 READY_FOR_HUMAN_REVIEW 审查事件。`, { file: scan.status.path });
    }
    const current = meta.gateState === "closed" ? meta.gateFingerprint : fingerprintCurrentCode(scan, audit);
    if (!current || current !== meta.gateFingerprint || review?.codeFingerprint !== current) {
      fail(c8, "AI Review 后代码、配置或关键文档发生变化，旧审查已经失效。", { file: scan.status.path });
    }
    const reconciled = latest(audit.events, "architecture_reconciled");
    if (!reconciled || reconciled.codeFingerprint !== current || reconciled.timestamp > review?.timestamp) {
      fail(c8, "Architecture Baseline 与 change surface 没有按当前审查指纹完成对账。", { file: scan.status.path });
    }
  }

  const needsExtensions = meta.gateStage === "verification"
    || ["review-blocked", "ready-for-human-review", "human-approved", "closed"].includes(meta.gateState);
  if (needsExtensions) {
    const currentFingerprint = meta.gateState === "closed"
      ? meta.gateFingerprint
      : fingerprintCurrentCode(scan, audit);
    for (const extension of enabled) {
      const evaluation = audit.events.filter((event) => (
        event.type === "extension_evaluated" && event.payload?.extension === extension
      )).at(-1);
      if (!evaluation) {
        fail(c9, `${extension} 缺少 extension_evaluated 证据。`, { extension });
        continue;
      }
      if (evaluation.codeFingerprint !== currentFingerprint) {
        fail(c9, `${extension} 的证据不对应当前代码指纹。`, { extension });
      }
      const outcome = evaluation.payload?.outcome;
      if (outcome === "FAIL") fail(c9, `${extension} 的结果是 FAIL。`, { extension });
      if (outcome === "PASS" && !String(evaluation.payload?.evidence ?? "").trim()) {
        fail(c9, `${extension} 标记 PASS，但没有 evidence。`, { extension });
      }
      if (outcome === "N/A" && !String(evaluation.payload?.reason ?? "").trim()) {
        fail(c9, `${extension} 标记 N/A，但没有具体理由。`, { extension });
      }
      if (extension === "pbt" && outcome === "PASS") {
        if (!Number.isInteger(evaluation.payload?.caseCount) || evaluation.payload.caseCount <= 0 || evaluation.payload?.seed === undefined) {
          fail(c9, "PBT PASS 必须记录 caseCount 和 seed。", { extension });
        }
      }
    }
  }

  if (meta.gateState === "review-blocked" && review && !REVIEW_OUTCOMES.includes(review.payload?.outcome)) {
    fail(c10, `AI Review 结论不合法：${review.payload?.outcome || "(空)"}。`);
  }
  if (["human-approved", "closed"].includes(meta.gateState)) {
    const signed = latest(audit.events, "human_signed");
    if (!signed || signed.codeFingerprint !== meta.gateFingerprint || signed.timestamp < review?.timestamp) {
      fail(c10, "缺少当前审查指纹对应、且发生在 AI Review 之后的人工签署。", { file: scan.status.path });
    }
  }
  if (meta.gateState === "closed") {
    if (scan.active) fail(c10, "gateState 是 closed，但 activeLoop 仍指向活跃目录。", { file: scan.status.path });
    const closed = latest(audit.events, "loop_closed");
    if (!closed || closed.codeFingerprint !== meta.gateFingerprint) {
      fail(c10, "gateState 是 closed，但缺少当前指纹对应的 loop_closed 事件。", { file: scan.status.path });
    }
    const currentDelivery = fingerprintRepo(scan.repoRoot, {
      statusRel: scan.status.path,
      excludePrefixes: [path.dirname(scan.convention.statusFile), scan.convention.archiveDir],
    });
    if (!closed?.deliveryFingerprint || closed.deliveryFingerprint !== currentDelivery || review?.deliveryFingerprint !== currentDelivery) {
      fail(c10, "Loop 关闭后代码、配置或长期文档与签署时不一致。", { file: scan.status.path });
    }
  }

  return [c6, c7, c8, c9, c10];
}
