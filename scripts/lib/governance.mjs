import path from "node:path";

import { recordGovernanceEvent } from "../../src/governance/protocol.js";
import { EXIT_OK, EXIT_UNUSABLE } from "./exit-codes.mjs";

/**
 * Skills 使用的内部写入口。用户仍只需要记 init/interview/upgrade/review；
 * 原始输入从临时 JSON 文件读取，避免出现在 shell history 和进程参数中。
 */
export function runGovernance(args, io) {
  if (args._[1] !== "record" || !args["event-json"]) {
    io.stderr("内部用法：sdd-loop _governance record --event-json <tmp-file> [--repo <dir>] [--stream <name>] [--status-file <path>] [--archive-dir <path>]\n");
    io.exit(EXIT_UNUSABLE);
    return;
  }
  try {
    const overrides = {};
    if (args["status-file"]) overrides.statusFile = args["status-file"];
    if (args["archive-dir"]) overrides.archiveDir = args["archive-dir"];
    const result = recordGovernanceEvent({
      repoRoot: path.resolve(args.repo || process.cwd()),
      stream: args.stream || null,
      eventFile: args["event-json"],
      overrides,
    });
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    io.exit(EXIT_OK);
  } catch (error) {
    io.stderr(`治理事件未记录：${error.message}\n`);
    io.exit(EXIT_UNUSABLE);
  }
}
