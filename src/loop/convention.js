/**
 * SDD Loop 的目录与字段约定（D5：字段名定死，路径默认可覆盖）。
 *
 * 默认值取自一个真实项目的实际形状，但**一律不硬编码进判定逻辑**——
 * 判定只认本对象。别的项目换了目录名，覆盖这里即可，不用改代码。
 * 这是「不硬编码别人的约定」那条的落点：默认值是便利，不是前提。
 */

import path from "node:path";

export const DEFAULT_CONVENTION = Object.freeze({
  /** 状态文件相对仓库根的路径。活跃 Loop 目录按它的所在目录解析。 */
  statusFile: "docs/loops/status.md",

  /** 归档根目录。已关闭 Loop 的阶段文档落在这下面。 */
  archiveDir: "docs/archive",

  /** Loop 目录名前缀：活跃目录 = `<prefix><n>`，归档目录 = `<prefix><n>` 或 `<prefix><n>-<后缀>`。 */
  loopDirPrefix: "loop-",

  /**
   * 阶段文档的文件名（不含 .md）。
   *
   * 这份清单同时承担一件容易被忽略的职责：**把阶段文档和语料文档分开**。
   * 实测归档目录（如 docs/archive/loop-0-prd-source/）里放着用户带来的原始 PRD 等
   * 来源文档，它们是 confirmed 且应当保持 confirmed，不该被「关闭的 Loop 必须全部
   * archived」判死。
   * 靠文件名判、不靠所在目录判——判错会一次产生 7 条假警报，而假警报会杀死整个检查。
   */
  stageDocs: Object.freeze([
    "requirements",
    "architecture",
    "specification",
    "tasks",
    "implementation",
    "verification",
  ]),

  /** 文档状态白名单（AGENTS.md 文档规则：只允许这四个）。 */
  docStatuses: Object.freeze(["draft", "confirmed", "superseded", "archived"]),

  /** 已关闭 Loop 的阶段文档应处于的状态。 */
  closedStatus: "archived",

  /** 状态文件必须有的键。缺了就没法判——直接算读不出来。 */
  requiredStatusFields: Object.freeze(["activeLoop"]),

  /**
   * 状态文件认识的键。用于提示拼写错误，不作为错误。
   *
   * `stream` / `owner` 是分流形态下的**认领信息**：谁在这条流上干活。
   * 它们是意图不是事实，判定一律不读——工具不判断意图（那是 AGENTS.md 的规则在管），
   * 列在这里只是为了它们不被当成拼写错误。
   */
  knownStatusFields: Object.freeze([
    "activeLoop",
    "lastClosedLoop",
    "lastClosedAt",
    "nextLoop",
    "nextPhase",
    "updatedAt",
    "project",
    "document",
    "stream",
    "owner",
    "governanceVersion",
    "gateStage",
    "gateState",
    "gateFingerprint",
    "enabledExtensions",
    "roleRequester",
    "roleProduct",
    "roleArchitect",
    "roleImplementer",
    "roleReviewer",
    "roleApprover",
  ]),
});

/** 合并用户覆盖；未提供的键落回默认值。 */
export function resolveConvention(overrides = {}) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  return Object.freeze({ ...DEFAULT_CONVENTION, ...source });
}

/**
 * 分流：把一条流的名字解析成它自己的一份 overrides。
 *
 * 两条派生规则，都不是风格偏好：
 * - 状态文件 = `<状态文件所在目录>/<流名>/<状态文件名>`——流目录的判据就是「里面有这个文件」，
 *   所以发现与解析必须用同一套推导，否则会出现「发现得了、判不了」。
 * - 归档根 = `<archiveDir>/<流名>`。C3 是拿 `loop-` + lastClosedLoop 当前缀去 archiveDir 里扫的
 *   （见 repo-scan.js 的归档段）。多条流共用一个归档根时，A 流声明 lastClosedLoop: 1 会扫到
 *   B 流的 `loop-1-*`，然后去校验**别人**的阶段文档状态——错误归属，成片假警报。
 *
 * 这一份推导是发现、判定、表面共用的唯一入口：各算各的就是「两处都改才对、只改了一处」的来源。
 */
export function conventionForStream(streamName, overrides = {}) {
  const base = resolveConvention(overrides);
  return {
    ...base,
    statusFile: path.join(path.dirname(base.statusFile), streamName, path.basename(base.statusFile)),
    archiveDir: path.join(base.archiveDir, streamName),
  };
}
