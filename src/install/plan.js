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
 * 宿主表。加新宿主（Codex / Gemini …）就往这里加一项，
 * CLI 与测试都从这张表推导，不枚举 id。
 */
export const HOST_IDS = ["claude", "pi"];

const HOST_LABEL = { claude: "Claude Code", pi: "pi" };

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

function planClaude({ home, skills }) {
  const configDir = path.join(home, ".claude");
  const skillsDir = path.join(configDir, "skills");
  const host = { id: "claude", label: HOST_LABEL.claude, kind: "symlink", dir: skillsDir };

  if (!fs.existsSync(configDir)) {
    return { ...host, detected: false, reason: `没有 ${configDir}——这台机器上看不到 Claude Code`, items: [] };
  }

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
 */
export function planInstall({ packageRoot, home, only }) {
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
    id === "claude" ? planClaude({ home, skills }) : planPi({ home, packageRoot }),
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
