/**
 * SDD Loop 状态对账的**唯一判定源**（sdd-loop 能力一）。
 *
 * 两条形状约束：
 * - 只返回数据，不渲染文案。CLI 和 pi 工具各渲染各的，各自决定退出码。
 * - 判定只有一份。任何表面都不许自己再判一次——那是「两处都改才对、只改了一处」的来源。
 *
 * 它执行的是 AGENTS.md 已经写了、却没有任何机制在执行的那条规则：
 * 「如果状态文件、活跃目录和阶段文档互相矛盾，应停止相关工作并请求用户确认。」
 *
 * 严重度三档，对应 CLI 的退出码：
 *   unusable(2) 判据读不出来——此时不许下任何结论，因为结论会建立在猜出来的元数据上
 *   problem(1)  声明与事实矛盾
 *   advisory(0) 只报事实，不影响结论（C5 就是这一档，理由见下）
 */

import { scanLoopRepo } from "../loop/repo-scan.js";
import { isBlank } from "../loop/front-matter.js";

const SEVERITY = Object.freeze({ unusable: "unusable", problem: "problem", advisory: "advisory" });

function check(id, title, severity) {
  return { id, title, severity, ok: true, findings: [] };
}

function fail(entry, detail, extra = {}) {
  entry.ok = false;
  entry.findings.push({ detail, ...extra });
}

/**
 * @param {string} repoRoot 仓库根
 * @param {object} overrides 约定覆盖（见 src/loop/convention.js）
 * @returns 数据；渲染与退出码由调用方决定
 */
