---
name: sdd-solo
description: 在一个主仓和同一场对话中，由一名开发者完成跨多个 Git 仓库的同一需求。用于“一个人改多个仓库”“多仓需求”“/sdd solo”：先基于代码澄清需求并固定远程基线，再按风险推荐完整 SDD 或 OpenSpec 轻量交付；全程由 Agent 从主仓操作参与仓并留下可追溯证据。不是多人并发模型；同仓多需求并发由 demandId 负责。
---

# SDD Solo：单人、单会话、多仓需求

## 不变的交互模型

- 用户最初进入的仓库就是主仓；所有访谈、确认、实现、验证和收口都在这一场对话完成。
- 不要求用户切换仓库，也不要求在参与仓另跑一遍 SDD 或 OpenSpec 命令、开启另一场对话。Agent 从主仓访问参与仓并执行必要操作。
- `sdd-solo` 解决“一个需求跨多个仓库”；`demandId` 解决“同一仓库并行多个需求”。两者正交，不得把参与仓当成 stream，也不能靠 `sdd-solo` 规避并发门禁。
- 主仓保存唯一可编辑的需求事实和跨仓设计；参与仓只保存与本仓有关的只读追溯内容，不建立第二份可独立演化的需求。
- 交付模式只有 `full` 和 `openspec-light`。先完成需求澄清，再推荐交付模式；不能让用户在事实尚不清楚时凭感觉选择。

## 入口与按需读取

1. 先运行 `sdd-loop capabilities --require solo@1 --host <当前宿主>`。它只验证 Solo 协议、资源和当前宿主能否发现 `sdd-solo`；失败就停止 SDD Solo 工作，不自动安装或升级。
2. 读取 [participant-manifest.md](references/participant-manifest.md)，从 `assets/repositories.json` 创建参与清单并填实际值，不删字段。
3. 先执行下文的需求发现、澄清和模式评估。模式确认前不要提前创建后续阶段空壳。
4. 确认 `full` 后读取 [repository-unit.md](references/repository-unit.md)、[release-checklist.md](references/release-checklist.md) 与 [trace-export.md](references/trace-export.md)，并按完整 SDD 路径执行。
5. 确认 `openspec-light` 后读取 [openspec-light.md](references/openspec-light.md)、[release-checklist.md](references/release-checklist.md) 与 [trace-export.md](references/trace-export.md)，连续执行轻量路径。

确认或继续 `full` 后，先读取所选 demand 的 `status.md`，再按其实际版本运行 `sdd-loop capabilities --require governance@1 --host <当前宿主>` 或 `governance@2`；`solo@1` 不能代替治理能力预检。v1 demand 运行 `sdd-loop check --demand <demandId>`；当前分支能唯一匹配时可省略 `--demand`。v2 demand 还要加载 `sdd-route`，所有 `workflow recommend/show/start` 都传同一个 `--demand <demandId>`（当前分支唯一匹配时可省略），后续事件写入该 demand 中锁定的 workflow run。不得把 v1 的阶段审计和 v2 的 workflow 事件混写。

新需求的 demand unit 尚未创建时，不得对不存在的 ID 运行 check：先检查仓库当前布局，尚未初始化则只执行一次 `sdd-init`，仍是旧单元布局则按 `sdd-upgrade` 的“旧单元迁移”处理，再由 `sdd-interview` 创建 demand unit 和 Requirements。创建后依据该 demand 声明的 `governanceVersion` 选择上面的 v1 或 v2 路径。`openspec-light` 不需要治理能力预检，也不伪造 `activeLoop`、workflow run、阶段审批或普通 Loop 已通过的状态。

## 需求身份与命名

新需求只向用户确认一次 `demandId` 和需求标题；从中生成标题简写并固定下列名称，不要求用户为每个参与仓重复输入：

- 对话名称：`[SDD Solo][{demandId}] {需求标题}`。
- 标准分支：`feature/{yyMMdd}_{demandId}_{标题简写}`，其中日期取首次生成命名的日期并写入清单，后续继续需求时不得随当天日期重算。

标题简写应简短可辨识，并移除 Git ref 不允许的字符。宿主支持修改当前对话标题时自动设置；不支持时只提示建议名称。对话标题不是治理门禁，外部改名也不使需求证据失效。

