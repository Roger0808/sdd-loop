# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

sdd-loop 是一个给 SDD Loop 约定提供仪器的包。主体是 skill 与 CLI（对宿主零依赖），pi 扩展只是把它们包成工具与命令——pi 与 Claude Code 都能用。两件仪器：

1. **状态对账**：把状态文件的「声明」与文件里的「事实」摆在一起比（front-matter 可读性 / 悬空指针 / 归档完整性 / 当前门禁 / 下一步）。
2. **口径字典**：写之前给要求（「这一类条款该写哪几项」+ 本仓现有编号族 + 参考写法）。**只在写之前给要求，不做事后判定。**

外加三份纯提示词 skill：

- `skills/sdd-init/`：把一个仓库初始化成按 SDD Loop 运行（AGENTS.md 门禁规则 + CLAUDE.md 转引 + status.md），每个仓库一次。**AGENTS.md 是承重墙**——`loop-check.js` 执行的就是它写的那条「矛盾时停下请人确认」，没有它 check 是在判一个仓库从没声明过的约定。所以模板逐字复制，不许现写。
- `skills/sdd-interview/`：七站提问 + 收官拆任务（冷启动仪器，每个产品一次）。**「七」是提问站数**；拆任务勘察为主、不算提问站，编进站数会让人以为还有一轮问题要答。
- `skills/sdd-upgrade/`：**已经**在跑 SDD Loop 的仓库的条款对齐与形态迁移（单流 → 分流）。它与 init 分家不是为了整齐：init 的承重规则是「不覆盖已存在的东西」，upgrade 的核心动作恰恰是「改已存在的东西」，塞进一份 skill 打输的会是安全的那条。

三者的分界：init 建约定不产业务内容，interview 产内容不建约定，upgrade 只改已有约定、一个字业务内容都不动。

## 协作形态三档（模板里的条款分档）

`AGENTS.md.template` 的条款分三档，init 第 2 步的两问各开一档：

| 档 | 什么时候留 | 标记 |
|---|---|---|
| 常驻 | 任何项目 | 无标记，**不许删** |
| 多人 | 范围能互不重叠地切分 | `<!-- 单人开发：删掉… -->` |
| 分流 | 已按系统分成多条 Loop 流 | `<!-- 单流：删掉… -->` |

三条硬规矩：

1. **判据是「范围能不能切分」，不是「几个人」。**两个方向都有反例：一个人的 monorepo 同时推两个不相干系统照样撞同一把锁；三个人做同一个小服务，切开会变成三份互不知情的需求各自 confirmed。
2. **「多人」和「分流」是两档不是一档。**多人 + 单流是正常形态，不是过渡态——删「单流」不等于删「多人」。
3. **标记有两个方向，别搞反。**`源项目迁移` 说的是要**加**什么（默认不在）；`单人开发：删掉` / `单流：删掉` 说的是要**删**什么（默认就在）。默认在是有意的：漏删只是多几句用不上的话，漏加是门禁上少一条。删除标记的单位只用「这一条 / 这一段 / 本节整节」，**不用「下一句」**——常驻条款和条件条款同处一行时，「删掉下一句」会让 agent 把整条 bullet 一起删掉。

**改模板必须同步在 `skills/sdd-init/AGENTS.md.CHANGELOG.md` 记一笔**（条款 / 在哪一节 / 探针 / 属于哪一档）。`sdd-upgrade` 拿探针去老仓库里搜，搜不到才提示补——漏记的后果是那条新规则永远到不了老仓库。探针写错一个字则相反：它会去劝用户补一条其实一直都在的条款。两侧都有锁（`tests/sdd-init-skill.test.js`），但「记不记」这个动作本身没有机器锁，靠纪律。

**分流不解决「干了没进门禁」。**它移除的是借口（「唯一的 Loop 被别人占着」），不是可能性——一个压根没建流的子系统照样能悄悄发布。那部分归 AGENTS.md 的规则管，不归工具。两份 README 里都写着这句，别在「宣传」时把它删掉。

## 明确不做（边界，不是待办）

