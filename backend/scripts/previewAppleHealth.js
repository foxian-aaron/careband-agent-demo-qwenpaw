import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AppleHealthError,
  analyzeAppleHealthXmlFile,
  resolvePrivateAppleHealthInput,
} from "../src/importers/appleHealthXml.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const parseArgs = (args) => {
  if (args.length < 1 || args.length > 2) throw new Error("APPLE_HEALTH_ARGS_INVALID");
  let limitDays = 14;
  for (const flag of args.slice(1)) {
    const match = flag.match(/^--limit-days=(\d{1,3})$/);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 366) {
      throw new Error("APPLE_HEALTH_ARGS_INVALID");
    }
    limitDays = Number(match[1]);
  }
  return { input: args[0], limitDays };
};

try {
  const { input, limitDays } = parseArgs(process.argv.slice(2));
  const inputPath = resolvePrivateAppleHealthInput(path.resolve(process.cwd(), input), projectRoot);
  const { preview } = await analyzeAppleHealthXmlFile(inputPath, { limitDays });
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
} catch (error) {
  const code = error instanceof AppleHealthError ? error.code : error?.message === "APPLE_HEALTH_ARGS_INVALID"
    ? "APPLE_HEALTH_ARGS_INVALID"
    : "APPLE_HEALTH_PREVIEW_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
