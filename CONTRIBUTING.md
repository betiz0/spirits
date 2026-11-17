# Contributing to spirits

This guide exists to save both sides time.

## What spirits is

spirits is an extension bundle plus a thin launcher that runs on top of the **official Pi host**. The
Pi source tree is not part of this repository, and contributions must not add one. New code lives in
`packages/spirits` (extension and launcher) or `scripts` (build, distribution, compatibility
measurement). Behavior that needs something from the host goes through the host's published extension
API or the `piConfig.name` overlay; the source diff against the host stays zero.

Read [AGENTS.md](AGENTS.md) before writing code. If you use an agent, run it from the repository root
so it picks that file up.

## The One Rule

**You must understand your code.** If you cannot explain what your changes do and how they interact
with the launcher, the managed set, and the host, your PR will be closed.

Using AI to write code is fine. Submitting AI-generated slop without understanding it is not.

## Checks

Before submitting a PR:

```bash
bun install --frozen-lockfile --ignore-scripts
bun run check
cd packages/spirits && bun test
```

All three must pass. `bun run check` does not rewrite files; formatting fixes come from `bun run fix`.

CI runs with no spirits or pi variables in its environment, and a run started from a live spirits does
not. `packages/spirits/test/preload.ts` pins the host identity, the agent directory, and the host's own
knobs so both cases measure the same thing; `bash scripts/test-clean-env.sh` re-runs the suites with
every `PI_*` and `SPIRITS_*` variable removed, which is how you reproduce CI locally. Use it before a PR
that touches launch, the managed set, or anything that reads an environment variable.

If your change affects launch, update, or the managed set, also run the checks named in `AGENTS.md`
(compatibility runner, installer and self-update smokes, tmux launch verification). State in the PR
which measurements you ran and what their results were.

## Specs

Behavior changes are planned in OpenSpec changes under `openspec/changes/`. A PR that changes
observable behavior should reference the change it implements, and the change's artifacts should match
the code (`openspec validate <change> --strict` passes).

## Dependencies

Direct external dependencies are pinned to exact versions and added with `bun install --save-exact`.
`bunfig.toml` holds back freshly published versions. A staged `bun.lock` change is reviewed as code;
the pre-commit gate requires an explicit opt-in to commit it.

## Release notes

There is no `CHANGELOG.md`. Release notes are written into the GitHub Release body for the `spirits-v*`
tag. Do not add changelog files.

## License

spirits is MIT licensed. By submitting a contribution you license it under the same terms. See
[LICENSE](LICENSE); the host itself is a separate work that you install at runtime and is not
relicensed here.
