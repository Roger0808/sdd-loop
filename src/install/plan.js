/**
 * 安装计划（`sdd-loop init -g`）的**唯一判定源**。
 *
 * 只算不做：本模块只读盘、只产出「该做什么」，一个字节都不写。真正建软链、
 * 跑 `pi install` 的是 scripts/lib/init.mjs。这样 `--show` 和真跑用的是同一份
 * 判定，不会出现「预览说 A、实际做 B」——那是安装器最容易骗人的地方。
 *
 * 三条刻意为之的形状：
 *
 * - **要装哪些 skill 不在这里写死**，读 package.json 的 `pi.skills`。那份清单已经
 *   有锁（包边界要显式），再抄一份就等着两处漂移。
 * - **判据读不出来时返回 null，不谎报 false。** pi 的 settings.json 坏了，答案是
 *   「不知道装没装」，不是「没装」——后者会让安装器去重装一个可能已经在的东西。
 * - **落点按「谁读这个目录」分，不按宿主一个个分。** 见下面 AGENTS_STANDARD_HOSTS。
 */

import fs from "node:fs";
import path from "node:path";

/**
 * 写入目标。注意这是**落点**不是宿主列表：十几个宿主共用 `~/.agents/skills/`，
 * 一个落点服务一批。CLI 与测试都从这张表推导，不枚举 id。
 */
export const HOST_IDS = ["claude", "agents", "pi"];

const HOST_LABEL = {
  claude: "Claude Code",
  agents: "开放标准宿主（共享落点）",
  pi: "pi",
};

const exists = (...seg) => fs.existsSync(path.join(...seg));

/**
 * 读 `~/.agents/skills/` 的宿主。这是 Agent Skills 开放标准收敛出来的**跨宿主共用**
 * 用户级目录：一次软链，下面这些全都发现得到。每一条都有出处，不是照着「应该支持」写的。
 *
 * | 宿主        | 依据                                                              |
 * |-------------|-------------------------------------------------------------------|
 * | Codex       | 实测：`CODEX_HOME=<tmp> HOME=<tmp> codex debug prompt-input`       |
 * | Gemini CLI  | 官方文档：`.gemini/skills` 与 `.agents/skills`，后者优先           |
 * | Copilot     | GitHub 文档：个人 skill 落 `~/.copilot/skills` 或 `~/.agents/skills` |
 * | Cursor      | 官方文档四个落点里含 `~/.agents/skills`（软链见下面的 note）        |
 * | Windsurf    | 官方文档：`~/.codeium/windsurf/skills` + `~/.claude` + `~/.agents` |
 * | OpenCode    | 官方文档：`~/.config/opencode/skills` + `~/.claude` + `~/.agents`  |
 * | Kimi Code   | 二进制里的 `USER_GENERIC_DIRS = [".agents/skills"]`                |
 * | Antigravity | 应用包里出现 `.agents/skills`（本机 Antigravity IDE.app 实查）     |
 * | Droid       | Factory 文档：`~/.agents/skills/` 下逐个 SKILL.md                  |
 * | Roo Code    | 官方文档：`~/.roo/skills/` 与 `~/.agents/skills/`                  |
 *
 * **检测信号按宿主选，一律不按 `~/.agents/` 判。** 那个目录是共用的，谁都可能建；
 * 按它判等于「有人用过任意一个宿主」就说全都装了。判据要落在宿主自己的地盘上，
 * 而且要挑没有第三方共用者的那个——`~/.gemini/` 就不行（Antigravity IDE 也写它，
 * 实测一台没装 Gemini CLI 的机器上 GEMINI.md 和 settings.json 都在），所以
 * Gemini CLI 按 PATH 上的命令判，Antigravity 按它自己在 `~/.gemini/` 里建的
 * `antigravity-ide/` 判。
 *
 * 没放进来的：OpenClaw、Cline、Kilo Code、Hermes、Mistral Vibe。前者本机只剩配置
 * 目录、没有可执行体，验不了「它读不读共用目录」；后几个的 skill/规则落点是
 * **项目级**的，往那儿写就是写进用户的仓库——`init -g` 的边界之外。宁可漏报。
 */
