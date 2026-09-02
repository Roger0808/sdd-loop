# AGENTS.md

> 这是**本仓库维护者**的 agent 说明，不是 sdd-loop 分发给用户的那份门禁模板。
> 模板在 [`skills/sdd-init/AGENTS.md.template`](skills/sdd-init/AGENTS.md.template)——改门禁规则请改那份，它有测试锁着。

**架构、命令、分层、CLI 契约等一切以 [CLAUDE.md](CLAUDE.md) 为准。** 本文件只写 CLAUDE.md 里没有的验收约定，不复制架构事实——两处并存必然漂移。

## 验收约定

**本包没有界面，也没有服务端。** 不要去起 localhost、不要找健康检查接口、不要开浏览器截图。验收只有两条路，两条都在终端里：

- `npm test`（Node 内置 runner，两个 flag 都不能省——见 CLAUDE.md）。
- 真实仓库回归基线：`node scripts/sdd-loop.mjs check --repo <某个采用 SDD Loop 约定的仓库>`，看退出码与不一致条数。**注意退出码要单独取**：接了 `tail`/`head` 之后 `$?` 拿到的是管道末端那个命令的码，不是 CLI 的（这坑踩过）。

## 不要提交进来的东西

- **本机 agent / 工具配置**（`.claude/`、`.rtk/`、`.agents/`）。`.claude/settings.json` 是权限白名单，跟着公开仓库分发等于让每个 clone 的人继承免确认权限。
- **第三方 skill 的软链。** 本机装的 skill 会往 `skills/` 里软链，曾有 8 条指向 `.agents/` 的死链被提交进来。`.gitignore` 现在只放行本包自己的两个 skill。
- **由工具自动注入本文件的内容。** 有些 CLI 会往 AGENTS.md 追加自己的用法速查（曾占掉本文件 85%）。那属于维护者的机器，不属于这个包——发现了就删掉。