所有参与仓默认使用同一个标准分支名。最终参与仓和交付模式确认后、正式 Apply 或 Implementation 前，逐仓从已固定的远程基线准备分支，并在清单记录标准分支、实际分支、处置方式和例外原因：

- 已在该标准分支时复用，不能重复创建。
- 已有属于本需求的其他分支，或工作区含本需求未提交改动时，保留实际分支并记录 `exception`；不得为了命名统一强制切换、重建或搬移改动。
- 工作区存在归属不明或与本需求无关的改动，无法安全准备分支时停止，请用户处理或确认，不擅自 stash、清理或覆盖。
- 新建标准分支时必须以该仓已固定的远程基线 commit 为起点，不能从陈旧本地分支创建。

处置方式只使用 `pending`、`created`、`reused`、`exception`。标准分支不一致但例外理由完整时可以进入实施；实际分支未记录则不得进入。

## 公共前置流程：发现、澄清、一次确认

### 1. 发现候选仓库并固定事实基线

只在本机可访问范围内发现仓库。若没有稳定目录表，只问用户一次“这次允许扫描哪些工作区根目录”；路径仅用于当前会话，不写入阶段文档、审计或导出包。不能发现未克隆、无权限或不在授权范围内的仓库，必须明确披露。

从原始需求出发，读取主仓代码、依赖声明、远程地址、接口客户端、配置、事件、数据链路和部署关系，再到允许范围内寻找候选仓。对每个候选仓获取远程信息，以最新远程 `master`（仓库没有该分支时记录真实默认分支并请用户决定）为分析基线，记录 remote URL、branch 和 commit。不得把当前工作树、陈旧本地 master 或猜测当成远程事实。

把候选、纳入/排除建议、证据和不可访问项展示给用户，由用户确认最终参与仓及主仓。按 [participant-manifest.md](references/participant-manifest.md) 维护 `repositories.json`；模式确认前使用临时工作副本，确认后再写入对应模式的正式位置。

### 2. 严谨澄清需求

先阅读相关代码、配置、接口和数据链路，再逐项提出会影响范围、行为或验收的疑问。每个问题都给出建议答案和代码依据；不能把可由代码确认的事实原样甩给用户。持续追问，直到目标、范围、非目标、用户场景、约束、跨仓影响和可执行验收标准都清楚。

发现新事实会改变参与仓时，先更新候选建议并让用户确认范围，再继续。不得在关键疑问未解决时生成正式 Proposal、Specification、Tasks 或开始写代码。

### 3. 按风险推荐模式

需求清楚后，由 Skill 评估并推荐模式，而不是要求用户自己判断：

- 默认优先推荐 `openspec-light`：关键疑问已经解决，范围/非目标/验收清楚，相关仓库与代码已经检查，任务能按仓拆清，且验证与回滚方式可信即可。需求业务逻辑简单时，即使涉及多个仓库也不因此升级为 `full`。
- 仓库数量、预计代码行数、是否触及跨仓调用都不是 `full` 判定条件。新增可选字段、兼容性接口扩展、生产者与消费者同步做简单适配等跨仓契约变化，在调用两端已查清、向后兼容、发布顺序安全、回滚明确且可执行契约验证时仍可走 `openspec-light`。
- 只有存在需要独立架构/治理门禁的实质复杂度时才推荐 `full`：尚有会影响方案的领域歧义或多个架构方案需要单独批准；破坏性契约变化或必须协同切流；复杂数据迁移、回填或兼容窗口；重大权限/安全/资金/合规行为变化；复杂多阶段发布；不可逆或高爆炸半径操作；项目明确要求完整治理；或者无法给出可信的验证和回滚方案。
- 仅仅修改数据库、权限模块或跨仓接口的代码，不自动命中 `full`；必须判断变化的兼容性、敏感性、迁移复杂度和失败影响。例如可回滚的兼容性加字段可以轻量，权限语义扩大或存量数据重写通常需要完整流程。
- 风险无法确认或事实不可验证时，先继续查代码和提问。只有澄清后仍存在上述实质风险，或客观上无法验证关键事实时，才推荐 `full`；不得把“未知”直接等同于“复杂”，也不得把未知当成低风险。
- 用户始终可以把 `openspec-light` 提升为 `full`。若仍存在 `full` 触发项而用户希望轻量，应先缩小范围、增加兼容/回滚措施并重新评估，不能只改模式名称绕过风险。