const AGENTS_STANDARD_HOSTS = [
  { id: "codex", label: "Codex", detect: (home) => exists(home, ".codex") },
  { id: "gemini", label: "Gemini CLI", detect: (home, env) => binOnPath("gemini", env) },
  { id: "copilot", label: "GitHub Copilot", detect: (home) => exists(home, ".copilot") },
  {
    id: "cursor",
    label: "Cursor",
    detect: (home) => exists(home, ".cursor"),
    // 官方文档列了 ~/.agents/skills，但社区有多份「Cursor 不跟进软链」的报告，
    // 而本包正是软链装法。照实说，不假装它一定能用。
    note: "有「不跟进软链」的报告，装了可能发现不了",
  },
  { id: "windsurf", label: "Windsurf", detect: (home) => exists(home, ".codeium", "windsurf") },
  {
    id: "opencode",
    label: "OpenCode",
    detect: (home) => exists(home, ".config", "opencode") || exists(home, ".opencode"),
  },
  { id: "kimi", label: "Kimi Code", detect: (home) => exists(home, ".kimi-code") },
  { id: "antigravity", label: "Antigravity", detect: (home) => exists(home, ".gemini", "antigravity-ide") },
  { id: "droid", label: "Factory Droid", detect: (home) => exists(home, ".factory") },
  { id: "roo", label: "Roo Code", detect: (home) => exists(home, ".roo") },
];

/** 供文案与测试引用（CLI 的 --agents 说明就是从这儿生成的），不另抄一份名字。 */
export const AGENTS_HOSTS = AGENTS_STANDARD_HOSTS.map((h) => ({ id: h.id, label: h.label, note: h.note ?? null }));

/**
 * 走「软链进一个 skills 目录」这条路的落点。
 *
 * Claude Code 与共享落点**刻意分开且不重叠**：实查 claude 可执行体里 `.claude/skills`
 * 出现 296 次、`.agents/skills` 零次，它不读共用目录。反过来也要求两边不能都装——
 * 实测 Codex 不去重，同名 skill 同时在品牌目录和共用目录里会被列两遍（两条不同
 * 路径），模型看到两个同名 skill。所以一个宿主只走一个落点。
 */
const SKILLS_DIR_HOSTS = {
  claude: {
    skillsDir: (home) => path.join(home, ".claude", "skills"),
    detect: (home) =>
      exists(home, ".claude")
        ? { detected: true }
        : { detected: false, reason: `没有 ${path.join(home, ".claude")}——这台机器上看不到 Claude Code` },
  },
  agents: {
    skillsDir: (home) => path.join(home, ".agents", "skills"),
    detect: (home, env) => {
      const serves = AGENTS_STANDARD_HOSTS.filter((h) => h.detect(home, env)).map((h) => ({
        id: h.id,
        label: h.label,
        note: h.note ?? null,
      }));
      if (serves.length) return { detected: true, serves };
      return {
        detected: false,
        serves: [],
        reason: `一个读 ${path.join(home, ".agents", "skills")} 的宿主都没看到（${AGENTS_STANDARD_HOSTS.map((h) => h.label).join(" / ")}）`,
      };
    },
  },
};

/**
 * 旧版落点：0.x 的 `init -g` 往这两个品牌目录里软链过。
 * 现在同一批宿主改走共享落点，两边都留着就会**被列两遍**（实测 Codex 不去重）。
 * 这里只找出来报给人，**不删**——删东西不是安装器的活。
 */
const LEGACY_SKILL_DIRS = [
  { label: "Codex", dir: (home) => path.join(home, ".codex", "skills") },
  { label: "Gemini CLI", dir: (home) => path.join(home, ".gemini", "skills") },
];

/** 某个可执行文件在不在 PATH 上。 */
export function binOnPath(name, env = process.env) {
  for (const dir of (env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    try {
      fs.accessSync(path.join(dir, name), fs.constants.X_OK);
      return true;
    } catch {
      /* 下一个 */
    }
  }
  return false;
}

/** 单个 skill 在某个落点的状态。 */
const ITEM_READY = "ready"; // 该建，目标位置空着
const ITEM_ALREADY = "already"; // 已经指向本包，无事可做
const ITEM_OCCUPIED = "occupied"; // 被别的东西占着——不动它，交给人

/** 读 package.json 的 pi.skills，产出 [{ name, source }]。读不出来返回 null。 */
export function readPackagedSkills(packageRoot) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  } catch {
    return null;
  }
  const listed = pkg?.pi?.skills;
  if (!Array.isArray(listed) || listed.length === 0) return null;
  return listed.map((rel) => {
    const source = path.resolve(packageRoot, rel);
    return { name: path.basename(source), source, exists: fs.existsSync(source) };
  });
}

