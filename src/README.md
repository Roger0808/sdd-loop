# src 分层说明

整个包有三件仪器，src/ 有四层：

- `loop/`：SDD Loop 约定的读取件——严格 front-matter 读取器（`front-matter.js`，冲突标记/重复键/未闭合一律判不可读）、目录与字段约定（`convention.js`，默认可覆盖）、仓库扫描（`repo-scan.js`，只产出事实）。
- `spec-guide/`：口径字典（`dictionary.js`，按「文档类型 × 条款类型」组织）、编号族扫描（`id-scan.js`，只扫只报）、参考写法选取（`example.js`，CLI 与 pi 扩展共享）。
- `governance/protocol.js`：治理事件写入、Git 身份/角色授权、敏感内容脱敏、分片哈希链以及代码/阶段指纹。
- `validation/`：`loop-check.js` 是状态对账的唯一聚合入口；`governance-check.js` 只在项目显式启用治理版本后提供 C6-C10。

修改原则：判定不许复制出第二份；front-matter 解析只有 `loop/front-matter.js` 一份；任何新判据先问「它在一份合格文档上会不会误报」；没有治理标记的旧仓库输出不得变化。
