/**
 * 扫描一个采用 SDD Loop 约定的仓库，产出**事实**——不下结论。
 *
 * 分工（D4）：本模块只回答「盘上是什么」，
 * loop-check.js 才回答「这算不算矛盾」，各表面再自己渲染文案。判定不许散落在扫描里，
 * 否则下一次就是「CLI 和工具各判各的」。
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { readFrontMatter, isBlank } from "./front-matter.js";
import { resolveConvention } from "./convention.js";

/** git 只读查询；不是仓库、没装 git、命令失败都返回 null，让调用方降级而不是崩。 */
function git(repoRoot, args) {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function readDocFile(absPath) {
  const content = fs.readFileSync(absPath, "utf8");
  const { ok, meta, issues } = readFrontMatter(content);
  return {
    name: path.basename(absPath, ".md"),
    path: absPath,
    ok,
    status: ok ? String(meta.status ?? "").trim() : "",
    meta: ok ? meta : {},
    issues,
  };
}

/**
 * 读一个目录里的阶段文档。
 * 只认 convention.stageDocs 里的文件名——语料文档（00-intro.md 之类）不在此列，
 * 因此不会被「关闭的 Loop 必须全部 archived」判死（见 convention.js 的说明）。
 */
function readStageDocs(dirAbs, convention) {
  if (!fs.existsSync(dirAbs)) return [];
  const docs = [];
  for (const stage of convention.stageDocs) {
    const file = path.join(dirAbs, `${stage}.md`);
    if (fs.existsSync(file)) docs.push(readDocFile(file));
  }
  return docs;
}

/** 目录里 git 跟踪的文件数。git 不可用时返回 null（未知），不要谎报 0。 */
function trackedFileCount(repoRoot, relDir) {
  const out = git(repoRoot, ["ls-files", "--", relDir]);
  if (out === null) return null;
  return out ? out.split("\n").filter(Boolean).length : 0;
}

export function scanLoopRepo(repoRoot, overrides = {}) {
  const convention = resolveConvention(overrides);
  const root = path.resolve(repoRoot);

  // ---- 状态文件 ----
  const statusRel = convention.statusFile;
  const statusAbs = path.join(root, statusRel);
  const statusExists = fs.existsSync(statusAbs);
  let status = { path: statusRel, exists: statusExists, ok: false, meta: {}, issues: [] };
  if (statusExists) {
    const parsed = readFrontMatter(fs.readFileSync(statusAbs, "utf8"));
    status = { path: statusRel, exists: true, ok: parsed.ok, meta: parsed.ok ? parsed.meta : {}, issues: parsed.issues };
  }

  const loopsDirRel = path.dirname(statusRel);
  const loopsDirAbs = path.join(root, loopsDirRel);

  // ---- 活跃 Loop ----
  const declaredActive = status.ok ? status.meta.activeLoop : undefined;
  const hasActive = status.ok && !isBlank(declaredActive);
  let active = null;
  if (hasActive) {
    const dirRel = path.join(loopsDirRel, `${convention.loopDirPrefix}${declaredActive}`);
    const dirAbs = path.join(root, dirRel);
    active = {
      declared: String(declaredActive),
      dir: dirRel,
      exists: fs.existsSync(dirAbs),
      trackedFiles: trackedFileCount(root, dirRel),
      stageDocs: readStageDocs(dirAbs, convention),
    };
  }

  // ---- activeLoop 为空时，盘上还有没有 Loop 目录（声明与事实的另一个方向）----
  const strayLoopDirs = [];
  if (fs.existsSync(loopsDirAbs)) {
    for (const entry of fs.readdirSync(loopsDirAbs, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(convention.loopDirPrefix)) continue;
      const relDir = path.join(loopsDirRel, entry.name);
      const tracked = trackedFileCount(root, relDir);
      // 只关心「有被跟踪内容」的目录：空壳目录和未跟踪的草稿不构成声明矛盾。
      if (tracked === null || tracked > 0) {
        strayLoopDirs.push({ dir: relDir, trackedFiles: tracked });
      }
    }
  }

  // ---- 已关闭 Loop 的归档 ----
  const declaredClosed = status.ok ? status.meta.lastClosedLoop : undefined;
  let closed = null;
  if (status.ok && !isBlank(declaredClosed)) {
    const archiveAbs = path.join(root, convention.archiveDir);
    const prefix = `${convention.loopDirPrefix}${declaredClosed}`;
    const dirs = [];
    if (fs.existsSync(archiveAbs)) {
      for (const entry of fs.readdirSync(archiveAbs, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        // `loop-0` 本身，或 `loop-0-<后缀>`。不能只用 startsWith，否则 loop-0 会吃掉 loop-01。
        if (entry.name !== prefix && !entry.name.startsWith(`${prefix}-`)) continue;
        const dirAbs = path.join(archiveAbs, entry.name);
        dirs.push({
          name: entry.name,
          dir: path.join(convention.archiveDir, entry.name),
          stageDocs: readStageDocs(dirAbs, convention),
        });
      }
    }
    closed = { declared: String(declaredClosed), archiveDirs: dirs };
  }

  // ---- git 状态（C5 提醒级用）----
  const dirty = git(root, ["status", "--porcelain"]);
  const upstream = git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  let ahead = null;
  if (upstream) {
    const counts = git(root, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`]);
    if (counts) ahead = Number(counts.split(/\s+/)[0]) || 0;
  }

  return {
    repoRoot: root,
    convention,
    status,
    active,
    strayLoopDirs,
    closed,
    git: {
      available: dirty !== null,
      dirtyCount: dirty === null ? null : dirty.split("\n").filter(Boolean).length,
      upstream: upstream || null,
      ahead,
    },
  };
}
