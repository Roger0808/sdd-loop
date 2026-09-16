---
name: sdd-full-test
description: 驱动项目测试插件执行全维度测试（UI、业务逻辑、安全、性能与 PBT），采集不可变证据包（Evidence Bundle），并为 Verification 和工程扩展整理待审事实。用户说「运行全量测试」「/sdd full-test」「运行冒烟测试」或需要收集自动化验证事实时使用。不代替人或独立 reviewer 下通过结论，不替人工确认。
---

# SDD Full-Test：全维度测试驱动与证据执行器

Full-Test 是 SDD Loop 的**证据执行器（Evidence Runner）**，负责在实施完成后或验证收口前，调度项目自身的测试套件，采集不可变的测试事实与度量指标。

**核心边界：执行器不越权做裁判。**
- 插件与 Full-Test 只能声明「采集到了哪些客观事实与指标（`extensionClaims`）」，不能自行宣布某个工程扩展（Testing / PBT / Security / Resiliency）已经 PASS。
- 绝不自动将 `verification.md` 改为 `confirmed`，绝不替独立 reviewer 下结论，绝不自动推进门禁。
- 扩展评价完全保留给 `sdd-review`，终审签字完全保留给人类 Approver。

---

## 一、八阶段安全生命周期

Full-Test 严格遵循受控生命周期，确保测试过程安全、隔离且现场可恢复：

```text
discover → validate → plan → preflight → setup
         → run → collect → teardown → verify-cleanup
```

### 1. Discover（发现）
探测项目自身的测试插件清单（遵循「不硬编码任何项目的目录约定」）：
- 优先尊重用户显式传入的清单路径参数或状态文件约定的 `testPluginManifest`；
- 环境变量 `SDD_TEST_PLUGIN` 可覆盖清单位置；
- 默认回退探测候选：`tests/sdd/plugin.yaml`（或 `.json`）、`docs/testing/plugin.yaml`（或 `.json`）。
- 若均不存在，提示用户当前项目尚未配置测试插件，可运行交互引导指定路径或生成脚手架。

### 2. Validate（协议校验）
读取插件清单并由 `validatePluginManifest` 校验安全规则：
- 必须声明 `protocolVersion: "sdd-full-test/v1"`；
- `entrypoint.argv` 必须为字符串数组，**严禁使用任意 shell 字符串**，防止命令注入；
- `requiredEnvironment` 仅允许声明所需的环境变量名称（及 `secret: true`），**严禁在清单中内嵌明文密码或默认值**；
- 校验资源锁（`resourceLocks`，如 `mysql:wms-test`），防止并发运行互相踩踏。

### 3. Plan（交互与执行计划）
根据用户选择（快速冒烟 / 标准回归 / 全量压测 / 自选 suites），生成绑定的上下文与 `plan.json`：
- 分配唯一的不可变 `runId`（绑定当前 Git HEAD、工作区修改指纹、流与 Loop）；
- 未选择的套件显式记录在 `plan.json` 的 `skippedSuites` 中，不得伪装成 PASS 或省略。

### 4. Preflight（前置探活）
在执行任何测试代码前验证依赖环境：
- 检查 `requiredEnvironment` 声明的环境变量是否已在当前运行环境提供（只检查是否存在，绝不打印或落盘敏感值）；
- 检查目标依赖服务端口或进程连通性；
- 检查声明的资源锁当前未被其他进程占用。
- 若任一前置条件不满足，运行状态置为 `BLOCKED` 并安全退出，说明具体缺失依赖。

### 5. Setup（环境准备与授权）
- 高风险 setup（如创建测试租户、执行测试数据库迁移、启动外部临时容器）**必须向用户明确说明并取得授权**；
- 建立测试隔离标识（如 `strategy: tenant-and-run-id`，测试数据统一携带当前 `runId` 标记）。

### 6. Run & Collect（受控执行与日志收集）
- 按照 `entrypoint.argv` 以隔离子进程执行测试套件；
- 实施超时防护（遵循 profile 的 `timeoutMs`，默认单 suite 超时 10 分钟）；
- 捕获 stdout/stderr 写入 `logs/`，收集测试产物写入 `evidence/`。

### 7. Teardown（清理现场与平账）
- **必须在 `finally` 保护路径下执行**：无论测试通过、失败或异常中断，teardown 均必须触发；
- 对测试写入的数据执行平账与回收清理，而不仅是盲目 `rm -rf`；
- **清理失败判定为 `ERROR`**：若 teardown 失败或清理后发现数据残留，整个运行状态必须标记为 `ERROR`，严禁在现场脏乱时宣布测试通过。

### 8. Verify-Cleanup & Bundle（证据包封存）
- 汇总所有执行产物写入 `<artifact-root>/<runId>/` 独立目录；
- 计算目录下所有文件的 SHA-256 哈希值，生成不可变清单 `manifest.sha256`。

---

## 二、运行状态五态契约

执行状态严密收敛为以下五态，杜绝模糊状态：

