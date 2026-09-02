/**
 * sdd-loop pi 扩展：SDD Loop 的两件仪器接进 pi——状态对账 + 口径字典。
 *
 * 分工（与 CLI 表面 scripts/sdd-loop.mjs 同一套约束）：
 * - 判定只有一份：sdd_loop_check 的结论全部来自 src/validation/loop-check.js，
 *   本文件一条判据都不写；sdd_spec_guide 的口径全部来自 src/spec-guide/dictionary.js，
 *   编号族全部来自 src/spec-guide/id-scan.js，参考写法选取与 CLI 共享 example.js。
 * - 两个工具都是只读的：不替人改状态、不解冲突、不归档（边界见设计 §7）。
 * - front-matter 只走 src/loop/front-matter.js（经 loop-check 间接使用）——
 *   src/render/spec-file.js 那份会静默吞掉冲突标记，不许用。
 *
 * 命令：
 *   /sdd       加载 sdd-interview 访谈 skill（产**内容**：四份阶段文档）
 *   /sdd init  加载 sdd-init skill（建**约定**：AGENTS.md / CLAUDE.md / status.md，每仓一次）
 */

import { Type } from "@earendil-works/pi-ai";
import {
	truncateHead,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
// @ts-expect-error src 是纯 ESM JS，无类型声明
import { buildLoopCheckReport } from "../../src/validation/loop-check.js";
// @ts-expect-error
import { guideFor, listGuideTypes } from "../../src/spec-guide/dictionary.js";
// @ts-expect-error
import { scanIdFamilies } from "../../src/spec-guide/id-scan.js";
// @ts-expect-error
import { pickExample } from "../../src/spec-guide/example.js";

function truncate(text: string): string {
	const r = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
	if (!r.truncated) return r.content;
	// 截断必须可见：agent 拿到半句话却不知道内容不完整，会拿残缺依据下判断。
	return `${r.content}\n\n⚠️ 以上输出已被截断（原 ${r.totalBytes} 字节 / ${r.totalLines} 行）。看到的内容不完整，据此下判断前请缩小范围重新取。`;
}

const STATUS_MARK: Record<string, string> = { true: "✅", false: "❌" };

/** check 报告的扩展侧渲染。文案这里出，结论一个字都不新造。 */
function renderCheck(report: any): string {
	const lines: string[] = [];
	if (!report.readable) {
		// 两种成因分叉。曾经这里无条件说「被污染…先请人解决文件本身」，
		// 于是一个空仓库的用户被要求去「解决」一个根本不存在的文件，访谈就此卡死。
		const coldStart = report.reason === "missing-status";
		lines.push(
			coldStart
				? "结论：这个仓库还没有 SDD Loop 结构，没有状态可对账。"
				: "结论：判据读不出来，不给状态结论。",
			"",
		);
		for (const problem of report.problems) {
			const where = problem.line ? `${problem.file}:${problem.line}` : problem.file;
			lines.push(`- ✖ ${where}：${problem.detail}`);
		}
		lines.push(
			"",
			coldStart
				? `处理：这是冷启动，不是故障——正常起点。先问用户是要在本仓库开始 SDD Loop，还是状态文件在别处（在别处就用 statusFile 参数指过去）。确认要开始后加载 sdd-init skill 走初始化：由你落地 AGENTS.md（门禁规则）、CLAUDE.md 与 ${report.statusPath}，然后重跑本工具。本工具只读，不替人建文件。`
				: "处理：front-matter 是门禁判据，被污染（冲突标记/重复键/未闭合）时一切结论都建立在猜上。先请人解决文件本身。",
		);
		return lines.join("\n");
	}

	lines.push(report.ok ? "结论：干净——状态声明与文件事实一致。" : `结论：有 ${report.problems.length} 处声明与事实不符。`, "");
	for (const entry of report.checks) {
		if (entry.id === "C4") continue;
		lines.push(`${entry.id} ${STATUS_MARK[String(entry.ok)]} ${entry.title}`);
		for (const finding of entry.findings) lines.push(`  - ${finding.detail}`);
	}

	const next = report.nextStep;
	if (next?.kind === "start-new") {
		lines.push("", `下一步：${next.loop ? `Loop ${next.loop} / ${next.phase || "requirements"}` : "由用户明确新目标后开启"}`);
	} else if (next?.kind === "continue") {
		lines.push("", `下一步：继续 Loop ${next.loop}（${next.dir}）`);
		if (next.blockedAt) lines.push(`当前门禁：${next.blockedAt}`);
	}

	if (report.advisories.length) {
		lines.push("", "提醒（不影响结论）：");
		for (const item of report.advisories) lines.push(`- ⓘ ${item.detail}`);
	}
	if (!report.ok) {
		lines.push("", "规则要求：状态文件、活跃目录与阶段文档矛盾时，应停止相关工作并请求用户确认。矛盾由人解决，本工具不改任何文件。");
	}
	return lines.join("\n");
}

const FORM_LABEL: Record<string, string> = { "two-part": "两段式", "three-part": "三段式", "wildcard-only": "仅通配引用" };

function renderGuide(type: string, entry: any, idScan: any, example: any): string {
	const lines: string[] = [];
	lines.push(`${type} ｜ ${entry.title} ｜ 落点 ${entry.doc}.md`, "", entry.summary);
	for (const line of entry.lines) lines.push(`- ${line}`);
	lines.push("");
	if (!idScan.families.length) {
		lines.push(`本仓库还没有编号族（扫描 ${idScan.docsDir}/ 无命中）。第一条编号自定前缀：两段式 BND-001 或三段式 DEL-DIR-001；定下之后沿用，不要另起体系。`);
		return lines.join("\n");
	}
	lines.push(`本仓库现有编号族（扫描 ${idScan.docsDir}/ 得到）：`);
	for (const form of ["two-part", "three-part", "wildcard-only"]) {
		const group = idScan.families.filter((f: any) => f.form === form);
		if (group.length) lines.push(`- ${FORM_LABEL[form]}：${group.map((f: any) => `${f.prefix}-*`).join(" ")}`);
	}
	lines.push("新增条款沿用同族前缀，不要另起体系。");
	if (example) lines.push("", `参考写法：${example.file}:${example.line}  ${example.text}`);
	return lines.join("\n");
}

function renderGuideList(): string {
	const lines: string[] = ["可用类型（type 取其一）："];
	for (const type of listGuideTypes()) {
		const entry = guideFor(type);
		lines.push(`- ${type} —— ${entry.title}`);
	}
	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "sdd_loop_check",
		label: "SDD Loop 状态对账",
		description:
			"把状态文件的「声明」和文件里的「事实」摆在一起比：状态文件读不读得出来（front-matter 冲突/重复键/未闭合）、activeLoop 是否悬空指针、已关闭 Loop 的阶段文档是否全部 archived、当前卡在哪道门禁、下一步该做什么。每轮 Loop 开局跑一次。只读，不改任何文件；发现矛盾时停下来请人确认，不替人改状态。",
		promptSnippet: "SDD Loop 开局读状态：声明与事实是否一致",
		promptGuidelines: [
			"每轮 Loop 开始时先跑 sdd_loop_check 再动手。",
			"结论是「判据读不出来」（文件在但被污染）时，不许猜状态，先把文件问题摆给人。",
			"结论是「还没有 SDD Loop 结构」时不要报错更不要停工——那是冷启动的正常起点：问过用户后加载 sdd-init skill 建结构（AGENTS.md 门禁规则 / CLAUDE.md / 状态文件），再重跑检查。",
		],
		parameters: Type.Object({
			repo: Type.Optional(Type.String({ description: "仓库根，默认当前工作目录" })),
			statusFile: Type.Optional(Type.String({ description: "状态文件相对仓库根的路径，默认 docs/loops/status.md" })),
			archiveDir: Type.Optional(Type.String({ description: "归档根目录，默认 docs/archive" })),
		}),
		async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
			const repo = params.repo || ctx?.cwd || process.cwd();
			const overrides: Record<string, string> = {};
			if (params.statusFile) overrides.statusFile = params.statusFile;
			if (params.archiveDir) overrides.archiveDir = params.archiveDir;
			const report = buildLoopCheckReport(repo, overrides);
			return {
				content: [{ type: "text", text: truncate(renderCheck(report)) }],
				details: { report },
			};
		},
	});

	pi.registerTool({
		name: "sdd_spec_guide",
		label: "SDD 口径字典",
		description:
			"写之前给要求：「我要写这一类条款，该写哪几项」——传 type（如 specification.behavior、architecture.adr、tasks.task），返回该类条款的口径、本仓库现有编号族（新增条款沿用同族前缀）和一条参考写法。不带 type 返回全部可用类型。只在写之前给要求，不做事后判定。",
		promptSnippet: "写某类 SDD 条款之前查口径与编号族",
		promptGuidelines: [
			"写任何 SDD 条款之前先用 sdd_spec_guide 查该类口径与本仓编号族；编号沿用现有族，不另起体系。",
		],
		parameters: Type.Object({
			type: Type.Optional(Type.String({ description: "条款类型，形如 <文档>.<条款>，例 specification.behavior；不带则列出全部类型" })),
			repo: Type.Optional(Type.String({ description: "仓库根，默认当前工作目录" })),
			docsDir: Type.Optional(Type.String({ description: "编号族扫描目录，默认 docs" })),
		}),
		async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
			if (!params.type) {
				return { content: [{ type: "text", text: renderGuideList() }], details: { types: listGuideTypes() } };
			}
			const entry = guideFor(params.type);
			if (!entry) {
				throw new Error(`未知类型 "${params.type}"。\n${renderGuideList()}`);
			}
			const repo = params.repo || ctx?.cwd || process.cwd();
			const idScan = scanIdFamilies(repo, params.docsDir ? { docsDir: params.docsDir } : {});
			const example = pickExample(entry, idScan.families);
			return {
				content: [{ type: "text", text: truncate(renderGuide(params.type, entry, idScan, example)) }],
				details: { entry, idScan, example },
			};
		},
	});

	// 两条路径产出的东西性质不同，所以是两个 skill、两句人话，不是一个命令兼职：
	//   init  建**约定**（AGENTS.md 门禁规则 + CLAUDE.md 转引 + status.md），每个仓库一次
	//   访谈  产**内容**（四份阶段文档），每个产品/每轮 Loop 一次
	// AGENTS.md 是承重墙：loop-check.js 执行的就是它写的那条「矛盾时停下请人确认」。
	// 它不存在时 check 是在判一个仓库从没声明过的约定——所以冷启动必须先过 init。
	const INIT_MESSAGE =
		"请加载 sdd-init skill，按它的步骤把当前仓库初始化成按 SDD Loop 运行：" +
		"先用 sdd_loop_check 确认这确实是冷启动（报「判据读不出来」就停下请我解决，不要初始化），" +
		"再做仓库概览，然后逐字落地 AGENTS.md 与 CLAUDE.md 模板、建状态文件与首个 Loop 目录，最后重跑 sdd_loop_check 验证。" +
		"这一步只建结构，不要写任何业务内容。";

	const INTERVIEW_MESSAGE =
		"请加载 sdd-interview skill，按它的访谈大纲带我从一句话需求走到四份 SDD 文档。" +
		"开始之前先用 sdd_loop_check 读一下当前仓库的 Loop 状态——如果它报「还没有 SDD Loop 结构」，" +
		"先告诉我去跑 /sdd init 建结构，不要自己开始访谈。写任何条款之前用 sdd_spec_guide 查口径与编号族。";

	pi.registerCommand("sdd", {
		description: "SDD 访谈：加载 sdd-interview skill，从一句话需求到四份 SDD 文档（`/sdd init` 先初始化仓库结构）",
		handler: async (args: any, _ctx: any) => {
			const sub = String(args ?? "").trim().split(/\s+/)[0];
			pi.sendUserMessage(sub === "init" ? INIT_MESSAGE : INTERVIEW_MESSAGE);
		},
	});
}
