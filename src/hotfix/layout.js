import fs from "node:fs";
import path from "node:path";

import { readFrontMatter } from "../loop/front-matter.js";

const FILE_RE = /^hotfix-(\d{8})-(\d{2})\.md$/;
const ID_RE = /^HF-(\d{8})-(\d{2})$/;

function list(root, rel, location) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return { dir: rel, location, files: [], issue: null };
  let stat;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    return { dir: rel, location, files: [], issue: { kind: "unreadable-hotfix-dir", file: rel } };
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return { dir: rel, location, files: [], issue: { kind: "unsafe-hotfix-dir", file: rel } };
  }
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.name.startsWith("hotfix-") && entry.name.endsWith(".md"))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => {
        const relFile = path.join(rel, entry.name);
        if (!entry.isFile() || entry.isSymbolicLink()) {
          return { name: entry.name, path: relFile, location, ok: false, meta: {}, body: "", issues: [{ kind: "unsafe-hotfix-file", file: relFile }] };
        }
        try {
          const text = fs.readFileSync(path.join(root, relFile), "utf8");
          const parsed = readFrontMatter(text);
          return {
            name: entry.name,
            path: relFile,
            location,
            ok: parsed.ok,
            meta: parsed.meta,
            body: text.split(/\r?\n/).slice(parsed.bodyStart).join("\n"),
            issues: parsed.issues,
          };
        } catch {
          return { name: entry.name, path: relFile, location, ok: false, meta: {}, body: "", issues: [{ kind: "unreadable-hotfix-file", file: relFile }] };
        }
      });
    return { dir: rel, location, files, issue: null };
  } catch {
    return { dir: rel, location, files: [], issue: { kind: "unreadable-hotfix-dir", file: rel } };
  }
}

export function hotfixRoots(convention) {
  return {
    active: path.join(path.dirname(convention.statusFile), convention.hotfixDirName),
    archive: path.join(convention.archiveDir, convention.hotfixDirName),
  };
}

export function scanHotfixes(repoRoot, convention) {
  const root = path.resolve(repoRoot);
  const roots = hotfixRoots(convention);
  const active = list(root, roots.active, "active");
  const archive = list(root, roots.archive, "archive");
  return {
    roots,
    directories: [active, archive],
    files: [...active.files, ...archive.files],
    issues: [active.issue, archive.issue].filter(Boolean),
  };
}

export function normalizeHotfixId(value) {
  const text = String(value ?? "").trim();
  const idMatch = text.match(ID_RE);
  if (idMatch) return { id: text, stem: `hotfix-${idMatch[1]}-${idMatch[2]}` };
  const fileMatch = `${text.replace(/\.md$/, "")}.md`.match(FILE_RE);
  if (fileMatch) return { id: `HF-${fileMatch[1]}-${fileMatch[2]}`, stem: `hotfix-${fileMatch[1]}-${fileMatch[2]}` };
  return null;
}

export function nextHotfixIdentity(repoRoot, convention, date = new Date()) {
  const day = date instanceof Date
    ? `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`
    : String(date).replaceAll("-", "");
  const scan = scanHotfixes(repoRoot, convention);
  const used = scan.files.flatMap((file) => {
    const match = file.name.match(FILE_RE);
    return match?.[1] === day ? [Number(match[2])] : [];
  });
  const sequence = Math.max(0, ...used) + 1;
  const suffix = String(sequence).padStart(2, "0");
  return { hotfixId: `HF-${day}-${suffix}`, fileName: `hotfix-${day}-${suffix}.md`, sequence };
}

export function hotfixAuditDir(file) {
  const stem = file.name.replace(/\.md$/, "");
  return path.join(path.dirname(file.path), "audit", stem);
}

export { FILE_RE as HOTFIX_FILE_PATTERN, ID_RE as HOTFIX_ID_PATTERN };
