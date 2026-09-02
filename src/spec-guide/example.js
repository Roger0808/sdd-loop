/**
 * 「参考写法」的选取策略——CLI 与 pi 扩展共享的同一处（渲染策略也是策略，
 * 复制成两份就是下一次「两处都该改、只改了一处」）。
 *
 * 选取顺序：先取「落点文档同名文件里、标题中的出现」（那是这类条款的定义处），
 * 再退到任何标题中的出现，再退到任何出现。全是事实排序，没有对错判定。
 */

import path from "node:path";

/**
 * @param {{ doc: string }} entry 字典条目（取它的落点文档名）
 * @param {Array<{ occurrences: Array }>} families id-scan 的族列表
 * @returns 出现条目或 null
 */
export function pickExample(entry, families) {
  const occurrences = families.flatMap((family) => family.occurrences);
  const docFile = `${entry.doc}.md`;
  return (
    occurrences.find((o) => o.inHeading && o.file && path.basename(o.file) === docFile) ??
    occurrences.find((o) => o.inHeading) ??
    occurrences[0] ??
    null
  );
}
