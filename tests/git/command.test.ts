import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { currentCheckoutRoot } from "../../git/current-checkout.ts";

test("bounds a stalled checkout lookup", () => {
  const directory = mkdtempSync(join(tmpdir(), "omp-soft-boundary-guard-checkout-"));
  const executable = join(directory, "git");
  const nestedDirectory = join(directory, "nested", "directory");
  writeFileSync(executable, "#!/bin/sh\nexec sleep 30\n");
  chmodSync(executable, 0o755);
  mkdirSync(nestedDirectory, { recursive: true });

  const originalPath = process.env.PATH;
  try {
    process.env.PATH = `${directory}:${originalPath}`;
    const startedAt = Date.now();
    expect(currentCheckoutRoot(nestedDirectory)).toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  } finally {
    process.env.PATH = originalPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
