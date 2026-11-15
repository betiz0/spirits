# spirits

**English** | [日本語](README.ja.md) | [简体中文](README.zh.md) | [Deutsch (Schweiz)](README.de-CH.md)

spirits is an extension bundle plus a thin launcher for the official [Pi](https://github.com/earendil-works/pi) artifact. It reimplements the execution model of Prime Intellect's [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) in TypeScript/Bun, and it carries no Pi sources: `~/.spirits/managed-pi` holds the pinned official Pi release, and the compiled `spirits` binary verifies that set and starts it with the spirits extension loaded.

Instead of driving the model through a loop of individual tool calls, spirits gives it a persistent TypeScript REPL (`tsrepl`) as its main interface: the model writes TypeScript cells, keeps state across cells, calls host functions, and can start child agents recursively. Agents can also maintain their own memory, skills, and code-mode prompt across sessions (a "continual harness").

> **Status:** milestones M1–M4 are implemented: the persistent REPL, single-binary distribution, synchronous `rlm`, and the continual harness. M5 (Phase 2 enhancements) is decided by a dogfooding-based Go/No-Go gate. Releases are tagged `spirits-v*`; only Linux x86_64 is supported.

## Features

- **Persistent TypeScript REPL** — `tsrepl` is the main tool. Cells are transpiled with `Bun.Transpiler` and executed in a `node:vm` context; assignments to `globalThis` persist across cells. `return` / `out()` set the cell value, `print()` output is captured, errors are formatted with the failing line and an actionable hint, `use()` imports `node:` / `bun:` builtins and cwd-relative modules, and `tool()` calls other tools through the host pipeline.
- **Recursive child agents** — `await rlm("prompt")` runs a child agent in-process and returns its final answer as a string. Depth is capped (default 2), calls from one REPL are serialized, aborts propagate to the child, and every call records an `rlm_usage` entry for token and cost accounting.
- **Continual harness** — `note()` appends cross-session memory, `goal()` tracks the goal of the current branch, codemode tools manage skills (`spirits_skill_*`), and the agent can override its own code-mode prompt (`spirits_prompt_set`).
- **Session TODO and non-destructive clear** — `manage_todos` keeps a TODO list bound to the current session branch, shown as a panel between the editor and footer; `/spirits-clear` starts a fresh conversation branch while keeping the model, thinking level, and extension state.
- **Dual model routing** — `/model spirits/auto` keeps one selection while every request is routed to a normal or a strong model. The two OpenSpec review and verify skills get the strong one (`models.strong` in settings), everything else the default model.
- **Single binary** — the launcher is compiled with `bun build --compile` and carries no Pi sources. It downloads the pinned host set on first launch, verifies every checksum, and then starts it; the machine needs neither Bun nor Node to run it.

## Install

Linux x86_64 (glibc) only. The installer verifies the SHA256 checksum before placing anything.

```sh
curl -fsSL https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh | sh
```

The binary is installed to `~/.spirits/bin/spirits`. Add it to `PATH` if needed:

```sh
export PATH="$HOME/.spirits/bin:$PATH"
```

Pin a version with `VERSION=0.1.0 sh ...`, check it with `spirits --version` (prints the spirits version and the embedded Bun version), and uninstall with `... | sh -s -- --uninstall` (the installer prints the `rm` commands; nothing is deleted automatically).

Update an installed binary with `spirits update`:

```sh
spirits update           # replace with the latest stable release, then install its managed set
spirits update self      # same thing, spelled explicitly
spirits update --force   # re-download even when already latest
```

`spirits update` verifies the SHA256 checksum and replaces `~/.spirits/bin/spirits` with an atomic rename, then installs the managed set of the release it updated to. It prints `spirits <version> is already up to date` when the installed version already matches the latest stable release (or is newer, e.g. a prerelease), and still re-installs the managed set. `PI_OFFLINE=1` (also `true` / `yes`) makes it refuse without network access. Update requests fail after 10 seconds without received data; set `SPIRITS_UPDATE_IDLE_TIMEOUT_SECONDS` (positive integer seconds) to override.

`spirits update` takes only those forms. `--all`, `--extensions`, `--models`, `-h`, an unknown option, and any positional other than `self` / `pi` are refused with a message and a non-zero exit code, because silently forwarding them would make an unhandled flag look like a finished update. **If you come from 0.7.x, use `spirits update`**: `spirits update --all` is no longer a self-update form.

The host and the spirits extension bundle follow the `spirits` release, so `spirits update` is also how you update them. Two things live outside it:

```sh
spirits managed-pi update                # the pinned host set, without touching the binary
~/.spirits/managed-pi/current/pi/pi update --extensions   # host packages and model catalogs
```

The second command runs on the host executable, and it has to: the launcher always loads the spirits bundle before your arguments, so `spirits -- update ...` is a prompt to the model, not a host command. The same applies to the host's other commands (`install`, `remove`, `uninstall`, `list`, `config`, `auth`, `mcp`): `spirits <command>` refuses them and prints the host path to run them on.

Re-running `install.sh` still works: with latest resolution it skips the download when the installed version matches, and prints `spirits <version> is already up to date`. Use `VERSION=x.y.z` to force a re-download and placement. The 0.1.0 binary predates self-update, so upgrading from 0.1.0 requires one `install.sh` run; after that, `spirits update` works.

Themes come from the host artifact. The launcher no longer places `~/.spirits/bin/theme/`; a directory left there by an older release is unused and can be removed.

The installer resolves the newest `spirits-v*` release. If no release is published yet, build from source (see [Development](#development)).

## Quick start

```sh
spirits
```

Ask the model to solve a task; it works through `tsrepl` cells:

```ts
// cells persist state through globalThis
globalThis.rows = await (await use("./load.ts")).load();

// delegate: the child runs its own REPL session
return await rlm("Summarize the rows and return JSON.");
```

Details, limits, and constraints are in [`packages/spirits/README.md`](packages/spirits/README.md).

## Bundled skills

spirits ships with skills that are available right after install. They are written at startup to `<agentDir>/bundled-skills/<spirits version>/` and handed to pi's skill search; they are never placed in `<agentDir>/skills/`.

- The bundled skills are:
  - `sprt-architecture-guards` measures a TypeScript repository and generates the convention source of truth plus checks that run in that repository's test runner.
  - `sprt-opsx-verify-deep` verifies an OpenSpec change deeply, independently of the default verification (verify2).
  - `sprt-opsx-review-change` reviews an OpenSpec change before `/opsx-apply` and returns a YES/NO verdict on starting implementation.
- Start a bundled skill explicitly, for example with `/skill:sprt-architecture-guards`. Most bundled skills carry `disable-model-invocation: true`, so the model never selects them automatically; `sprt-opsx-review-change` is an exception and may be selected by the model.
- A user skill with the same name in `<agentDir>/skills/<name>/` always wins. pi keeps the user version and prints a collision warning; the bundled copy is skipped.
- Disable all bundled skills with `SPIRITS_BUNDLED_SKILLS=0` (unset or any other value keeps them enabled). Nothing is written and no skill path is supplied.
- After a spirits update, start spirits again to get the new contents: the bundled contents are embedded in the running binary, so `/reload` only rewrites the tree of the version that is already running. A previous version directory is removed on write only after it has not been used for 7 days.
- `bundled-skills/` is managed by spirits. Do not edit files there; keep your own skills in `<agentDir>/skills/`.

## Model routing

Only two OpenSpec workflow steps ask for a stronger model: the change review skill `sprt-opsx-review-change` and the deep verification skill `sprt-opsx-verify-deep`. Instead of switching models by hand and forgetting to switch back, select one model and let spirits route each request.

- Select the routing model with `/model spirits/auto`. Nothing else changes: the default model settings, `--model`, and the behaviour of `/model` stay as they are, and a session with a physical model selected is never routed.
- Configure the strong target in `settings.json` (`~/.spirits/agent/settings.json`, or `.pi/settings.json` in the project):

  ```json
  { "models": { "strong": "anthropic/claude-opus-4-7" } }
  ```

  A bare model id (`"claude-opus-4-7"`) resolves against the current default provider. `models` is a spirits key, and pi keeps it when it saves other settings.
- propose, apply, verify, and archive run as **normal** on the default provider and model. If the default cannot be resolved, the model of the latest successful response takes over with one notice. Requests made while `sprt-opsx-review-change` or `sprt-opsx-verify-deep` runs go as **strong**, and the role returns to the locked role when the run settles, including after an Escape abort or an error.
- Lock a role with `/spirits-role <normal|strong>`: the lock holds for later prompts and releases when you lock the other role; a `/reload` re-reads `models.role`, so a lock that was only pressed for the session returns to the default role. While a physical model is selected there is no routing and no badge (`/spirits-role status` then reports `routing: off (a physical model is selected)`); the lock takes effect from the requests made after switching back to `spirits/auto`.
- Keep a **physical** model in `defaultProvider` / `defaultModel`. A virtual model is never a normal target, so saving `spirits/auto` as the default leaves normal with nothing to resolve and the first request of a new session ends in an error.
- Without `models.strong` everything stays normal in silence. A configured strong target that cannot be used (unknown id, provider without credentials) falls back to normal and says so once per run.
- The extension's status line shows `[normal]` or `[strong]` under the model line. The badge reports the role of the **latest request**, so it lags one request: right after starting a skill it still reads `[normal]`, and right after the skill settles it still reads `[strong]` until the next request.
- Lock a role with `/spirits-role <normal|strong>`, and inspect the whole picture with `/spirits-role status`, which prints the routing state, the lock, the running step, the last request, and the resolved `normal` / `strong` targets.

## Known limitations

- A synchronous loop that starts after an `await` cannot be interrupted: timeout does not fire and the whole process stops responding (restart required).
- Linux x86_64 only.
- The role badge is drawn on the extension's own status line, not inside the host's footer, so it sits on its own line under the model line. Role commands are `/spirits-role ...` (the host's `/model` takes no role argument); `/spirits-role status` reports the routing, the lock, the running step, and the resolved targets.
- The host's model list carries the routing model as `spirits  auto` (`--list-models` shows it with a zero context window, because it resolves per request).
- The host's own commands are not reachable through `spirits`: `spirits update <other args>`, `spirits install`, `spirits list`, and the rest are refused with the host executable path, because the launcher loads the spirits bundle first and the host dispatches a command only from its own first argument.
- Updates replace the binary in place (`spirits update`) or via the installer; there is no background or startup update check.
- `rlm` is synchronous and serialized. Async fan-out is evaluated in M5.
- Configuration, sessions, and auth live in `~/.spirits/agent/` (or `SPIRITS_CODING_AGENT_DIR`, which must name that directory). External extensions go to `~/.spirits/agent/extensions/`.
- **BREAKING**: the old `PI_CODING_AGENT_DIR` variable is no longer read. The default `~/.spirits/agent/` is unchanged, so existing data keeps working.
- **BREAKING**: the compiled binary no longer reads `.env`, `.env.local`, or `.env.<NODE_ENV>` files from the start directory. Set API keys and other variables in the shell (`export ANTHROPIC_API_KEY=...` or `export SPIRITS_...`) or inline before the command instead.
- Install telemetry and Pi-attributed provider headers are off by default. `settings.json` cannot enable them; use `PI_TELEMETRY=1` to opt in.
- The first launch needs network access once: it downloads the pinned host tarball (58,876,253 bytes for Pi 1.5.0) and the spirits bundle into `~/.spirits/managed-pi`, which takes 182 MB on disk afterwards. Later launches verify the set locally, and `spirits managed-pi repair` rebuilds it. `PI_OFFLINE=1` applies to `spirits update`, not to the managed set.

## Security

Model-generated code runs with the same OS user privileges as the spirits process. The vm context and `node:vm` are not a security boundary. For untrusted repositories or automation, run spirits in an isolated environment, following Pi's containerization guidance. Remote imports through `use()` are rejected by default.

## Development

Requirements: Bun >= 1.4.0 (1.4.2 or newer recommended). Node.js is used only by the lockfile gate and a few scripts.

```sh
git clone https://github.com/betiz0/spirits.git
cd spirits
bun install --frozen-lockfile   # one workspace, one bun.lock
bun run check                   # biome + scripts tsc + packages/spirits tsc, never rewrites
bun run fix                     # the rewriting variant
cd packages/spirits && bun test
```

Run the development build:

```sh
# from the repository root
bun packages/spirits/bin/spirits.ts
```

A source run does not fetch anything, so it needs a managed set first:

```sh
bun packages/spirits/bin/spirits.ts managed-pi install
# or point at a local build of the two inputs
SPIRITS_MANAGED_PI_MANIFEST_URL=http://host/manifest.json bun packages/spirits/bin/spirits.ts -- --version
```

The host types come from the pinned `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` devDependencies, so `tsc` checks the extension against the same declarations the host ships. Building the launcher needs no Pi sources: `bun scripts/build-binaries.ts --version <version>` compiles only `packages/spirits/bin/spirits.ts`.

Set `SPIRITS_DEV=1` to log each cell's description, duration, and result kind to stderr.

## Documentation

- Overall design: [`docs/spirits-design.md`](docs/spirits-design.md)
- Launch routes and the managed set: [`docs/spirits-default-launch.md`](docs/spirits-default-launch.md), [`docs/spirits-managed-pi.md`](docs/spirits-managed-pi.md)
- Host version upgrades and rollback: [`docs/spirits-host-upgrade.md`](docs/spirits-host-upgrade.md)
- Phase designs: [`docs/spirits-m1-repl.md`](docs/spirits-m1-repl.md), [`docs/spirits-m2-distribution.md`](docs/spirits-m2-distribution.md), [`docs/spirits-m3-rlm.md`](docs/spirits-m3-rlm.md), [`docs/spirits-m4-harness.md`](docs/spirits-m4-harness.md), [`docs/spirits-m5-phase2.md`](docs/spirits-m5-phase2.md)
- Package details: [`packages/spirits/README.md`](packages/spirits/README.md)
- The host: [pi.dev](https://pi.dev), [earendil-works/pi](https://github.com/earendil-works/pi)

## License

MIT. The upstream Pi copyright notice is retained in [`LICENSE`](LICENSE), which also records that spirits is an independent work that runs on top of Pi rather than a derivative of its sources. Prime Agent is an architectural reference only; no code is copied from it.

## Acknowledgments

- [Pi](https://github.com/earendil-works/pi) by Mario Zechner and contributors — upstream agent harness.
- [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) by Prime Intellect — reference architecture for the RLM-style execution model.
