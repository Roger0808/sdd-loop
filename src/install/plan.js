/**
 * 安装计划（`sdd-loop init -g`）的**唯一判定源**。
 *
 * 只算不做：本模块只读盘、只产出「该做什么」，一个字节都不写。真正建软链、
 * 跑 `pi install` 的是 scripts/sdd-loop.mjs。这样 `--show` 和真跑用的是同一份
 * 判定，不会出现「预览说 A、实际做 B」——那是安装器最容易骗人的地方。
 *
 * 两条刻意为之的形状：
 *
 * - **要装哪些 skill 不在这里写死**，读 package.json 的 `pi.skills`。那份清单已经
 *   有锁（包边界要显式），再抄一份就等着两处漂移。
 * - **判据读不出来时返回 null，不谎报 false。** pi 的 settings.json 坏了，答案是
 *   「不知道装没装」，不是「没装」——后者会让安装器去重装一个可能已经在的东西。
 */

import fs from "node:fs";
import path from "node:path";

/**
 * 宿主表。加新宿主（Codex …）就往这里加一项，
 * CLI 与测试都从这张表推导，不枚举 id。
 */
export const HOST_IDS = ["claude", "gemini", "pi"];

const HOST_LABEL = { claude: "Claude Code", gemini: "Gemini CLI", pi: "pi" };

/**
 * 走「软链进宿主的 skills 目录」这条路的宿主。
 *
 * **两个宿主的检测信号刻意不一样，别统一。**
 * Claude Code 按 `~/.claude` 在不在判；Gemini 必须按 `gemini` 二进制在不在
 * PATH 上判，因为 `~/.gemini/` 不是 Gemini CLI 独占的——Antigravity IDE 也用
 * 这个目录（实测：一台没装 Gemini CLI 的机器上 `~/.gemini/GEMINI.md` 和
 * settings.json 都在）。按目录判会在这类机器上误报「装了」，然后凭空建出一个
 * `~/.gemini/skills/`。假警报比漏报更致命，这里宁可漏。
 */
const SKILLS_DIR_HOSTS = {
  claude: {
    configDir: (home) => path.join(home, ".claude"),
    skillsDir: (home) => path.join(home, ".claude", "skills"),
    detect: (home) =>
      fs.existsSync(path.join(home, ".claude"))
        ? null
        : `没有 ${path.join(home, ".claude")}——这台机器上看不到 Claude Code`,
  },
  gemini: {
    skillsDir: (home) => path.join(home, ".gemini", "skills"),
    detect: (home, env) =>
      binOnPath("gemini", env)
        ? null
        : "PATH 上没有 gemini 命令——这台机器上看不到 Gemini CLI（只有 ~/.gemini/ 目录不算，Antigravity 也用它）",
  },
};

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

/** 单个 skill 在 Claude Code 那边的落点状态。 */
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
  const host = { id, label: HOST_LABEL[id], kind: "symlink", dir: skillsDir };

  const reason = spec.detect(home, env);
  if (reason) return { ...host, detected: false, reason, items: [] };

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
 * 算出安装计划。
 *
 * @param {object} options
 * @param {string} options.packageRoot 本包所在目录（软链的源、pi install 的参数）
 * @param {string} options.home        用户主目录
 * @param {string[]} [options.only]    只算这几个宿主，缺省是全部
 * @param {object} [options.env]       环境变量（Gemini 靠 PATH 检测，测试要能控）
 */
export function planInstall({ packageRoot, home, only, env = process.env }) {
  const wanted = only?.length ? HOST_IDS.filter((id) => only.includes(id)) : HOST_IDS;
  const skills = readPackagedSkills(packageRoot);

  if (!skills) {
    return { packageRoot, home, skills: null, hosts: [], unusable: "读不出 package.json 的 pi.skills——不知道该装什么" };
  }
  const missing = skills.filter((s) => !s.exists);
  if (missing.length) {
    return {
      packageRoot,
      home,
      skills,
      hosts: [],
      unusable: `pi.skills 里登记的目录不存在：${missing.map((s) => s.name).join("、")}`,
    };
  }

  const hosts = wanted.map((id) =>
    SKILLS_DIR_HOSTS[id] ? planSkillsDir(id, { home, skills, env }) : planPi({ home, packageRoot }),
  );

  return { packageRoot, home, skills, hosts, unusable: null };
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

/** 一个宿主都没检测到。 */
export function noHostDetected(plan) {
  return plan.hosts.length > 0 && plan.hosts.every((host) => !host.detected);
}

export const ITEM_STATES = Object.freeze({ ITEM_READY, ITEM_ALREADY, ITEM_OCCUPIED });
