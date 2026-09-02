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
- **不替人改状态**、不自动解冲突、不自动归档、不重命名文件。
- **不硬编码任何项目的目录约定**，不引入 HTML 注释锚点（稳定编号就是锚点）。

## Development Commands

| Command | Purpose |
|---------|---------|
| `npm test` | 全部测试（Node 内置 runner）。 |
| `node --test --test-timeout=30000 --test-force-exit tests/<file>.test.js` | 单文件。**两个 flag 都不能省**：Node 默认测试超时无限，挂起的 handler 会让 run 挂死而不是变红；`--test-force-exit` 才是真正结束 run 的那个。 |
| `node scripts/sdd-loop.mjs check --repo <dir>` | 状态对账 CLI。 |
| `node scripts/sdd-loop.mjs guide --type <doc.clause> [--repo <dir>]` | 口径字典 CLI。 |
| `node scripts/dead-exports.mjs` | 导出级可达性扫描（判据二，见 `docs/reachability.md`）。 |

## Architecture

| Layer | Path | Responsibility |
|-------|------|----------------|
| Loop 约定 | `src/loop/` | `front-matter.js`（严格读取器：冲突标记/重复键/未闭合一律判不可读，不返回猜出来的 meta）、`convention.js`（字段名定死、路径默认可覆盖）、`repo-scan.js`（只产出事实；git 不可用返回 null 不谎报 0） |
| 口径 | `src/spec-guide/` | `dictionary.js`（按「文档类型 × 条款类型」组织的纯文字条目，**不携带机判结构**）、`id-scan.js`（编号族扫描：两段式/三段式/通配/区间，只扫只报）、`example.js`（参考写法选取，CLI 与扩展共享） |
| 判定 | `src/validation/loop-check.js` | 状态对账**唯一判定源**：只返回数据，不渲染文案；判据读不出来时拒绝给任何结论 |
| CLI | `scripts/sdd-loop.mjs` | `check` / `guide` 两个子命令；文案与退出码（0/1/2，契约在 `scripts/lib/exit-codes.mjs`） |
| pi 扩展 | `extensions/sdd-loop/index.ts` | `sdd_loop_check` / `sdd_spec_guide` 两个工具 + `/sdd`（访谈）与 `/sdd init`（初始化）两条路径。全只读——写文件的是 agent，不是工具。 |
| Skill · init | `skills/sdd-init/` | SKILL.md + `AGENTS.md.template` / `CLAUDE.md.template`。模板不用真名：skill 目录会被软链进 `~/.claude/skills/`，真名会被宿主当成生效的规则文件读走。 |
| Skill · 访谈 | `skills/sdd-interview/SKILL.md` | 访谈大纲 + 落点约定 + 勘察分工（SDD 文档 = 抽取 + 勘察 + 现场沟通；抽不出来要明说，不许编） |

## 红线（复审时盯这些）

1. **判定只有一份**：判据进 `loop-check.js`；表面（CLI/扩展）各渲染各的文案，不许自己再判。口径同理：数据在 `dictionary.js`。
2. **假警报比漏报更致命**：任何新判据先问「它在一份合格文档上会不会误报」。实测教训：天真正则在合格文档上造出 32 条假警报（三段式编号被拆尾巴、通配/区间引用被当悬空）。
3. **front-matter 只有一份读取器**（`src/loop/front-matter.js`）；旧 `src/render/spec-file.js` 已退役，那份会静默吞冲突标记的解析器不许复活。
4. **语料文档不是阶段文档**：判阶段只认 `convention.stageDocs` 的文件名，不认所在目录。
5. **不硬编码任何项目的目录约定**：`docs/loops/loop-N/` 是默认值不是前提，覆盖走 convention。
6. **git 查询不可用返回 null**（未知），不谎报 0。

## Testing

测试用 Node 内置 `node:test`。锁的哲学：一半锁「报得出来」，一半锁「不误报」——两者都要有独立命名的锁。新判据/新表面要过变异测试：故意破坏被测的那一条，确认**目标锁**变红（全红只证明可达性），然后还原并用 sha256 校验。

回归基线：拿一个真实的、已按 SDD Loop 运行的仓库跑 `node scripts/sdd-loop.mjs check --repo <dir>`（只读），记下当前输出的不一致条数；任何改动后都不该多出新的一条。假警报比漏报更致命，这条基线就是防它的。

## Configuration

无环境变量，无本地状态目录。所有状态都在被检查的那个仓库的文件里。
