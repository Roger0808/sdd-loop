/**
 * front-matter 严格读取器（sdd-loop 能力一的地基）。
 *
 * 为什么不复用 src/render/spec-file.js 的 parseFrontMatter：那一份对不认识的行
 * 静默跳过。冲突标记 `<<<<<<< HEAD` / `=======` / `>>>>>>> branch` 都不含冒号，
 * 于是会被无声丢掉，两侧的键混进同一个 meta，解析「成功」返回一份**混合的假元数据**。
 *
 * 而 AGENTS.md 把 front-matter 定义为阶段门禁的判据。判据被污染却报告解析成功，
 * 是最坏的一种失败——比读不出来还坏，因为没有人会去查。实测中这正好发生过：
 * 两份文档 9 处冲突标记全部落在 front-matter 里，而当时没有任何东西提示。
 *
 * 所以这里的规矩是：宁可报「读不出来」，不可报一份猜出来的 meta。
 */

/** 冲突标记：git 默认样式，行首三选一。 */
const CONFLICT_PATTERN = /^(<{7}|={7}|>{7})(\s|$)/;

/** `key: value`，key 不含冒号。列表值（`- x`）不在本读取器的职责内。 */
const PAIR_PATTERN = /^([^:]+):\s*(.*)$/;

/**
 * 读一段文本的 front-matter。
 *
 * @param {string} content 文件全文
 * @returns {{ ok: boolean, meta: Record<string,string>, bodyStart: number, issues: Array<{kind: string, line: number, text: string, detail: string}> }}
 *   ok      true 表示 meta 可信。任何 conflict/unterminated/duplicate 都会让它变 false。
 *   meta    只在 ok 为 true 时有意义；false 时保留已解析部分仅供人工排查，不许拿去判定。
 *   issues  逐条问题，带行号（1 起）。
 */
export function readFrontMatter(content) {
  const lines = String(content ?? "").split(/\r?\n/);
  const issues = [];
  const meta = {};

  if (lines[0]?.trim() !== "---") {
    issues.push({
      kind: "missing",
      line: 1,
      text: lines[0] ?? "",
      detail: "文件开头不是 `---`，没有 front-matter。",
    });
    return { ok: false, meta, bodyStart: 0, issues };
  }

  const seen = new Set();
  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (CONFLICT_PATTERN.test(raw)) {
      issues.push({
        kind: "conflict-marker",
        line: i + 1,
        text: trimmed,
        detail: "front-matter 里有未解决的合并冲突标记——元数据不可信。",
      });
      // 继续扫完，把所有冲突标记都收集齐：只报第一处会让人以为改一行就好。
      continue;
    }

    if (trimmed === "---") {
      // 冲突已经让 meta 不可信；没有冲突时才承认解析成功。
      const ok = issues.length === 0;
      return { ok, meta, bodyStart: i + 1, issues };
    }

    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = raw.match(PAIR_PATTERN);
    if (!match) {
      issues.push({
        kind: "unparsable-line",
        line: i + 1,
        text: trimmed,
        detail: "既不是 `key: value`，也不是注释或空行。",
      });
      continue;
    }

    const key = match[1].trim();
    if (seen.has(key)) {
      issues.push({
        kind: "duplicate-key",
        line: i + 1,
        text: trimmed,
        detail: `键 \`${key}\` 重复——两处声明哪个生效是靠运气，不该靠运气。`,
      });
      continue;
    }
    seen.add(key);
    meta[key] = stripQuotes(match[2].trim());
  }

  issues.push({
    kind: "unterminated",
    line: lines.length,
    text: "",
    detail: "front-matter 没有结束的 `---`。",
  });
  return { ok: false, meta, bodyStart: 0, issues };
}

/** YAML 的引号是包装不是内容；`status: "archived"` 与 `status: archived` 必须判成同一个值。 */
function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** `null` / 空串 / 缺失都算「没有值」——状态文件用 `activeLoop: null` 表达「没有活跃 Loop」。 */
export function isBlank(value) {
  const text = String(value ?? "").trim();
  return text === "" || text === "null" || text === "~";
}
