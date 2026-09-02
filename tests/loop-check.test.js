/**
 * 状态对账的判定锁。
 *
 * 这批锁一半在锁「报得出来」，另一半在锁「不误报」——后者同等重要甚至更重要：
 * 一份完全合格的文档上甩出假警报，几次之后整个检查就没人看了。设计阶段实测过
 * 一次天真实现在真实语料上产生 32 条假警报，所以「语料文档不参与判定」「另一轮
 * 全 archived 不报」这两条必须有独立的锁，不能靠「顺带没报」来保证。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { buildLoopCheckReport } from "../src/validation/loop-check.js";
import { readFrontMatter } from "../src/loop/front-matter.js";

function git(dir, args) {
  execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
}

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function doc(status, extra = "") {
  return `---\ndocument: stage\nstatus: ${status}\n${extra}---\n\n# 内容\n`;
}

function statusFile({ activeLoop = "null", lastClosedLoop = "0", nextLoop = "1", nextPhase = "requirements" } = {}) {
  return `---\nproject: t\ndocument: loop-status\nactiveLoop: ${activeLoop}\nlastClosedLoop: ${lastClosedLoop}\nnextLoop: ${nextLoop}\nnextPhase: ${nextPhase}\n---\n\n# Loop 状态\n`;
}

/**
 * 基线仓库：activeLoop 为 null、loop-0 两轮全部归档、外加 7 份归档的来源文档（用户带来的原始 PRD 之类）。
 * 形状照抄一个真实仓库的结构——反例只有在基线干净时才证明得了东西。
 */
function makeRepo(build) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-loop-"));
  write(root, "docs/loops/status.md", statusFile());
  for (const stage of ["requirements", "architecture", "specification", "tasks", "implementation"]) {
    write(root, `docs/archive/loop-0-cleanup-2026-08-31/${stage}.md`, doc("archived"));
  }
  for (const name of ["00-intro", "01-business", "02-skeleton", "03-scenarios", "04-fields", "05-cases", "06-pages"]) {
    write(root, `docs/archive/loop-0-prd-source/${name}.md`, doc("confirmed"));
  }
  if (build) build(root);
  git(root, ["init", "-q"]);
  git(root, ["add", "-A"]);
  git(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  return root;
}

// ---------------------------------------------------------------- 基线

test("基线：干净仓库判成干净（否则后面每一条反例都证明不了任何事）", () => {
  const report = buildLoopCheckReport(makeRepo());
  assert.equal(report.readable, true);
  assert.deepEqual(report.problems, [], "基线不该有任何问题");
  assert.equal(report.ok, true);
});

test("不误报之一：归档的来源文档是 confirmed，不该被「关闭的 Loop 必须 archived」判死", () => {
  const report = buildLoopCheckReport(makeRepo());
  const hit = report.problems.filter((p) => String(p.file || "").includes("prd-source"));
  assert.deepEqual(hit, [], "语料文档不是阶段文档，一旦参与判定就是 7 条假警报");
});

test("不误报之二：全部 archived 的那一轮不报", () => {
  const report = buildLoopCheckReport(makeRepo());
  const hit = report.problems.filter((p) => String(p.file || "").includes("loop-0-cleanup"));
  assert.deepEqual(hit, []);
});

test("不误报之三：lastClosedLoop: 0 不该吃掉 loop-01 的归档", () => {
  const root = makeRepo((r) => {
    write(r, "docs/archive/loop-01-other/specification.md", doc("draft"));
  });
  const report = buildLoopCheckReport(root);
  const hit = report.problems.filter((p) => String(p.file || "").includes("loop-01-other"));
  assert.deepEqual(hit, [], "前缀匹配必须区分 loop-0 与 loop-01");
});

// ---------------------------------------------------------------- C1

