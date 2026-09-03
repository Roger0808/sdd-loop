<h1 align="center">sdd-loop</h1>

<p align="center">
  <strong>把「跟 AI 聊需求」变成一套能反复走、能查账的流程</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Node-%E2%89%A520-brightgreen.svg" alt="Node >= 20">
  <img src="https://img.shields.io/badge/宿主-Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Gemini%20CLI%20%C2%B7%20pi-8A2BE2" alt="Hosts">
</p>

<p align="center">
  <a href="#安装">安装</a> &bull;
  <a href="#快速开始">快速开始</a> &bull;
  <a href="#命令">命令</a> &bull;
  <a href="#七站访谈">七站访谈</a>
</p>

---

一句话需求 → 七站访谈 → 四份规格文档 → 拆成任务 → 写代码 → 验证 → 关闭这一轮,再开下一轮。这一整圈叫一个 **Loop**。

## 它解决什么

| 你遇到的 | sdd-loop 做的 |
|---|---|
| 让 AI 写需求文档,它编得头头是道,但一半是猜的 | 强制区分「问出来的」「读代码查到的」「还不知道的」。查不到就标「待勘察」,**不许编** |
| 第一版做完了,不知道第二轮从哪儿接 | 状态文件记着走到哪一步。开工先跑一次对账,声明和事实对不上就停下 |
| 文档写着「已完成」,代码里根本没有 | 把状态文件的**声明**和文件里的**事实**摆一起比,不一致直接列出来 |
| 每次写条款格式都不一样,编号也对不上 | 写之前查口径:这类条款该写哪几项、本仓库已有哪些编号族 |
| 聊到一半 AI 忘了前面说过什么 | 每一站的产出立刻落盘成文档,不靠对话记忆 |

## 安装

要求 Node ≥ 20。三条命令,所有宿主一起装好:

```bash
git clone https://github.com/Roger0808/sdd-loop.git && cd sdd-loop
npm link
sdd-loop init -g
```

`init -g` 把 `skills/sdd-init` 和 `skills/sdd-interview` 装进这台机器上检测到的宿主:

| 宿主 | 落点 |
|---|---|
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| Gemini CLI | `~/.gemini/skills/` |
| pi | `pi install` 登记本包 |

没检测到的宿主自动跳过并说明理由。想先看它要做什么:

```bash
sdd-loop init -g --show
```

只装一个宿主加 `--claude` / `--codex` / `--gemini` / `--pi`。重复跑是安全的:**绝不删任何已存在的文件或目录**,位置被别的东西占着就报出来交给你。

装完**要重启宿主**才会加载到新 skill(Gemini 里也可以 `/skills reload`)。

> pi 用户也可以不 clone,直接 `pi install git:github.com/Roger0808/sdd-loop`。代价是没有 `sdd-loop` 这条命令,查口径只能走 pi 的 `sdd_spec_guide` 工具。

## 快速开始

**1. 初始化仓库**(每个仓库一次)

在你的项目里让 agent 加载 sdd-init:Claude Code 敲 `/sdd-init`,pi 敲 `/sdd init`,Codex / Gemini 直接说「初始化 SDD」。

生成 `AGENTS.md`(门禁规则)、`CLAUDE.md`、`docs/loops/status.md`。只建结构,不写任何业务内容。**别删 `AGENTS.md`** —— 状态对账执行的就是它里面那条门禁规则。

**2. 走一轮访谈**

