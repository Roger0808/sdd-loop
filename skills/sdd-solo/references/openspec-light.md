# OpenSpec Light 交付规则

本文件只在 `repositories.json.deliveryMode` 已由用户确认为 `openspec-light` 后读取。它是低风险需求的连续交付路径，不是缩写版的完整 SDD Loop，也不能声明完整治理门禁已经通过。

## 适用前提

进入本路径前，主 Skill 必须已经：

- 基于相关代码和最新远程基线完成需求澄清；
- 确认目标、范围、非目标、参与仓和可执行验收标准；
- 确认任务可按仓拆清，验证和回滚方式可信，并排除需要独立架构/治理门禁的实质复杂度；
- 通过“需求确认 + 推荐模式”联合确认卡获得用户确认。

缺一项都不能开始。仓库数量、预计文件数、代码行数、是否触及跨仓调用都不改变这组前提。业务逻辑简单且边界清楚时，多仓需求仍应优先使用本路径。

下列情况仍可使用本路径：简单的跨仓调用联动；新增可选字段；向后兼容的 API、事件或消息扩展；生产者与消费者同步做范围明确的适配；可回滚、无复杂存量数据处理的兼容性数据结构调整。前提是调用两端已检查，兼容策略、发布顺序、回滚方式和契约/集成验证已经写清并可执行。

## 连续执行序列

确认后在同一轮连续完成：

```text
Proposal → Spec → Tasks → Apply → Verification → Release Checklist → Trace Export → Solo Check → 结果报告
```

1. 先识别主仓已有的 OpenSpec 目录、命令和 change ID 约定；沿用现有约定，不另造平行目录或第二套规范。创建 change 目录后，把联合确认使用的临时参与清单固化到该 change 的 `sdd-solo/repositories.json`（或项目既有元数据位置），轻量模式不得为此创建 demand unit 或写入 `activeLoop`。
2. 用已确认需求直接生成 Proposal、Spec 和 Tasks。三者必须共享同一 change ID，并把任务映射到明确的 `repositoryId`；跨仓契约不变时写清保持不变，发生兼容性调整时写清新旧行为、兼容策略、调用两端任务、发布/回滚方式和契约验证。
3. 生成后做一致性自检：需求与验收是否完整映射、Tasks 是否覆盖所有参与仓、每项任务是否有验证方法。发现普通笔误或内部遗漏时直接修正。
4. 不得在 Proposal、Spec、Tasks 之间再次要求用户确认，也不得在 Apply 前再停一次。只有本文件“升级与停止条件”命中时才暂停。
5. 按固定基线和已记录分支，从主仓对话操作所有参与仓完成 Apply。每项改动回写对应 Task 状态，并记录仓库、文件/change surface 和实际 commit 或工作树指纹。
6. 对每个参与仓执行与改动相称的必要构建、测试、静态检查或人工验证；把命令、结果、未执行项及理由写回主仓 OpenSpec 变更记录。一个仓的通过不能替代另一个仓的验证。
7. 按 [release-checklist.md](release-checklist.md) 补全主仓上线执行清单。每个参与仓都要有发布或不发布结论；SQL、项目配置、FilerUI 配置、验证和回滚都要有可勾选条目或带原因的 N/A。把清单状态置为 `ready`，但不要把尚未执行的上线动作预先勾选。
8. 按 [trace-export.md](trace-export.md) 的轻量模式向每个非主仓参与仓刷新并提交只读追溯内容，从参与仓 commit 重新校验来源、协议文件和 hash；只生成工作树文件不算完成。
9. 把清单 `closure.state` 置为 `ready`、`aggregateReview.outcome` 置为 `NOT_REQUIRED`，运行 `sdd-loop solo check ... --write-receipt`。退出非 0、上线清单不完整、任一 participant 未达 `verified` 或凭据缺失时不得报告完成。
10. 汇总已完成任务、各仓变更、验证结果、上线执行清单、未决风险、追溯 commit 和机器凭据，向用户报告并等待验收。
11. 等待用户验收并明确同意后，确认清单和凭据指纹未变化，才执行 OpenSpec Archive。用户未验收、要求继续调整、验证不通过或凭据漂移时不得归档。

这一模式不要求创建 Architecture、Architecture Baseline、独立 Requirements AI Review、repository readiness receipt、逐仓独立 AI Review、跨仓聚合 AI Review 或完整 SDD 审计。不得把独立 AI Review、Architecture Baseline、readiness receipt 或跨仓聚合审查设为必经门禁。项目已有更严格的强制规则仍优先；若这些规则使轻量路径不再成立，应升级为 `full`，不能伪造豁免。

## 升级与停止条件

执行中出现以下任一情况，立即停止轻量路径并建议升级为 `full`：

- 新需求、范围扩张或新的参与仓使原确认失效；
- 出现破坏性或无法向后兼容的 API、事件、消息、共享数据契约变化，或者必须多仓同步切流；
- 出现复杂数据迁移/回填/兼容窗口，重大权限、安全、资金或合规行为变化，或者复杂多阶段发布；
- 出现需要单独批准的架构分歧、项目明确要求完整治理、高风险/不可逆/高爆炸半径操作或未经授权的外部操作；
- 实现与已确认 Spec 冲突，或无法设计可信的验证和回滚；
- 验证失败揭示的是需求/架构问题，而不是范围内的普通实现缺陷。

新增参与仓或发现契约变化时，先重新评估，不机械升级。若需求语义仍简单，契约向后兼容，发布与回滚独立可控且验证充分，可更新联合确认内容后继续 `openspec-light`；只有命中上述触发项才升级。

升级时保留已有事实和 OpenSpec 草稿作为输入，但把 `deliveryMode` 更新为 `full` 前必须展示变化原因和新增风险并由用户确认。原轻量模式确认不能冒充完整 SDD 的 Requirements、Architecture 或 Review 审批。