test("C1：front-matter 里的冲突标记 ⟹ 判据不可读，且不下任何结论", () => {
  const root = makeRepo((r) => {
    write(
      r,
      "docs/loops/status.md",
      "---\nproject: t\n<<<<<<< HEAD\nactiveLoop: 1\n=======\nactiveLoop: null\n>>>>>>> other\n---\n\n# x\n",
    );
  });
  const report = buildLoopCheckReport(root);
  assert.equal(report.readable, false, "冲突标记必须让判据判为不可读");
  assert.equal(report.severity, "unusable");
  assert.equal(report.nextStep, null, "读不出来时不许给下一步——那会建立在猜出来的元数据上");
  assert.equal(report.checks.length, 1, "读不出来时不该继续跑后面的判据");
  const kinds = report.problems.map((p) => p.kind);
  assert.ok(kinds.includes("conflict-marker"));
  assert.equal(kinds.filter((k) => k === "conflict-marker").length, 3, "三处标记要全报，只报第一处会让人以为改一行就好");
});

// 「不可读」有两种成因，严重度相同但该触发的行为相反：污染要停下请人解决，
// 不存在是冷启动的正常起点。不区分的代价实测过——表面把「先请人解决文件本身」
// 甩给了一个空仓库的用户，访谈当场卡死。区分属于判定，不许留给表面各自猜。
test("C1：状态文件不存在 ⟹ reason 是 missing-status（冷启动），不是 unreadable", () => {
  const root = makeRepo(() => {});
  fs.rmSync(path.join(root, "docs"), { recursive: true, force: true });
  const report = buildLoopCheckReport(root);
  assert.equal(report.readable, false, "没有状态文件就没有判据，仍然不给结论");
  assert.equal(report.reason, "missing-status", "冷启动必须能和「文件被污染」分开，否则表面只能猜");
  assert.equal(report.problems[0].kind, "missing-status", "finding 上也要带 kind，供逐条渲染的表面用");
});

test("C1：文件在但被污染 ⟹ reason 是 unreadable（与冷启动分开）", () => {
  const root = makeRepo((r) => {
    write(r, "docs/loops/status.md", "---\n<<<<<<< HEAD\nactiveLoop: 1\n=======\nactiveLoop: 2\n>>>>>>> o\n---\n\n# x\n");
  });
  const report = buildLoopCheckReport(root);
  assert.equal(report.readable, false);
  assert.equal(report.reason, "unreadable", "文件存在却读不出来，不能被当成冷启动放过去");
});

test("C1：阶段文档的 front-matter 被污染，同样算判据不可读", () => {
  const root = makeRepo((r) => {
    write(r, "docs/archive/loop-0-cleanup-2026-08-31/tasks.md", "---\nstatus: archived\n<<<<<<< HEAD\nx: 1\n---\n\n# x\n");
  });
  const report = buildLoopCheckReport(root);
  assert.equal(report.readable, false, "阶段文档的 front-matter 就是门禁判据，污染了就是读不出来");
});

test("C1：状态文件缺 activeLoop ⟹ 不可读", () => {
  const root = makeRepo((r) => {
    write(r, "docs/loops/status.md", "---\nproject: t\nlastClosedLoop: 0\n---\n\n# x\n");
  });
  const report = buildLoopCheckReport(root);
  assert.equal(report.readable, false);
});

test("C1：状态文件不存在 ⟹ 不可读（而不是当成「没有活跃 Loop」）", () => {
  const root = makeRepo();
  fs.rmSync(path.join(root, "docs/loops/status.md"));
  const report = buildLoopCheckReport(root);
  assert.equal(report.readable, false);
});

// ---------------------------------------------------------------- C2

test("C2：activeLoop 指的目录不存在 ⟹ 悬空指针", () => {
  const root = makeRepo((r) => {
    write(r, "docs/loops/status.md", statusFile({ activeLoop: "1" }));
  });
  const report = buildLoopCheckReport(root);
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((p) => p.detail.includes("悬空指针")));
});

test("C2：目录在但没有被跟踪的文件 ⟹ 悬空指针（这是真实发生过的那一种）", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-loop-"));
  write(root, "docs/loops/status.md", statusFile({ activeLoop: "1" }));
  write(root, "docs/loops/loop-1/.keep", "");
  git(root, ["init", "-q"]);
  git(root, ["add", "docs/loops/status.md"]);
  git(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"]);
  const report = buildLoopCheckReport(root);
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((p) => p.dir === path.join("docs/loops", "loop-1")));
});

