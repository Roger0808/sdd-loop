# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

sdd-loop 是一个给 SDD Loop 约定提供仪器的包。主体是 skill 与 CLI（对宿主零依赖），pi 扩展只是把它们包成工具与命令——pi 与 Claude Code 都能用。两件仪器：

1. **状态对账**：把状态文件的「声明」与文件里的「事实」摆在一起比（front-matter 可读性 / 悬空指针 / 归档完整性 / 当前门禁 / 下一步）。
2. **口径字典**：写之前给要求（「这一类条款该写哪几项」+ 本仓现有编号族 + 参考写法）。**只在写之前给要求，不做事后判定。**

外加两份纯提示词 skill：

- `skills/sdd-init/`：把一个仓库初始化成按 SDD Loop 运行（AGENTS.md 门禁规则 + CLAUDE.md 转引 + status.md），每个仓库一次。**AGENTS.md 是承重墙**——`loop-check.js` 执行的就是它写的那条「矛盾时停下请人确认」，没有它 check 是在判一个仓库从没声明过的约定。所以模板逐字复制，不许现写。
- `skills/sdd-interview/`：七站提问 + 收官拆任务（冷启动仪器，每个产品一次）。**「七」是提问站数**；拆任务勘察为主、不算提问站，编进站数会让人以为还有一轮问题要答。

两者的分界是「结构 vs 内容」：init 建约定不产业务内容，interview 产内容不建约定。

## 明确不做（边界，不是待办）

这些是设计边界。想加进来之前，先说清为什么这条边界不再成立。

- **不做 Web UI、数据库、登录、跨仓注册表。** 本包无环境变量、无本地状态目录；SDD 文档就是 markdown，编辑器和 GitHub 渲染得更好。工具跑在仓库里（cwd），不需要 name→path 映射——那种映射注定过期。
- **不做事后口径判定。** 口径只在写之前给要求。
- **不做引用图检查。** 将来若在真实项目上见到确凿的悬空引用再重开；重开时必须支持三段式编号、通配引用、区间引用——天真实现会在合格文档上造出成片假警报（实测 32 条）。
- **不接管 Implementation / Verification。** 那是 coding agent 的主场，用户 `AGENTS.md` 的门禁已经在管。loop 生命周期（open/delivering/done）同理。
- **不替人改状态**、不自动解冲突、不自动归档、不重命名文件。这条说的是**用户的仓库**；`init -g` 写的是宿主配置目录，两回事（见红线 7）。
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
| `node scripts/dead-exports.mjs` | 导出级可达性扫描。判据与盲区见脚本头注；当前基线 `TOTAL: 20 DEAD: 0`。 |

## Architecture

| Layer | Path | Responsibility |
|-------|------|----------------|
| Loop 约定 | `src/loop/` | `front-matter.js`（严格读取器：冲突标记/重复键/未闭合一律判不可读，不返回猜出来的 meta）、`convention.js`（字段名定死、路径默认可覆盖）、`repo-scan.js`（只产出事实；git 不可用返回 null 不谎报 0） |
| 口径 | `src/spec-guide/` | `dictionary.js`（按「文档类型 × 条款类型」组织的纯文字条目，**不携带机判结构**）、`id-scan.js`（编号族扫描：两段式/三段式/通配/区间，只扫只报）、`example.js`（参考写法选取，CLI 与扩展共享） |
| 判定 | `src/validation/loop-check.js` | 状态对账**唯一判定源**：只返回数据，不渲染文案；判据读不出来时拒绝给任何结论 |
| 安装计划 | `src/install/plan.js` | `init -g` 的**唯一判定源**：只算不写，产出「该做什么」。要装哪些 skill 读 `package.json` 的 `pi.skills`，不另抄一份；pi 的 settings 读不出来返回 `null`（不知道），不谎报「没装」。落点加在 `HOST_IDS` + `SKILLS_DIR_HOSTS`，走开放标准的宿主加在 `AGENTS_STANDARD_HOSTS`（每条判据带出处），CLI 帮助与测试都从表推导、不枚举 id |
| CLI | `scripts/sdd-loop.mjs` + `scripts/lib/init.mjs` | `check` / `guide` / `init` 三个子命令；文案与退出码（0/1/2，契约在 `scripts/lib/exit-codes.mjs`）。`init.mjs` 是唯一动手的地方——`--show` 和真跑共用同一个计划对象 |
| pi 扩展 | `extensions/sdd-loop/index.ts` | `sdd_loop_check` / `sdd_spec_guide` 两个工具 + `/sdd`（访谈）与 `/sdd init`（初始化）两条路径。全只读——写文件的是 agent，不是工具。 |
| Skill · init | `skills/sdd-init/` | SKILL.md + `AGENTS.md.template` / `CLAUDE.md.template`。模板不用真名：skill 目录会被软链进 `~/.claude/skills/`，真名会被宿主当成生效的规则文件读走。 |
| Skill · 访谈 | `skills/sdd-interview/SKILL.md` | 访谈大纲 + 落点约定 + 勘察分工（SDD 文档 = 抽取 + 勘察 + 现场沟通；抽不出来要明说，不许编） |
| 首页 | `README.md`（英文，默认）+ `README_zh.md`（简体中文） | **改一份必须改另一份**。`tests/readme.test.js` 对两份跑同一批锁，数字与名字（站数 / 条款类型 / 宿主 / 子命令）一律从真相源推导，只有「用什么写法表达这个数」按语言分 |

