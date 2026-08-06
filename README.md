# OMP Soft Boundary Guard

Opt-in OMP extension that logs a soft, best-guess warning when a recognized mutation may cross the current built-in boundary; the installed extension never blocks the operation.

## What it guards

- Local `write` and structured `edit` operations, including both endpoints of an `edit` move.
- `git push`, including default, configured, named, SSH, and HTTPS remotes.
- `gh issue` creation and updates, `gh pr` creation and updates, and mutating `gh api` requests.
- Supported `xd://github` issue and pull-request writes.

The installed extension logs a warning when it can resolve a supported mutation and identify a target outside the active boundary, then lets the operation proceed. Same-boundary mutations remain silent. Read-only operations, unknown or malformed operations, dynamic or ambiguous commands, unresolved paths, unresolved repositories, and missing checkout information pass through silently. The underlying tool remains responsible for validating anything the guard cannot classify confidently.
Static GraphQL queries and every GraphQL mutation pass through without a warning when their target cannot be resolved.

The current built-in boundary is the invoking session's normalized GitHub `origin`, or its canonical Git root when no GitHub origin exists. Tool `cwd`, shell `cd … &&`, and Git `-C` help resolve a target, but never redefine the boundary. Programmatic callers can opt into strict, one-shot OMP Ask enforcement with `createRepositoryBoundaryGuard({ enforce: true })`; the installed extension remains advisory.

## Handoff inspection

`bun run handoff` reads `{"event":{"toolName":…,"input":…},"cwd":"…"}` from standard input and writes one JSON packet. Its `decision` is `allow` or `ask`; an `ask` packet includes the exact standard OMP Ask payload, active repository, resolved mutation target, action, and exact-retry fingerprint.

```bash
printf '%s\n' '{"event":{"toolName":"bash","input":{"command":"git push https://github.com/elsewhere/example.git HEAD"}}}' | bun run handoff
```

## Install

```bash
omp plugin install github:klondikemarlen/omp-soft-boundary-guard
```

After installing or reinstalling, start a new OMP process before retesting. Reloading extensions does not replace a module already loaded by the process.

Strict-mode approvals are held only in process memory; a plugin reload clears them, and a new OMP process does not carry an earlier approval. The blocked handoff is cached in memory for the pending confirmation and one exact retry. Directories within the same canonical Git root share that approval scope; a different worktree or checkout does not. A changed mutation input or resolved target never uses the cached artifact or approval; an approved exact release remains pending until that invocation starts, another confirmation replaces it, the checkout changes, it is rejected, the plugin reloads, or the process ends. No prompt artifact is written to disk or retained across runs.

Release, deploy, publish, and promote commands—including repository wrappers, package scripts, nested shell commands, and GitHub release writes—are soft-boundary checks. A release targeting the current checkout's resolved `klondikemarlen/*` GitHub origin is inside the built-in boundary and remains silently allowed, including under an active reviewed policy. Other resolved targets log a concise soft warning and proceed. Programmatic strict mode reports the full command and requests the exact Ask when UI is available; without UI, the underlying operation proceeds.

An optional reviewed soft-boundary policy can be activated with `OMP_SOFT_BOUNDARY_POLICY` containing JSON `{ "name": "...", "positive": "...", "negative": "..." }` and `OMP_SOFT_BOUNDARY_POLICY_REVIEWED` set to the compiled policy fingerprint. Inspect the compiled output before copying its `sourceFingerprint`; an edited source or mismatched fingerprint stays inactive. With an active policy, built-in deterministic adapters remain the safety floor and the optional `@smol` classifier is advisory. Low-risk uncertainty proceeds with in-memory evidence; high-risk or likely outside cases log a soft warning and proceed. Model, UI, parser, and guard failures follow the configured `allow-and-record` behavior.

From the plugin checkout or its installed package directory (for example `~/.omp/plugins/node_modules/omp-soft-boundary-guard`), compute the reviewed fingerprint after inspecting the compiled policy:

```bash
export OMP_SOFT_BOUNDARY_POLICY='{"name":"Customer repository work","positive":"active checkout, source, tests, docs","negative":"other checkouts, production targets, credentials, secrets"}'
export OMP_SOFT_BOUNDARY_POLICY_REVIEWED="$(bun -e 'const { compileBoundaryPolicy } = await import("./index.ts"); console.log(compileBoundaryPolicy(JSON.parse(process.env.OMP_SOFT_BOUNDARY_POLICY)).sourceFingerprint)')"
```

`bun run reinstall` removes the historical `omp-repository-boundary-guard` when present before installing this package, preventing competing confirmation flows. For a direct installation, remove it first:

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
- Major versions cover intentionally incompatible behavior changes.
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
