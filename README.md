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

After installing or reinstalling, start a new OMP process before retesting. Reloading extensions does not replace a module already loaded by the process.

Approvals are held only in process memory; a plugin reload clears them, and a new OMP process does not carry an earlier approval. The blocked handoff is cached in memory for the pending confirmation and one exact retry. A changed mutation input or resolved target never uses the cached artifact or approval; an approved exact release remains pending until that invocation starts, another confirmation replaces it, the checkout changes, it is rejected, or the process ends. No prompt artifact is written to disk or retained across runs. The baseline path rebuilt the canonical handoff on retry; the integration tests cover the optimized single-handoff path and changed-retry rejection.

Release, deploy, publish, and promote commands—including repository wrappers, package scripts, nested shell commands, and GitHub release writes—are soft-boundary checks. A release targeting the current checkout's resolved `klondikemarlen/*` GitHub origin is inside the built-in boundary and remains silently allowed, including under an active reviewed policy. Other or unresolved release targets report the full command and request the exact Ask when UI is available; without UI, the underlying operation proceeds. Only a guard-internal delegated call carrying an in-memory one-shot capability bypasses the interactive check; ordinary command fields, environment variables, and flags cannot.

An optional reviewed soft-boundary policy can be activated with `OMP_SOFT_BOUNDARY_POLICY` containing JSON `{ "name": "...", "positive": "...", "negative": "..." }` and `OMP_SOFT_BOUNDARY_POLICY_REVIEWED` set to the compiled policy fingerprint. Inspect the compiled output before copying its `sourceFingerprint`; an edited source or mismatched fingerprint stays inactive. With an active policy, built-in deterministic adapters remain the safety floor, the optional `@smol` classifier is advisory, low-risk uncertainty proceeds with in-memory evidence, and high-risk or likely outside cases use the exact Ask. Model, UI, parser, and guard failures follow the configured `allow-and-record` behavior. Resolved cases never silently broaden authorization.

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
