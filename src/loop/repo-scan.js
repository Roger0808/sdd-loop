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

/**
 * 分流发现：这个仓库是单流还是分流。只产出事实，不下结论。
 *
 * 靠**发现**不靠配置文件：这个包全局安装，sdd-init 已经在别的仓库产出过单流结构，
 * 那些仓库必须继续按原样跑。新增一个 `.sdd-loop.json` 之类的配置面等于要求它们先改配置。
 *
 * @returns {{mode: "single"|"streams", streams: string[]}}
 */
export function discoverStreams(repoRoot, overrides = {}) {
  const convention = resolveConvention(overrides);
  const root = path.resolve(repoRoot);

  // 根状态文件存在 = 单流。这一条排在最前，是向后兼容的落点：
  // 已经在跑的单流仓库永远走原路，发现逻辑碰都不碰它。
  if (fs.existsSync(path.join(root, convention.statusFile))) return { mode: "single", streams: [] };

  const loopsDirAbs = path.join(root, path.dirname(convention.statusFile));
  const statusName = path.basename(convention.statusFile);
  const streams = [];
  if (fs.existsSync(loopsDirAbs)) {
    for (const entry of fs.readdirSync(loopsDirAbs)) {
      // 判据是「这个子目录里有状态文件」，不是「它是个目录」——状态文件所在目录下
      // 将来可能有别的东西（语料、说明、脚本），按目录判会把它们全认成流。
      //
      // 这里刻意用 existsSync 而不是「必须是普通文件」：状态文件位置上如果是个目录，
      // 那也是**发现了一条流、它的判据读不出来**（退出 2，停下修文件），
      // 不是「这条流不存在」。后者会让一条流悄悄从门禁里消失——比报错危险得多。
      // 读不出来由 scanLoopRepo 的读取层负责翻成事实，见 readTextFile。
      if (fs.existsSync(path.join(loopsDirAbs, entry, statusName))) streams.push(entry);
    }
  }
  streams.sort();

  // 一条流都没发现 → 仍然按单流走，好让 C1 原样报 missing-status（冷启动）。
  // 「一条都没发现」和「发现了但某条读不出来」必须可区分：前者去初始化，后者停下修文件。
  return streams.length ? { mode: "streams", streams } : { mode: "single", streams: [] };
}

/**
 * 读一个文本文件；**读不出来返回 null**（目录、权限不足、IO 错都算）。
 *
 * 为什么不直接 readFileSync：`fs.existsSync()` 对目录也返回 true。盘上出现
 * `docs/loops/status.md/`（目录）时，「存在」是真的、「能读」是假的，
 * 而 readFileSync 会抛 EISDIR——CLI 当场异常退出，用户拿到的是一段 Node 堆栈，
 * 不是「判据读不出来，别信任何结论」的退出码 2。
 *
 * 这一层只把「读不出来」变成一个事实（null），仍然不下结论：是谁读不出来、
 * 算不算矛盾，归 loop-check.js。
 */
function readTextFile(absPath) {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

/** 「读不出来」也是一条普通 issue；目录没有真实行号，不编一个 `:1`。 */
function unreadableIssue(relPath) {
  return {
    kind: "unreadable-file",
    detail: `\`${relPath}\` 存在但读不出来（是目录？权限不足？）——判据不可信。`,
  };
}

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
  const content = readTextFile(absPath);
  if (content === null) {
    return {
      name: path.basename(absPath, ".md"),
      path: absPath,
      ok: false,
      status: "",
      meta: {},
      issues: [unreadableIssue(path.basename(absPath))],
    };
  }
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
    const content = readTextFile(statusAbs);
    // 存在但读不出来：`exists` 仍然是 true。这一位决定 C1 说的是「读不出来，停下修文件」
    // 还是「还没有 SDD Loop 结构，去初始化」——把它翻成 false，等于让用户
    // 在一个已经有内容（哪怕是个目录）的路径上重新初始化。
    const parsed = content === null
      ? { ok: false, meta: {}, issues: [unreadableIssue(statusRel)] }
      : readFrontMatter(content);
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
