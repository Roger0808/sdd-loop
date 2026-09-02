---
name: sdd-init
description: 把一个还没有 SDD Loop 结构的仓库初始化成按 SDD Loop 运行——落地 AGENTS.md（门禁规则，主力）、CLAUDE.md（转引 AGENTS.md）、docs/loops/status.md 与首个 Loop 目录。当用户说「初始化 SDD」「/sdd init」「/sdd-init」，或 sdd-loop check 报「这个仓库还没有 SDD Loop 结构」时使用。每个仓库一次，不产出任何业务内容。
---

# SDD 初始化：把一个仓库变成按 SDD Loop 运行

## 这份 skill 产出的是**结构**，不是内容

| | sdd-init（本 skill） | sdd-interview |
|---|---|---|
| 干什么 | 建立约定：这个仓库从此按 SDD Loop 运行 | 访谈，把四份 SDD 文档问出来 |
| 产出 | AGENTS.md / CLAUDE.md / status.md / Loop 目录 | 四份阶段文档的业务内容 |
| 频率 | 每个仓库一次 | 每个产品/每轮 Loop 一次 |

**一个字的业务内容都不要在这一步写。** 初始化完成后交棒给 `sdd-interview`。

## 为什么 AGENTS.md 是主力

`sdd-loop check` 执行的就是 AGENTS.md 里那条「状态文件、活跃目录和阶段文档互相矛盾时，应停止相关工作并请求用户确认」。**没有 AGENTS.md，check 是在判一个仓库从没声明过的约定。**

所以 CLAUDE.md 只转引，不复制条款——两份规则必然漂移，漂移之后没人知道哪份算数。

## 步骤

### 0. 先确认这是不是冷启动

跑 `sdd-loop check`（pi 里是 `sdd_loop_check` 工具）：

- 报**「还没有 SDD Loop 结构」** → 冷启动，继续往下走。
- 报**「判据读不出来」** → 文件在但被污染（冲突标记/重复键/未闭合）。**停下请人解决**，不要初始化，更不要覆盖。
- 报出状态（干净或有矛盾）→ 这个仓库已经初始化过了。不要重跑本 skill，去 `sdd-interview`。

再问用户一句：是要在这个仓库开始 SDD Loop，还是状态文件在别处（在别处就把路径指过去，别新建）。

### 1. 仓库概览（只做概览，不做全量盘点）

读到能填 AGENTS.md 的「项目上下文」一段就够：

- 项目名与一句话定位（`package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod` / README 的第一段）
- 技术栈与运行方式（依赖清单、脚本、构建/测试命令）
- 顶层目录结构与代码入口
- 已有文档在哪（README / docs/ / 现成的 PRD 或需求文档）
- 是不是迁移/重写类项目（有没有源项目、旧系统）

**边界：到此为止。** 模块细节、接口语义、数据模型是 `sdd-interview` 第 2 站的勘察活，那时候有文档可落。在这里读了没有落点，只会变成编造的素材。

概览结果先复述给用户确认再往下写——认错了项目，AGENTS.md 顶上那段就是错的。

### 2. 落 AGENTS.md（逐字复制模板）

模板：本 skill 目录下的 `AGENTS.md.template`。

**逐字复制，只做三件事**：

1. 替换 `{{PROJECT_NAME}}` 和 `{{PROJECT_CONTEXT}}`（用第 1 步的概览，写成一小段人话，不要贴目录树）。
2. 非迁移/重写类项目：删掉标了「迁移类项目才保留」的行；是迁移类项目：按注释里的提示把「源项目」加回去。删完把这些引导注释一并删掉。
3. 目录约定与本仓不同时改路径——**改了要记下来**，`sdd-loop check` 得用 `--status-file` / `--archive-dir` 指过去，否则它判的是默认路径。

**条款本身不要改写、不要精简、不要"优化措辞"。** 改写会让仓库声明的规则和 sdd-loop 的判据对不上，检查就成了摆设——那比没有检查更坏，因为它还在绿着。

### 3. 落 CLAUDE.md

模板：本 skill 目录下的 `CLAUDE.md.template`。同样逐字复制。

**仓库已有 CLAUDE.md 时不要覆盖。** 在它顶部加一句指向 AGENTS.md 的转引，其余内容原样保留——那是用户自己的东西。已有 AGENTS.md 同理：不覆盖，把差异摆给用户，由用户决定合并还是保留。

### 4. 落状态文件（`activeLoop: null` 起步，**不要建 Loop 目录**）

`docs/loops/status.md`（或用户指定的路径），front-matter **至少要有 `activeLoop`**——缺了它 check 直接判读不出来：

```markdown
---
project: <项目名>
document: loop-status
activeLoop: null
lastClosedLoop: null
nextLoop: 1
nextPhase: requirements
updatedAt: <YYYY-MM-DD>
---

# Loop 状态

当前没有活跃 Loop。下一步：由用户明确目标后，为 Loop 1 产出 requirements。
```

**初始化时没有活跃 Loop，这是事实不是缺陷。** AGENTS.md 自己就写着 `activeLoop: null` 的含义——下一步只能在用户明确新目标后为 `nextLoop` 创建 Requirements，那正是访谈第 0 站的活。

两个坑，实测都踩过：

- **不要预先建 `docs/loops/loop-1/`。** 空目录进不了 git，check 会报「目录存在但没有任何被跟踪的文件（悬空指针）」，初始化当场产出一个红的仓库。目录由访谈第 0 站连同 requirements.md 一起建，同时把 `activeLoop` 改成 `1`。
- **不要预先创建空壳阶段文档**——AGENTS.md 的文档规则明确禁止（"不提前创建后续阶段的空壳文档"）。
- `activeLoop` 的值是**编号本身**，目录名是 `loop-` 加这个值。写 `activeLoop: loop-1` 会被解析成 `docs/loops/loop-loop-1`，check 报悬空指针。

### 5. 重跑 check 验证

再跑一次 `sdd-loop check`。**应该是干净的（退出码 0）**，下一步显示「Loop 1 / requirements」。

不干净就说明第 4 步写错了，改完再跑——不要跳过这一步直接进访谈，也不要把红的结果当"待会儿访谈就好了"放过去。

## 收尾

报告写三件事：

1. 建了哪几个文件（逐个点名路径），以及**哪几个因为已存在而没动**。
2. AGENTS.md 里对模板做了哪些改动（删了哪些迁移条款、改了哪些路径）。路径改过的话，把对应的 `--status-file` / `--archive-dir` 参数一并写出来。
3. check 的验证结果，然后交棒：接下来用 `sdd-interview` 走访谈，产出 requirements.md。

初始化不产出业务内容——报告里不要出现任何关于产品做什么的结论。