这些是设计边界。想加进来之前，先说清为什么这条边界不再成立。

- **不做 Web UI、数据库、登录、跨仓注册表。** 本包无环境变量、无本地状态目录；SDD 文档就是 markdown，编辑器和 GitHub 渲染得更好。工具跑在仓库里（cwd），不需要 name→path 映射——那种映射注定过期。
- **不做事后口径判定。** 口径只在写之前给要求。
- **不做引用图检查。** 将来若在真实项目上见到确凿的悬空引用再重开；重开时必须支持三段式编号、通配引用、区间引用——天真实现会在合格文档上造出成片假警报（实测 32 条）。
- **不判 `docs/backlog.md`。** 它是 AGENTS.md 门禁里的约定（Implementation 把本轮不做的记进去，下一轮 Requirements 开局捞出来交用户拍板），**check 完全不看它**——它没有 front-matter、不是阶段文档，也没有「正确的样子」可判。想加判据之前先回答：它在一份合格的 backlog 上会不会误报。
- **不接管 Implementation / Verification。** 那是 coding agent 的主场，用户 `AGENTS.md` 的门禁已经在管。loop 生命周期（open/delivering/done）同理。
- **不替人改状态**、不自动解冲突、不自动归档、不重命名文件。这条说的是**用户的仓库**；`init -g` 写的是宿主配置目录，两回事（见红线 9）。
- **不硬编码任何项目的目录约定**，不引入 HTML 注释锚点（稳定编号就是锚点）。

## Development Commands

| Command | Purpose |
|---------|---------|
| `npm test` | 全部测试（Node 内置 runner）。 |
| `node --test --test-timeout=30000 --test-force-exit tests/<file>.test.js` | 单文件。**两个 flag 都不能省**：Node 默认测试超时无限，挂起的 handler 会让 run 挂死而不是变红；`--test-force-exit` 才是真正结束 run 的那个。 |
| `node scripts/sdd-loop.mjs check --repo <dir>` | 状态对账 CLI。 |
| `node scripts/sdd-loop.mjs guide --type <doc.clause> [--repo <dir>]` | 口径字典 CLI。 |
| `node scripts/sdd-loop.mjs init -g [--show]` | 把本包装进本机的三个落点（`~/.claude/skills` / `~/.agents/skills` / pi）。**改代码后别拿真 home 试**，用 `HOME=<临时目录>` 跑；试 Gemini 还要伪造 PATH。 |
| `CODEX_HOME=<临时目录> codex debug prompt-input "hi"` | 验 Codex 到底发现了哪些 skill——渲染模型可见的 prompt，离线、不调模型、不写盘。比让模型自述可靠，也是「Codex 认软链」这条结论的来源。 |
| `node scripts/dead-exports.mjs` | 导出级可达性扫描。判据与盲区见脚本头注；当前基线 `TOTAL: 25 DEAD: 0`。 |

## Architecture

