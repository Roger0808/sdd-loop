/**
 * 编号族扫描（sdd-loop 能力二的一半）：从仓库的 SDD 文档里扫出已有编号族，
 * 供「新增条款沿用同族前缀」参考。**只扫、只报，不判对错**——
 * 这里没有「悬空引用」「孤儿条款」任何概念，那两个概念在真实语料上的实测结局是
 * 32 条假警报、0 条真问题（设计 §4.2）。
 *
 * 形态要求（来自真实语料，一条都不能少）：
 * - 两段式 BND-001 与三段式 DEL-DIR-001 都要认；
 * - 三段式不许被拆出尾巴假族（DEL-DIR-001 不产生 DIR 族）——天真正则就是死在这；
 * - 通配引用（KEEP-*、MIX-*）与区间引用（DEL-DIR-002 至 DEL-DIR-005）是正常写法。
 */

import fs from "node:fs";
import path from "node:path";

/** 具体编号。段长与数字位数来自真实语料的最宽形状（TC-01 两位，MIX-OTHER-001 两段前缀）。 */
const CONCRETE_ID = /\b[A-Z]{2,6}(?:-[A-Z]{2,8})?-[0-9]{2,4}\b/g;

/** 通配引用：KEEP-* / DEL-DIR-* / MIX-*（一段通配指三段式整族的情况真实存在）。 */
const WILDCARD_REF = /\b[A-Z]{2,6}(?:-[A-Z]{2,8})?-\*/g;

/** 编号直接跟在标题标记后面才算「标题定义」：### BND-002 … 。 */
const HEADING_PREFIX = /^\s{0,3}#{1,6}\s*$/;

/** 每族最多保留的出现条数。超出只留计数——扫描是给人参考的，不是全文索引。 */
const MAX_OCCURRENCES_PER_FAMILY = 50;

function emptyFamily(prefix) {
  return { prefix, form: null, ids: [], refs: 0, wildcardRefs: 0, occurrences: [], truncated: 0 };
}

/** 族键 = 编号去掉数字尾巴（BND-001 → BND，DEL-DIR-001 → DEL-DIR）。 */
function familyPrefix(id) {
  return id.replace(/-[0-9]{2,4}$/, "");
}

function addOccurrence(family, occurrence) {
  if (family.occurrences.length < MAX_OCCURRENCES_PER_FAMILY) {
    family.occurrences.push(occurrence);
  } else {
    family.truncated += 1;
  }
}

/**
 * 扫一段文本里的编号族。纯函数，文件系统壳是 scanIdFamilies。
 * @param {string} text
 * @param {{ file?: string | null }} where 出现位置上的文件名（行内调用方填）
 * @returns {{ families: Array }}
 */
export function scanIdText(text, { file = null } = {}) {
  const byPrefix = new Map();
  const lines = String(text ?? "").split(/\r?\n/);

  const familyFor = (prefix) => {
    let family = byPrefix.get(prefix);
    if (!family) {
      family = emptyFamily(prefix);
      byPrefix.set(prefix, family);
    }
    return family;
  };

  lines.forEach((line, index) => {
    for (const match of line.matchAll(CONCRETE_ID)) {
      const id = match[0];
      const prefix = familyPrefix(id);
      const family = familyFor(prefix);
      family.refs += 1;
      if (!family.ids.includes(id)) family.ids.push(id);
      addOccurrence(family, {
        file,
        line: index + 1,
        text: line.trim(),
        inHeading: HEADING_PREFIX.test(line.slice(0, match.index)),
      });
    }
    for (const match of line.matchAll(WILDCARD_REF)) {
      const prefix = match[0].slice(0, -2); // 去掉 "-*"
      const family = familyFor(prefix);
      family.wildcardRefs += 1;
    }
  });

  const families = [...byPrefix.values()].map((family) => {
    family.ids.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    // 族形态只看具体编号；只有通配引用的族老实说「只知道通配」。
    family.form = family.ids.length
      ? (family.prefix.includes("-") ? "three-part" : "two-part")
      : "wildcard-only";
    return family;
  });
  families.sort((a, b) => a.prefix.localeCompare(b.prefix));
  return { families };
}

/** 递归收集 dir 下的 .md 文件（跳过点目录），返回相对 root 的路径，有序。 */
function collectMarkdown(root, dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMarkdown(root, abs, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(path.relative(root, abs));
    }
  }
}

/**
 * 扫仓库的编号族。默认只扫 docs/（可覆盖）——SDD 文档住在哪就扫哪，
 * 全仓库扫会把 vendor / 生成物里的假族带进来。
 *
 * @param {string} repoRoot
 * @param {{ docsDir?: string }} options
 * @returns {{ docsDir: string, filesScanned: number, families: Array }}
 *   docs 目录不存在时 filesScanned=0、families=[]——新项目没有编号族是事实，不是错误。
 */
export function scanIdFamilies(repoRoot, { docsDir = "docs" } = {}) {
  const root = path.resolve(repoRoot);
  const docsAbs = path.join(root, docsDir);
  const empty = { docsDir, filesScanned: 0, families: [] };
  if (!fs.existsSync(docsAbs)) return empty;

  const files = [];
  collectMarkdown(root, docsAbs, files);
  files.sort();

  const merged = new Map();
  for (const rel of files) {
    const { families } = scanIdText(fs.readFileSync(path.join(root, rel), "utf8"), { file: rel });
    for (const incoming of families) {
      let family = merged.get(incoming.prefix);
      if (!family) {
        family = emptyFamily(incoming.prefix);
        merged.set(incoming.prefix, family);
      }
      family.refs += incoming.refs;
      family.wildcardRefs += incoming.wildcardRefs;
      family.truncated += incoming.truncated;
      for (const id of incoming.ids) if (!family.ids.includes(id)) family.ids.push(id);
      for (const occurrence of incoming.occurrences) addOccurrence(family, occurrence);
    }
  }

  const families = [...merged.values()].map((family) => {
    family.ids.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    family.form = family.ids.length
      ? (family.prefix.includes("-") ? "three-part" : "two-part")
      : "wildcard-only";
    return family;
  });
  families.sort((a, b) => a.prefix.localeCompare(b.prefix));
  return { docsDir, filesScanned: files.length, families };
}
