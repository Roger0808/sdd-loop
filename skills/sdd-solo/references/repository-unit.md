# Repository unit 与 readiness receipt

主仓在 `repositories/<repositoryId>/` 下维护：

- `tasks.md`：只列本仓任务，每项引用总体 requirement/spec/task 编号。
- `implementation.md`：基线 remote/branch/commit、标准分支与实际实现分支、命名处置/例外原因、最终 commit 或未提交指纹、change surface、跨仓依赖。
- `verification.md`：命令、环境、退出码、规格映射、未执行项、迁移与回滚证据。
- `review.md`：只读 reviewer、审查指纹、发现、处置、唯一结论。
- `repository-receipt.json`：机器可聚合的就绪结论。

Receipt 必须包含本仓真实事实，不能引用另一仓的通过结果代替：

```json
{
  "schemaVersion": 1,
  "demandId": "DEMAND-123",
  "repositoryId": "orders-api",
  "baseline": { "branch": "master", "commit": "<commit>" },
  "branch": {
    "expected": "feature/260928_DEMAND-123_order-cancel",
    "actual": "feature/260928_DEMAND-123_order-cancel",
    "disposition": "created",
    "exceptionReason": null
  },
  "implementation": { "ref": "<branch-or-commit>", "fingerprint": "sha256:<digest>" },
  "verification": { "outcome": "PASS", "evidence": ["verification.md"] },
  "review": { "outcome": "READY_FOR_HUMAN_REVIEW", "evidence": "review.md" },
  "dependencies": [
    { "repositoryId": "client", "contract": "SPEC-API-001", "releaseOrder": "before" }
  ],
  "ready": true,
  "generatedAt": "<RFC3339>"
}
```

`branch.actual` 必须与生成 receipt 时的真实实现分支一致；使用非标准分支时必须记录 `exception` 和理由。只有分支事实完整、验证通过、review 为 `READY_FOR_HUMAN_REVIEW`、依赖和剩余风险已明确时 `ready` 才能为 true。代码、实际分支或关键文档变化后 receipt 立即失效并重新生成。
