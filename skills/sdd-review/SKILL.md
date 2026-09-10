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

生成并记录指纹：基线 commit、HEAD、`git status --short`、任务范围、已跟踪 diff 的哈希，以及纳入审查的未跟踪文件清单与内容哈希。不为了审查强制提交；审查未提交改动时，指纹必须包含它们。

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

## 独立 AI Review

优先启动一个没有实施上下文的独立 reviewer，只给它已确认文档、实施基线、当前指纹和原始 diff。reviewer 只读：可以运行不改代码的复现、测试和构建，不修复问题、不修改文档、不替用户确认。

无法启动独立 reviewer 时，同一 Agent 只能在清理实施推理上下文后做一次独立审查，并在报告顶部标注“降级：非独立 reviewer”。

审查要对照任务与规格，覆盖：正确性、边界/失败/权限路径、兼容性、数据与回滚、配置/部署、测试有效性、文档和 Architecture Baseline 是否与代码一致。只报告可复现、有具体文件/行号和影响的发现。

## 写入 verification.md

`verification.md` 保持 `draft`，并固定包含四节：

1. **Automated Verification**：命令、环境、退出码、结果和未执行项。
2. **Architecture Reconciliation & Change Surface**：更新的 Baseline 路径、反向对账结论和七类改动面。
3. **AI Code Review**：reviewer 身份/降级、指纹、发现、残余风险和唯一结论。
4. **Human Review Packet**：人工应重点看的 diff、架构图、验证证据、未决项，以及尚未填写的确认人/时间/版本/指纹。

最终只能给出一个 AI 结论：

- `READY_FOR_HUMAN_REVIEW`：没有已知阻断问题，人工可开始审查；这不等于人工通过。
- `CHANGES_REQUIRED`：返回 Implementation，修复后从自动化验证和架构回写重新开始。
- `NOT_REVIEWABLE_SAFELY`：基线、diff、环境或证据不足，不给通过/失败判断。

实施基线缺失、审查对象无法固定或 Architecture Baseline 尚未完成反向对账时，必须给 `NOT_REVIEWABLE_SAFELY`；自动化验证失败或 reviewer 有阻断发现时，必须给 `CHANGES_REQUIRED`。两者都不得进入人工通过或关闭 Loop。

治理模式下用 `review_completed` 记录唯一结论。只有当前指纹已有 `architecture_reconciled` 且四项扩展均为 PASS 或合理 N/A 时，工具才接受 `READY_FOR_HUMAN_REVIEW`。

## 人工门禁

只有人工明确通过当前指纹对应的审查包，并在 `verification.md` 记录确认人、时间、审查版本和指纹后，才能把 verification 改为 `confirmed` 并关闭 Loop。AI 不得从“用户没有反对”、以前 Loop 的确认或 `READY_FOR_HUMAN_REVIEW` 推导人工已经通过。

人工明确通过后记录 `human_signed`；随后按项目规则归档六份阶段文档并更新 `activeLoop` / `lastClosedLoop`，最后记录 `loop_closed`。两者都要求 Approver 的 Git 邮箱与状态文件角色映射一致；关闭事件允许阶段文档从活跃目录迁入归档，但会拒绝签署后发生的代码、配置或长期文档变化。
