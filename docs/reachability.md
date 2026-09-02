# 可达性清单（src/ 模块）

> v2 重写（2026-09-01，分支 `v2-sdd-loop`，阶段五退役后重生成）。
> 旧版（P10~P22，七入口、冻结件清单）随旧模型退役——`git log` 里可查。
> 重跑判据见下，别凭记忆维护这张表。

## 现状

`src/` 只有 7 个模块，全部可达，零死导出（判据二实测 12 导出 0 死）：

| 模块 | 职责 |
|---|---|
| `loop/front-matter.js` | 严格 front-matter 读取器 |
| `loop/convention.js` | 目录与字段约定（默认可覆盖） |
| `loop/repo-scan.js` | 仓库扫描，只产事实 |
| `spec-guide/dictionary.js` | 口径字典 |
| `spec-guide/id-scan.js` | 编号族扫描 |
| `spec-guide/example.js` | 参考写法选取（CLI 与扩展共享） |
| `validation/loop-check.js` | 状态对账唯一判定源 |

v2 没有「冻结件」这一类别：旧模型的六个冻结件（field-prompt / field-ai-guidance /
source-excerpt / source-docs / prototype-transfer / ai-response）随退役删除，
不存在「留着等解冻」的模块。想解冻的方向需要重新实现并补上判据，本仓库不留「等解冻」的死代码。

## 判据

### 判据一：模块级

从两个活入口出发，沿静态相对 `import` 递归展开，扫全 `src/`：

```
scripts/sdd-loop.mjs
extensions/sdd-loop/index.ts
```

**盲区**：动态 `import()` 拼路径、裸模块名。删任何模块前 `grep -rn "<文件名>" src/ scripts/ extensions/` 兜底。

`tests/` 不算存活理由——死代码有测试仍是死代码；删模块时其测试随功能退役。

### 判据二：导出级

扫描器是 `scripts/dead-exports.mjs`（`node scripts/dead-exports.mjs`）：`src/` 的具名导出
在 `src/` + `scripts/` + `extensions/` 的去注释源码里零引用即为死导出。盲区与剥注释的坑
见脚本头注（P15-A 的教训都在那里）。