## 红线（复审时盯这些）

1. **判定只有一份**：判据进 `loop-check.js`；表面（CLI/扩展）各渲染各的文案，不许自己再判。口径同理：数据在 `dictionary.js`。
2. **假警报比漏报更致命**：任何新判据先问「它在一份合格文档上会不会误报」。实测教训：天真正则在合格文档上造出 32 条假警报（三段式编号被拆尾巴、通配/区间引用被当悬空）。
3. **front-matter 只有一份读取器**（`src/loop/front-matter.js`）；旧 `src/render/spec-file.js` 已退役，那份会静默吞冲突标记的解析器不许复活。
4. **语料文档不是阶段文档**：判阶段只认 `convention.stageDocs` 的文件名，不认所在目录。
5. **不硬编码任何项目的目录约定**：`docs/loops/loop-N/` 是默认值不是前提，覆盖走 convention。
6. **git 查询不可用返回 null**（未知），不谎报 0。
7. **宿主检测信号按宿主选，不许「统一一下」**，尤其**不许按 `~/.agents/` 判**。那是跨宿主共用目录，谁都可能建，按它判等于「有人用过任意一个宿主」就说十个全装了。判据要落在宿主自己的地盘上，还得挑没有第三方共用者的那个：Claude Code / Codex / Copilot / Cursor / Windsurf / OpenCode / Kimi / Droid / Roo 按各自的品牌目录判（目录判还能覆盖只装了桌面端/IDE 扩展、命令没进 PATH 的人）；**Gemini CLI 必须按 PATH 上有没有 `gemini` 判**——`~/.gemini/` 不是它独占的，Antigravity IDE 也写，实测一台没装 Gemini CLI 的机器上 `~/.gemini/GEMINI.md` 和 settings.json 都在，按目录判会误报；Antigravity 反过来按它自己在 `~/.gemini/` 里建的 `antigravity-ide/` 判。`AGENTS_STANDARD_HOSTS` 里每条判据都有出处注释，`tests/init.test.js` 的 `AGENTS_HOST_DIR` 是**测试自己写的**一份期望值（不从被测代码 import），两边各写一份才锁得住「判据被人偷偷改成按共用目录判」。
8. **`init -g` 是安装器，不是仪器**——它是全包唯一会写盘的路径，边界写死在三处：只写**用户主目录下的 agent 落点**（`~/.claude/skills`、`~/.agents/skills`、pi 的 settings），**不碰用户的仓库**（`.cline/skills`、`.kilocode/rules` 那类项目级落点一律不做，所以那几个宿主也就不在支持名单里）；**一个宿主只走一个落点**——实测宿主不去重，同名 skill 同时在品牌目录和共用目录里会被列两遍（两条不同路径），模型看到两个同名 skill，所以走开放标准的十个宿主共用 `~/.agents/skills` 这一份，Claude Code 单走 `~/.claude/skills`（实查它的可执行体：`.claude/skills` 296 次、`.agents/skills` 零次，它不读共用目录）；只新建软链，**绝不删除任何已存在的文件或目录**——包括 0.x 留在 `~/.codex/skills`、`~/.gemini/skills` 里的旧版软链，那些只报不删（`findLegacyLinks`），万一是用户自己重建的。改这一块必须重跑 `tests/init.test.js` 里那几条「不越权」锁，且要验「动手之后内容还在」，不是只验计划里标了 occupied——标了照删是最典型的空绿。

## Testing

测试用 Node 内置 `node:test`。锁的哲学：一半锁「报得出来」，一半锁「不误报」——两者都要有独立命名的锁。新判据/新表面要过变异测试：故意破坏被测的那一条，确认**目标锁**变红（全红只证明可达性），然后还原并用 sha256 校验。

回归基线：拿一个真实的、已按 SDD Loop 运行的仓库跑 `node scripts/sdd-loop.mjs check --repo <dir>`（只读），记下当前输出的不一致条数；任何改动后都不该多出新的一条。假警报比漏报更致命，这条基线就是防它的。

## Configuration

无环境变量，无本地状态目录。所有状态都在被检查的那个仓库的文件里。
