# Development Rules

spirits is an extension bundle plus a thin launcher that runs on top of the official Pi host. The
Pi source tree is not in this repository. See [README.md](README.md) for use and
[docs/spirits-design.md](docs/spirits-design.md) for architecture.

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text (e.g. "Thanks @user" not "Thanks so much @user!")
- Technical prose only, be direct
- Use concise, clear, simple language. Define unavoidable jargon before using it.
- Explain non-trivial designs and problems as: problem, concrete example or short trace, then solution. State why the solution is necessary and distinguish it from optional complexity.
- Prefer concrete behavior and small illustrations over abstract summaries, dense terminology, or unexplained lists of changes.
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## Code Quality

- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Do not rely on search snippets for broad changes.
- No `any` unless absolutely necessary.
- Inline single-line helpers that have only one call site.
- Check the installed host packages under `node_modules` for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Use only erasable TypeScript syntax (Node strip-only mode) in `packages/spirits/src`, `packages/spirits/test`, `packages/spirits/bin`, and `scripts`: no parameter properties, `enum`, `namespace`/`module`, `import =`, `export =`, or other constructs needing JS emit. Use explicit fields with constructor assignments.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.

## Host Boundary

The host is the official Pi artifact in `~/.spirits/managed-pi`. Never write code that assumes a Pi
source tree exists.

- Import the host only through its published entry points: `@earendil-works/pi-coding-agent`,
  `@earendil-works/pi-coding-agent/rpc-entry`, `@earendil-works/pi-tui`. Never deep-import a file
  inside a host package, and never re-declare a host type in an ambient `.d.ts`.
- Host types come from the pinned devDependencies in `packages/spirits/package.json`. When a name is
  missing, derive an alias in `packages/spirits/src/types/host.ts` from a published export instead of
  hand-writing the shape.
- Host-shaped facts (executable name, extension load arguments, environment variable names, command
  words the host dispatches from its own first argument, extension externals) live in
  `packages/spirits/src/managed-pi/host.ts`. Values that move with a host version (version, artifact
  name, checksums, overlay version) live in `PINNED_PI` in `packages/spirits/src/constants.ts`.
- Source diffs against the host are always zero. Behavior goes through the extension API or the
  `piConfig.name` overlay. If the API is missing, record it as a limited-compatibility item.
- The source diff target against the host stays 0. Do not "temporarily" patch a host artifact.

## Commands

- After code changes (not docs): `bun run check` from the repo root (full output, no tail). It runs biome, `tsc -p tsconfig.scripts.json`, and the package type check **without rewriting files**. Fix everything it reports before committing. It does not run tests.
- Rewriting/formatting is `bun run fix`, never a `check` variant.
- Tests: `cd packages/spirits && bun test`. A single file: `cd packages/spirits && bun test test/name.test.ts`.
- CI has no `PI_*`/`SPIRITS_*` variables and a live spirits session does. `packages/spirits/test/preload.ts` pins the host identity, agent dir, and host knobs for every run; reproduce CI with `bash scripts/test-clean-env.sh` before believing a green suite or after a red CI job.
- If you create or modify a test file, run it and iterate on test or implementation until it passes.
- Tests use the fake host in `packages/spirits/test/host/fake-pi.ts` and the faux provider. No real provider APIs, keys, or paid tokens.
- Architecture rules, layers, and baselines are recorded in `docs/architecture/convention-registry.md` and enforced by `packages/spirits/test/architecture-conventions.test.ts`. Re-record the baselines when you add, delete, or move files.
- Product builds and verification:
  - Launcher: `bun scripts/build-binaries.ts --version <ver>`
  - Extension bundle and manifest: `bun scripts/build-managed-pi-inputs.ts --version <ver> --out dist`
  - Compatibility runner (official mode is the default; it measures the pinned host):
    `bun scripts/managed-pi-compat/run.ts --inputs dist --artifact-root <dir> --commit HEAD --out <file>`
  - Installer shell suite: the shell test beside `scripts/install.sh` (97 assertions)
  - Self-update smoke (old binary to new binary): `sh scripts/self-update-smoke.sh <old-bin> <new-bin> <ver> [manifest] [bundle]`
  - Interactive launch check: `scripts/tmux-verify.sh run --session <name> -- <binary>`, then `scripts/tmux-verify.sh check`
