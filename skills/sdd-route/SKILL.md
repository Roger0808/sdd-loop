---
name: sdd-route
description: 根据任务描述推荐并确认 Loop、Hotfix 或 Debug，随后固定项目或流级 workflow.md 并按治理 v2 执行。
---

# 动态工作流路由

1. 先读当前仓库的 `AGENTS.md`、状态与 `sdd-loop check`。已有 v1 活跃工作不得自动迁移；需要恢复跨流误报时使用 `legacy_scope_reconciled` 的显式差量核对，保持原阶段和签署规则。
2. 将用户任务原文写入临时文件，运行 `sdd-loop workflow recommend --request-file <file> --repo <repo> [--stream <stream>]`。展示推荐的路线、理由及 `workflow show --route <route>` 所得阶段依赖、Review 与签署策略。**必须等用户确认具体路线**，不能把工具推荐视为授权。
3. 新工作需 `governanceVersion: 2`。将用户确认原文与选定 route 写入 JSON 文件：`{"route":"loop","input":"用户的确认原文"}`。调用 `sdd-loop workflow start --route <route> --confirmation-json <file> --repo <repo> [--stream <stream>] [--id <id>]`。启动输出的 `runDir` 是之后的固定审计落点。项目定义放在 `docs/sdd/workflows/<route>/workflow.md`；流级完整覆盖放在 `docs/sdd/workflows/<stream>/<route>/workflow.md`。工作启动后不得借配置修改重释已锁定流程。
4. Loop 继续维护六份阶段文档，Hotfix 在候选前维护单份 confirmed 的 `hotfix.md`，Debug 在关闭时回溯生成 archived 的 `debug.md`。`stage_completed` 记录文档确认与证据；Requirements 必须含 `confirmation` 用户原文。人工手测期间用 `cycle` 事件简记 `issue`、`fixScope`、`targetedTest`、`deployment`、`retest`。产品行为变化先记录有用户 `confirmation` 的 `decision`；架构影响记录 `impact`。本期间不反复触发完整文档回写、正式 Review 或签署。
5. 稳定后只改受影响文档并重新记录对应 `stage_completed`，对下游未改内容用短 `stage_revalidated` 事件重验证据，再记录 `candidate`。候选从真实 Git 变化建立精确文件内容清单；不允许删减未归属变更。另一条流可先以 `claim` 认领自己的实际文件，再由本流在候选的 `assignedElsewhere` 中逐一引用。依锁定图执行 `final_test`、`reconciliation`、`review` 和 `signoff`。`review` 需要 `READY_FOR_HUMAN_REVIEW`；预声明豁免时需要 `WAIVED` 和替代验收证据。签署者按锁定的 submitter、指定 role、optional 或 none 策略核验；可选免签需理由。
6. Review 后再修复就追加 `cycle`、重新固定 `candidate`，并为新差异记录测试、对账和 Review。归档 Loop 六份文档后使用 `workflow close`；命令会把尚在活跃目录的 Loop、Hotfix 或 Debug 工作目录移入锁定的归档根，后续引用以返回的新 `runDir` 为准。最后用 `sdd-loop provenance check --base <commit> --head <commit>` 对交付提交区间做只读归属门禁。

所有 `workflow record` 和 `workflow close` 事件通过 `--event-json` 文件传入，避免原文进入 shell 历史。不要替用户确认产品决定、签署或审核结论。
