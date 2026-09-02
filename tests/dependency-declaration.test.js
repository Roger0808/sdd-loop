import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 依赖声明锁——判据式，不枚举包名。
// 判据：生产代码（src/ scripts/ extensions/）里的**裸模块 import**
// （不是相对路径、不是 node: 内建）必须能在 package.json 的
// dependencies ∪ peerDependencies 里找到声明。
// peerDependencies 即「由宿主安装机制提供」的显式登记——pi 的
// `pi install` 用 `npm install --omit=dev`，npm ≥7 会自动装 peerDeps。
//
// 为什么需要它：extension 曾以值形式 import 两个 @earendil-works 包，
// 而 package.json 只在 peerDependencies 里登着——能不能装上全靠实测撞。
// 有了这条锁，下次谁新加一个 npm 依赖忘了声明，锁当场报。
//
// 反向（声明了但没人 import）刻意不锁：dependencies 已清空，
// peerDependencies 的包由宿主侧使用方式决定，反向锁会误伤。

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|ts)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** 静态 import/export from、副作用 import、动态 import() 三种形态的模块说明符。 */
const SPECIFIER = /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g;

/** 裸说明符 → 包名（@scope/pkg/sub → @scope/pkg；pkg/sub → pkg）。 */
function packageName(spec) {
  if (spec.startsWith(".") || spec.startsWith("node:")) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

test("生产代码的裸模块 import 必须在 dependencies ∪ peerDependencies 里有声明", () => {
  const files = ["src", "scripts", "extensions"].flatMap((d) => walk(path.join(repoRoot, d)));
  const bare = new Map(); // 包名 → 引用它的文件集合
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(SPECIFIER)) {
      const name = packageName(m[1]);
      if (!name) continue;
      if (!bare.has(name)) bare.set(name, new Set());
      bare.get(name).add(path.relative(repoRoot, f));
    }
  }

  // 防空跑：两个 @earendil-works 包是已知站点（extensions/sdd-loop/index.ts，
  // 以值形式 import）。扫不到它们说明正则失效，而不是依赖消失了。
  for (const known of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"]) {
    assert.ok(bare.has(known), `没扫到已知裸 import ${known}——扫描判据失效（而不是它不再被引用）`);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  for (const [name, sites] of bare) {
    assert.ok(
      declared.has(name),
      `${name} 被 ${[...sites].join(", ")} import，但 package.json 的 dependencies/peerDependencies 都没声明——` +
        `运行时依赖必须声明（宿主提供的进 peerDependencies，其余进 dependencies），否则 pi install 之后加载即崩`,
    );
  }
});
