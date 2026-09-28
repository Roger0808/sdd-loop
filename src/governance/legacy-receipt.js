import crypto from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { normalizeDeliveryScope } from "./protocol.js";
import { digest } from "../workflow/definition.js";

function git(root, args, binary = false) {
  try { return execFileSync("git", ["-C", root, ...args], { encoding: binary ? "buffer" : "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
}

function readBlobs(root, ids) {
  const values = [];
  for (let start = 0; start < ids.length; start += 128) {
    const batch = ids.slice(start, start + 128);
    let output;
    try {
      output = execFileSync("git", ["-C", root, "cat-file", "--batch"], {
        input: Buffer.from(`${batch.join("\n")}\n`), maxBuffer: 128 * 1024 * 1024, stdio: ["pipe", "pipe", "ignore"],
      });
    } catch { return null; }
    let offset = 0;
    for (const id of batch) {
      const end = output.indexOf(10, offset);
      if (end < 0) return null;
      const header = output.toString("utf8", offset, end);
      const match = /^([a-f0-9]{40,64}) blob (\d+)$/.exec(header);
      if (!match || match[1] !== id) return null;
      const size = Number(match[2]);
      offset = end + 1;
      if (!Number.isSafeInteger(size) || offset + size >= output.length) return null;
      values.push(output.subarray(offset, offset + size));
      offset += size + 1;
    }
  }
  return values;
}

/** Rebuild the exact old delivery aggregate from the Review commit if the worktree had no uncommitted inputs. */
export function reconstructLegacyReceipt(root, { review, statusRel, archiveDir, stream = null }) {
  const commit = review?.context?.commit;
  if (!commit || !/^[a-f0-9]{40,64}$/i.test(commit)) return { ok: false, reason: "Review 未记录可用的提交 ID" };
  const entries = git(root, ["ls-tree", "-rz", "--full-tree", commit], true);
  if (entries === null) return { ok: false, reason: "Review 提交不可用" };
  let scope;
  try { scope = normalizeDeliveryScope(review.payload?.deliveryScope); }
  catch { return { ok: false, reason: "旧交付范围不可信" }; }
  const loopRoot = stream ? path.dirname(path.dirname(statusRel)) : path.dirname(statusRel);
  const archiveRoot = stream ? path.dirname(archiveDir) : archiveDir;
  const hash = crypto.createHash("sha256");
  const files = [];
  const selected = [];
  for (const raw of entries.toString("utf8").split("\0").filter(Boolean)) {
    const match = /^(100644|100755|120000) blob ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(raw);
    if (!match) continue;
    const [, mode, blobId, rel] = match;
    if (rel === statusRel || [loopRoot, archiveRoot].some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) continue;
    if (stream && scope && !scope.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) continue;
    selected.push({ rel, mode, blobId });
  }
  const blobs = readBlobs(root, selected.map((item) => item.blobId));
  if (!blobs) return { ok: false, reason: "Review 提交的历史 blob 不可批量读取" };
  for (const [{ rel, mode }, content] of selected.map((item, index) => [item, blobs[index]])) {
    const kind = mode === "120000" ? "symlink" : mode === "100755" ? "file:executable" : "file:regular";
    hash.update(`${rel}\0${kind}\0`);
    hash.update(content);
    hash.update("\0");
    files.push({ path: rel, kind, hash: digest(content) });
  }
  const fingerprint = `sha256:${hash.digest("hex")}`;
  if (fingerprint !== review.deliveryFingerprint) return { ok: false, reason: "Review 提交无法重建签署时工作区（可能有未提交文件）", fingerprint };
  return { ok: true, commit, fingerprint, files };
}
