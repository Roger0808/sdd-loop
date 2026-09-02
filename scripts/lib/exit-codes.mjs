/**
 * exit-codes.mjs — CLI 退出码契约的唯一定义点。
 *
 * D40：退出码 0 没问题 / 1 内容有问题 / 2 用不了，agent 靠它分支、不解析文案。
 * v2 起唯一消费方是 scripts/sdd-loop.mjs（prd.mjs 已随旧模型退役）。
 */
export const EXIT_OK = 0;
export const EXIT_CONTENT = 1;
export const EXIT_UNUSABLE = 2;
