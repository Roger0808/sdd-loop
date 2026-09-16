---
name: sdd-hotfix
description: 在已有 SDD Loop 仓库中走独立、单文档的 Hotfix 通道。用户说“/sdd-hotfix”“/sdd hotfix”“做个 hotfix”“紧急修复但不想走完整 Loop”时使用。首次只读勘察并展示一次范围/风险/reviewer 确认卡；确认后隔离实施、验证、独立 AI Review、人工签署和归档。不是普通 Loop 的跳阶段开关。
---

# SDD Hotfix

Hotfix 与普通 Loop 并行：不修改 `activeLoop`、`nextLoop`、`gateStage` 或 `gateState`，不生成六份阶段文档。简化的是文档数量和中间审批，不取消验证、审查、审计、回滚与人工签署。

## 1. 首次响应：只读勘察并停下

1. 运行 `sdd-loop capabilities --require governance@1 --host <当前宿主>`、`sdd-loop capabilities --require hotfix@1 --host <当前宿主>` 和 `sdd-loop check`。任何能力缺失只说明更新方法；未经用户明确授权不得安装、链接或切换本机工具。
2. 只读检查问题、复现、相关代码、测试、当前分支/提交和工作区。仓库必须已有 SDD 结构、`governanceVersion: 1` 与六类角色映射。
3. 首次回复只展示这张短卡片，然后等待一次确认；不要创建文件、分支或改代码：

```text
Hotfix 启动卡
- 问题与目标：...
- 修改范围：...
- 风险提示：API / 数据 / 权限 / 依赖 / 部署 / 回滚（逐项说明，无则写无）
- Reviewer：current-subagent（当前 Agent 启动独立只读 subagent）或 external-agent（换 Agent handoff）
- 计划基线：<baseBranch>@<baseCommit>

请一次确认范围、风险承担与 Reviewer 路径。
```

Hotfix 是否适用由用户决定。风险必须展示并留痕，但不得按类别、diff 行数或主观复杂度自动拒绝。用户修改卡片内容时，更新后再等同一次确认。

## 2. 确认后建档与隔离

1. 立即记录用户确认原文。运行 `sdd-loop _hotfix next --repo <仓库> [--stream <流>]` 分配编号；它按当前流扫描活跃和归档两个目录中当天的编号，取最大序号加一，不得自行只看活跃目录：
   - 单流：`docs/loops/hotfix/` 与 `docs/archive/hotfix/`
   - 分流：`docs/loops/<stream>/hotfix/` 与 `docs/archive/<stream>/hotfix/`
   - 文件名 `hotfix-YYYYMMDD-NN.md`，ID `HF-YYYYMMDD-NN`；每条流、每天独立递增。
2. 创建独立分支或 worktree，记录真实 `baseBranch`、`baseCommit`。不得覆盖或夹带用户已有改动。
3. 创建唯一一份 Hotfix 文档，front-matter 字段不得省略：

```markdown
---
document: hotfix
hotfixId: HF-YYYYMMDD-NN
status: confirmed
hotfixState: implementation
reviewRoute: current-subagent
baseBranch: <branch>
baseCommit: <sha>
fixFingerprint: null
architectureImpact: none
openedAt: <ISO-8601>
updatedAt: <ISO-8601>
---

# HF-YYYYMMDD-NN

## 1. 问题、影响与复现
## 2. 修复范围与非目标
## 3. 风险提示及用户确认
## 4. 实施摘要与回滚方法
## 5. Testing/PBT/Security/Resiliency 证据
## 6. Architecture Impact
## 7. AI Review
## 8. Human Sign-off
```

4. 用临时 JSON 文件记录 `hotfix_authorized`，至少包含 `type`、`role`、`summary`、用户原始 `input` 与启动时选择的 `reviewRoute`：

```sh
sdd-loop _governance record --hotfix HF-YYYYMMDD-NN --event-json <tmp-file> [--stream <流>] --repo <仓库>
```

原始输入只放临时文件，不放命令行；记录成功后删除临时文件。

## 3. 连续实施到 AI Review

确认后不再为普通实施步骤逐项索要批准。按卡片范围修复，维护第 4–6 节，并保持非目标不扩张：

- 记录 `implementation_completed`，正文写清改动摘要和可执行回滚方法。
- 对 `testing`、`pbt`、`security`、`resiliency` 各记录一次 `extension_evaluated`。Testing 必须 `PASS`；其余必须 `PASS` 或具体 `N/A` 理由。PBT 有不变量时即使没有库也应使用确定性轻量生成器，并记录 `caseCount` 与 `seed`。
- `architectureImpact: updated` 时，先更新 Architecture Baseline/change surface，再记录带证据的 `architecture_reconciled`；无长期架构变化时保持 `none` 并在正文说明判断。
- 每次代码变化都会使旧验证和 Review 指纹失效；重新执行并记录。

随后严格使用启动卡选定的路径做独立只读 AI Review：

- `current-subagent`：当前 Agent 启动一个独立、只读、不得修复的 review subagent；当前 Agent 本体不得自审。
- `external-agent`：先让用户确认具体 Agent，再给出包含基线、范围、diff、验证与风险的只读 handoff；不得自动降级为自审。

Review 只允许 `READY_FOR_HUMAN_REVIEW`、`CHANGES_REQUIRED`、`NOT_REVIEWABLE_SAFELY`。记录 `review_completed` 时同时带 `reviewRoute` 和证据。后两种结论停下说明问题；修复后重新验证并重新审查。前一种把完整审查结论写入第 7 节，然后停在人工签署。

## 4. 人工签署与归档

1. 向用户展示当前 `fixFingerprint`、变更、四项证据、架构影响、回滚和 AI Review，请用户对**当前指纹**明确签署。不得替用户确认。
2. 用户签署后记录 `human_signed`，更新第 8 节和 `hotfixState: human-approved`。
3. 用 `git mv` 把 Hotfix 文件及其整个审计目录迁到同一流的归档位置，设置 `status: archived`；保持 ID、文件名和审计内容不变。
4. 在归档位置记录 `hotfix_closed`，它会把 `hotfixState` 置为 `closed`。重跑 `sdd-loop check`。

普通 Loop 始终不暂停、不推进。若 Hotfix 合入使普通 Loop 的旧代码指纹失效，按普通 Loop 治理重新验证，不能继承 Hotfix 证据。
