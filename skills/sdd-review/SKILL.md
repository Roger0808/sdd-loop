---
name: sdd-review
description: 在 SDD Loop 实施和自动化验证完成后，反向更新长期架构、生成 change surface，并组织独立只读 AI 代码审查与人工审查包。用户说「审查本轮实现」「/sdd review」或当前 Loop 进入 Verification 收口时使用。不负责修复审查发现，不替人工确认。
---

# SDD Review：从实现事实到人工签字

## 入口门禁

1. 运行 `sdd-loop check`，只处理当前流的活跃 Loop。状态不可读或声明与事实矛盾时停止。
2. Requirements、Architecture、Specification 和 Tasks 必须已确认，Implementation 必须存在。
3. `implementation.md` 必须记录基线分支、基线 commit、当前分支和任务范围。存量 Loop 缺少基线时向用户确认，不从 merge-base 或日期猜。
4. 自动化测试、构建、部署和必要人工检查已运行，或者未运行项已如实记录。`skip` 不等于通过。
5. 读取 `sdd-init/references/extensions/`，逐项复核 Testing、PBT、Security、Resiliency；项目自定义扩展按 `enabledExtensions` 加载。没有 PBT 库不构成 N/A 理由。

## 固定本次审查对象

生成并记录指纹：基线 commit、HEAD、`git status --short`、任务范围、已跟踪 diff 的哈希，以及纳入审查的未跟踪文件清单与内容哈希。不为了审查强制提交；审查未提交改动时，指纹必须包含它们。分流仓库还要从本轮 change surface 生成去重、排序后的 `deliveryScope`：只列仓库相对文件或目录，覆盖本轮真实交付的代码、配置、迁移、测试和长期文档；不把别的流目录塞进来，也不得为了让 C10 变绿漏掉共享文件。

审查完成后再计算一次。代码、配置、迁移、测试、Loop 关键文档或 Architecture Baseline 任一变化，旧审查失效，必须重跑。

## 先反向更新架构

在人工审查前，实施 Agent 根据最终代码更新长期 Architecture Baseline。优先沿用已有 `docs/architecture/` 结构；没有时，单系统默认 `docs/architecture/overview.md`，分流默认 `docs/architecture/<stream>.md`。图只用 Mermaid 或 ASCII。

完成后写 change surface，对下列每类给出“影响项 + 证据路径”或明确写“无”：代码与模块边界；公开接口与兼容性；配置、权限与安全；数据模型、迁移与回滚；运行时、部署与可观测性；测试与验收；Loop 文档、README 与长期架构。

完成回写后记录 `architecture_reconciled` 事件。事件由工具绑定当前代码指纹；之后任何非审计、非状态文件变化都会使它失效。

## 工程扩展证据

在 AI Review 前为每个启用扩展记录一次 `extension_evaluated`：

| 扩展 | PASS 必须有 | N/A 边界 |
|---|---|---|
| Testing | 命令、环境、退出码、AC 映射和未覆盖范围 | 仅在确实没有可执行行为时使用 |
| PBT | Property、生成域、caseCount、seed、失败反例/回归样本 | 无有价值不变量；“没有库”不算理由 |
| Security | 信任边界、负向测试或检查证据、剩余风险 | 不涉及输入、权限、秘密、依赖或数据边界 |
| Resiliency | 故障场景、超时/重试/幂等、回滚和观测证据 | 无运行时或外部依赖 |

没有 PBT 库但存在简单不变量时，用现有测试框架加测试目录内的确定性随机生成器：固定 seed、明确样本数、输出失败输入，并把缩减后的最小反例固化为普通回归测试。复杂生成或自动 shrinking 才申请新增成熟依赖，不在项目里自造通用 PBT 框架。

## AI Review 前的人类选择门禁

自动化验证、架构回写和工程扩展证据完成后，**在启动任何 reviewer 前停下来**，向人类问一次：「这轮 AI Review 要留在当前 Agent 的只读 subagent 上跑，还是换一个 Agent？」，然后结束当前响应，等待人类在后续消息中选择。不得把先前的阶段批准、Continue、上一轮的审查者或默认宿主当成本轮授权；审查失效需要重跑时重新询问。未取得明确选择，不启动 AI Review，也不写 `review_completed`。

- **留在当前 Agent**：由当前 Agent 启动没有实施上下文的独立只读 subagent，把审查对象和任务交给它。当前 Agent 本体只能准备材料、接收结果和整理审查包，不能自行审查。当前运行环境不能启动 subagent 时停止并说明，不能退化为同一 Agent 清理上下文后自审。
- **换一个 Agent**：若人类没有点名，先问「要换到哪个 Agent/宿主？」并再次停下等待。确认后生成针对该 Agent 的 handoff，交给人类或其指定的协作渠道；不擅自启动外部会话、发送消息或在当前 Agent 上代审。handoff 至少写明目标宿主/Agent 的审查 Skill 入口、可访问的仓库 ref、流/Loop、基线 commit 与当前 HEAD、审查指纹、已确认阶段文档和 Architecture Baseline 路径、任务范围、原始 diff 与 change surface、验证及扩展证据、只读边界、三个允许的结论、发现所需的文件/行号/复现证据，以及结果如何交回本轮 `verification.md`。若审查对象包含未提交改动且目标 Agent 无法读同一工作区，先确认安全的 diff/文件交接方式；材料未交齐时不得宣称审查已启动。仅提供必要材料，不附本机绝对 worktree 路径、Secrets 或无关会话记录。目标 Agent 也必须在与实施上下文隔离的只读 reviewer 会话或 subagent 中执行；若做不到，报告 `NOT_REVIEWABLE_SAFELY`，不要假称独立审查。

