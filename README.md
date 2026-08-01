# OMP Soft Boundary Guard

Opt-in OMP extension that offers a soft, best-guess warning when a recognized mutation may cross the current built-in boundary.

## What it guards

- Local `write` and structured `edit` operations, including both endpoints of an `edit` move.
- `git push`, including default, configured, named, SSH, and HTTPS remotes.
- `gh issue` creation and updates, `gh pr` creation and updates, and mutating `gh api` requests.
- Supported `xd://github` issue and pull-request writes.

The guard asks when it can resolve a supported mutation and identify a target outside the active boundary. Same-boundary mutations remain silent. Read-only operations, unknown or malformed operations, dynamic or ambiguous commands, unresolved paths, unresolved repositories, and missing checkout information pass through without an Ask. The underlying tool remains responsible for validating anything the guard cannot classify confidently.

GraphQL `gh api` requests are conservatively target-resolved only for a single `resolveReviewThread` mutation; other GraphQL mutations remain unresolved and pass through.

The current built-in boundary is the invoking session's normalized GitHub `origin`, or its canonical Git root when no GitHub origin exists. Tool `cwd`, shell `cd … &&`, and Git `-C` help resolve a target, but never redefine the boundary. A different local checkout or resolved GitHub repository triggers one standard OMP Ask; one approval authorizes exactly one matching retry.

## Ask handoff

`bun run handoff` reads `{"event":{"toolName":…,"input":…},"cwd":"…"}` from standard input and writes one JSON packet. Its `decision` is `allow` or `ask`; an `ask` packet includes the exact standard OMP Ask payload, active repository, resolved mutation target, action, and exact-retry fingerprint.

```bash
printf '%s\n' '{"event":{"toolName":"bash","input":{"command":"git push https://github.com/elsewhere/example.git HEAD"}}}' | bun run handoff
```

## Install

```bash
omp plugin install github:klondikemarlen/omp-soft-boundary-guard
```

After installing or reinstalling, start a new OMP process (or reload its extensions) before retesting. Existing OMP processes retain extension modules loaded at startup.

Approvals are held in memory only; a plugin reload does not carry an earlier approval into the new process.
The blocked handoff is cached in memory for the pending confirmation and one exact retry. The cache key excludes only OMP's per-call intent; any mutation input change, checkout change, rejection, or plugin reload discards or bypasses the artifact and requires a new confirmation. No prompt artifact is written to disk or retained across runs. The baseline path rebuilt the canonical handoff on retry; the integration tests cover the optimized single-handoff path and changed-retry rejection.

Release, deploy, publish, and promote commands—including repository wrappers, package scripts, nested shell commands, and GitHub release writes—are soft-boundary checks. They report the full command and request the exact Ask when UI is available; without UI, the underlying operation proceeds. Release pending/approved state is cleared at OMP `turn_start`; ordinary boundary state keeps its existing lifecycle. Only a guard-internal delegated call carrying an in-memory one-shot capability bypasses the interactive check; ordinary command fields, environment variables, and flags cannot.

The next boundary-policy phase is tracked in issue #153: long positive/inside and negative/outside descriptions will compile into reviewed policy, while built-in deterministic adapters remain the safety floor. Uncertain low-risk cases may proceed with advisory recording; high-risk or likely outside cases may trigger the exact Ask. Resolved cases never silently broaden authorization.

If `omp-github-write-guard` is installed from the historical package name, remove it before installing this replacement. If `omp-repository-boundary-guard` is installed, remove it before installing this package; running both creates competing confirmation flows.

```bash
omp plugin uninstall omp-repository-boundary-guard
omp plugin install github:klondikemarlen/omp-soft-boundary-guard
```

For development:

```bash
omp --extension .
```

The package root declares `index.ts` under `omp.extensions` for packaged installation.

## Development

```bash
bun test
```

## Release

Release policy:

- Patch versions cover merged behavior fixes, documentation, and maintenance changes.
- Minor versions cover new user-visible capabilities or supported policy changes.
- Every release must advance `package.json` beyond the latest semantic Git tag; `release:check` rejects an unchanged version.

```bash
bun run release:check
```

After `main` is pushed:

```bash
bun run reinstall
```

`bun run reinstall` is the normal release install path; it uses the generic GitHub reference and follows the repository's default branch. Use an exact commit hash with `--force` only when reproducing a specific release or diagnosing a stale cached install:

```bash
omp plugin install github:klondikemarlen/omp-soft-boundary-guard#<full-commit-hash> --force
```