test("C2 反方向：声明没有活跃 Loop，但盘上有被跟踪的 loop 目录", () => {
  const root = makeRepo((r) => {
    write(r, "docs/loops/loop-2/requirements.md", doc("draft"));
  });
  const report = buildLoopCheckReport(root);
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((p) => p.detail.includes("声明没有活跃 Loop")));
});

// ---------------------------------------------------------------- C3

test("C3：已关闭 Loop 里有文档没归档 ⟹ 不干净，且逐条点名", () => {
  const root = makeRepo((r) => {
    write(r, "docs/archive/loop-0-migration/requirements.md", doc("confirmed"));
    write(r, "docs/archive/loop-0-migration/specification.md", doc("draft"));
  });
  const report = buildLoopCheckReport(root);
  assert.equal(report.ok, false);
  assert.equal(report.problems.length, 2, "两份未归档就报两条，不多不少");
  assert.ok(report.problems.every((p) => p.expected === "archived"));
});

test("C3：状态不在白名单里时要额外说出来", () => {
  const root = makeRepo((r) => {
    write(r, "docs/archive/loop-0-migration/tasks.md", doc("done"));
  });
  const report = buildLoopCheckReport(root);
  assert.ok(report.problems.some((p) => p.detail.includes("不在允许的状态里")));
});

// ---------------------------------------------------------------- C4 / C5

test("C4：没有活跃 Loop 时给出下一步，取自状态文件的 nextLoop / nextPhase", () => {
  const report = buildLoopCheckReport(makeRepo());
  assert.deepEqual(report.nextStep, { kind: "start-new", loop: "1", phase: "requirements" });
});

test("C4：有活跃 Loop 时报出卡在哪一阶段", () => {
  const root = makeRepo((r) => {
    write(r, "docs/loops/status.md", statusFile({ activeLoop: "1" }));
    write(r, "docs/loops/loop-1/requirements.md", doc("confirmed"));
    write(r, "docs/loops/loop-1/architecture.md", doc("draft"));
  });
  const report = buildLoopCheckReport(root);
  assert.equal(report.nextStep.kind, "continue");
  assert.equal(report.nextStep.blockedAt, "architecture");
});

test("C5 是提醒级：未提交的改动不影响结论，也不进 problems", () => {
  const root = makeRepo();
  write(root, "docs/loops/scratch.md", "本地草稿");
  const report = buildLoopCheckReport(root);
  assert.equal(report.ok, true, "C5 只报事实——做成错误级会在每轮开局甩一堆无关本地历史");
  assert.ok(report.advisories.length >= 1);
  assert.deepEqual(report.problems, []);
});

// ---------------------------------------------------------------- 约定可覆盖

test("约定可覆盖：换了目录名不用改代码（默认值是便利，不是前提）", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-loop-"));
  write(root, "spec/state.md", statusFile());
  write(root, "spec/old/loop-0-x/requirements.md", doc("draft"));
  git(root, ["init", "-q"]);
  git(root, ["add", "-A"]);
  git(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"]);

  const wrong = buildLoopCheckReport(root);
  assert.equal(wrong.readable, false, "按默认路径找不到状态文件");

  const right = buildLoopCheckReport(root, { statusFile: "spec/state.md", archiveDir: "spec/old" });
  assert.equal(right.readable, true);
  assert.equal(right.ok, false, "覆盖后应当照样抓到未归档的文档");
});

// ---------------------------------------------------------------- front-matter 读取器

test("front-matter：引号是包装不是内容", () => {
  const { ok, meta } = readFrontMatter('---\nstatus: "archived"\n---\n');
  assert.equal(ok, true);
  assert.equal(meta.status, "archived");
});

test("front-matter：重复键不许靠运气决定谁生效", () => {
  const { ok, issues } = readFrontMatter("---\nstatus: draft\nstatus: archived\n---\n");
  assert.equal(ok, false);
  assert.equal(issues[0].kind, "duplicate-key");
});

test("front-matter：没有结束的 --- 不算解析成功", () => {
  const { ok, issues } = readFrontMatter("---\nstatus: draft\n\n# 正文\n");
  assert.equal(ok, false);
  assert.equal(issues.at(-1).kind, "unterminated");
});
