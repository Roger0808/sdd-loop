import path from "node:path";

import { nextHotfixIdentity, hotfixRoots } from "../../src/hotfix/layout.js";
import { conventionForStream, resolveConvention } from "../../src/loop/convention.js";
import { discoverStreams } from "../../src/loop/repo-scan.js";
import { EXIT_OK, EXIT_UNUSABLE } from "./exit-codes.mjs";

/** Skills 使用的只读编号入口：同一套 convention 同时派生活跃与归档路径。 */
export function runHotfix(args, io) {
  if (args._[1] !== "next") {
    io.stderr("内部用法：sdd-loop _hotfix next [--repo <dir>] [--stream <name>] [--date <YYYY-MM-DD>] [--status-file <path>] [--archive-dir <path>]\n");
    io.exit(EXIT_UNUSABLE);
    return;
  }
  try {
    const root = path.resolve(args.repo || process.cwd());
    const overrides = {};
    if (args["status-file"]) overrides.statusFile = args["status-file"];
    if (args["archive-dir"]) overrides.archiveDir = args["archive-dir"];
    const found = discoverStreams(root, overrides);
    if (found.mode === "streams" && !args.stream) throw new Error(`这是分流仓库，请用 --stream 指明一条流：${found.streams.join(" / ")}`);
    if (args.stream && !found.streams.includes(args.stream)) throw new Error(`没有名为 ${args.stream} 的流。`);
    if (found.mode === "single" && args.stream) throw new Error("这是单流仓库，不能使用 --stream。");
    const convention = args.stream ? conventionForStream(args.stream, overrides) : resolveConvention(overrides);
    const identity = nextHotfixIdentity(root, convention, args.date ? String(args.date) : new Date());
    const roots = hotfixRoots(convention);
    io.stdout(`${JSON.stringify({ ...identity, stream: args.stream || null, activeDir: roots.active, archiveDir: roots.archive }, null, 2)}\n`);
    io.exit(EXIT_OK);
  } catch (error) {
    io.stderr(`无法分配 Hotfix 编号：${error.message}\n`);
    io.exit(EXIT_UNUSABLE);
  }
}
