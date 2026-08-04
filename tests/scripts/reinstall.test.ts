import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const legacyGuard = "omp-repository-boundary-guard";
const packageRoot = new URL("../..", import.meta.url).pathname;

function reinstallCalls(plugins: { npm: Array<{ name: string }> }): string[] {
  const directory = mkdtempSync(join(tmpdir(), "omp-soft-boundary-guard-"));
  const command = join(directory, "omp");
  const log = join(directory, "calls");
  writeFileSync(command, `#!/bin/sh
printf '%s\\n' "$*" >> "$OMP_REINSTALL_LOG"
if [ "$1" = plugin ] && [ "$2" = list ]; then
  printf '%s' "$OMP_REINSTALL_LIST"
fi
`);
  chmodSync(command, 0o755);
  try {
    execFileSync(process.execPath, ["run", "scripts/reinstall.ts"], {
      cwd: packageRoot,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        OMP_REINSTALL_LIST: JSON.stringify(plugins),
        OMP_REINSTALL_LOG: log,
      },
    });
    return readFileSync(log, "utf8").trim().split("\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("reinstall removes the historical competing guard", () => {
  expect(reinstallCalls({ npm: [{ name: legacyGuard }] })).toEqual([
    "plugin list --json",
    `plugin uninstall ${legacyGuard}`,
    "plugin install github:klondikemarlen/omp-soft-boundary-guard",
  ]);
});

test("reinstall does not uninstall an absent competing guard", () => {
  expect(reinstallCalls({ npm: [{ name: "omp-soft-boundary-guard" }] })).toEqual([
    "plugin list --json",
    "plugin install github:klondikemarlen/omp-soft-boundary-guard",
  ]);
});
