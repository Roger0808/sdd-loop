# AGENTS.md 审计与无损精简规范

本规范供 `sdd-init` 和 `sdd-upgrade` 共用。目标是把 SDD 门禁、项目事实和宿主配置分开，不是把 `AGENTS.md` 压到最短。

## 分类

对当前 `AGENTS.md` 的每个可独立执行指令单元，只能给一个分类：

- `KEEP_SDD_CANONICAL`：SDD Loop 状态、阶段、确认、审查或归档门禁。
- `KEEP_PROJECT_SPECIFIC`：只对本项目成立的架构、命令、验收、安全或交付约束。
- `DUPLICATED`：同一个可执行约束已在本文件的更高优先级位置完整表达。
- `STALE`：可以用当前仓库事实证明已过期。
- `MODEL_OR_HOST_SPECIFIC`：只对某个模型、CLI 或宿主成立。
- `BELONGS_IN_AGENT_CONFIG`：权限白名单、模型、reasoning、MCP、hook 或其他机器配置。
- `CANONICAL_ELSEWHERE`：完整 SOP 已由其他明确的 canonical source 维护，这里只需短引用。
- `UNCLEAR`：证据不足，无法安全决定去留。

`UNCLEAR` 必须保留并向用户提问。不得用“可能过期”代替证据。

## Candidate

- 仓库没有 `AGENTS.md` 时，只判断模板条款的适用档位，直接生成最终文件；不审计一份不存在的旧文件，不生成 Candidate。
- 已有 `AGENTS.md` 时，先把备份、`AGENTS.candidate.md` 和逐项报告放到 `/tmp/sdd-loop-agents-<repo>-<timestamp>/`，仓库内不写临时文件。
- 报告中每个原指令单元必须恰好出现一次，列出：原文、分类、证据、候选动作和目标 canonical source。
- Candidate 只能预览，不得直接覆盖。删除、移动或合并必须逐项得到用户确认；“整体看起来可以”不算逐项授权。
- 不修改 `.claude/`、`.codex/`、`.agents/`、模型、权限、MCP 或任何宿主配置。

## 验证与结论

采用前对比原文和 Candidate，运行 `sdd-loop check`，并验证本项目的 canonical workflow 仍可执行。有安全的临时 A/B 环境时，再验证简单任务、已授权任务、只读并行与多 Agent 写入冲突。

最终只输出一个结论：

- `RECOMMEND_ADOPTION`
- `NEEDS_REVISION`
- `KEEP_CURRENT`
- `NOT_TESTABLE_SAFELY`

只有 Candidate 更简洁、没有遗失约束，且未观察到关键行为退化时，才能给出 `RECOMMEND_ADOPTION`。
