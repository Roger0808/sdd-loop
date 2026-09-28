import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { digest } from "./definition.js";

function git(root, args, { binary = false } = {}) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: binary ? "buffer" : "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function lines0(buffer) {
  return buffer === null ? null : buffer.toString("utf8").split("\0").filter(Boolean);
}

export function safeRelative(file) {
  if (typeof file !== "string" || !file || file.includes("\\") || path.posix.isAbsolute(file) || file.split("/").some((part) => !part || part === "." || part === "..") || file === ".git" || file.startsWith(".git/")) throw new Error(`不安全的仓库相对路径：${file}`);
  return file;
}

export function gitIdentity(root) {
  const name = git(root, ["config", "user.name"])?.trim();
  const email = git(root, ["config", "user.email"])?.trim().toLowerCase();
  if (!name || !email) throw new Error("缺少 Git user.name 或 user.email。");
  return { name, email };
}

export function gitHead(root) {
  const head = git(root, ["rev-parse", "HEAD"])?.trim();
  if (!head) throw new Error("Git HEAD 不可用。");
  return head;
}

export function changedFiles(root, base, { exclude = [] } = {}) {
  const tracked = lines0(git(root, ["diff", "--name-only", "-z", base, "--"], { binary: true }));
  const untracked = lines0(git(root, ["ls-files", "--others", "--exclude-standard", "-z"], { binary: true }));
  if (!tracked || !untracked) throw new Error("Git 变更文件清单不可用。");
  return [...new Set([...tracked, ...untracked])].filter((file) => {
    safeRelative(file);
    return !exclude.some((prefix) => file === prefix || file.startsWith(`${prefix}/`));
  }).sort();
}

export function fileReceipt(root, rel) {
  safeRelative(rel);
  const abs = path.join(root, rel);
  let stat;
  try { stat = fs.lstatSync(abs); } catch { return { path: rel, kind: "deleted", hash: null }; }
  if (stat.isSymbolicLink()) return { path: rel, kind: "symlink", hash: digest(fs.readlinkSync(abs)) };
  if (!stat.isFile()) throw new Error(`交付路径不是普通文件或软链：${rel}`);
  return { path: rel, kind: stat.mode & 0o111 ? "executable" : "regular", hash: digest(fs.readFileSync(abs)) };
}

export function captureSource(root, files) {
  if (!Array.isArray(files) || !files.length) throw new Error("交付文件清单为空。");
  const sorted = [...new Set(files.map(safeRelative))].sort();
  const receipts = sorted.map((file) => fileReceipt(root, file));
  return { files: receipts, fingerprint: digest(JSON.stringify(receipts)) };
}

export function compareSource(root, receipt) {
  const current = captureSource(root, receipt.files.map((item) => item.path));
  const before = new Map(receipt.files.map((item) => [item.path, item]));
  const drift = current.files.filter((item) => JSON.stringify(item) !== JSON.stringify(before.get(item.path)));
  return { ok: drift.length === 0, drift, current };
}

export function commitRange(root, base, head) {
  for (const rev of [base, head]) if (!rev || rev.startsWith("-") || !git(root, ["rev-parse", "--verify", `${rev}^{commit}`])) throw new Error(`提交不可用：${rev}`);
  const data = git(root, ["diff", "--name-status", "-z", "--no-renames", base, head, "--"], { binary: true });
  if (data === null) throw new Error("Git 提交区间不可用。");
  const parts = lines0(data);
  const changed = [];
  for (let i = 0; i < parts.length; i += 2) {
    const status = parts[i];
    const file = safeRelative(parts[i + 1]);
    if (!status || !file) throw new Error("Git name-status 输出不完整。");
    changed.push({ path: file, status });
  }
  return changed;
}

export function receiptAtCommit(root, rev, rel) {
  safeRelative(rel);
  const tree = git(root, ["ls-tree", "-z", rev, "--", rel], { binary: true });
  if (tree === null) return null;
  if (!tree.length) return { path: rel, kind: "deleted", hash: null };
  const header = tree.toString("utf8", 0, tree.indexOf(0));
  const match = /^(100644|100755|120000) blob ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(header);
  if (!match || match[3] !== rel) return null;
  const data = git(root, ["show", `${rev}:${rel}`], { binary: true });
  if (data === null) return null;
  return { path: rel, kind: match[1] === "120000" ? "symlink" : match[1] === "100755" ? "executable" : "regular", hash: digest(data) };
}

export function contentFingerprint(receipts) {
  const hash = crypto.createHash("sha256");
  for (const item of receipts) hash.update(`${item.path}\0${item.kind}\0${item.hash}\0`);
  return `sha256:${hash.digest("hex")}`;
}
