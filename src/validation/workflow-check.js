import fs from "node:fs";
import path from "node:path";

import { LOOP_DOCS, digest } from "../workflow/definition.js";
import { compareSource } from "../workflow/source.js";
import { readWorkflowRun } from "../workflow/runtime.js";

function check(id, title) { return { id, title, severity: "problem", ok: true, findings: [] }; }
function fail(entry, detail, extra = {}) { entry.ok = false; entry.findings.push({ detail, ...extra }); }
function latest(events, type, stage = null) {
  return events.filter((event) => event.type === type && (!stage || event.payload?.stage === stage)).at(-1) ?? null;
}

function runDirs(scan) {
  const dirs = [];
  const children = (absolute) => {
    if (!fs.existsSync(absolute)) return [];
    const stat = fs.lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`工作流扫描目录不是普通目录：${path.relative(scan.repoRoot, absolute)}`);
    return fs.readdirSync(absolute, { withFileTypes: true });
  };
  if (scan.active?.exists) dirs.push(scan.active.dir);
  const activeRoot = path.dirname(scan.status.path);
  const activeAbsolute = path.join(scan.repoRoot, activeRoot);
  for (const entry of children(activeAbsolute)) {
    if (entry.name.startsWith(scan.convention.loopDirPrefix) && entry.isSymbolicLink()) throw new Error(`活跃 Loop 是软链：${path.join(activeRoot, entry.name)}`);
    if (entry.isDirectory() && entry.name.startsWith(scan.convention.loopDirPrefix)) dirs.push(path.join(activeRoot, entry.name));
  }
  const archive = path.join(scan.repoRoot, scan.convention.archiveDir);
  for (const entry of children(archive)) {
    if (entry.name.startsWith(scan.convention.loopDirPrefix) && entry.isSymbolicLink()) throw new Error(`归档 Loop 是软链：${path.join(scan.convention.archiveDir, entry.name)}`);
    if (entry.isDirectory() && entry.name.startsWith(scan.convention.loopDirPrefix)) dirs.push(path.join(scan.convention.archiveDir, entry.name));
  }
  const archivedRuns = path.join(archive, "workflow-runs");
  for (const entry of children(archivedRuns)) {
    if (entry.isSymbolicLink()) throw new Error(`归档工作目录是软链：${path.join(scan.convention.archiveDir, "workflow-runs", entry.name)}`);
    if (entry.isDirectory()) dirs.push(path.join(scan.convention.archiveDir, "workflow-runs", entry.name));
  }
  const sibling = path.join(path.dirname(scan.status.path), "workflow-runs");
  const absolute = path.join(scan.repoRoot, sibling);
  for (const entry of children(absolute)) {
    if (entry.isSymbolicLink()) throw new Error(`活跃工作目录是软链：${path.join(sibling, entry.name)}`);
    if (entry.isDirectory()) dirs.push(path.join(sibling, entry.name));
  }
  return [...new Set(dirs)].filter((dir) => fs.existsSync(path.join(scan.repoRoot, dir, "workflow.lock.json")));
}

