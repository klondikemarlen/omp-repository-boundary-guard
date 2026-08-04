import { execFileSync } from "node:child_process";

type PluginList = { npm?: Array<{ name?: string }> };

const legacyGuard = "omp-repository-boundary-guard";
const installed = JSON.parse(execFileSync("omp", ["plugin", "list", "--json"], { encoding: "utf8" })) as PluginList;

if (installed.npm?.some(({ name }) => name === legacyGuard)) {
  execFileSync("omp", ["plugin", "uninstall", legacyGuard], { stdio: "inherit" });
}

execFileSync("omp", ["plugin", "install", "github:klondikemarlen/omp-soft-boundary-guard"], { stdio: "inherit" });
