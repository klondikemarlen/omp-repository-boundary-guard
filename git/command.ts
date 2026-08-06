import { execFileSync } from "node:child_process";

const GIT_COMMAND_TIMEOUT_MS = 1_000;

export function gitCommandOutput(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_COMMAND_TIMEOUT_MS,
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}
