<h1 align="center">sdd-loop</h1>

<p align="center">
  <strong>面向 AI 协作交付的可重复、可审计 SDD 生命周期</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Node-%E2%89%A520-brightgreen.svg" alt="Node >= 20">
  <img src="https://img.shields.io/badge/宿主-14%20个-8A2BE2" alt="Hosts">
</p>

<p align="center">
  <a href="#工作流程">工作流程</a> &bull;
  <a href="#安装">安装</a> &bull;
  <a href="#命令">命令</a> &bull;
  <a href="#仓库结构">仓库结构</a>
</p>

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_zh.md">简体中文</a>
</p>

---

一句话需求 → 七站访谈 → 隔离实施 → 验证 → 架构对账 → AI 审查 → 人工确认。完整走一遍就是一个 **Loop**。

## 工作流程

`Requirements → Architecture/Baseline → Specification → Tasks → Worktree Ready → Implementation → Automated Verification → Architecture Reconciliation → AI Review → Human Review → Closed`

原有六份阶段文档和 `nextPhase` 取值不变，新增名称都是门禁：

| 门禁 | 必须具备的证据 |
|---|---|
| Requirements | `requirements.md` 已由用户明确确认 |
| Architecture/Baseline | 本轮 `architecture.md` 已确认，长期 Architecture Baseline 与系统现状一致 |
| Specification | `specification.md` 已定义可验证行为 |
| Tasks | `tasks.md` 的每项任务都能追溯到已确认条款 |
| Worktree Ready | 分流项目已为当前 stream + Loop 建立独立分支和 Git worktree |
| Implementation | `implementation.md` 已记录基线分支、基线 commit、当前分支和任务范围 |
| Automated Verification | 已记录测试、构建、部署检查和未执行项 |
| Architecture Reconciliation | 最终代码已反向更新长期架构，并生成 change surface |
| AI Review | 只读 reviewer 已给出一个固定结论 |
| Human Review | 人工明确通过当前审查指纹 |
| Closed | 阶段文档归档，并同步更新状态文件 |

### Worktree 隔离

- 分流项目每个 `stream + Loop` 使用独立分支和 worktree。
- 主工作区只用于同步、集成和审查。
- 跨系统或平台级改动使用独立的 platform worktree。
- 已在主工作区实施的存量 Loop 可记录一次性豁免；下一个 Loop 不得继承。

### 架构与审查

- 本轮 `architecture.md` 描述本轮方案；`docs/architecture/` 描述系统当前事实。
- 优先沿用已有架构目录；没有时，单系统用 `docs/architecture/overview.md`，分流项目用 `docs/architecture/<stream>.md`。架构图使用 Mermaid 或 ASCII。
- 自动化验证后，按最终代码更新 Architecture Baseline，并列出代码、配置、数据、接口、部署、测试和文档改动面。
- 随后进行独立、只读的 AI 审查。结论只能是 `READY_FOR_HUMAN_REVIEW`、`CHANGES_REQUIRED` 或 `NOT_REVIEWABLE_SAFELY`。
- `verification.md` 固定包含 `Automated Verification`、`Architecture Reconciliation & Change Surface`、`AI Code Review` 和 `Human Review Packet`。
- 代码或关键文档变化会使旧审查失效。只有人工记录确认人、时间、审查版本和指纹后才能关闭 Loop。

## AGENTS.md 处理

- 没有 AGENTS.md：sdd-init 按单流/分流和项目事实筛选规则，直接生成结构化最终版本。
- 已有 AGENTS.md：sdd-init 或 sdd-upgrade 只在 `/tmp` 生成 `AGENTS.candidate.md` 和逐项报告，不静默覆盖仓库文件。
- 删除、移动和合并必须逐项授权；模型、权限、MCP 和宿主配置不在审计范围内。

分类：`KEEP_SDD_CANONICAL`、`KEEP_PROJECT_SPECIFIC`、`DUPLICATED`、`STALE`、`MODEL_OR_HOST_SPECIFIC`、`BELONGS_IN_AGENT_CONFIG`、`CANONICAL_ELSEWHERE`、`UNCLEAR`。

审计结论：`RECOMMEND_ADOPTION`、`NEEDS_REVISION`、`KEEP_CURRENT`、`NOT_TESTABLE_SAFELY`。

## 安装

要求 Node ≥ 20：

```bash
git clone https://github.com/Roger0808/sdd-loop.git && cd sdd-loop
npm link
sdd-loop init -g
```

包含四个 Skill：`skills/sdd-init`、`skills/sdd-interview`、`skills/sdd-upgrade`、`skills/sdd-review`。

| 落点 | 安装方式 |
|---|---|
| Claude Code | `~/.claude/skills/` |
| Agent Skills 宿主 | `~/.agents/skills/` — Codex、Gemini CLI、GitHub Copilot、Cursor、Windsurf、OpenCode、OpenClaw、Kimi Code、Antigravity、Factory Droid、Roo Code |
| Hermes Agent | 通过其 Skills 配置登记 |
| pi | 登记本包 |

可用 `--claude`、`--agents`、`--openclaw`、`--hermes` 或 `--pi` 限定落点；`--show` 只预览、不写入。安装器不会删除或覆盖已有文件和目录。

安装后重启宿主或开启新会话。

## 命令

### 状态对账

```bash
sdd-loop check
sdd-loop check --repo <dir>
sdd-loop check --stream <name>
sdd-loop check --json
```

| 退出码 | 含义 |
|---|---|
| `0` | 干净 |
| `1` | 声明与仓库事实矛盾 |
| `2` | 判据不可读，不给结论 |

### 条款口径

```bash
sdd-loop guide
sdd-loop guide --type specification.entity-table
```

在写条款前返回必填项、已有编号族和仓库内参考写法。

pi 路由：`/sdd` 进入访谈，另有 `/sdd init`、`/sdd upgrade`、`/sdd review`；未知子命令只返回用法。

## 仓库结构

```text
your-project/
├── AGENTS.md
├── CLAUDE.md
└── docs/
    ├── architecture/
    │   └── overview.md 或 <stream>.md
    ├── loops/
    │   └── [<stream>/]
    │       ├── status.md
    │       └── loop-N/
    │           ├── requirements.md
    │           ├── architecture.md
    │           ├── specification.md
    │           ├── tasks.md
    │           ├── implementation.md
    │           └── verification.md
    └── archive/
```

`sdd-loop check` 自动发现单流或分流结构；自定义路径使用 `--status-file` 和 `--archive-dir`。

## 许可

MIT License — 见 [LICENSE](LICENSE)。