| Layer | Path | Responsibility |
|-------|------|----------------|
| Loop 约定 | `src/loop/` | `front-matter.js`（严格读取器：冲突标记/重复键/未闭合一律判不可读，不返回猜出来的 meta）、`convention.js`（字段名定死、路径默认可覆盖；`conventionForStream()` 把状态文件与归档根一起下移一层）、`repo-scan.js`（只产出事实；git 不可用返回 null 不谎报 0；`discoverStreams()` **发现不配置**——根上有 `status.md` 就是单流，没有则看下一层哪些子目录里有 `status.md`） |
| 口径 | `src/spec-guide/` | `dictionary.js`（按「文档类型 × 条款类型」组织的纯文字条目，**不携带机判结构**）、`id-scan.js`（编号族扫描：两段式/三段式/通配/区间，只扫只报）、`example.js`（参考写法选取，CLI 与扩展共享） |
| 判定 | `src/validation/loop-check.js` | 状态对账**唯一判定源**：只返回数据，不渲染文案；判据读不出来时拒绝给任何结论。`buildLoopCheckReport()` 判一条流，`buildRepoCheckReport()` 是**聚合层，自己不判**——只发现、逐流委派、做算术（严重度取最坏：unusable > problem > ok）；打错的流名当**参数错**返回 `unknownStream`，不走下去说成冷启动 |
| 安装计划 | `src/install/plan.js` | `init -g` 的**唯一判定源**：只算不写，产出「该做什么」。要装哪些 skill 读 `package.json` 的 `pi.skills`，不另抄一份；pi 的 settings 读不出来返回 `null`（不知道），不谎报「没装」。落点加在 `HOST_IDS` + `SKILLS_DIR_HOSTS`，走开放标准的宿主加在 `AGENTS_STANDARD_HOSTS`（每条判据带出处），CLI 帮助与测试都从表推导、不枚举 id |
| CLI | `scripts/sdd-loop.mjs` + `scripts/lib/init.mjs` | `check` / `guide` / `init` 三个子命令；文案与退出码（0/1/2，契约在 `scripts/lib/exit-codes.mjs`）。`init.mjs` 是唯一动手的地方——`--show` 和真跑共用同一个计划对象 |
| pi 扩展 | `extensions/sdd-loop/index.ts` | `sdd_loop_check` / `sdd_spec_guide` 两个工具 + `/sdd`（访谈）与 `/sdd init`（初始化）两条路径。全只读——写文件的是 agent，不是工具。 |
| Skill · init | `skills/sdd-init/` | SKILL.md + `AGENTS.md.template` / `CLAUDE.md.template` + `AGENTS.md.CHANGELOG.md`（模板变更的探针表，`sdd-upgrade` 的真相源）。模板不用真名：skill 目录会被软链进 `~/.claude/skills/`，真名会被宿主当成生效的规则文件读走。 |
| Skill · 访谈 | `skills/sdd-interview/SKILL.md` | 访谈大纲 + 落点约定 + 勘察分工（SDD 文档 = 抽取 + 勘察 + 现场沟通；抽不出来要明说，不许编）。第 0 站**先定流、再捞 backlog**——顺序反了就筛不出该摆哪几条 |
| Skill · 升级 | `skills/sdd-upgrade/SKILL.md` | 老仓库的条款对齐（按 `AGENTS.md.CHANGELOG.md` 的探针逐条核，**不整份 diff**）与形态迁移（`git mv`，`activeLoop` 的值不动）。安全规则是「不删用户的东西，动手前留退路」 |
| 首页 | `README.md`（英文，默认）+ `README_zh.md`（简体中文） | **改一份必须改另一份**。`tests/readme.test.js` 对两份跑同一批锁，数字与名字（站数 / 条款类型 / 宿主 / 子命令）一律从真相源推导，只有「用什么写法表达这个数」按语言分 |

## 红线（复审时盯这些）