function lstat(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

/** 目标位置是不是一条指向 source 的软链。 */
function linksTo(target, source) {
  try {
    return path.resolve(path.dirname(target), fs.readlinkSync(target)) === source;
  } catch {
    return false;
  }
}

function planSkillsDir(id, { home, skills, env }) {
  const spec = SKILLS_DIR_HOSTS[id];
  const skillsDir = spec.skillsDir(home);
  const verdict = spec.detect(home, env);
  const host = {
    id,
    label: HOST_LABEL[id],
    kind: "symlink",
    dir: skillsDir,
    serves: verdict.serves ?? null,
  };

  if (!verdict.detected) return { ...host, detected: false, reason: verdict.reason, items: [] };

  const items = skills.map((skill) => {
    const target = path.join(skillsDir, skill.name);
    const stat = lstat(target);
    if (!stat) return { ...skill, target, state: ITEM_READY };
    if (stat.isSymbolicLink()) {
      if (linksTo(target, skill.source)) return { ...skill, target, state: ITEM_ALREADY };
      let points = "(读不出来)";
      try {
        points = fs.readlinkSync(target);
      } catch {
        /* 读不出来就照实说 */
      }
      return { ...skill, target, state: ITEM_OCCUPIED, detail: `已有软链指向 ${points}` };
    }
    // 真目录/真文件：可能是用户自己写的同名 skill。绝不删。
    return { ...skill, target, state: ITEM_OCCUPIED, detail: "已存在同名的真实文件/目录（不是软链）" };
  });

  return { ...host, detected: true, items };
}

function planPi({ home, packageRoot }) {
  const settingsDir = path.join(home, ".pi", "agent");
  const settingsPath = path.join(settingsDir, "settings.json");
  const host = {
    id: "pi",
    label: HOST_LABEL.pi,
    kind: "command",
    settingsPath,
    command: ["pi", "install", packageRoot],
  };

  if (!fs.existsSync(path.join(home, ".pi"))) {
    return { ...host, detected: false, reason: `没有 ${path.join(home, ".pi")}——这台机器上看不到 pi`, installed: false };
  }

  // installed 三态：true 已登记 / false 没登记 / null 判据读不出来（不许当成没装）。
  let installed = false;
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      const packages = Array.isArray(settings?.packages) ? settings.packages : [];
      // pi 记的是相对 settings 目录的路径，解析后再比。
      installed = packages.some((entry) => path.resolve(settingsDir, entry) === packageRoot);
    } catch {
      installed = null;
    }
  }

  return { ...host, detected: true, installed };
}

/**
 * 找出旧版留在品牌目录里的软链。**只认指向本包的软链**——用户自己放在那儿的
 * 同名目录、或指向别处的软链一律不报，那些不是我们造的，也轮不到我们评论。
 */
export function findLegacyLinks({ home, skills }) {
  const found = [];
  for (const legacy of LEGACY_SKILL_DIRS) {
    const dir = legacy.dir(home);
    for (const skill of skills) {
      const target = path.join(dir, skill.name);
      const stat = lstat(target);
      if (stat?.isSymbolicLink() && linksTo(target, skill.source)) {
        found.push({ label: legacy.label, name: skill.name, target });
      }
    }
  }
  return found;
}

/**
 * 算出安装计划。
 *
 * @param {object} options
 * @param {string} options.packageRoot 本包所在目录（软链的源、pi install 的参数）
 * @param {string} options.home        用户主目录
 * @param {string[]} [options.only]    只算这几个落点，缺省是全部
 * @param {object} [options.env]       环境变量（Gemini 靠 PATH 检测，测试要能控）
 */
export function planInstall({ packageRoot, home, only, env = process.env }) {
  const wanted = only?.length ? HOST_IDS.filter((id) => only.includes(id)) : HOST_IDS;
  const skills = readPackagedSkills(packageRoot);

  if (!skills) {
    return { packageRoot, home, skills: null, hosts: [], legacy: [], unusable: "读不出 package.json 的 pi.skills——不知道该装什么" };
  }
  const missing = skills.filter((s) => !s.exists);
  if (missing.length) {
    return {
      packageRoot,
      home,
      skills,
      hosts: [],
      legacy: [],
      unusable: `pi.skills 里登记的目录不存在：${missing.map((s) => s.name).join("、")}`,
    };
  }

  const hosts = wanted.map((id) =>
    SKILLS_DIR_HOSTS[id] ? planSkillsDir(id, { home, skills, env }) : planPi({ home, packageRoot }),
  );

  return { packageRoot, home, skills, hosts, legacy: findLegacyLinks({ home, skills }), unusable: null };
}

/** 计划里有没有要动手的活。用于决定「已经装好了」还是「这就装」。 */
export function hasWork(plan) {
  return plan.hosts.some((host) => {
    if (!host.detected) return false;
    if (host.kind === "symlink") return host.items.some((i) => i.state === ITEM_READY);
    return host.installed === false;
  });
}

/** 计划里有没有占位冲突（人得先处理，安装器不越权）。 */
export function hasConflict(plan) {
  return plan.hosts.some(
    (host) => host.detected && host.kind === "symlink" && host.items.some((i) => i.state === ITEM_OCCUPIED),
  );
}

/** 一个落点都没检测到。 */
export function noHostDetected(plan) {
  return plan.hosts.length > 0 && plan.hosts.every((host) => !host.detected);
}

export const ITEM_STATES = Object.freeze({ ITEM_READY, ITEM_ALREADY, ITEM_OCCUPIED });
