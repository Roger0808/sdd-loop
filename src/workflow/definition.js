import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

export const ROUTES = Object.freeze(["loop", "hotfix", "debug"]);
export const LOOP_DOCS = Object.freeze(["requirements", "architecture", "specification", "tasks", "implementation", "verification"]);
const STAGES = new Set([...LOOP_DOCS, "deployment", "manual_test", "final_test", "reconciliation", "review", "signoff", "close"]);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function safeName(value, label) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(String(value ?? ""))) throw new Error(`${label} 不合法：${value}`);
  return String(value);
}

export function parseWorkflow(text, expectedRoute) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error("workflow.md 缺少 YAML front-matter。");
  const document = YAML.parseDocument(match[1], { uniqueKeys: true, strict: true });
  if (document.errors.length) throw new Error(`workflow.md YAML 不可信：${document.errors[0].message}`);
  const config = document.toJS();
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("workflow.md 配置必须是对象。");
  const allowed = new Set(["schema", "route", "review", "signoff", "signerRole", "stages"]);
  for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error(`workflow.md 有未知配置字段：${key}`);
  if (config.schema !== "sdd-workflow/v1") throw new Error(`不支持 workflow schema：${config.schema}`);
  if (!ROUTES.includes(config.route) || config.route !== expectedRoute) throw new Error(`workflow route 必须是 ${expectedRoute}。`);
  if (!["required", "waived"].includes(config.review)) throw new Error("review 必须是 required 或 waived。");
  if (!["submitter", "role", "optional", "none"].includes(config.signoff)) throw new Error("signoff 必须是 submitter、role、optional 或 none。");
  if (config.signoff === "role" && !safeName(config.signerRole, "signerRole")) throw new Error("缺少 signerRole。");
  if (config.signoff !== "role" && config.signerRole !== undefined) throw new Error("只有 role 签署可设置 signerRole。");
  if (!Array.isArray(config.stages) || !config.stages.length) throw new Error("stages 必须是非空数组。");
  const ids = new Set();
  for (const stage of config.stages) {
    if (!stage || typeof stage !== "object" || Array.isArray(stage) || Object.keys(stage).some((key) => !["id", "needs"].includes(key))) throw new Error("stage 只能包含 id 和 needs。");
    if (!STAGES.has(stage.id) || ids.has(stage.id)) throw new Error(`stage 重复或未知：${stage.id}`);
    if (!Array.isArray(stage.needs) || stage.needs.some((need) => typeof need !== "string")) throw new Error(`${stage.id}.needs 必须是阶段数组。`);
    ids.add(stage.id);
  }
  const mandatory = config.route === "loop" ? [...LOOP_DOCS, "final_test", "reconciliation", "review", "signoff", "close"] : ["implementation", "final_test", "reconciliation", "review", "signoff", "close"];
  for (const id of mandatory) if (!ids.has(id)) throw new Error(`${config.route} 缺少必需阶段：${id}`);
  const predecessors = new Map(config.stages.map((stage) => [stage.id, stage.needs]));
  for (const stage of config.stages) {
    for (const need of stage.needs) if (!ids.has(need) || need === stage.id) throw new Error(`${stage.id} 有不存在或自引用的依赖：${need}`);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new Error("workflow stages 存在依赖环。");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const need of predecessors.get(id)) visit(need);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
  const ancestor = (id, target) => predecessors.get(id).some((need) => need === target || ancestor(need, target));
  const core = config.route === "loop" ? ["requirements", "architecture", "specification", "tasks", "implementation"] : ["implementation"];
  for (let i = 1; i < core.length; i++) if (!ancestor(core[i], core[i - 1])) throw new Error(`${core[i]} 必须依赖 ${core[i - 1]}。`);
  for (const id of ids) {
    if (id !== "implementation" && !core.includes(id) && !ancestor(id, "implementation")) throw new Error(`${id} 必须位于 implementation 后。`);
    if (id !== "close" && !ancestor("close", id)) throw new Error(`close 必须依赖 ${id}。`);
  }
  if (!ancestor("review", "final_test") || !ancestor("review", "reconciliation")) throw new Error("review 必须位于最终测试和架构对账之后。");
  for (const id of ids) {
    if (!["review", "signoff", "close"].includes(id) && !ancestor("review", id)) throw new Error(`review 必须位于 ${id} 之后。`);
  }
  if (!ancestor("signoff", "review") || !ancestor("close", "signoff")) throw new Error("签署和关闭顺序不合法。");
  if (ids.has("manual_test") && (!ids.has("deployment") || !ancestor("manual_test", "deployment"))) throw new Error("人工测试必须依赖部署。");
  return config;
}

export function loadWorkflow(repoRoot, route, { stream = null, workflowDir = "docs/sdd/workflows" } = {}) {
  if (!ROUTES.includes(route)) throw new Error(`未知流程：${route}`);
  if (stream) safeName(stream, "stream");
  const root = path.resolve(repoRoot);
  const relative = [
    ...(stream ? [path.join(workflowDir, stream, route, "workflow.md")] : []),
    path.join(workflowDir, route, "workflow.md"),
  ];
  const selected = relative.find((file) => fs.existsSync(path.join(root, file)));
  const source = selected ?? path.join(PACKAGE_ROOT, "workflows", route, "workflow.md");
  const content = fs.readFileSync(selected ? path.join(root, source) : source, "utf8");
  return { source: selected ?? `builtin:${route}`, hash: digest(content), text: content, definition: parseWorkflow(content, route) };
}

export function recommendWorkflow(input) {
  const value = String(input ?? "").toLowerCase();
  if (/\bdebug\b|调试|手测|复测|反复.*(?:测试|修复)|测试环境.*(?:bug|问题)/i.test(value)) return { route: "debug", reason: "任务描述包含人工测试或连续调试。", requiresConfirmation: true };
  if (/\bhotfix\b|紧急修复|线上故障|生产故障|快速修复|不走完整.*loop/i.test(value)) return { route: "hotfix", reason: "任务描述包含紧急或独立修复。", requiresConfirmation: true };
  return { route: "loop", reason: "默认按标准需求到交付流程处理。", requiresConfirmation: true };
}
