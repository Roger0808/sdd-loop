/**
 * exit-codes.mjs — CLI 退出码契约的唯一定义点。
 *
 * D40：退出码 0 没问题 / 1 内容有问题 / 2 用不了，agent 靠它分支、不解析文案。
 * 唯一消费方是 scripts/sdd-loop.mjs——契约单独放一个文件，是为了让「改文案」
 * 和「改退出码」在 diff 里分得开：前者随便改，后者是对 agent 的承诺。
 */
export const EXIT_OK = 0;
export const EXIT_CONTENT = 1;
export const EXIT_UNUSABLE = 2;
