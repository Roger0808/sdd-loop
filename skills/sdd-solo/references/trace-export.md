# 参与仓只读追溯包

参与仓只保存主仓权威内容的只读投影，不维护第二份可编辑需求。导出内容按 `deliveryMode` 分为完整模式和轻量模式。

## `full` 完整模式

默认导出到每个参与仓的 `docs/sdd/demands/<demandId>/`：

```text
source.json
requirements.md
repository/
  tasks.md
  implementation.md
  verification.md
  review.md
  repository-receipt.json
contracts.md
dependencies.md
```

`source.json` 固定权威来源：主仓规范 remote、demandId、主需求相对路径、主仓来源 commit、requirements SHA-256、导出时间、本包协议版本。`requirements.md` 是只读快照，页首明确“不得在参与仓独立修改”。

导出步骤：

1. 在最终人工审批前冻结主仓权威来源 commit；该 commit 必须包含本次用于导出的 Requirements、repository unit 和跨仓证据。
2. 只选本仓相关的 repository unit、契约和依赖，不带其他仓实施证据。
3. 计算每个导出文件 SHA-256，写入 `source.json.files`，将该 participant 的 `traceExport.state` 置为 `generated`。
4. 把追溯包提交到参与仓，将承载它的 commit 写入 `traceExport.participantCommit`，状态置为 `committed`。
5. 从该 commit 而不是工作树重新读取 `source.json` 和全部协议文件，校验文件集合、逐文件 hash、整体 package hash、来源 commit、remote、demandId、deliveryMode 和本仓 receipt；成功后才将状态置为 `verified`。
6. 所有参与仓均为 `verified` 后再做跨仓聚合审查；审查必须把参与仓 commit 和 package hash 纳入固定证据。
7. 把 `closure` 置为 `ready`，运行机器检查并写凭据：

```text
sdd-loop solo check --repo <主仓路径> --manifest <demand-unit>/repositories.json \
  --participant <repoId>=<参与仓路径> [--participant <repoId>=<参与仓路径> ...] \
  --write-receipt
```

8. 按治理版本衔接后续门禁：
   - v1：机器凭据通过后才组织最终人工审批；凭据在 `loop_closed` 时再次校验。
   - v2：机器凭据必须在 `candidate` 之前生成；候选把 `repositories.json` 与 `solo-closure-receipt.json` 的 hash 纳入快照，然后才执行 `final_test`、`reconciliation`、`review` 和 `signoff`。`workflow close` 再次校验凭据。
9. 任一 hash、来源 commit、demandId、receipt 或聚合审查不一致时停止候选、审批、合并和关闭。v2 候选后或 v1 人工批准后，任何固定证据变化都会使旧凭据及后续审查/批准失效，必须重新导出、校验并重走相应门禁。

最终合并引用的参与仓 commit 必须与 `traceExport.participantCommit` 相同。若合并、rebase、补提交或冲突处理生成新 commit，即使业务代码看起来等价，也要更新清单和追溯包，从新 commit 重新校验；不能用已审批的旧 commit 为未验证的新 commit 背书。

禁止导出主仓 `status.md`、任何 audit 分片、Architecture Baseline、其他仓 commit/测试/审查以及本机绝对路径。参与仓若需显示同步状态，只读 `source.json`，不得创建第二份可编辑 Requirements 或伪造独立门禁状态。

## `openspec-light` 轻量模式

默认导出到参与仓稳定的 `docs/sdd/demands/<demandId>/` 追溯目录，但这个目录只是只读归档命名空间，不是主仓 demand unit，也不声明该仓存在活跃 Loop。项目已有追溯目录约定时沿用既有约定。轻量包只保留：

```text
source.json
requirements.md
openspec/
  proposal.md
  spec.md
  tasks.md
repository/
  implementation.md
  verification.md
dependencies.md
```

- `requirements.md` 是联合确认卡中最终需求的只读快照；`openspec/` 是主仓对应 OpenSpec change 的只读投影。
- `repository/implementation.md` 和 `verification.md` 只记录本仓真实变更、任务映射、验证命令与结果；不得复制其他仓证据。
- `dependencies.md` 只写本仓相关依赖。跨仓契约不变时明确保持不变；发生兼容性调整时记录新旧行为、兼容策略、发布/回滚方式和契约验证证据。只有破坏性契约、同步切流或复杂兼容窗口等 `full` 触发项才使轻量模式失效。
- `source.json` 必须增加 `deliveryMode: "openspec-light"`、主仓规范 remote、change ID、来源 commit 或工作树指纹、需求/OpenSpec 文件 SHA-256、导出时间和逐文件 hash。
- 轻量包在结果报告前生成、提交并从参与仓 commit 重新校验；用户要求调整后随主仓权威内容刷新，旧凭据失效；用户验收后才允许 OpenSpec Archive。

轻量包不包含 Review、repository receipt、主仓 `status.md`、audit、Architecture Baseline、其他仓实现与测试，也不得声称独立 AI Review、完整 SDD 聚合门禁或人工审批已经通过。

## 统一机器收口门禁

两种模式都必须遵守同一硬门禁：

1. 每个非主仓 participant 的 `traceExport` 已达到 `verified`，并指向真实存在的参与仓 commit。
2. `source.json.files` 必须与模式规定的文件集合完全一致，不能缺文件、混入别仓证据或只校验工作树。
3. `requirements.md` 必须与 `repositories.json.requirementsVersion.sha256` 一致；`source.json.authority.commit` 必须等于清单的权威 commit。
4. 主仓 `release-checklist.md` 必须达到 `ready`，覆盖所有参与仓和必填上线类别，不含占位符或待定项；它是唯一可编辑的跨仓上线清单，不复制进参与仓追溯包。
5. `full` 必须同时通过所有 readiness receipt 和跨仓聚合审查；`openspec-light` 明确记录聚合审查为 `NOT_REQUIRED`，不能伪造完整门禁。
6. `sdd-loop solo check --write-receipt` 退出码必须为 0，且生成的 `solo-closure-receipt.json` 必须纳入主仓最终审查/验收指纹；v2 还必须在 `candidate` 中锁定 manifest 与该凭据的 hash。

Agent 不得用“稍后补录”“代码已经完成”“用户已经口头同意”绕过这一步。没有机器凭据时：

- `full` 不得记录 v2 `candidate`、展示 v1 最终人工审批卡、合并参与仓或执行 `loop_closed` / `workflow close`；
- `openspec-light` 不得报告交付完成或请求用户验收，也不得 Archive。

恢复中断任务时，先读取清单中每个 `traceExport.state`，再检查相应 commit；不得根据对话记忆把状态直接推进到 `verified`。凭据只能由 CLI 生成，不能复制模板后手工填写。
