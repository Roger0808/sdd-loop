<h1 align="center">sdd-loop</h1>

<p align="center">
  <strong>把「跟 AI 聊需求」变成一套能反复走、能查账的流程</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Node-%E2%89%A520-brightgreen.svg" alt="Node >= 20">
  <img src="https://img.shields.io/badge/宿主-13%20个-8A2BE2" alt="Hosts">
</p>

<p align="center">
  <a href="#安装">安装</a> &bull;
  <a href="#快速开始">快速开始</a> &bull;
  <a href="#命令">命令</a> &bull;
  <a href="#七站访谈">七站访谈</a>
</p>

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_zh.md">简体中文</a>
</p>

---

一句话需求 → 七站访谈 → 独立 worktree 实施 → 自动化验证 → 架构对账 → AI 审查 → 人工审查 → 关闭本轮。这一整圈叫一个 **Loop**。

## 它解决什么

| 你遇到的 | sdd-loop 做的 |
|---|---|
| 让 AI 写需求文档,它编得头头是道,但一半是猜的 | 强制区分「问出来的」「读代码查到的」「还不知道的」。查不到就标「待勘察」,**不许编** |
| 第一版做完了,不知道第二轮从哪儿接 | 状态文件记着走到哪一步。开工先跑一次对账,声明和事实对不上就停下 |
| 文档写着「已完成」,代码里根本没有 | 把状态文件的**声明**和文件里的**事实**摆一起比,不一致直接列出来 |
| 每次写条款格式都不一样,编号也对不上 | 写之前查口径:这类条款该写哪几项、本仓库已有哪些编号族 |
| 聊到一半 AI 忘了前面说过什么 | 每一站的产出立刻落盘成文档,不靠对话记忆 |
| 一个人的 Loop 开着,别人的活只能绕过门禁做 | 按子系统拆成多条流,各有各的状态、门禁和归档（[怎么做](#多人并行)） |
| 代码已经变了，总体架构图还停在上个季度 | 长期维护 `docs/architecture/` 下的 Architecture Baseline，人工审查前按最终代码反向对账 |
| 测试绿了，AI 就把本轮宣称为完成 | 把自动化验证、只读 AI 代码审查和人工明确通过分开，只有最后一道能关 Loop |

## 安装

要求 Node ≥ 20。三条命令,所有宿主一起装好:

```bash
git clone https://github.com/Roger0808/sdd-loop.git && cd sdd-loop
npm link
sdd-loop init -g
```

`init -g` 安装四个 Skill：`skills/sdd-init`、`skills/sdd-interview`、`skills/sdd-upgrade` 和 `skills/sdd-review`。没检测到的宿主会跳过。十个开放标准宿主共用 `~/.agents/skills/`；Hermes 通过官方支持的 `skills.external_dirs` 读同一份。

| 宿主 | 落点 | 初始化仓库 | 走访谈 |
|---|---|---|---|
| Claude Code | `~/.claude/skills/` | `/sdd-init` | `/sdd-interview` |
| Codex | `~/.agents/skills/` | 说「初始化 SDD」 | 说「走 SDD 访谈」 |
| Gemini CLI | `~/.agents/skills/` | 说「初始化 SDD」 | 说「走 SDD 访谈」 |
| GitHub Copilot | `~/.agents/skills/` | 说「初始化 SDD」 | 说「走 SDD 访谈」 |
| Cursor ⚠️ | `~/.agents/skills/` | 说「初始化 SDD」 | 说「走 SDD 访谈」 |
| Windsurf | `~/.agents/skills/` | 说「初始化 SDD」 | 说「走 SDD 访谈」 |
| OpenCode | `~/.agents/skills/` | 说「初始化 SDD」 | 说「走 SDD 访谈」 |
| Kimi Code | `~/.agents/skills/` | 说「初始化 SDD」 | 说「走 SDD 访谈」 |
| Antigravity | `~/.agents/skills/` | 说「初始化 SDD」 | 说「走 SDD 访谈」 |
| Factory Droid | `~/.agents/skills/` | 说「初始化 SDD」 | 说「走 SDD 访谈」 |
| Roo Code | `~/.agents/skills/` | 说「初始化 SDD」 | 说「走 SDD 访谈」 |
| Hermes Agent | `${HERMES_HOME:-~/.hermes}/config.yaml` 登记 `~/.agents/skills/` | 说「初始化 SDD」 | 说「走 SDD 访谈」 |
| pi | `pi install` 登记本包 | `/sdd init` | `/sdd` |

⚠️ Cursor 有多份「不跟进软链」的报告,本包正是软链装法——装上了也可能发现不了。

**sdd-upgrade** 负责老仓库的门禁对齐、单流转分流，以及对已有 AGENTS.md 生成临时 Candidate。Candidate 里的删除、移动和合并必须逐项授权，宿主/模型配置不会被改写。**sdd-review** 负责实施后收口：架构反向回写、change surface、独立只读 AI 审查和人工审查包。

`sdd-loop check` 与 `sdd-loop guide` 在哪个宿主里敲法都一样；pi 里也可以用内置的 `sdd_loop_check` / `sdd_spec_guide` 工具。pi 中用 `/sdd upgrade` 进入升级与 AGENTS 审计，用 `/sdd review` 进入审查收口；未知 `/sdd` 子命令只返回用法，不误进访谈。

```bash
sdd-loop init -g --claude   # 只装 ~/.claude/skills/
sdd-loop init -g --agents   # 只装 ~/.agents/skills/（上表其余宿主共用这一份）
sdd-loop init -g --hermes   # 共享软链 + Hermes external_dirs 登记
sdd-loop init -g --pi       # 只登记进 pi
sdd-loop init -g --show     # 只看要做什么，不动手
```

重复跑是安全的：**绝不删任何已存在的文件或目录**。Hermes 配置会按 YAML 解析，路径去重追加，改已有文件前备份并原子替换；YAML 损坏或字段类型异常时只报冲突、不覆盖。安装器只接入已安装的 Hermes，不下载 Hermes，也不往 `~/.hermes/skills/` 建重复软链。需要让多个 Hermes Profile 使用时，应分别在对应的 `HERMES_HOME` 下执行。

装完**要重启宿主**才会加载到新 Skill（Gemini 里也可以 `/skills reload`；Hermes 在新会话加载）。

<details>
<summary>从 0.x 升级</summary>

0.x 往各宿主的品牌目录里装(`~/.codex/skills/`、`~/.gemini/skills/`),现在改成共用 `~/.agents/skills/` 一份。宿主**不去重**:同一个 skill 两个目录里都有,它会被列两遍,模型看到两个同名 skill。

`init -g` 会把旧软链找出来、给出 `rm` 命令,但**不替你删**——万一那是你自己重建的。删掉即可,skill 内容没变。

</details>

## 快速开始

| 步骤 | 多久一次 | 怎么做 |
|---|---|---|
| **1. 初始化仓库** | 每个仓库一次 | 在项目里触发 sdd-init([各宿主的敲法](#安装)) |
| **2. 走一轮访谈** | 每个 Loop 一次 | 触发 sdd-interview,走完[七站](#七站访谈) |
| **3. 开工先对账** | 每轮开工 | `sdd-loop check` |
| **4. 实施** | 每个 Loop | 分流项目每个 stream + Loop 单独分支和 worktree |
| **5. 审查与关闭** | 每个 Loop | 触发 sdd-review，然后取得人工明确通过 |

第 2 步也可以是「我已经有一份 PRD,帮我整理成 SDD」—— 大纲照走,原文里没有的照样要问你。

### 生命周期门禁

`Requirements → Architecture + Architecture Baseline → Specification → Tasks → Worktree Ready → Implementation → Automated Verification → Architecture Reconciliation → AI Review → Human Review → Closed`

六份阶段文档和状态取值不变，新名称是门禁。Loop 内 `architecture.md` 写本轮方案；长期 Architecture Baseline 写系统当前总体事实。先沿用已有 `docs/architecture/` 结构；没有时，单系统用 `docs/architecture/overview.md`，分流用 `docs/architecture/<stream>.md`。架构图只用可评审的 Mermaid 或 ASCII。

Implementation 开始时，`implementation.md` 记录基线分支、基线 commit、当前分支和任务范围，不记本机 worktree 路径。测试后，实施 Agent 按最终代码更新 Baseline，并写出代码/配置/数据/接口/部署/测试/文档改动面。独立只读 reviewer 只能输出 `READY_FOR_HUMAN_REVIEW`、`CHANGES_REQUIRED` 或 `NOT_REVIEWABLE_SAFELY`；关键事实一变，旧审查失效。`verification.md` 保持 draft，直到人工记录确认人、时间、审查版本和指纹。

分流项目每个 stream + Loop 使用独立分支和 worktree，主工作区只做同步、集成和审查。已开工的存量 Loop 可在 sdd-upgrade 中记录一次性豁免，下一 Loop 必须使用 worktree。

sdd-init 发现没有 AGENTS.md 时，会先按项目现状分类模板适用性，直接生成按工作流组织的最终文件。已有 AGENTS.md 时，sdd-init/sdd-upgrade 只在 `/tmp` 生成 Candidate 和逐项分类报告，不静默覆盖；删除、移动、合并必须逐项授权。固定分类是 `KEEP_SDD_CANONICAL`、`KEEP_PROJECT_SPECIFIC`、`DUPLICATED`、`STALE`、`MODEL_OR_HOST_SPECIFIC`、`BELONGS_IN_AGENT_CONFIG`、`CANONICAL_ELSEWHERE` 和 `UNCLEAR`。

AGENTS 审计只输出一个结论：`RECOMMEND_ADOPTION`、`NEEDS_REVISION`、`KEEP_CURRENT` 或 `NOT_TESTABLE_SAFELY`。

## 命令

### `sdd-loop check` — 状态对账

```bash
sdd-loop check                    # 当前仓库
sdd-loop check --repo <dir>       # 指定仓库
sdd-loop check --stream <name>    # 只看一条流（见下）
sdd-loop check --json             # 机器可读
```

对四件事:front-matter 读不读得出来、`activeLoop` 指的目录是不是空的、已关闭 Loop 的阶段文档是否全部归档、当前卡在哪道门禁。

| 退出码 | 含义 |
|---|---|
| `0` | 干净 |
| `1` | 声明与事实矛盾 |
| `2` | 判据读不出来,此时不给任何结论 |

**只读**,矛盾由人解决:不改状态、不解冲突、不归档、不重命名文件。

状态路径已经存在但读不出来时——例如误建成了名为 `status.md` 的目录——属于判据不可读（退出 `2`），不是「状态不存在」的冷启动。

### `sdd-loop guide` — 口径字典

```bash
sdd-loop guide                                  # 列出全部类型
sdd-loop guide --type specification.entity-table
```

输出三样:该写哪几项、本仓库现有编号族(新增沿用同族前缀)、一条参考写法。**只在写之前给要求,不做事后判定。**

<details>
<summary>全部 17 种条款类型</summary>

**requirements.md** — `goal` 目标 · `non-goal` 非目标 · `scenario` 用户场景 · `success-criterion` 成功标准 · `non-functional` 非功能要求

**architecture.md** — `module-boundary` 模块边界 · `adr` 技术决策 · `integration` 集成边界 · `schema-change` 数据模型变更 · `migration-map` 迁移映射

**specification.md** — `entity-table` 实体与字段表 · `state-machine` 状态机 · `permission-matrix` 权限矩阵 · `behavior` 行为条款 · `page-behavior` 页面行为 · `approval-flow` 审批流

**tasks.md** — `task` 实施任务

</details>

## 七站访谈

每一站的产出立刻落盘,`status: draft` 起步;改成 `confirmed` 是人的动作,AI 不代办。

| 站 | 问什么 | 落到哪 |
|---|---|---|
| **0 · 需求起点与公司背景** | 一句话需求、产品名、目标业务域、成功标准、行业、发展阶段、经营模式、业务规模、当前用什么工具、当前痛点、一期目标、本期不做 | requirements.md<br>背景 / 目标 / 非目标 / 成功标准 |
| **1 · 业务上下文** | 现在这事怎么跑、谁参与、卡在哪、一期闭环到哪、边界在哪 | requirements.md<br>用户场景 / 范围 |
| **2 · 系统骨架** | 模块怎么分、核心实体与关系、业务单据、共享机制、技术选型、外部系统怎么接 | architecture.md<br>模块边界 / 技术决策 / 集成边界 |
| **3 · 场景粗流程推演** | 端到端主流程、关键场景、异常分支、审批流 | specification.md<br>主流程 / 异常分支 / 审批流 |
| **4 · 字段清单与业务规则** | 有哪些单据/对象、每个字段(控件、取值、必填、在哪个页面)、状态机、每个状态谁能做什么、业务规则 | specification.md<br>实体与字段表 / 状态机 / 权限矩阵 / 行为条款 |
| **5 · 用例数据推演** | 样例主数据、样例单据、事件序列、测试用例 | specification.md<br>用例(数据 + 事件 + 预期) |
| **6 · 页面规格** | 页面清单、关键交互、校验点、列表/表单/弹窗行为、非功能要求 | specification.md 页面行为<br>requirements.md 非功能要求 |
| **收官 · 拆任务** | 不提问,读代码 | tasks.md<br>编号 / 引用的需求·架构·规格编号 / 完成条件 / 验证方法 |

## 文件长什么样

初始化之后:

```
你的项目/
├── AGENTS.md              # 门禁规则
├── CLAUDE.md              # 转引 AGENTS.md
└── docs/
    ├── loops/
    │   ├── status.md      # 走到哪一步了
    │   └── loop-1/        # 访谈第 0 站时创建
    │       ├── requirements.md
    │       ├── architecture.md
    │       ├── specification.md
    │       └── tasks.md
    └── archive/           # 关闭的 Loop 挪到这
```

路径是默认值:目录约定不同,用 `sdd-loop check --status-file <path>` / `--archive-dir <path>` 指过去。

<details>
<summary>多人并行</summary>

一个仓库、一份状态、一个活跃 Loop——这是一把全仓库的锁。一个人的 Loop 开着，别人的活就只能在门禁外面做。

按「能各自独立交付的子系统」拆成多条**流**，每条流各有各的状态文件、门禁和归档：

```
你的项目/
└── docs/
    ├── loops/
    │   ├── maker/
    │   │   ├── status.md
    │   │   └── loop-1/
    │   └── admin-console/
    │       ├── status.md
    │       └── loop-2/
    └── archive/
        ├── maker/
        └── admin-console/
```

不用加配置文件：根上那份状态文件挪走，`sdd-loop check` 自己就发现得了，然后逐流报结论。**一条流读不出来，不影响其余各流给结论。**只想看一条用 `--stream <名字>`。

自定义布局时，`--status-file` 传的是「单流形态下状态文件会在的基准路径」；发现分流后，工具会在文件名前插入 `<流名>/`，`--archive-dir` 则在末尾追加 `<流名>/`。例如 `--status-file meta/loops/status.md --archive-dir meta/archive` 会发现 `meta/loops/maker/status.md`，并把该流的归档根解析成 `meta/archive/maker/`。

Loop 编号是流内的，`maker/loop-1` 和 `admin-console/loop-1` 是两个不同的 Loop，提到时要带流名。条款编号（`REQ-001`）不受影响——它们只在同一条流内部互相引用。

先按单流起步，真撞上锁再拆；迁移就是挪目录，sdd-upgrade 会带着你走。

**拆流不会逼任何人进门禁。**它移除的是借口，不是可能性——一个压根没建流的子系统照样能悄悄发布。那部分是 AGENTS.md 的规则在管。

</details>

## 许可

MIT License — 详见 [LICENSE](LICENSE)。
