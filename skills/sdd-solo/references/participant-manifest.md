# Participant manifest

`repositories.json` 是参与范围和分析基线的权威清单，不保存本机路径。保存位置取决于交付模式：

- `full`：保存在主仓 demand unit 根目录。
- `openspec-light`：保存在主仓现有 OpenSpec change 目录的 `sdd-solo/repositories.json`；若项目已有明确的 OpenSpec 元数据目录约定，则沿用该约定。它不属于 demand unit，不得创建或修改 `activeLoop` 来容纳轻量需求。

模式尚未确认时，先把工作副本放在主仓临时工作区；联合确认后再按已确认模式写入上述正式位置。若从轻量模式升级为完整模式，把已确认清单迁入 demand unit，并在原位置留下只读来源指针，不能同时维护两份可编辑清单。

## 必填结构

```json
{
  "schemaVersion": 1,
  "demandId": "DEMAND-123",
  "naming": {
    "demandTitle": "order cancellation",
    "shortTitle": "order-cancel",
    "conversationTitle": "[SDD Solo][DEMAND-123] order cancellation",
    "branchDate": "260928",
    "branchTemplate": "feature/{yyMMdd}_{demandId}_{shortTitle}",
    "canonicalBranch": "feature/260928_DEMAND-123_order-cancel"
  },
  "primaryRepository": "orders-api",
  "deliveryMode": "openspec-light",
  "modeDecision": {
    "recommendedMode": "openspec-light",
    "confirmedMode": "openspec-light",
    "confirmedBy": "<name/email>",
    "confirmedAt": "<ISO-8601>",
    "reasons": ["需求逻辑简单、边界和验收明确，跨仓任务可拆分且验证与回滚可信"],
    "riskAssessment": {
      "requirementsResolved": true,
      "scopeAndAcceptanceClear": true,
      "repositoriesInspected": true,
      "verificationPlanClear": true,
      "rollbackPlanClear": true,
      "architectureDecisionRisk": "absent",
      "breakingContractOrCutoverRisk": "absent",
      "complexDataMigrationRisk": "absent",
      "materialSensitiveDomainRisk": "absent",
      "complexReleaseCoordinationRisk": "absent",
      "irreversibleOrHighBlastRadiusRisk": "absent",
      "explicitFullGovernanceRequired": "absent"
    }
  },
  "requirementsVersion": { "commit": "<commit>", "sha256": "sha256:<digest>" },
  "releaseChecklist": {
    "path": "release-checklist.md",
    "state": "ready",
    "sha256": "sha256:<normalized-digest>",
    "preparedAt": "<ISO-8601>"
  },
  "participants": [
    {
      "repositoryId": "orders-api",
      "remote": "https://example.invalid/team/orders-api.git",
      "role": "primary",
      "baseline": { "branch": "master", "commit": "<40-hex>" },
      "workingBranch": {
        "expected": "feature/260928_DEMAND-123_order-cancel",
        "actual": "feature/260928_DEMAND-123_order-cancel",
        "disposition": "created",
        "exceptionReason": null
      },
      "discoveryEvidence": ["module path / dependency / interface"],
      "status": "confirmed",
      "repositoryUnitPath": "repositories/orders-api/repository-receipt.json",
      "traceExport": {
        "required": false,
        "state": "not-required",
        "packagePath": null,
        "sourceCommit": null,
        "packageSha256": null,
        "participantCommit": null,
        "verifiedAt": null
      }
    }
  ],
  "excludedCandidates": [
    { "repositoryId": "example", "reason": "confirmed out of scope" }
  ],
  "unavailableCandidates": [
    { "repositoryId": "example", "reason": "not cloned or no access" }
  ],
  "closure": {
    "state": "pending",
    "aggregateReview": {
      "outcome": "NOT_REQUIRED",
      "evidencePath": null,
      "reviewedAt": null
    },
    "receiptPath": "solo-closure-receipt.json"
  }
}
```

`naming` 在需求创建时由一次确认固定。`branchDate` 不随继续工作的日期变化；`conversationTitle` 供支持改名的宿主自动设置，不作为关闭门禁。`canonicalBranch` 是所有参与仓的默认分支名。

