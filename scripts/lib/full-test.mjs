import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

import {
  validatePluginManifest,
  verifyEvidenceManifest,
  validateExtensionClaims,
  FULL_TEST_PROTOCOL_VERSION,
} from "../../src/full-test/protocol.js";
import { EXIT_OK, EXIT_UNUSABLE } from "./exit-codes.mjs";

/**
 * Skills 与开发者使用的只读检查工具入口：
 * 提供清单 schema 校验、不可变证据包完整性校验与待审 claims 越权校验，不负责判决 Verification。
 * 异常受控捕获，绝不向终端泄漏未捕获 Node 堆栈。
 */
export function runFullTestCli(args, io) {
  try {
    const sub = args._[1];
    if (sub === "verify-manifest") {
      const file = args.file ? path.resolve(args.file) : path.resolve("tests/sdd/plugin.yaml");
      if (!fs.existsSync(file)) {
        io.stderr(`清单文件不存在：${file}\n`);
        io.exit(EXIT_UNUSABLE);
        return;
      }
      try {
        const text = fs.readFileSync(file, "utf8");
        const parsed = file.endsWith(".json") ? JSON.parse(text) : yaml.parse(text);
        const result = validatePluginManifest(parsed);
        if (!result.valid) {
          io.stderr(`清单格式错误：\n${result.errors.map((e) => `  - ${e}`).join("\n")}\n`);
          io.exit(EXIT_UNUSABLE);
          return;
        }
        io.stdout(`清单合法：${parsed.id}@${parsed.version}（${FULL_TEST_PROTOCOL_VERSION}）。\n`);
        io.exit(EXIT_OK);
      } catch (err) {
        io.stderr(`解析失败：${err.message}\n`);
        io.exit(EXIT_UNUSABLE);
      }
      return;
    }

    if (sub === "verify-bundle") {
      const dir = args.dir ? path.resolve(args.dir) : null;
      if (!dir || !fs.existsSync(dir)) {
        io.stderr("必须用 --dir 指定存在的证据包目录。\n");
        io.exit(EXIT_UNUSABLE);
        return;
      }

      const result = verifyEvidenceManifest(dir);
      if (!result.verified) {
        const issues = [
          ...result.errors,
          ...result.mismatches.map((m) => `哈希不匹配或未登记: ${m}`),
          ...result.missing.map((m) => `文件缺失: ${m}`),
        ];
        io.stderr(`证据包无效或损坏：\n${issues.map((f) => `  - ${f}`).join("\n")}\n`);
        io.exit(EXIT_UNUSABLE);
        return;
      }

      io.stdout("证据包完整性验证通过（SHA-256 清单与契约一致）。\n");
      io.exit(EXIT_OK);
      return;
    }

    if (sub === "verify-claims") {
      const file = args.file ? path.resolve(args.file) : null;
      if (!file || !fs.existsSync(file)) {
        io.stderr("必须用 --file 指定存在的 claims JSON 文件。\n");
        io.exit(EXIT_UNUSABLE);
        return;
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        const result = validateExtensionClaims(parsed);
        if (!result.valid) {
          io.stderr(`extensionClaims 非法：\n${result.errors.map((e) => `  - ${e}`).join("\n")}\n`);
          io.exit(EXIT_UNUSABLE);
          return;
        }
        io.stdout("extensionClaims 校验通过（无越权判定）。\n");
        io.exit(EXIT_OK);
      } catch (err) {
        io.stderr(`解析失败：${err.message}\n`);
        io.exit(EXIT_UNUSABLE);
      }
      return;
    }

    io.stderr("内部用法：sdd-loop _full_test [verify-manifest --file <path> | verify-bundle --dir <dir> | verify-claims --file <path>]\n");
    io.exit(EXIT_UNUSABLE);
  } catch (fatalError) {
    io.stderr(`命令执行失败：${fatalError.message}\n`);
    io.exit(EXIT_UNUSABLE);
  }
}
