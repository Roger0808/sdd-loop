import fs from "node:fs";
import path from "node:path";

import { loadWorkflow, recommendWorkflow, ROUTES } from "../../src/workflow/definition.js";
import { closeWorkflow, recordWorkflowEvent, startWorkflow } from "../../src/workflow/runtime.js";
import { checkProvenance } from "../../src/workflow/provenance.js";
import { EXIT_CONTENT, EXIT_OK, EXIT_UNUSABLE } from "./exit-codes.mjs";

function jsonFile(file) {
  if (!file) throw new Error("缺少 JSON 输入文件。");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function runWorkflow(args, io) {
  const root = path.resolve(args.repo || process.cwd());
  const action = args._[1];
  try {
    if (action === "recommend") {
      const request = fs.readFileSync(args["request-file"], "utf8");
      const result = recommendWorkflow(request);
      io.stdout(`${JSON.stringify({ ...result, workflow: loadWorkflow(root, result.route, { stream: args.stream }) }, null, 2)}\n`);
    } else if (action === "show") {
      if (!ROUTES.includes(args.route)) throw new Error("--route 必须是 loop、hotfix 或 debug。");
      io.stdout(`${JSON.stringify(loadWorkflow(root, args.route, { stream: args.stream }), null, 2)}\n`);
    } else if (action === "start") {
      const overrides = {};
      if (args["status-file"]) overrides.statusFile = args["status-file"];
      if (args["archive-dir"]) overrides.archiveDir = args["archive-dir"];
      const result = startWorkflow({ repoRoot: root, stream: args.stream, route: args.route, id: args.id, confirmation: jsonFile(args["confirmation-json"]), overrides });
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    } else if (action === "record") {
      if (!args.run) throw new Error("缺少 --run 工作目录。");
      const result = recordWorkflowEvent({ repoRoot: root, runDir: args.run, payload: jsonFile(args["event-json"]) });
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    } else if (action === "close") {
      if (!args.run) throw new Error("缺少 --run 工作目录。");
      const payload = jsonFile(args["event-json"]);
      const result = closeWorkflow({ repoRoot: root, runDir: args.run, summary: payload.summary, evidence: payload.evidence });
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    } else throw new Error("用法：workflow recommend|show|start|record|close；事件从 JSON 文件读取。");
    io.exit(EXIT_OK);
  } catch (error) { io.stderr(`工作流操作失败：${error.message}\n`); io.exit(EXIT_UNUSABLE); }
}

export function runProvenance(args, io) {
  try {
    if (args._[1] !== "check" || !args.base || !args.head) throw new Error("用法：provenance check --base <commit> --head <commit> [--repo <dir>]");
    const overrides = {};
    if (args["status-file"]) overrides.statusFile = args["status-file"];
    if (args["archive-dir"]) overrides.archiveDir = args["archive-dir"];
    const result = checkProvenance(path.resolve(args.repo || process.cwd()), { base: args.base, head: args.head, overrides });
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    io.exit(result.ok ? EXIT_OK : EXIT_CONTENT);
  } catch (error) { io.stderr(`溯源检查失败：${error.message}\n`); io.exit(EXIT_UNUSABLE); }
}