`/sdd-interview`(pi 里 `/sdd`,Codex / Gemini 说「走 SDD 访谈」)。带你走完[七站](#七站访谈),产出四份文档。

也可以是「我已经有一份 PRD,帮我整理成 SDD」—— 大纲照走,每一站的内容先从原文里找,原文没有的照样要问你。

**3. 每轮开工先对账**

```bash
sdd-loop check
```

> `sdd-loop init -g` 和 `/sdd-init` 是两件事,名字像但别混:前者装工具(每台机器一次),后者初始化一个仓库(每个仓库一次)。

## 命令

### `sdd-loop check` — 状态对账

把状态文件的**声明**和文件里的**事实**摆在一起比:front-matter 读不读得出来、`activeLoop` 指的目录是不是空的、已关闭 Loop 的阶段文档是否全部归档、当前卡在哪道门禁。

```bash
sdd-loop check                    # 当前仓库
sdd-loop check --repo <dir>       # 指定仓库
sdd-loop check --json             # 机器可读
```

退出码是契约:`0` 干净 / `1` 声明与事实矛盾 / `2` 判据读不出来。

**只读。** 不替你改状态、不解冲突、不归档、不重命名文件 —— 矛盾由人解决。

### `sdd-loop guide` — 口径字典

**写之前**查,不做事后判定。告诉你这类条款该写哪几项、本仓库现有编号族(新增沿用同族前缀)、一条参考写法。

```bash
sdd-loop guide                                  # 列出全部类型
sdd-loop guide --type specification.entity-table
```

<details>
<summary>全部 17 种条款类型</summary>

**requirements.md** — `goal` 目标 · `non-goal` 非目标 · `scenario` 用户场景 · `success-criterion` 成功标准 · `non-functional` 非功能要求

**architecture.md** — `module-boundary` 模块边界 · `adr` 技术决策 · `integration` 集成边界 · `schema-change` 数据模型变更 · `migration-map` 迁移映射

**specification.md** — `entity-table` 实体与字段表 · `state-machine` 状态机 · `permission-matrix` 权限矩阵 · `behavior` 行为条款 · `page-behavior` 页面行为 · `approval-flow` 审批流

**tasks.md** — `task` 实施任务

</details>

### 各宿主怎么触发

| 做什么 | Claude Code | Codex | Gemini CLI | pi |
|---|---|---|---|---|
| 初始化仓库 | `/sdd-init` | 说「初始化 SDD」 | 说「初始化 SDD」 | `/sdd init` |
| 走访谈 | `/sdd-interview` | 说「走 SDD 访谈」 | 说「走 SDD 访谈」 | `/sdd` |
| 状态对账 | `sdd-loop check` | `sdd-loop check` | `sdd-loop check` | `sdd_loop_check` 工具 |
| 查条款口径 | `sdd-loop guide --type <类型>` | 同左 | 同左 | `sdd_spec_guide` 工具 |

Codex 与 Gemini 的 skill 由模型按描述自己激活,没有斜杠命令,所以那两格写的是「你说什么」。

## 七站访谈

七站问完产出四份文档。**每一站的产出立刻落盘**,`status: draft` 起步,你确认后才改成 `confirmed` —— 确认是人的动作,AI 不代办。

| 站 | 问什么 | 落到哪 |
|---|---|---|
| **0 · 需求起点与公司背景** | 一句话需求、产品名、目标业务域、成功标准、行业、发展阶段、经营模式、业务规模、当前用什么工具、当前痛点、一期目标、本期不做 | requirements.md<br>背景 / 目标 / 非目标 / 成功标准 |
| **1 · 业务上下文** | 现在这事怎么跑、谁参与、卡在哪、一期闭环到哪、边界在哪 | requirements.md<br>用户场景 / 范围 |
| **2 · 系统骨架** | 模块怎么分、核心实体与关系、业务单据、共享机制、技术选型、外部系统怎么接 | architecture.md<br>模块边界 / 技术决策 / 集成边界 |
| **3 · 场景粗流程推演** | 端到端主流程、关键场景、异常分支、审批流 | specification.md<br>主流程 / 异常分支 / 审批流 |
| **4 · 字段清单与业务规则** | 有哪些单据/对象、每个字段(控件、取值、必填、在哪个页面)、状态机、每个状态谁能做什么、业务规则 | specification.md<br>实体与字段表 / 状态机 / 权限矩阵 / 行为条款 |
| **5 · 用例数据推演** | 样例主数据、样例单据、事件序列、测试用例 | specification.md<br>用例(数据 + 事件 + 预期) |
| **6 · 页面规格** | 页面清单、关键交互、校验点、列表/表单/弹窗行为、非功能要求 | specification.md 页面行为<br>requirements.md 非功能要求 |

**收官:拆任务**(不是提问站)。前面靠问,这一步靠读代码。产出 `tasks.md`:每条任务写编号、引用的需求/架构/规格编号、完成条件、验证方法。

之后 implementation 与 verification 两个阶段由 coding agent 按 `AGENTS.md` 的门禁走。

> 访谈只能得到你脑子里的东西。代码现状、接口错误语义、运行环境**必须去读代码**;读不到就在文档里标「待勘察」,**不许编** —— 编出来的结论会被后续流程当成高级别事实用。

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

## 许可

MIT。