- Docs are part of the product here: `docs/spirits-host-upgrade.md` is the procedure for a host version bump, and `docs/architecture/convention-registry.md` is the source of truth for layers.
- Never run `bun run build`, `bun publish`, or a release workflow unless the user asks.
- Ad-hoc scripts: `write` them to a temp file (e.g. `/tmp`), run, edit if needed, remove when done. Don't embed multi-line scripts in `bash` commands.
- Never commit unless the user asks.

## Runtime and Data

- Bun is the runtime and the package manager. Node is only used by a few `.mjs` gate scripts.
- Verify behavior in an isolated `HOME` (for example `HOME=/tmp/spirits-check`). Never point a test run at the real `~/.spirits`, and never delete real `~/.spirits` content.
- A managed agent directory named in the environment beats `HOME`. When a script installs a binary into an isolated `HOME`, drop `SPIRITS_CODING_AGENT_DIR`, `SPIRITS_CODING_AGENT_SESSION_DIR`, and the legacy `PI_*` equivalents from the child environment.

## Dependency and Install Security

- Treat dependency and `bun.lock` changes as reviewed code. Direct external deps stay pinned to exact versions; add them with `bun install --save-exact`.
- One lockfile only: root `bun.lock`. Hydrate locally with `bun install --ignore-scripts`; clean/CI-style with `bun install --frozen-lockfile --ignore-scripts`. Don't run lifecycle scripts unless the user asks.
- New releases of dependencies are held back by `bunfig.toml` `[install] minimumReleaseAge`. Bun does not read npm's `min-release-age`, so don't add it to `.npmrc`.
- Pre-commit blocks staged `bun.lock` changes unless `PI_ALLOW_LOCKFILE_CHANGE=1`. Use that only for an intentional lockfile change and say so.
- The host pins (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, transitive `@earendil-works/pi-ai`, `typebox`) must not drift during unrelated dependency work.

## Git

Multiple agent sessions may be running in this cwd at the same time, each modifying different files. Git operations that touch unstaged, staged, or untracked files outside your own changes will stomp on other sessions' work. Follow these rules:

Committing:

- Only commit files YOU changed in THIS session.
- Stage explicit paths (`git add <path1> <path2>`); never `git add -A` / `git add .`.
- Before committing, run `git status` and verify you are only staging your files.
- Message format: `{feat,fix,docs,chore,ci,build}[(spirits,architecture)]: <commit message> (optionally multiple lines)`. Message is informative and concise.

Never run (destroys other agents' work or bypasses checks):

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`.

If rebase conflicts occur:

- Resolve conflicts only in files you modified.
- If a conflict is in a file you did not modify, abort and ask the user.
- Never force push.

## Issues and PRs

When reviewing PRs:

- Do not run `gh pr checkout`, `git switch`, or otherwise move the worktree to the PR branch unless the user explicitly asks.
- Use `gh pr view`, `gh pr diff`, `gh api`, and local `git show`/`git diff` against fetched refs to inspect PR metadata, commits, and patches without changing branches.
- If you need PR file contents, fetch/read them into temporary files or use `git show <ref>:<path>` without switching branches.

When posting issue/PR comments:

- Write the comment to a temp file and post with `gh issue/pr comment --body-file` (never multi-line markdown via `--body`).
- Keep comments concise, technical, in the user's tone.
- End every AI-posted comment with the AI-generated disclaimer line specified by the originating prompt.

When closing issues via commit:

- Include `fixes #<number>` or `closes #<number>` in the message so merging auto-closes the issue. For multiple issues, repeat the keyword per issue (`closes #1, closes #2`); a shared keyword (`closes #1, #2`) only closes the first.

## Specs

Work is planned in OpenSpec changes under `openspec/changes/<name>/`. After editing proposal,
specs, design, or tasks, validate with `openspec validate <change> --strict`. Do not archive a
change unless the user asks.

## Testing Interactive Mode with tmux

For testing the interactive TUI, load and follow [.pi/skills/interactive-testing.md](.pi/skills/interactive-testing.md).
The default pane (`80x24`) scrolls the startup header away; resize wider (for example
`tmux resize-window -x 200 -y 60`) before capturing.

## Release Notes

There is no `CHANGELOG.md`. Release notes live in the GitHub Release body for the `spirits-v*` tag.
Host version changes are recorded in `docs/spirits-host-upgrade.md`.

## Releasing

For release preparation, publishing, verification, or recovery, load and follow [.pi/skills/release.md](.pi/skills/release.md).

## User Override

If the user's instructions conflict with any rule in this document, ask for explicit confirmation before overriding. Only then execute their instructions.
