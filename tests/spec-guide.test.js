/**
 * 口径字典与编号扫描的锁。
 *
 * 与 loop-check.test.js 同一条原则：一半锁「报得出来」，一半锁「不误报」。
 * 这里的误报形态是编号扫描把三段式拆出假族（DEL-DIR-001 拆出 DIR）——
 * 设计阶段正是这类天真匹配在合格文档上造出 32 条假警报，所以
 * 「三段式不被拆成尾巴」是独立锁，不许靠顺带保证。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { SPEC_GUIDE, guideFor, listGuideTypes } from "../src/spec-guide/dictionary.js";
import { scanIdText, scanIdFamilies } from "../src/spec-guide/id-scan.js";
import { DEFAULT_CONVENTION } from "../src/loop/convention.js";

const CLI = path.resolve(import.meta.dirname, "../scripts/sdd-loop.mjs");

function makeDocsRepo(build) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-guide-"));
  if (build) build(root);
  return root;
}

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function runCli(args) {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { encoding: "utf8" });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

function familyOf(result, prefix) {
  return result.families.find((f) => f.prefix === prefix) ?? null;
}

// ---------------------------------------------------------------- 字典

test("字典：每个条目的落点文档都是约定里的阶段文档（条目与 SDD 阶段门禁一一对应）", () => {
  for (const [key, entry] of Object.entries(SPEC_GUIDE)) {
    assert.ok(
      DEFAULT_CONVENTION.stageDocs.includes(entry.doc),
      `${key} 的 doc=${entry.doc} 不在 stageDocs 里——字典键必须挂到 SDD 阶段文档上`,
    );
    assert.equal(key, `${entry.doc}.${entry.clause}`, `${key} 的键必须等于 <doc>.<clause>`);
  }
});

test("字典：四份撰写期文档每份至少一个条目", () => {
  const docs = new Set(Object.values(SPEC_GUIDE).map((e) => e.doc));
  for (const doc of ["requirements", "architecture", "specification", "tasks"]) {
    assert.ok(docs.has(doc), `${doc} 没有任何口径条目`);
  }
});

test("字典：每个条目都有 summary 与 lines，且只说「写之前的要求」", () => {
  for (const [key, entry] of Object.entries(SPEC_GUIDE)) {
    assert.ok(entry.title, `${key} 缺 title`);
    assert.ok(entry.summary, `${key} 缺 summary`);
    assert.ok(Array.isArray(entry.lines) && entry.lines.length > 0, `${key} 缺 lines`);
    for (const line of entry.lines) {
      assert.equal(typeof line, "string");
      assert.ok(line.length > 0);
    }
  }
});

test("字典：旧表格口径真的迁过来了，不是只留了名字", () => {
  const entity = guideFor("specification.entity-table");
  const entityText = `${entity.summary}\n${entity.lines.join("\n")}`;
  assert.ok(entityText.includes("控件类型"), "fields 表的控件类型要求丢了");
  assert.ok(entityText.includes("取值说明"), "fields 表的取值说明要求丢了");
  assert.ok(entityText.includes("页面归属"), "fields 表的页面归属五列要求丢了");

  const page = guideFor("specification.page-behavior");
  const pageText = `${page.summary}\n${page.lines.join("\n")}`;
  assert.ok(pageText.includes("双向包含"), "pageBehaviors 的跨表匹配判据丢了");
  assert.ok(pageText.includes("默认排序"), "pageBehaviors 的列表页必填项丢了");

  const state = guideFor("specification.state-machine");
  assert.ok(`${state.summary}\n${state.lines.join("\n")}`.includes("守卫"), "状态机的守卫要求丢了");

  const approval = guideFor("specification.approval-flow");
  assert.ok(`${approval.summary}\n${approval.lines.join("\n")}`.includes("节点顺序"), "审批流的必填项丢了");

  const integration = guideFor("architecture.integration");
  assert.ok(`${integration.summary}\n${integration.lines.join("\n")}`.includes("方向"), "integrations 的方向要求丢了");
});

test("字典：未知类型返回 null，不猜", () => {
  assert.equal(guideFor("specification.nope"), null);
  assert.equal(guideFor(""), null);
  assert.equal(guideFor(undefined), null);
});

test("字典：listGuideTypes 与 SPEC_GUIDE 键一致且有序", () => {
  assert.deepEqual(listGuideTypes(), Object.keys(SPEC_GUIDE).sort());
});

// ---------------------------------------------------------------- 编号扫描（纯文本）

test("编号：两段式与三段式都认得", () => {
  const result = scanIdText("见 BND-001 与 DEL-DIR-001。");
  assert.equal(familyOf(result, "BND")?.form, "two-part");
  assert.equal(familyOf(result, "DEL-DIR")?.form, "three-part");
});

test("编号：三段式不被拆成尾巴——DEL-DIR-001 不产生 DIR 族，也不产生 DEL 族", () => {
  const result = scanIdText("DEL-DIR-001");
  assert.equal(result.families.length, 1, "一个三段式编号只能算一个族");
  assert.equal(result.families[0].prefix, "DEL-DIR");
  assert.deepEqual(result.families[0].ids, ["DEL-DIR-001"]);
});

test("编号：通配引用记进族（KEEP-*），不假装它是具体编号", () => {
  const result = scanIdText("引用：KEEP-*、STOP-*");
  assert.equal(familyOf(result, "KEEP")?.wildcardRefs, 1);
  assert.equal(familyOf(result, "STOP")?.wildcardRefs, 1);
  assert.deepEqual(familyOf(result, "KEEP")?.ids ?? ["x"], [], "通配不该产出具体编号");
});

test("编号：区间引用两端都计数", () => {
  const result = scanIdText("DEL-DIR-002 至 DEL-DIR-005");
  const family = familyOf(result, "DEL-DIR");
  assert.deepEqual(family.ids, ["DEL-DIR-002", "DEL-DIR-005"]);
});

test("编号：标题里的编号标记 inHeading（### BND-002 … 是定义处）", () => {
  const result = scanIdText("正文引用 BND-002。\n\n### BND-002 Maker 完整保护边界\n");
  const family = familyOf(result, "BND");
  const heading = family.occurrences.find((o) => o.inHeading);
  assert.ok(heading, "标题出现必须标出来——它是「参考写法」的候选");
  assert.ok(heading.text.includes("Maker"));
  const body = family.occurrences.find((o) => !o.inHeading);
  assert.ok(body, "正文出现也要在，只是不作定义处");
});

test("编号：不像编号的不报（小写、段长越界、数字位数越界）", () => {
  const result = scanIdText("abc-001 A-001 ABCDEFG-001 BND-1 BND-00001 x9-some-branch");
  assert.deepEqual(result.families, []);
});

test("编号：同族多个编号去重排序，出现次数照实统计", () => {
  const result = scanIdText("BND-002 BND-001 BND-002 BND-10");
  const family = familyOf(result, "BND");
  assert.deepEqual(family.ids, ["BND-001", "BND-002", "BND-10"]);
  assert.equal(family.refs, 4, "四次出现（去重前）要照实报");
});

// ---------------------------------------------------------------- 编号扫描（文件系统）

test("扫描：只读 .md、递归子目录、文件计数照实", () => {
  const root = makeDocsRepo((r) => {
    write(r, "docs/a.md", "BND-001");
    write(r, "docs/nested/b.md", "DEL-DIR-001");
    write(r, "docs/notes.txt", "KEEP-001"); // 不是 .md，不许扫
    write(r, "docs/.hidden/c.md", "STOP-001"); // 点目录，不扫
  });
  const result = scanIdFamilies(root);
  assert.equal(result.filesScanned, 2);
  assert.ok(familyOf(result, "BND"));
  assert.ok(familyOf(result, "DEL-DIR"));
  assert.equal(familyOf(result, "KEEP"), null, "非 .md 文件里的编号不算");
  assert.equal(familyOf(result, "STOP"), null, "点目录里的编号不算");
});

test("扫描：docs 目录不存在时不报错，families 为空（新项目正是最需要 guide 的时候）", () => {
  const result = scanIdFamilies(makeDocsRepo());
  assert.equal(result.filesScanned, 0);
  assert.deepEqual(result.families, []);
});

test("扫描：出现位置带文件与行号，且相对仓库根", () => {
  const root = makeDocsRepo((r) => {
    write(r, "docs/loops/loop-1/specification.md", "x\n### BND-001 边界\n");
  });
  const result = scanIdFamilies(root);
  const occurrence = familyOf(result, "BND").occurrences[0];
  assert.equal(occurrence.file, path.join("docs", "loops", "loop-1", "specification.md"));
  assert.equal(occurrence.line, 2);
  assert.equal(occurrence.inHeading, true);
});

// ---------------------------------------------------------------- CLI

test("guide：已知类型输出口径与编号族，退出 0", () => {
  const root = makeDocsRepo((r) => {
    write(r, "docs/loops/loop-1/specification.md", "### BND-001 边界\n### DEL-DIR-001 目录\n引用 KEEP-*\n");
  });
  const { code, stdout } = runCli(["guide", "--type", "specification.behavior", "--repo", root]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("适用边界"), "行为条款的口径没出来");
  assert.ok(stdout.includes("BND-*"), "两段式族没出来");
  assert.ok(stdout.includes("DEL-DIR-*"), "三段式族没出来");
  assert.ok(stdout.includes("沿用"), "「沿用同族前缀」的建议没出来");
});

test("guide：参考写法优先取「落点文档同名文件里、标题中的出现」", () => {
  const root = makeDocsRepo((r) => {
    write(r, "docs/aaa-notes.md", "正文提到 BND-002。\n### BND-002 别的文档标题\n");
    write(r, "docs/specification.md", "正文。\n### BND-001 落点文档标题\n");
  });
  const { code, stdout } = runCli(["guide", "--type", "specification.behavior", "--repo", root]);
  assert.equal(code, 0);
  const ref = stdout.split("\n").find((line) => line.includes("参考写法"));
  assert.ok(ref, "有编号族时必须给参考写法");
  assert.ok(ref.includes("specification.md"), "参考写法应优先取落点文档同名文件");
  assert.ok(ref.includes("BND-001 落点文档标题"), "同一族里优先取标题中的出现");
});

test("guide：仓库还没有编号族时直说，并给出起步写法", () => {
  const root = makeDocsRepo((r) => write(r, "docs/readme.md", "没有编号。\n"));
  const { code, stdout } = runCli(["guide", "--type", "requirements.goal", "--repo", root]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("还没有编号族") || stdout.includes("无命中"), "没扫到族要直说");
});

test("guide：未知类型退出 2，并列出可用类型", () => {
  const { code, stderr } = runCli(["guide", "--type", "specification.nope"]);
  assert.equal(code, 2);
  assert.ok(stderr.includes("specification.behavior"), "要把可用类型列给人看");
});

test("guide：不带 --type 列出全部类型，退出 0", () => {
  const { code, stdout } = runCli(["guide"]);
  assert.equal(code, 0);
  for (const type of listGuideTypes()) {
    assert.ok(stdout.includes(type), `类型清单缺 ${type}`);
  }
});