| 状态 | 含义 | 后续动作 |
|---|---|---|
| `PASS` | 所选测试套件全部执行完毕，且断言与业务行为全部通过 | 证据包就绪，提议 Review 补丁 |
| `FAIL` | 业务逻辑、断言、接口契约或安全规则测试失败 | 触发四类失败分流分析 |
| `BLOCKED` | 缺少必要环境、数据库连接、环境变量、前置授权或资源锁冲突 | 输出缺失环境清单，等待用户补齐后重试 |
| `ERROR` | 协议格式错误、runner 异常崩溃、输出解析失败或 teardown 清理失败 | 检查插件配置与清理逻辑，修复前不可信赖输出 |
| `CANCELLED` | 用户显式中断或超时终止 | 保留已执行部分的日志并安全清理 |

*注：`N/A` 仅属于 SDD Review 评价工程扩展时的法理结论，不属于测试执行器的运行状态。*

---

## 三、不可变证据包（Evidence Bundle）结构

每次运行的所有产物必须独立归档，格式如下：

```text
docs/testing/runs/<runId>/ (或指定 artifact 目录)
├── plan.json          # 执行上下文：Git HEAD、指纹、profile、选择的套件
├── result.json        # 标准化结果：总体五态、各套件指标、耗时、清理平账状态
├── logs/              # 原样 stdout/stderr 日志
│   ├── api.log
│   └── e2e.log
├── evidence/          # 导出的原始报告、截图、HTML 或性能指标
│   ├── coverage.json
│   └── playwright-report.html
└── manifest.sha256    # 整个证据包所有文件的 SHA-256 校验和（防篡改）
```

---

## 四、多对多工程扩展索赔（extensionClaims）

测试插件只能输出**客观事实索引**，由 Reviewer 依据规则进行判定：

```json
"extensionClaims": [
  {
    "extension": "pbt",
    "evidenceIds": ["biz-suite-log"],
    "facts": {
      "property": "库存并发守恒：物理总数 === 可用 + 冻结",
      "caseCount": 1000,
      "seed": 20260916
    }
  },
  {
    "extension": "resiliency",
    "evidenceIds": ["perf-suite-log"],
    "facts": {
      "concurrency": 50,
      "p95LatencyMs": 38,
      "deadlocks": 0,
      "lockWaitTimeoutCount": 0,
      "retrySuccessCount": 12
    }
  }
]
```

**严禁越权**：`facts` 中严禁包含 `status: "PASS"` 或 `verdict: "CONFIRMED"`。只有当 Resiliency 事实不仅包含压测，还包含了故障注入、超时重试与回滚观测时，Reviewer 才能独立给出 PASS 评价。

---

## 五、失败分流四分法（守住已确认规格）

当测试运行出现 `FAIL` 时，Full-Test 引导用户与 Agent 进行严格的四分法诊断：

```
                    ┌─────────────────────────┐
                    │     测试断言或执行失败    │
                    └────────────┬────────────┘
                                 │
         ┌───────────────┬───────┴───────┬───────────────┐
         ▼               ▼               ▼               ▼
    【代码缺陷】    【测试脚本缺陷】  【环境数据缺陷】  【业务规格变更】
   实现偏离了规范   测试代码/断言写错 测试库数据变质   原确认规范不再适用
         │               │               │               │
         ▼               ▼               ▼               ▼
   返回实施阶段    修改测试代码    清理重置数据    【严禁直接改用例】
   修复业务代码    重新运行验证    重新探活执行    必须退回前期阶段
                                                 修改 Spec 并重新确认
```

四类诊断与分流说明：
1. **代码缺陷**：实现未达到 Specification 规定 -> 返回实施阶段修复代码；
2. **测试脚本缺陷**：测试脚本本身代码或断言写错 -> 修正测试代码后重新运行；
3. **环境数据缺陷**：环境不稳定、数据库脏数据或网络异常 -> 清理重置数据并重新探活；
4. **已确认业务规格需要变化**：业务需求或接口规则发生演进 -> 严禁直接改用例，必须退回前期阶段修改并重新确认。

> [!CAUTION]
> **红线：严禁以“用例修正”为名直接在用例文件中修改预期以迎合错误代码！**
> 若业务需求或接口契约确实发生改变，说明当前代码与已确认的 `requirements.md` / `specification.md` 产生了实质冲突。必须停下来退回前期阶段更新规格，由人类或产品角色重新审批后，方可调整测试用例。

---

## 六、交付物输出

运行结束后，Full-Test 在会话中输出：
1. **执行总结**：展示本次 `runId`、总体五态状态、耗时与通过率；
2. **待审补丁建议**：生成一段供 `verification.md` 使用的 Markdown 摘要代码块（包含真实执行命令、退出码与证据包路径）；
3. **下一步指引**：
   - 若状态为 `PASS`：提示用户可进入 `/sdd review` 进行架构反向对账与独立 AI 审查；
   - 若状态为 `FAIL` / `ERROR` / `BLOCKED`：提示对应分流诊断指引。