把结论写入 `repositories.json.modeDecision`，但在用户确认前保持 `deliveryMode: null`。

### 4. 只展示一次联合确认卡

向用户展示一张“需求确认 + 推荐模式”卡，至少包含：

- demandId、需求标题、建议对话名称和标准分支；
- 最终需求摘要、范围、非目标和验收标准；
- 主仓、参与仓、各仓远程基线 commit 和不可访问项；
- 推荐模式、判定依据、已排除/仍存在的风险；
- 用户可选择接受推荐或提升为 `full`。

用户一次确认同时确认需求事实、参与仓范围和交付模式。确认后写入 `deliveryMode`、确认人和时间，不再重复询问同一内容。若确认的是 `full`，这张卡可作为正式 Requirements 审批输入，但后续仍遵守完整 SDD 的 Continue 与阶段门禁；若确认的是 `openspec-light`，立即按轻量路径自动推进。

## 两种模式共用的上线执行清单

从实施开始即可按 [release-checklist.md](references/release-checklist.md) 维护主仓唯一的 `release-checklist.md`。它必须用简明、可勾选的条目集中说明：发布哪些项目及顺序、SQL 脚本、项目配置、FilerUI 配置、发布后验证和回滚；不涉及的类别也要写 `N/A` 和具体原因。不得把密码、Token、连接串或配置密钥明文写入清单。

在最终交付提交、`openspec-light` 结果报告或 `full` 候选冻结之前，清单必须消除全部待定项并达到 `ready`，每个 participant 都必须在发布顺序中有明确动作或不发布原因。`ready` 只表示计划完整，未实际执行的上线动作保持 `[ ]`；Agent 只能在取得真实执行证据后代为勾选，不能为了通过门禁预先写成 `[x]`。

清单正文和其规范化 hash 是 Solo 机器收口证据。正文变化会使旧凭据失效；实际执行时仅切换已有复选框的勾选状态不会改变计划指纹。清单只在主仓编辑，不能在参与仓维护另一份会独立演化的版本。

## `full`：完整 SDD 路径

### 1. 主仓完成唯一需求生命周期

在主仓 demand unit 内完成 Requirements → Architecture → Specification → Tasks。Requirements 必须覆盖跨仓目标、范围、非目标、约束、成功标准和参与仓清单；Architecture/Specification 固定跨仓契约、依赖顺序、兼容窗口、数据与发布策略；总体 Tasks 指向各 repository unit。

- `governanceVersion: 1`：继续使用该 demand 的阶段门禁、独立 Continue 和 v1 审计事件。
- `governanceVersion: 2`：由 `sdd-route` 为该 demand 推荐并由用户确认 `loop`，`workflow start --route loop --demand <demandId>` 锁定定义；六份 Loop 文档与 `stage_completed`、`candidate`、`final_test`、`reconciliation`、`review`、`signoff`、`close` 事件均落在这个 run。项目若提供 `docs/sdd/workflows/demands/<demandId>/loop/workflow.md`，它优先于仓库级定义；启动后不得借修改定义重释已锁定流程。

Requirements 梳理完成后、进入实现前，必须由与需求整理上下文隔离的只读 AI reviewer 审查一次，记录结论、发现、版本指纹和处置。它不替用户批准；发现修复后重新审查。随后仍按治理规则逐阶段由用户批准，并在后续消息 Continue。

### 2. Agent 从主仓操作各参与仓

用户确认 Tasks 后，Agent 在同一会话中逐仓实施。需要隔离并行改动时可为各仓使用分支或 worktree，但这是 Git 实现细节，不改变用户只在主仓交互的模型。

每个参与仓都在主仓的 `repositories/<repoId>/` 下维护本仓 Tasks、Implementation、Verification、Review 和 readiness receipt，格式见 [repository-unit.md](references/repository-unit.md)。证据必须来自该仓真实代码与命令；不得把别仓测试、提交或审查结果算到本仓。执行路径可在对话中使用，但文档只保存仓库 ID、规范 remote、分支和 commit，不保存本机绝对路径。

### 3. 分仓实现、验证与审查

所有仓实现完成后：