export function buildWorkflowChecks(scan) {
  if (String(scan.status.meta.governanceVersion) !== "2") return [];
  const c6 = check("C6", "v2 工作流定义与阶段依赖固定");
  const c7 = check("C7", "v2 过程审计与身份可信");
  const c8 = check("C8", "文档与源码审查快照有效");
  const c9 = check("C9", "人工测试后正式验证与对账完整");
  const c10 = check("C10", "审查、动态签署与关闭完整");
  let dirs;
  try { dirs = runDirs(scan); }
  catch (error) {
    fail(c7, `工作流目录不可安全扫描：${error.message}`);
    return [c6, c7, c8, c9, c10];
  }
  if (scan.active?.exists && !dirs.includes(scan.active.dir)) fail(c6, `活跃 Loop ${scan.active.dir} 缺少 workflow.lock.json。`, { dir: scan.active.dir });
  for (const dir of dirs) {
    let run;
    try { run = readWorkflowRun(scan.repoRoot, dir); } catch (error) {
      fail(c7, `${dir} 的锁或审计不可信：${error.message}`, { dir });
      continue;
    }
    const { lock, events } = run;
    if (lock.statusRel !== scan.status.path) fail(c6, `${dir} 的状态文件归属不匹配。`, { dir });
    const candidate = latest(events, "candidate");
    const review = latest(events, "stage_completed", "review");
    const signed = latest(events, "stage_completed", "signoff");
    const closed = latest(events, "stage_completed", "close");
    if (closed) {
      const archiveRoot = lock.route === "loop" ? lock.archiveDir : path.join(lock.archiveDir, "workflow-runs");
      if (path.dirname(dir) !== archiveRoot) fail(c6, `${dir} 已关闭但不在锁定的归档目录。`, { dir });
    }
    const stageById = new Map(lock.workflow.definition.stages.map((stage) => [stage.id, stage]));
    if (events[0]?.type !== "started" || events.filter((event) => event.type === "started").length !== 1) {
      fail(c7, `${dir} 缺少唯一的启动事件。`, { dir });
    }
    for (const [index, event] of events.entries()) {
      if (!["stage_completed", "stage_revalidated"].includes(event.type)) continue;
      const stage = event.payload?.stage;
      const node = stageById.get(stage);
      if (!node) { fail(c6, `${dir} 的事件记录了流程外阶段 ${stage}。`, { dir, stage }); continue; }
      const earlier = events.slice(0, index);
      for (const need of node.needs) {
        const documented = earlier.some((prior) => ["stage_completed", "stage_revalidated"].includes(prior.type) && prior.payload?.stage === need);
        const cycle = ["deployment", "manual_test"].includes(need)
          && earlier.some((prior) => prior.type === "cycle" && prior.payload?.deployment && prior.payload?.retest === "PASS");
        if (!documented && !cycle) fail(c6, `${dir} 的 ${stage} 发生时缺少依赖阶段 ${need}。`, { dir, stage, need });
      }
    }
    if (candidate) {
      for (const type of ["decision", "impact", "cycle", "claim"]) {
        const change = latest(events, type);
        if (change && events.indexOf(change) > events.indexOf(candidate)) {
          fail(c8, `${dir} 候选后有新的 ${type}，需要重新固定候选。`, { dir });
        }
      }
      for (const node of lock.workflow.definition.stages) {
        if (["final_test", "reconciliation", "review", "signoff", "close", ...LOOP_DOCS].includes(node.id)) continue;
        const prior = events.slice(0, events.indexOf(candidate));
        const completed = prior.some((event) => event.type === "stage_completed" && event.payload?.stage === node.id);
        const cycle = ["deployment", "manual_test"].includes(node.id)
          && prior.some((event) => event.type === "cycle" && event.payload?.deployment && event.payload?.retest === "PASS");
        if (!completed && !cycle) fail(c6, `${dir} 固定候选时缺少 ${node.id} 阶段证据。`, { dir, stage: node.id });
      }
    }
    if (review && (!candidate || review.payload.candidateId !== candidate.payload.candidateId)) fail(c10, `${dir} 的 Review 不对应最新候选。`, { dir });
    if (review && candidate && events.indexOf(review) <= events.indexOf(candidate)) fail(c10, `${dir} 的 Review 必须发生在候选固定之后。`, { dir });
    if (review && JSON.stringify(review.payload.source) !== JSON.stringify(candidate?.payload.source)) fail(c8, `${dir} 的 Review 源码清单与候选不一致。`, { dir });
    if (review && candidate?.payload.delta && !String(review.payload.deltaReview ?? "").trim()) fail(c10, `${dir} 的修订候选缺少差量 Review 证据。`, { dir });
    if (signed && (!review || signed.payload.candidateId !== review.payload.candidateId)) fail(c10, `${dir} 的签署不对应最新 Review。`, { dir });
    if (signed && review && events.indexOf(signed) <= events.indexOf(review)) fail(c10, `${dir} 的签署必须发生在 Review 之后。`, { dir });
    if (closed && (!signed || closed.payload.candidateId !== signed.payload.candidateId)) fail(c10, `${dir} 的关闭不对应签署。`, { dir });
    if (closed && signed && events.indexOf(closed) <= events.indexOf(signed)) fail(c10, `${dir} 的关闭必须发生在签署之后。`, { dir });
    if (review && lock.workflow.definition.review === "required" && review.payload.outcome !== "READY_FOR_HUMAN_REVIEW") fail(c10, `${dir} 缺少正式 AI Review 通过结论。`, { dir });
    if (review && lock.workflow.definition.review === "waived" && review.payload.outcome !== "WAIVED") fail(c10, `${dir} 的 Review 豁免与锁定流程不符。`, { dir });
    if (signed && lock.workflow.definition.signoff === "submitter" && signed.actor.email !== lock.submitter.email) fail(c10, `${dir} 不是登记提交者签署。`, { dir });
    if (signed && ["submitter", "role"].includes(lock.workflow.definition.signoff) && signed.payload.outcome !== "SIGNED") fail(c10, `${dir} 的签署结论与锁定流程不符。`, { dir });
    if (signed && lock.workflow.definition.signoff === "optional" && signed.payload.outcome === "SIGNED" && signed.actor.email !== lock.submitter.email) fail(c10, `${dir} 可选签署的签署者不是登记提交者。`, { dir });
    if (signed && lock.workflow.definition.signoff === "optional" && !["SIGNED", "WAIVED"].includes(signed.payload.outcome)) fail(c10, `${dir} 的可选签署结论不合法。`, { dir });
    if (signed && lock.workflow.definition.signoff === "none" && signed.payload.outcome !== "NOT_REQUIRED") fail(c10, `${dir} 的免签记录与锁定流程不符。`, { dir });
    if (signed && lock.workflow.definition.signoff === "role" && signed.payload.role !== lock.workflow.definition.signerRole) fail(c10, `${dir} 的签署角色与锁定流程不符。`, { dir });
    if (signed && lock.workflow.definition.signoff === "role" && !lock.roleSigners?.includes(signed.actor.email)) fail(c10, `${dir} 的签署人不在启动时锁定的角色映射中。`, { dir });
    if (signed && lock.workflow.definition.signoff === "optional" && signed.payload.outcome === "WAIVED" && signed.actor.email !== lock.submitter.email) fail(c10, `${dir} 的免签人不是登记提交者。`, { dir });
    if (candidate && lock.route === "loop") {
      for (const stage of LOOP_DOCS) {
        const approved = [...events].reverse().find((event) => ["stage_completed", "stage_revalidated"].includes(event.type) && event.payload?.stage === stage);
        if (!approved || approved.payload.docHash !== candidate.payload.documentHashes?.[stage]) fail(c8, `${dir}/${stage}.md 的候选快照缺少对应确认。`, { dir, stage });
        if (!closed) {
          const file = path.join(scan.repoRoot, dir, `${stage}.md`);
          const hash = fs.existsSync(file) ? digest(fs.readFileSync(file)) : null;
          if (hash !== candidate.payload.documentHashes?.[stage]) fail(c8, `${dir}/${stage}.md 在候选固定后变化。`, { dir, stage });
        }
      }
    }
    if (candidate && lock.route === "hotfix" && !closed) {
      const file = path.join(scan.repoRoot, dir, "hotfix.md");
      const hash = fs.existsSync(file) ? digest(fs.readFileSync(file)) : null;
      if (hash !== candidate.payload.hotfixDocumentHash) fail(c8, `${dir}/hotfix.md 在候选固定后变化。`, { dir });
    }
    if (review) {
      for (const stage of ["final_test", "reconciliation"]) {
        const event = latest(events, "stage_completed", stage);
        if (!event || event.payload.candidateId !== review.payload.candidateId || events.indexOf(event) >= events.indexOf(review)) fail(c9, `${dir} 缺少 Review 之前当前候选的 ${stage} 证据。`, { dir, stage });
      }
    }
    if (closed) {
      if (lock.route === "loop") {
        for (const stage of LOOP_DOCS) {
          const file = path.join(scan.repoRoot, dir, `${stage}.md`);
          const hash = fs.existsSync(file) ? digest(fs.readFileSync(file)) : null;
          if (!hash || hash !== closed.payload.archiveHashes?.[stage]) fail(c8, `${dir}/${stage}.md 与关闭时归档快照不一致。`, { dir, stage });
        }
      }
      if (["hotfix", "debug"].includes(lock.route)) {
        const name = `${lock.route}.md`;
        const file = path.join(scan.repoRoot, dir, name);
        const hash = fs.existsSync(file) ? digest(fs.readFileSync(file)) : null;
        if (!hash || hash !== closed.payload.archiveHashes?.[name]) fail(c8, `${dir}/${name} 与关闭时归档快照不一致。`, { dir });
      }
      if (JSON.stringify(closed.payload.source) !== JSON.stringify(candidate?.payload.source)) fail(c10, `${dir} 的关闭源码快照不等于审查候选。`, { dir });
      // 关闭后的源码由后续交付负责；这里只检查当时的审查、归档与签署关系。
    } else if (candidate && review) {
      try {
        const comparison = compareSource(scan.repoRoot, candidate.payload.source);
        if (!comparison.ok) fail(c8, `${dir} 审查后交付文件变化：${comparison.drift.map((item) => item.path).join(" / ")}`, { dir, paths: comparison.drift.map((item) => item.path) });
      } catch (error) { fail(c8, `${dir} 源码清单不可验证：${error.message}`, { dir }); }
    }
    const lastCycle = latest(events, "cycle");
    if (review && lastCycle && events.indexOf(lastCycle) > events.indexOf(review)) fail(c10, `${dir} Review 后仍有修复，需重新固定候选、测试和差量 Review。`, { dir });
    const lastClaim = latest(events, "claim");
    if (review && lastClaim && events.indexOf(lastClaim) > events.indexOf(review)) fail(c10, `${dir} Review 后源码清单新增认领，需重新固定候选并补审。`, { dir });
    for (const event of events) {
      if (!event.actor?.name || !event.actor?.email) fail(c7, `${dir} 有缺少 Git 身份的事件。`, { dir });
      if (JSON.stringify(event).includes(scan.repoRoot)) fail(c7, `${dir} 的事件包含本机绝对路径。`, { dir });
    }
  }
  return [c6, c7, c8, c9, c10];
}
