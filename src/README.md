# src 分层说明（v2）

v2 之后整个包只有两件仪器，src/ 只剩三层：

- `loop/`：SDD Loop 约定的读取件——严格 front-matter 读取器（`front-matter.js`，冲突标记/重复键/未闭合一律判不可读）、目录与字段约定（`convention.js`，默认可覆盖）、仓库扫描（`repo-scan.js`，只产出事实）。
- `spec-guide/`：口径字典（`dictionary.js`，按「文档类型 × 条款类型」组织）、编号族扫描（`id-scan.js`，只扫只报）、参考写法选取（`example.js`，CLI 与 pi 扩展共享）。
- `validation/loop-check.js`：状态对账的**唯一判定源**——只返回数据，不渲染文案；CLI（`scripts/sdd-loop.mjs`）与 pi 扩展（`extensions/sdd-loop/`）各渲染各的。

修改原则：判定不许复制出第二份；front-matter 解析只有 `loop/front-matter.js` 一份；任何新判据先问「它在一份合格文档上会不会误报」。
