---
name: sdd-debug
description: 在已有 SDD Loop 仓库中进行人工测试驱动的连续调试。用户说“/sdd-debug”“/sdd debug”或要反复手测、让 AI 排查修复并部署测试环境时使用；调试期不建阶段文档、不做独立 Review，用户说“开始收口”后才反写一份 Debug 路由 Hotfix、按最终代码更新长期架构并归档关闭。不是生产发布或完整审查通道。
---

# SDD Debug

这是低仪式、人工测试主导的修复通道。它与普通 Loop 并行，不修改 `activeLoop`、`nextLoop`、`gateStage` 或 `gateState`。它明确放弃独立 AI Review，不能把人工点测表述成完整回归、安全审查或 `READY_FOR_HUMAN_REVIEW`。

## 1. 启动：记录基线后直接调试

1. 只读运行 `sdd-loop capabilities --require debug@1 --host <当前宿主>`、`sdd-loop check`、`git status`，记录当前分支、HEAD、工作区基线、开始时间和目标测试环境。仓库必须已有 SDD 结构、`governanceVersion: 1` 和 `roleApprover` 映射；缺失时只说明用 `/sdd upgrade`（或 `sdd-upgrade`）升级，不自动修改。不要创建 Hotfix 文档、分支或 worktree，不要要求范围卡、Reviewer 选择或阶段确认。
2. 保留用户已有改动。基线不可信、问题复现需要新的产品决定，或无法区分本次修改与已有改动时，说明具体问题后再请求用户决策；不要猜。
3. 用户已经明确允许 AI 部署测试环境时，该授权覆盖本次 Debug 会话内同一测试环境和服务的重复部署。没有授权时只问一次是否由 AI 重复部署；用户选择手动部署后，AI 每轮交付可部署版本并等待用户反馈。

## 2. 调试循环

对用户每次手测反馈连续执行：

```text
复现与定位 → 修复 → 与改动相称的定向测试/构建 → 测试环境部署或交给用户部署 → 报告实际版本 → 等待下一次手测反馈
```

- 不因修改文件、模块或服务超出原 Loop 的预测改动面而停下；解决当前手测问题所需的关联修改可以继续，并在会话记录中保留原因和影响面。
- 不在每轮创建或更新 SDD/Hotfix 文档，不执行独立 AI Review，不记录 `review_completed`，不生成正式签署指纹。
- 每轮保留事实清单：用户报告、根因、实际修复、执行过的命令及结果、部署操作者、可识别的部署版本或镜像摘要、用户手测结果。没有执行或无法取得的证据写明未知，不补写成通过。
- 只有出现以下边界才停止相关动作并请求明确决定：新的产品行为选择；生产环境操作；破坏性或不可逆数据变更；Secrets、权限或安全策略变化；新增外部费用；无法安全回滚的共享环境操作。其他范围扩张不引入额外门禁。
- 未经用户明确要求不提交、不推送、不部署生产环境。

## 3. “开始收口”

用户在完成手测后说“开始收口”或等价表达，即同时授权按当前最终版本生成回溯记录并关闭本次 Debug；不要再索要第二次确认。

1. 冻结当前候选，按启动基线核对真实 diff 与部署版本。只记录本次会话可证实的事实。
2. 运行与最终改动相称的测试、构建和测试环境冒烟。任何必需项失败时返回调试循环，不得生成已关闭文档。
3. 根据最终代码反向检查长期 Architecture Baseline：有长期模块边界、接口、数据、权限、依赖或部署拓扑变化时更新并设 `architectureImpact: updated`；否则设为 `none`，不要为局部 bug 强改架构文档。
4. 运行 `sdd-loop _hotfix next --repo <仓库> [--stream <流>]` 分配编号。直接在对应归档 Hotfix 目录创建唯一一份回溯文档；编号仍按当前流和日期扫描活跃、归档两个目录后递增。
5. 文档先以 `hotfixState: human-approved`、`fixFingerprint: null` 写入，随后用临时 JSON 文件记录 `debug_closed`；治理入口会绑定当前代码指纹并更新为 `hotfixState: closed`。原始用户收口输入只放临时文件，不放命令行，记录成功后删除临时文件。
6. 重跑 `sdd-loop check`。Debug Hotfix 自身必须干净；若本次代码使普通 Loop 的旧审查或关闭指纹失效，如实报告，不能用 Debug 文档伪造旧 Loop 的 Review。

回溯文档格式：

```markdown
---
document: hotfix
hotfixId: HF-YYYYMMDD-NN
route: debug
status: archived
hotfixState: human-approved
acceptanceMode: manual-test
reviewStatus: waived
baseBranch: <启动时分支>
baseCommit: <启动时 HEAD>
fixFingerprint: null
architectureImpact: none
openedAt: <启动时间 ISO-8601>
updatedAt: <收口时间 ISO-8601>
---

# HF-YYYYMMDD-NN

## 1. 问题与手测过程
## 2. 修复摘要与回滚方法
## 3. 最终测试、部署与人工验收
## 4. Architecture Impact
## 5. Review Waiver
```

`Review Waiver` 必须明确写出：本次采用人工测试验收，没有独立 AI Review；该结论是 `MANUAL_TEST_ACCEPTED_NO_INDEPENDENT_REVIEW`，不等于标准 Hotfix 的 `READY_FOR_HUMAN_REVIEW`。

`debug_closed` 事件至少包含：

```json
{
  "type": "debug_closed",
  "role": "approver",
  "summary": "人工测试完成，关闭 Debug Hotfix",
  "input": "用户开始收口的原始输入",
  "evidence": "最终测试、部署版本、人工验收与架构对账证据"
}
```

记录命令：

```sh
sdd-loop _governance record --hotfix HF-YYYYMMDD-NN --event-json <tmp-file> [--stream <流>] --repo <仓库>
```
