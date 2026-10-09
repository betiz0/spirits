# spirits

**English** | [日本語](README.ja.md) | [简体中文](README.zh.md) | [Deutsch (Schweiz)](README.de-CH.md)

spirits is a fork of [Pi](https://github.com/earendil-works/pi) that reimplements the execution model of Prime Intellect's [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) in TypeScript/Bun.

Instead of driving the model through a loop of individual tool calls, spirits gives it a persistent TypeScript REPL (`tsrepl`) as its main interface: the model writes TypeScript cells, keeps state across cells, calls host functions, and can start child agents recursively. Agents can also maintain their own memory, skills, and code-mode prompt across sessions (a "continual harness").

> **Status:** milestones M1–M4 are implemented: the persistent REPL, single-binary distribution, synchronous `rlm`, and the continual harness. M5 (Phase 2 enhancements) is decided by a dogfooding-based Go/No-Go gate. Releases are tagged `spirits-v*`; only Linux x86_64 is supported.

## Features

- **Persistent TypeScript REPL** — `tsrepl` is the main tool. Cells are transpiled with `Bun.Transpiler` and executed in a `node:vm` context; assignments to `globalThis` persist across cells. `return` / `out()` set the cell value, `print()` output is captured, errors are formatted with the failing line and an actionable hint, `use()` imports `node:` / `bun:` builtins and cwd-relative modules, and `tool()` calls other tools through the host pipeline.
- **Recursive child agents** — `await rlm("prompt")` runs a child agent in-process and returns its final answer as a string. Depth is capped (default 2), calls from one REPL are serialized, aborts propagate to the child, and every call records an `rlm_usage` entry for token and cost accounting.
- **Continual harness** — `note()` appends cross-session memory, `goal()` tracks the goal of the current branch, codemode tools manage skills (`spirits_skill_*`), and the agent can override its own code-mode prompt (`spirits_prompt_set`).
- **Single binary** — compiled with `bun build --compile`. The target machine needs neither Bun nor Node.

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

## Known limitations

- A synchronous loop that starts after an `await` cannot be interrupted: timeout does not fire and the whole process stops responding (restart required).
- Linux x86_64 only; themes, assets, HTML export, and native prebuilds are not bundled.
- No automatic updates. Re-run the installer to upgrade; `spirits update` only shows Pi's update notice.
- `rlm` is synchronous and serialized. Async fan-out is evaluated in M5.
- Configuration, sessions, and auth live in `~/.spirits/agent/` (or `PI_CODING_AGENT_DIR`). External extensions go to `~/.spirits/agent/extensions/`.

## Security

Model-generated code runs with the same OS user privileges as the spirits process. The vm context and `node:vm` are not a security boundary. For untrusted repositories or automation, run spirits in an isolated environment, following Pi's containerization guidance. Remote imports through `use()` are rejected by default.

## Development

Requirements: Bun >= 1.4.0 (1.4.2 or newer recommended). Node.js is not supported.

```sh
git clone https://github.com/betiz0/spirits.git
cd spirits
npm ci --ignore-scripts   # only needed to run Pi from source
cd packages/spirits
bun install --frozen-lockfile
bun test
bun run check
```

Run the development build:

```sh
# from the repository root
bun packages/spirits/bin/spirits.ts

# or load the extension into Pi from source
bun packages/coding-agent/src/cli.ts -e packages/spirits/src/index.ts
```

Set `SPIRITS_DEV=1` to log each cell's description, duration, and result kind to stderr.

## Documentation

- Overall design: [`docs/spirits-design.md`](docs/spirits-design.md)
- Phase designs: [`docs/spirits-m1-repl.md`](docs/spirits-m1-repl.md), [`docs/spirits-m2-distribution.md`](docs/spirits-m2-distribution.md), [`docs/spirits-m3-rlm.md`](docs/spirits-m3-rlm.md), [`docs/spirits-m4-harness.md`](docs/spirits-m4-harness.md), [`docs/spirits-m5-phase2.md`](docs/spirits-m5-phase2.md)
- Package details: [`packages/spirits/README.md`](packages/spirits/README.md)
- Upstream Pi: [pi.dev](https://pi.dev), [earendil-works/pi](https://github.com/earendil-works/pi)

## License

MIT. The upstream Pi copyright notice is retained in [`LICENSE`](LICENSE). Prime Agent is an architectural reference only; no code is copied from it.

## Acknowledgments

- [Pi](https://github.com/earendil-works/pi) by Mario Zechner and contributors — upstream agent harness.
- [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) by Prime Intellect — reference architecture for the RLM-style execution model.
