# SDD Full-Test 业务参考插件实现手册（以 WMS 系统为例）

本手册为业务系统（如 WMS 仓储管理系统）接入 `sdd-full-test/v1` 协议提供完整的参考实现范例。

**项目测试代码与插件配置存放在项目自身源码目录中，不进入本包核心。**

---

## 1. 插件清单定义（`tests/sdd/plugin.yaml`）

```yaml
protocolVersion: sdd-full-test/v1
id: wms-test-suite
version: 1.0.0
description: "WMS 复杂仓储系统全维度测试套件：包含 PC UI、业务接口、库存守恒 PBT、多货主越权及并发压测"

# 入口必须使用 argv 数组安全调用，拒绝任意 shell 字符串
entrypoint:
  argv: ["node", "tests/sdd/runner.mjs"]

profiles:
  smoke:
    suites: ["biz-critical", "security-isolation"]
    timeoutMs: 60000
  regression:
    suites: ["ui-outbound", "biz-critical", "biz-pbt", "security-isolation"]
    timeoutMs: 300000
  full:
    suites: ["ui-outbound", "biz-critical", "biz-pbt", "security-isolation", "perf-concurrency"]
    timeoutMs: 1800000

# 仅声明依赖的环境变量名，严禁内嵌明文密钥
requiredEnvironment:
  - name: TEST_DB_URL
    secret: true
  - name: WMS_API_BASE
    secret: false

# 声明独占资源锁，防止多个 worker/会话同时操作同一套数据库
resourceLocks:
  - "mysql:wms-test-db"
  - "service:wms-mock-api"

isolation:
  strategy: "tenant-and-run-id"
  cleanupRequired: true
```

---

## 2. 套件目录组织与实现示例

推荐在业务项目中按如下目录结构组织测试套件：

```text
tests/
├── sdd/
│   ├── plugin.yaml            # 插件声明清单
│   └── runner.mjs             # 遵循协议的调度适配器
├── e2e/                       # UI / E2E 测试
│   └── outbound.spec.js       # Playwright 驱动 PC 拣货复核流
├── biz/                       # 业务逻辑与状态机
│   ├── stock-flow.test.js     # 入库、上架、波次分配流转
│   └── stock-pbt.test.js      # 基于属性测试：库存总数守恒不变量
├── security/                  # 安全测试
│   └── idor-check.test.js     # 多货主/多仓库水平越权与角色垂直越权探测
└── perf/                      # 性能压力测试
    └── stock-concurrency.mjs  # Node 原生异步并发扣库存压测脚本
```

### 2.1 业务状态机与 PBT 守恒测试范例（`tests/biz/stock-pbt.test.js`）

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";

// PBT: 模拟随机并发分配操作，验证核心守恒不变量
test("PBT 不变量：任何并发操作序列后，可用库存 + 冻结库存 === 物理总库存", async () => {
  const seed = 20260916;
  const caseCount = 1000;
  let available = 10000;
  let frozen = 0;
  const total = 10000;

  // 使用固定 seed 的伪随机数发生器
  let s = seed;
  function rnd() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  }

  for (let i = 0; i < caseCount; i++) {
    const delta = Math.floor(rnd() * 50);
    if (rnd() > 0.5 && available >= delta) {
      available -= delta;
      frozen += delta;
    } else if (frozen >= delta) {
      frozen -= delta;
      available += delta;
    }
    // 关键守恒断言
    assert.equal(available + frozen, total, `在第 ${i} 次操作出现总额偏离！`);
  }
});
```

### 2.2 多货主越权安全探测范例（`tests/security/idor-check.test.js`）

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";

test("安全防线：货主 A 无法读取或操作货主 B 的出库批次（IDOR 检查）", async () => {
  const tokenOwnerA = "Bearer owner_a_token";
  const batchIdOwnerB = "BATCH-B-998877";

  // 模拟以货主 A 身份请求货主 B 的私有数据
  const res = await fakeHttpRequest({
    url: `/api/v1/batches/${batchIdOwnerB}/allocations`,
    headers: { Authorization: tokenOwnerA },
  });

  // 必须被 403 Forbidden 严格拦截
  assert.equal(res.status, 403, "严重安全漏洞：货主 A 成功读取了货主 B 的数据！");
});
```

### 2.3 Node.js 原生并发压测脚本（`tests/perf/stock-concurrency.mjs`）

```javascript
/**
 * 原生 Node 并发扣库存压测脚本，无需外部 JMeter/k6
 */
export async function runConcurrencyTest({ concurrency = 50, requests = 200 } = {}) {
  const latencies = [];
  let deadlocks = 0;
  let lockWaitTimeouts = 0;
  let successes = 0;

  const queue = Array.from({ length: requests }, (_, i) => i);
  async function worker() {
    while (queue.length > 0) {
      const id = queue.pop();
      const start = Date.now();
      try {
        // 调用真实的扣减接口或 DB 事务
        await mockDeduceStock({ skuId: "SKU-HOT-01", qty: 1, reqId: id });
        successes++;
      } catch (err) {
        if (String(err).includes("Deadlock")) deadlocks++;
        if (String(err).includes("Lock wait timeout")) lockWaitTimeouts++;
      } finally {
        latencies.push(Date.now() - start);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  latencies.sort((a, b) => a - b);

  return {
    concurrency,
    totalRequests: requests,
    successes,
    deadlocks,
    lockWaitTimeouts,
    p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)] || 0,
  };
}
```

---

## 3. 标准结果输出（`result.json`）示例

插件 runner 最终将结果整理为协议对象写入 `<artifact-root>/<runId>/result.json`：

```json
{
  "protocolVersion": "sdd-full-test/v1",
  "runId": "run-20260916T172000Z-7a8f",
  "runStatus": "PASS",
  "cleanup": {
    "attempted": true,
    "verified": true
  },
  "suiteResults": [
    {
      "id": "ui-outbound",
      "status": "PASS",
      "durationMs": 15400,
      "passedCount": 12,
      "failedCount": 0
    },
    {
      "id": "biz-pbt",
      "status": "PASS",
      "durationMs": 2100,
      "passedCount": 1000,
      "failedCount": 0
    },
    {
      "id": "security-isolation",
      "status": "PASS",
      "durationMs": 950,
      "passedCount": 8,
      "failedCount": 0
    },
    {
      "id": "perf-concurrency",
      "status": "PASS",
      "durationMs": 4200,
      "passedCount": 200,
      "failedCount": 0
    }
  ],
  "extensionClaims": [
    {
      "extension": "pbt",
      "evidenceIds": ["logs/biz-pbt.log"],
      "facts": {
        "property": "库存并发守恒：物理总数 === 可用 + 冻结",
        "caseCount": 1000,
        "seed": 20260916
      }
    },
    {
      "extension": "resiliency",
      "evidenceIds": ["logs/perf-concurrency.log"],
      "facts": {
        "concurrency": 50,
        "p95LatencyMs": 38,
        "deadlocks": 0,
        "lockWaitTimeoutCount": 0
      }
    }
  ]
}
```