1. **判定只有一份**：判据进 `loop-check.js`；表面（CLI/扩展）各渲染各的文案，不许自己再判。口径同理：数据在 `dictionary.js`。
2. **假警报比漏报更致命**：任何新判据先问「它在一份合格文档上会不会误报」。实测教训：天真正则在合格文档上造出 32 条假警报（三段式编号被拆尾巴、通配/区间引用被当悬空）。
3. **front-matter 只有一份读取器**（`src/loop/front-matter.js`）；旧 `src/render/spec-file.js` 已退役，那份会静默吞冲突标记的解析器不许复活。
4. **语料文档不是阶段文档**：判阶段只认 `convention.stageDocs` 的文件名，不认所在目录。
5. **不硬编码任何项目的目录约定**：`docs/loops/loop-N/` 是默认值不是前提，覆盖走 convention。
6. **git 查询不可用返回 null**（未知），不谎报 0。
7. **宿主检测信号按宿主选，不许「统一一下」**，尤其**不许按 `~/.agents/` 判**。那是跨宿主共用目录，谁都可能建，按它判等于「有人用过任意一个宿主」就说十个全装了。判据要落在宿主自己的地盘上，还得挑没有第三方共用者的那个：Claude Code / Codex / Copilot / Cursor / Windsurf / OpenCode / Kimi / Droid / Roo 按各自的品牌目录判（目录判还能覆盖只装了桌面端/IDE 扩展、命令没进 PATH 的人）；**Gemini CLI 必须按 PATH 上有没有 `gemini` 判**——`~/.gemini/` 不是它独占的，Antigravity IDE 也写，实测一台没装 Gemini CLI 的机器上 `~/.gemini/GEMINI.md` 和 settings.json 都在，按目录判会误报；Antigravity 反过来按它自己在 `~/.gemini/` 里建的 `antigravity-ide/` 判。`AGENTS_STANDARD_HOSTS` 里每条判据都有出处注释，`tests/init.test.js` 的 `AGENTS_HOST_DIR` 是**测试自己写的**一份期望值（不从被测代码 import），两边各写一份才锁得住「判据被人偷偷改成按共用目录判」。
8. **单流一个字都不许变**：这个包是全局安装的，已经在跑的单流仓库不该因为别人要分流而输出变样。`mode === "single"` 时 CLI 与扩展都**原路返回那份单流报告本身**（不是聚合对象）——文案、`--json` 形状、`details.report` 形状、退出码，四样都要原样。锁在 `tests/cli-check.test.js`（真起进程）与 `tests/sdd-loop-extension.test.js`；回归基线见 Testing。
9. **`init -g` 是安装器，不是仪器**——它是全包唯一会写盘的路径，边界写死在三处：只写**用户主目录下的 agent 落点**（`~/.claude/skills`、`~/.agents/skills`、pi 的 settings），**不碰用户的仓库**（`.cline/skills`、`.kilocode/rules` 那类项目级落点一律不做，所以那几个宿主也就不在支持名单里）；**一个宿主只走一个落点**——实测宿主不去重，同名 skill 同时在品牌目录和共用目录里会被列两遍（两条不同路径），模型看到两个同名 skill，所以走开放标准的十个宿主共用 `~/.agents/skills` 这一份，Claude Code 单走 `~/.claude/skills`（实查它的可执行体：`.claude/skills` 296 次、`.agents/skills` 零次，它不读共用目录）；只新建软链，**绝不删除任何已存在的文件或目录**——包括 0.x 留在 `~/.codex/skills`、`~/.gemini/skills` 里的旧版软链，那些只报不删（`findLegacyLinks`），万一是用户自己重建的。改这一块必须重跑 `tests/init.test.js` 里那几条「不越权」锁，且要验「动手之后内容还在」，不是只验计划里标了 occupied——标了照删是最典型的空绿。

## Testing

测试用 Node 内置 `node:test`。锁的哲学：一半锁「报得出来」，一半锁「不误报」——两者都要有独立命名的锁。新判据/新表面要过变异测试：故意破坏被测的那一条，确认**目标锁**变红（全红只证明可达性），然后还原并用 sha256 校验。

回归基线：拿一个真实的、已按 SDD Loop 运行的仓库跑 `node scripts/sdd-loop.mjs check --repo <dir>`（只读），记下当前输出的不一致条数；任何改动后都不该多出新的一条。假警报比漏报更致命，这条基线就是防它的。**单流的输出还要逐字节比**（`diff` + sha256），不是只比条数。

变异测试实测出来的三种空绿，写新锁时先自查：

- **只有一种坏的 fixture 锁不住「取最坏」。**把 severity 的两档判断顺序对调，一个「一条流读不出来 + 另一条干净」的 fixture 照样绿。要锁排序就得让两种坏同时在场。
- **反向断言挡不住退化路径。**「输出里没有别的流」在参数被吃掉、什么都没印时同样成立。锁正向的那件事（该有的在、该是 0 就是 0）。
- **换个动词就绕过去的关键词锁。**「基准」两个字在「看一眼 check 的输出」里照样在；要锁的动作是「存下来」，就得锁那个词。

只有源码里有判定的地方才好做变异；纯提示词的 skill 与模板同样要过，做法是把那句话真的改掉（不是删关键词），确认**目标锁**变红。

## Configuration

无环境变量，无本地状态目录。所有状态都在被检查的那个仓库的文件里。
