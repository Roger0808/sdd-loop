# Engineering Extensions 协议

四个内置扩展默认启用：`testing`、`pbt`、`security`、`resiliency`。启用的意思是每轮都要判断适用性，最终写出 `PASS`、`FAIL` 或有具体理由的 `N/A`，不是机械增加依赖或测试数量。

## 阶段加载

| 阶段 | 加载内容 |
|---|---|
| Requirements | 判断本轮是否存在对应风险面，保留用户原始答案 |
| Architecture | 写设计约束、信任边界和故障边界 |
| Specification | 写可验证行为、不变量和负向场景 |
| Tasks | 生成带验证方法的实施任务 |
| Implementation | 编码并收集测试、检查和运行证据 |
| Verification | 每项记录 PASS / FAIL / N/A，由独立 reviewer 复核 |

项目自定义扩展放在 `docs/sdd/extensions/<domain>/<name>.md`，文件名使用小写字母、数字和连字符。有同名 `<name>.opt-in.md` 时，只在 Requirements 加载轻量问题，答案启用后才在相关阶段加载完整规则；没有 opt-in 文件则始终启用。内置与项目扩展重名、跨目录同名、只有 opt-in 没有完整规则时停止并报告冲突，不静默覆盖。

完整规则的 front-matter 使用扁平字段，便于不同宿主读取：

```yaml
---
extension: api-compatibility
stages: architecture,specification,verification
---
```

opt-in 文件正文只放一个能由用户回答的问题，不复制完整规则。启用结果写进状态文件的 `enabledExtensions`，问题和答案写进审计。

## 固定结果

| 结果 | 要求 |
|---|---|
| PASS | 有命令、测试结果、文件或运行证据 |
| FAIL | 写明阻断问题，返回 Implementation |
| N/A | 写明改动类型、检查过的风险面和不适用原因 |

空白、只有“已检查”或没有证据的 PASS 都算未完成。用内部事件入口记录时，原始内容写入临时 JSON，通过 `sdd-loop _governance record --event-json <tmp-file>` 传递，不把敏感内容放进命令行参数。