1. 每仓独立验证规格映射、构建/测试、接口兼容、迁移/回滚、配置与发布条件。
2. 每仓进行只读 AI 代码审查，结论限定为 `READY_FOR_HUMAN_REVIEW`、`CHANGES_REQUIRED`、`NOT_REVIEWABLE_SAFELY`。
3. 按最终代码和部署事实补全 `release-checklist.md`，确认所有上线类别、每个参与仓及发布/回滚顺序都有结论，然后将清单置为 `ready`。
4. 所有仓 ready 且上线清单完整后冻结主仓权威来源 commit。此时尚不能组织最终人工审批。

### 4. 先导出并提交追溯包，再聚合审查和审批

按 [trace-export.md](references/trace-export.md) 的完整模式向每个非主仓参与仓写入只读追溯包，提交到对应参与仓，并从该 commit 重新校验文件 hash、主仓来源 commit、需求版本和本仓 receipt。只生成工作树文件、只更新主仓状态或计划“关单后补录”都不算完成。

全部参与仓的 `traceExport.state` 达到 `verified` 后：

1. 回到主仓做跨仓聚合审查：核对契约两端、版本兼容窗口、数据链路、部署先后、失败回滚、观测、全部 readiness receipt、参与仓追溯 commit 和 package hash。任一仓未就绪，聚合不得通过。
2. 将 `closure.state` 置为 `ready`，运行 `sdd-loop solo check ... --write-receipt`。命令会同时核对上线清单的内容与规范化 hash；退出非 0 或没有生成机器收口凭据时，不得继续。
3. v1 在机器凭据固定后才组织最终人工审批并记录既有人工签署事件；v2 必须在记录 `candidate` **之前**完成导出、聚合审查和机器收口，候选会把 manifest 与凭据的 hash 纳入指纹，然后依锁定图执行 `final_test`、`reconciliation`、`review` 和 `signoff`。
4. v2 在 `candidate` 后、v1 在人工批准后，任何主需求、repository receipt、参与仓追溯 commit、聚合审查、manifest 或机器凭据变化都会使旧候选/审查/签署失效，必须重新导出、校验并从相应门禁重新执行。

整个跨仓需求只组织一次最终人工审批，不要求各参与仓分别审批。

参与仓追溯包不得复制主仓 `status.md`、主仓 audit、主仓 Architecture Baseline、其他仓的实现/测试/提交，或任何会暗示参与仓独立通过全部门禁的状态。

需求变化只在主仓重新确认，然后刷新所有受影响快照；参与仓内不得独立编辑快照。机器收口检查和最终人工审批/签署都通过后，才按依赖顺序合并各仓并聚合关闭主 demand unit。真正合并的 commit 必须就是已经校验并纳入候选/审批证据的参与仓 commit；若合并动作产生新的交付 commit 或内容变化，必须更新清单、重新导出校验并重走受影响的审查与签署，不能先验收旧 commit 再把新 commit 当作同一证据。v1 `loop_closed` 与 v2 `workflow close` 都必须重新验证收口凭据；凭据缺失或固定证据漂移时关闭失败。

## `openspec-light`：确认后连续交付

模式确认后按 [openspec-light.md](references/openspec-light.md) 一气呵成地生成主仓 OpenSpec Proposal、Spec 和 Tasks，从同一场对话操作所有参与仓实施并完成必要验证，补全上线执行清单，导出并提交轻量只读追溯内容，运行 `sdd-loop solo check ... --write-receipt` 成功后再报告结果。中途不重复要求用户确认已确认的需求或文档。

轻量路径在用户验收前停止，不自动 Archive。执行中一旦发现 `full` 触发项、关键歧义、范围扩大或无法给出可信验证/回滚，立即停止轻量路径并建议升级为 `full`；普通的跨仓联动或兼容性契约调整本身不触发升级。不得静默补写成完整 SDD，也不得继续按低风险处理。

## 通用停止条件

参与仓范围未确认、基线不是可验证的远程 commit、关键需求仍有疑问、模式未确认、工作区状态无法安全隔离或需要未获授权的破坏性/外部操作时，不得进入实施。

`full` 还必须在 Requirements 独立审查、各阶段门禁、全部 receipt、分仓审查、上线执行清单、追溯包提交与校验、聚合审查、机器收口凭据和最终人工审批均满足后才能关闭。`openspec-light` 必须在必要验证、上线执行清单、轻量追溯包提交与校验、机器收口凭据均完成后报告结果，并等待用户验收后才能 Archive。任何模式缺少已就绪的上线清单、参与仓追溯 commit 或机器凭据都不是“已完成”，不得事后补录冒充当时已过门禁。