模式确认前，`deliveryMode`、`modeDecision.confirmedMode`、`confirmedBy` 和 `confirmedAt` 都保持 `null`；确认后 `deliveryMode` 只允许 `full` 或 `openspec-light`，且必须等于 `confirmedMode`。`recommendedMode` 可以与最终确认模式不同，但用户只能把轻量建议提升为 `full`；若仍有 `full` 触发项，只能通过缩小范围或补齐兼容、验证、回滚措施后重新评估，不能强制降级。

风险使用 `present`、`absent` 或 `unknown`。`present` 只表示存在需要完整治理的实质风险，不能因为“涉及多个仓库”“修改了接口/数据库/权限模块”就直接填写 `present`。兼容性契约调整可以把 `breakingContractOrCutoverRisk` 记为 `absent`，并在 `reasons` 说明兼容、发布、回滚和验证依据。关键事实为 `unknown` 时先继续调查和提问；无法消除且会影响安全判定时才推荐 `full`。

`workingBranch.disposition` 只允许 `pending`、`created`、`reused`、`exception`。进入 Implementation 前必须填入 `actual`；非标准分支必须使用 `exception` 并写明 `exceptionReason`。已有需求分支或本需求未提交改动不得为了命名规范被强制切换或重建。

`repositoryId` 在本需求内唯一且稳定。`remote` 使用规范化远程标识；不得写凭据。基线必须是本次获取并验证过的远程分支 commit。参与仓范围或命名身份变更属于 Requirements 变更，必须重新确认并使受影响的审查、receipt 和导出失效；只更新实际分支处置记录不改变已确认需求语义，但会使该仓旧 implementation 指纹、receipt 和审查失效。

`releaseChecklist.path` 相对 `repositories.json`，默认指向同目录的 `release-checklist.md`。最终收口前 `state` 必须为 `ready`，`preparedAt` 必须是实际完成时间，`sha256` 是把所有 Markdown 复选框状态统一规范为 `[ ]` 后计算的 SHA-256。这样清单内容变化会使旧凭据失效，但上线执行人后续只切换 `[ ]` / `[x]` 不会破坏已经固定的计划。具体格式和必填内容见 [release-checklist.md](release-checklist.md)。

## 追溯与收口状态

主仓 participant 的 `traceExport.required` 必须为 `false`、`state` 必须为 `not-required`。每个非主仓 participant 必须增加同结构的 `traceExport`，并使用以下状态机：

```text
pending → generated → committed → verified
```

- `generated` 只表示工作树已经生成追溯包，不能据此收口。
- `committed` 时必须记录承载追溯包的 `participantCommit`。
- `verified` 只能在从该 commit 重新读取 `source.json` 和全部协议文件、逐项核对来源与 hash 成功后写入；同时记录 `packagePath`、`sourceCommit`、`packageSha256` 和 `verifiedAt`。
- 源需求、OpenSpec、repository unit、参与仓追溯包或参与仓 commit 变化时，将受影响项退回 `pending`，旧收口凭据立即失效。

`full` 中每个 participant 还必须填写 `repositoryUnitPath`，指向相对 `repositories.json` 所在目录的本仓 readiness receipt。`openspec-light` 不要求此字段。

`closure.state` 在上线清单和所有追溯项就绪前保持 `pending`，完成必要的聚合审查后改为 `ready`。`full` 的 `aggregateReview.outcome` 必须为 `READY_FOR_HUMAN_REVIEW` 且有主仓内证据路径；`openspec-light` 固定为 `NOT_REQUIRED`。`receiptPath` 是机器生成凭据相对 `repositories.json` 的位置，不得手工编造或编辑凭据。

本机仓库路径只通过本次运行的 `--participant <repositoryId>=<path>` 传给校验器，不能写入清单。最终报告、人工审批、Loop 关闭或 OpenSpec Archive 前，必须运行 `sdd-loop solo check ... --write-receipt` 并确认退出码为 0。
