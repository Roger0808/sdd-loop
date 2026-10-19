# 上线执行清单：<demand-id> <demand-title>

- demandId: `<demand-id>`
- 清单状态: `draft`
- 目标环境: `<environment>`
- 执行负责人: `<owner>`
- 计划窗口: `<window-or-not-scheduled>`

> `ready` 表示内容已经补全，不表示已经上线。实际执行后再把对应的 `[ ]` 改成 `[x]`。

## 发布项目与顺序

- [ ] 1. `<repository-id>` — 环境：`<env>`；发布物/版本来源：`<artifact-branch-tag-or-build>`；前置：`<dependency>`；动作：`<deploy-or-restart>`；验证：`<check>`

## SQL 脚本

- [ ] `<database>@<env>` — 脚本：`<repository-relative-path>`；顺序：`<n>`；条件：`<condition>`；校验：`<check>`；回滚：`<rollback>`
<!-- 不涉及时改为：- [x] N/A — 原因：本需求不涉及数据库变更或数据修复。 -->

## 项目配置

- [ ] `<repository-id>@<env>` — 位置/键：`<file-or-key>`；动作：`<change-without-secret>`；生效：`<reload-or-restart>`；验证：`<check>`；回滚：`<rollback>`
<!-- 不涉及时改为：- [x] N/A — 原因：本需求不涉及项目配置变更。 -->

## FilerUI 配置

- [ ] `<env>` — 定位：`<namespace-group-dataId-or-equivalent>`；配置键：`<key>`；动作：`<change-without-secret>`；生效/验证：`<check>`；回滚：`<rollback>`
<!-- 不涉及时改为：- [x] N/A — 原因：本需求不涉及 FilerUI 配置。 -->

## 发布后验证与回滚

- [ ] 冒烟与业务核对：`<checks>`
- [ ] 监控观察：`<metrics-logs-alerts-and-duration>`
- [ ] 回滚触发条件：`<conditions>`；回滚顺序：`<ordered-actions>`；负责人：`<owner>`