独立 reviewer 只给已确认文档、实施基线、当前指纹和原始 diff。reviewer 只读：可以运行不改代码的复现、测试和构建，不修复问题、不修改文档、不替用户确认。审查结果回来后，当前 Agent 重新校验指纹；代码或关键文档变化时旧结果失效，并从自动化验证和架构回写重新开始。

审查要对照任务与规格，覆盖：正确性、边界/失败/权限路径、兼容性、数据与回滚、配置/部署、测试有效性、文档和 Architecture Baseline 是否与代码一致。只报告可复现、有具体文件/行号和影响的发现。

## 写入 verification.md

`verification.md` 保持 `draft`，并固定包含四节：

1. **Automated Verification**：命令、环境、退出码、结果和未执行项。
2. **Architecture Reconciliation & Change Surface**：更新的 Baseline 路径、反向对账结论和七类改动面。
3. **AI Code Review**：人类选择的审查路径、reviewer 身份、handoff/结果来源、指纹、发现、残余风险和唯一结论。handoff 发出但结果未返回时保持待审，不把选择或交接写成审查完成。
4. **Human Review Packet**：人工应重点看的 diff、架构图、验证证据、未决项，以及尚未填写的确认人/时间/版本/指纹。

最终只能给出一个 AI 结论：

- `READY_FOR_HUMAN_REVIEW`：没有已知阻断问题，人工可开始审查；这不等于人工通过。
- `CHANGES_REQUIRED`：返回 Implementation，修复后从自动化验证和架构回写重新开始。
- `NOT_REVIEWABLE_SAFELY`：基线、diff、环境或证据不足，不给通过/失败判断。

实施基线缺失、审查对象无法固定或 Architecture Baseline 尚未完成反向对账时，必须给 `NOT_REVIEWABLE_SAFELY`；自动化验证失败或 reviewer 有阻断发现时，必须给 `CHANGES_REQUIRED`。两者都不得进入人工通过或关闭 Loop。

治理模式下用 `review_completed` 记录唯一结论。只有当前指纹已有 `architecture_reconciled` 且四项扩展均为 PASS 或合理 N/A 时，工具才接受 `READY_FOR_HUMAN_REVIEW`；分流仓库还必须在该事件写入本轮 `deliveryScope`。这个范围随 AI Review、人工签署和 `loop_closed` 一起固定，关闭后 C10 只重算它，因此其他流修改自己范围不会使本流变红。

## 人工门禁

只有人工明确通过当前指纹对应的审查包，并在 `verification.md` 记录确认人、时间、审查版本和指纹后，才能把 verification 改为 `confirmed` 并关闭 Loop。AI 不得从“用户没有反对”、以前 Loop 的确认或 `READY_FOR_HUMAN_REVIEW` 推导人工已经通过。

人工明确通过后记录 `human_signed`；随后按项目规则归档六份阶段文档并更新 `activeLoop` / `lastClosedLoop`，最后记录 `loop_closed`。两者都要求 Approver 的 Git 邮箱与状态文件角色映射一致；关闭事件允许阶段文档从活跃目录迁入归档，但会拒绝签署后发生的代码、配置或长期文档变化。

## 已关闭 Loop 的交付漂移

新版本关闭的分流 Loop 已由 `deliveryScope` 隔离：别的流或新一轮只要没有修改该范围，就不应触发 C10。只有该范围自身后续变化才进入漂移接受；此时不重开旧 Loop，不改写审计分片，也不补造 `review_completed`、`human_signed` 或 `loop_closed`。先列出从最近一次 `loop_closed`（或最近一次漂移接受）到当前版本在保护范围内的变化，确认没有改动该 Loop 自己的已归档阶段文档、审计记录或签署事实，再把变化清单、核对依据和剩余风险交给人类 Approver。

只有 Approver 明确接受当前漂移后，才通过内部治理入口追加 `closure_drift_accepted`。事件 JSON 至少包含：`type: "closure_drift_accepted"`、`role: "approver"`、非空 `summary`、解释为什么可接受的 `reason`，以及列出已核对签署后变化的 `evidence`；分流仓库仍须传 `--stream`。没有 `deliveryScope` 的存量分流 Loop 还必须在第一次接受时补录真实范围；已有范围时沿用原值，工具拒绝关闭后缩小或替换。事件只绑定记录当时的范围指纹，不改变原审查与签署指纹；之后该范围再次变化，C10 必须重新变红并再次人工核对。旧 CLI 不认识该事件时会继续报红，不能把旧工具的结果解释成已经接受。未取得明确接受、原关闭链不完整、当前没有实际漂移或无法说明变化范围时停止，不记录事件。