export function buildLoopCheckReport(repoRoot, overrides = {}) {
  const scan = scanLoopRepo(repoRoot, overrides);
  const { convention, status, active, strayLoopDirs, closed } = scan;

  // ---------- C1 判据读得出来吗 ----------
  const c1 = check("C1", "状态文件与阶段文档的 front-matter 可读", SEVERITY.unusable);
  if (!status.exists) {
    // kind 显式标出来：这一条和「front-matter 被污染」严重度相同（都不给结论），
    // 但该触发的行为完全相反——污染要停下请人解决，不存在是冷启动的正常起点。
    // 不区分的代价实测过：表面把「先请人解决文件本身」原样甩给一个空仓库的用户。
    fail(c1, `状态文件不存在：${status.path}`, { file: status.path, kind: "missing-status" });
  } else if (!status.ok) {
    for (const issue of status.issues) {
      fail(c1, issue.detail, { file: status.path, line: issue.line, kind: issue.kind, text: issue.text });
    }
  } else {
    for (const field of convention.requiredStatusFields) {
      if (!(field in status.meta)) {
        fail(c1, `状态文件缺必需字段 \`${field}\`——没有它无法判断当前状态。`, { file: status.path });
      }
    }
  }
  // 阶段文档的 front-matter 同样是门禁判据，被污染就等于判据读不出来。
  const allDocs = [
    ...(active?.stageDocs ?? []),
    ...(closed?.archiveDirs ?? []).flatMap((d) => d.stageDocs),
  ];
  for (const doc of allDocs) {
    if (doc.ok) continue;
    for (const issue of doc.issues) {
      fail(c1, issue.detail, { file: doc.path, line: issue.line, kind: issue.kind, text: issue.text });
    }
  }

  // 判据读不出来时，后面的判定全部不做——建立在猜出来的元数据上的结论比没有结论更坏。
  if (!c1.ok) {
    return {
      repoRoot: scan.repoRoot,
      statusPath: status.path,
      readable: false,
      // 不可读的两种成因，表面据此分叉渲染（判定在这里做一次，表面不许自己再判）：
      //   missing-status 这个仓库还没有 SDD Loop 结构——冷启动，该去初始化
      //   unreadable     文件在但读不出来（冲突标记/重复键/未闭合）——停下请人解决
      reason: status.exists ? "unreadable" : "missing-status",
      ok: false,
      severity: SEVERITY.unusable,
      checks: [c1],
      problems: c1.findings,
      advisories: [],
      nextStep: null,
    };
  }

  // ---------- C2 活跃 Loop 的声明与目录事实 ----------
  const c2 = check("C2", "活跃 Loop 的声明与目录一致", SEVERITY.problem);
  if (active) {
    if (!active.exists) {
      fail(c2, `状态文件声明 activeLoop: ${active.declared}，但目录不存在：${active.dir}（悬空指针）。`, {
        file: status.path,
        dir: active.dir,
      });
    } else if (active.trackedFiles === 0) {
      fail(c2, `活跃 Loop 目录 ${active.dir} 存在，但没有任何被 git 跟踪的文件（悬空指针）。`, {
        dir: active.dir,
      });
    }
  } else if (strayLoopDirs.length) {
    for (const stray of strayLoopDirs) {
      fail(c2, `状态文件声明没有活跃 Loop，但 ${stray.dir} 下有被跟踪的内容。`, { dir: stray.dir });
    }
  }

  // ---------- C3 已关闭 Loop 的归档完整性 ----------
  const c3 = check("C3", "已关闭 Loop 的阶段文档全部归档", SEVERITY.problem);
  if (closed) {
    if (!closed.archiveDirs.length) {
      fail(c3, `状态文件声明 lastClosedLoop: ${closed.declared}，但 ${convention.archiveDir} 下找不到它的归档目录。`, {
        file: status.path,
      });
    }
    for (const dir of closed.archiveDirs) {
      for (const doc of dir.stageDocs) {
        if (doc.status === convention.closedStatus) continue;
        const known = convention.docStatuses.includes(doc.status);
        const suffix = known
          ? ""
          : `（而且 \`${doc.status || "(空)"}\` 不在允许的状态里：${convention.docStatuses.join(" / ")}）`;
        fail(
          c3,
          `${dir.dir}/${doc.name}.md 的 status 是 \`${doc.status || "(空)"}\`，应为 \`${convention.closedStatus}\`${suffix}`,
          { file: doc.path, status: doc.status, expected: convention.closedStatus },
        );
      }
    }
  }

  // ---------- C4 下一步（信息，不判对错）----------
  const c4 = check("C4", "当前门禁与下一步", SEVERITY.advisory);
  let nextStep = null;
  if (active) {
    const pending = active.stageDocs.filter((d) => d.status !== "confirmed" && d.status !== "archived");
    nextStep = {
      kind: "continue",
      loop: active.declared,
      dir: active.dir,
      stages: active.stageDocs.map((d) => ({ name: d.name, status: d.status })),
      blockedAt: pending.length ? pending[0].name : null,
    };
  } else {
    const nextLoop = status.meta.nextLoop;
    const nextPhase = status.meta.nextPhase;
    nextStep = {
      kind: "start-new",
      loop: isBlank(nextLoop) ? null : String(nextLoop),
      phase: isBlank(nextPhase) ? null : String(nextPhase),
    };
  }

  // ---------- C5 只在本地历史里的内容（提醒级）----------
  // 降级理由写在设计文档里：它唯一的实证支撑（某个真实仓库那 358 行）被用户判定
  // 不需要保留——「只在本地历史」并不蕴含「重要」。做成错误级会在每轮开局甩一堆无关
  // 本地历史，几次之后整个检查就没人看了。所以只报事实，不进结论、不进退出码。
  const c5 = check("C5", "只存在于本地的内容", SEVERITY.advisory);
  if (scan.git.available) {
    if (scan.git.dirtyCount > 0) {
      fail(c5, `工作区有 ${scan.git.dirtyCount} 处未提交的改动。`, {});
    }
    if (scan.git.ahead) {
      fail(c5, `本地领先 ${scan.git.upstream} ${scan.git.ahead} 个提交，尚未推送。`, {});
    }
  }

  const checks = [c1, c2, c3, c4, c5];
  const problems = [...c2.findings, ...c3.findings];
  const advisories = [...c5.findings];

  return {
    repoRoot: scan.repoRoot,
    statusPath: status.path,
    readable: true,
    ok: problems.length === 0,
    severity: problems.length ? SEVERITY.problem : null,
    checks,
    problems,
    advisories,
    nextStep,
  };
}

export { SEVERITY };
