/**
 * 口径字典（sdd-loop 能力二）：「我要写这一类东西，该写哪几项」。
 *
 * 键是「文档类型 × 条款类型」（specification.entity-table / specification.state-machine …），
 * 不是「访谈第几站的附属物」。理由：访谈站数会变，文档里的条款类型不会——
 * 按站组织的字典每改一次大纲就要跟着重排，按条款类型组织的不用。
 *
 * 两条刻意为之的形状：
 *
 * - **条目是纯文字，不携带可机判结构**（没有 requiredKeys / pattern 之类的字段）。
 *   本工具只在写之前给要求，不做事后判定（D3）；机判结构会引诱下一个实现者
 *   长出判定，而事后判定的失败模式——在合格文档上误报——实测一次就是 32 条假警报。
 * - **字典是数据，渲染在表面**（同 §5.4 的「判定只有一份」）：CLI 和 pi 工具各自
 *   决定怎么摆给人看，这里不拼文案。
 *
 * 落点文档（doc）必须挂在 convention.stageDocs 的阶段文档上——
 * 字典条目与 SDD 阶段门禁一一对应，tests/spec-guide.test.js 有锁。
 */

/** @typedef {{ doc: string, clause: string, title: string, summary: string, lines: string[] }} GuideEntry */

/** @type {Readonly<Record<string, GuideEntry>>} */
export const SPEC_GUIDE = Object.freeze({
  // ---------------------------------------------------------- requirements
  "requirements.goal": {
    doc: "requirements",
    clause: "goal",
    title: "目标",
    summary: "每条目标一个稳定编号，且写得可验证。",
    lines: [
      "先扫仓库已有编号族再沿用，不另起体系（guide 会列出现有族）。实测过一个项目 requirements.md 稳定编号 0 条，「任务必须引用需求编号」的规则因此无链可挂——需求侧编号不是装饰。",
      "每条目标写清「怎么算达成」。写不出验证方式的目标先别编号。",
    ],
  },
  "requirements.non-goal": {
    doc: "requirements",
    clause: "non-goal",
    title: "非目标",
    summary: "非目标同样编号，写清「不做什么」加一句「为什么不做」。",
    lines: [
      "价值在防回流：没有编号的非目标，后续 Loop 会把它当漏做的需求捡回来。",
    ],
  },
  "requirements.scenario": {
    doc: "requirements",
    clause: "scenario",
    title: "用户场景",
    summary: "场景写到「谁在什么情境下做什么、期望什么结果」的粒度。",
    lines: [
      "粒度判据：能据此直接写用例。写不出用例的场景是口号。",
      "每条一个稳定编号。",
    ],
  },
  "requirements.success-criterion": {
    doc: "requirements",
    clause: "success-criterion",
    title: "成功标准",
    summary: "每条成功标准必须可测量。",
    lines: [
      "数字或可观察行为。「体验更好」不算标准。",
    ],
  },
  "requirements.non-functional": {
    doc: "requirements",
    clause: "non-functional",
    title: "非功能要求",
    summary: "每项非功能要求写三样：是否适用、要求、验证方式。",
    lines: [
      "不适用的能力项写明「否 / 不适用 / N/A」，别留空——留空和「没想过」读起来一模一样。",
      "适用的每项都要有要求和验证方式，缺一就是没写完。",
    ],
  },

  // ---------------------------------------------------------- architecture
  "architecture.adr": {
    doc: "architecture",
    clause: "adr",
    title: "技术决策（ADR）",
    summary: "每条决策标明分层：已确认约束 / 已验证事实 / 候选方案 / 待决问题。",
    lines: [
      "这是事实优先级的直接要求：只有「已确认」与「已验证」能当第 3 级事实用，候选与待决不许混进去。",
      "决策条目写三样：决策、理由、被否决的备选。",
      "每条一个稳定编号。",
    ],
  },
  "architecture.module-boundary": {
    doc: "architecture",
    clause: "module-boundary",
    title: "模块边界",
    summary: "每个模块写：负责什么、不负责什么、对外暴露什么。",
    lines: [
      "边界要靠勘察源码核实；访谈给不了的别编——编出来的架构结论会被当成事实用。",
    ],
  },
  "architecture.migration-map": {
    doc: "architecture",
    clause: "migration-map",
    title: "迁移映射（Migration Map · 代码结构）",
    summary: "迁移映射用表格，第一列是稳定编号。这是「源项目 → 目标项目」的代码搬家，数据模型变更走 architecture.schema-change。",
    lines: [
      "每行写：Source、Target、处理方式。例：| MIG-001 | src/old | src/new | 整体移动 |",
    ],
  },
  // 与 migration-map 分家是刻意的：两者都被口头叫作「Migration」，但一个是项目属性
  // （迁完就没了），一个是每轮属性（只要还有库就随时会回来）。合成一条的代价是
  // 非迁移项目会把整块当成「跟我无关」跳过，于是改表结构这一轮没有任何要求兜着。
  "architecture.schema-change": {
    doc: "architecture",
    clause: "schema-change",
    title: "数据模型变更（schema）",
    summary: "本轮动了表/字段/索引/约束时，四项缺一不可：变更清单、迁移步骤、已有数据的处理方式、回滚路径。",
    lines: [
      "变更清单逐项编号，写明动作（新增/修改/删除）与对象（表.字段）。删除与改类型单独标出来——它们不可逆，和加字段不是一档风险。",
      "迁移步骤写执行顺序，并写清「跑到一半失败怎么办」。没有回滚路径的删除/改类型是待决问题，不是候选方案。",
      "已有数据的处理方式要落到具体：默认值、回填来源、回填不了的行怎么办。生产有存量数据时，「新字段可空」不等于处理过了。",
      "新旧并存的兼容窗口写清起止条件：什么时候可以删掉旧字段与旧代码，由谁确认。没有终止条件的兼容层会永久留下。",
    ],
  },
  "architecture.integration": {
    doc: "architecture",
    clause: "integration",
    title: "集成边界",
    summary: "每个外部系统写：方向、用途、关键交换字段。",
    lines: [
      "现有接口与错误语义要去勘察真实代码，别凭印象写。",
    ],
  },

  // ---------------------------------------------------------- specification
  "specification.behavior": {
    doc: "specification",
    clause: "behavior",
    title: "行为条款",
    summary: "行为条款要写全：适用边界、强制/禁止动作、例外与停止条件。",
    lines: [
      "每条一个稳定编号，用标题定义（### BND-002 …）——编号本身就是锚点，不引入 HTML 注释。",
      "条款之间有覆盖关系时写清优先级（实测写法：「BND-007 高于所有 DEL-* / MIX-* 规则」）。",
    ],
  },
  "specification.entity-table": {
    doc: "specification",
    clause: "entity-table",
    title: "实体与字段表",
    summary: "可编辑字段必须写控件类型和取值说明；页面归属五列不许整行全空。",
    lines: [
      "「可编辑」= 新增页 / 编辑页 / 必填性写了任意一列。",
      "页面归属五列（新增页 / 编辑页 / 列表展示 / 可筛选 / 详情展示）全空 = 没想过；哪个页面都不出现是合法答案：逐列写「否」，别留空。",
      "每个实体写：所属模块、关键字段、上下游。",
    ],
  },
  "specification.state-machine": {
    doc: "specification",
    clause: "state-machine",
    title: "状态机",
    summary: "状态机要写全转移与守卫：状态流转、触发条件、允许操作、异常/终态。",
    lines: [
      "每个「单据/对象」都要在权限矩阵（状态策略）里有对应行——缺了就是按状态的权限没回答。",
    ],
  },
  "specification.permission-matrix": {
    doc: "specification",
    clause: "permission-matrix",
    title: "权限矩阵（状态策略）",
    summary: "每个对象的每个状态写：可操作项、可见字段、只读字段。",
    lines: [
      "「单据/对象」与状态机逐行对应：状态机里出现的每个对象，这里都要有行。",
    ],
  },
  "specification.page-behavior": {
    doc: "specification",
    clause: "page-behavior",
    title: "页面行为",
    summary: "列表页必须写默认排序和行操作；表单页必须写提交后行为。",
    lines: [
      "「页面」名字与页面清单双向包含——整行相等，或一方包含另一方。写到匹配不上的名字，开发和评审会对不上号。",
    ],
  },
  "specification.approval-flow": {
    doc: "specification",
    clause: "approval-flow",
    title: "审批流",
    summary: "每条审批流写：节点顺序、审批人来源、审批操作集。",
    lines: [
      "驳回与撤回有规则就写在这里，别散在正文里。",
    ],
  },

  // ---------------------------------------------------------- tasks
  "tasks.task": {
    doc: "tasks",
    clause: "task",
    title: "实施任务",
    summary: "每条任务写：编号、引用的需求/架构/规格编号、完成条件、验证方法。",
    lines: [
      "引用可以是具体编号、通配（KEEP-*）、区间（DEL-DIR-002 至 DEL-DIR-005）——但要让人读得出指的是哪一族。",
      "拆任务要先勘察代码现状；不知道现状拆出来的任务是编的。",
    ],
  },
});

/**
 * 按类型取条目。未知类型返回 null，不猜。
 * @param {string} type 例 "specification.behavior"
 * @returns {GuideEntry | null}
 */
export function guideFor(type) {
  if (!type || typeof type !== "string") return null;
  return SPEC_GUIDE[type] ?? null;
}

/** 全部类型键，有序。 */
export function listGuideTypes() {
  return Object.keys(SPEC_GUIDE).sort();
}
