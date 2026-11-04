# Design

## Context

See `proposal.md` for motivation and `specs/managed-pi/spec.md` for the behavior contract. The primary design references are the managed-pi section of `docs/spirits-design.md` and `docs/spirits-managed-pi.md`. Both predate this isolation change and describe the previous `~/.spirits/agent` behavior, so they are not the source of truth for the new safety rules; task 3.1 updates them. This design records the delta and the reasons, not a copy of the existing route description.

Current managed launch computes the child environment in `packages/spirits/src/managed-pi/environment.ts` and spawns after set verification. An explicit `SPIRITS_CODING_AGENT_DIR` wins; otherwise the existing `~/.spirits/agent` is used. There is no write-compatibility check, no isolation of the existing agent dir, and no pre-spawn rejection for unsafe paths.

The compiled wrapper calls `computeEnvDefaults` before it classifies `managed-pi`. When `SPIRITS_CODING_AGENT_DIR` is unset, that injection writes `~/.spirits/agent` into `process.env`. Passing the defaulted `process.env` to the managed command therefore makes an unset value indistinguishable from an explicit `~/.spirits/agent`, and Decision 2 would reject every default launch. The managed command receives an independent copy taken before the defaults instead (Decision 11); the normal route keeps using the defaulted `process.env`.

Pi 1.5.0 resolves the agent directory from the app-name-derived environment (here `SPIRITS_CODING_AGENT_DIR`), and the session directory from `SPIRITS_CODING_AGENT_SESSION_DIR`, `--session-dir`, or `settings.sessionDir`. CLI options also select sessions or export paths. The overlay sets `piConfig.name=spirits` and `configDir=.pi`, but inherited `PI_APP_NAME` / `PI_CONFIG_DIR` can still change identity resolution.

The managed root already holds `releases/` and `current`, and install/update/repair only touch release artifacts. The compatibility runner creates its own temp agent dir and must remain isolated; its isolation is not a product safety control.

The archived completion record lacks original result JSON/logs/CI evidence, and some checked items are contradicted by the audit rerun. The correction must preserve the archive and keep the distinction between “not supported by evidence” and “measured as not met”.

## Goals / Non-Goals

**Goals:**

- Make the managed route use one persistent, isolated agent dir and never the existing `~/.spirits/agent` during the experiment.
- Distinguish an unset agent dir from an explicit one through a pre-default environment copy, without changing the normal route defaults or the startup order.
- Fail closed before spawn on explicit paths, symlinks, containment, inherited environment, and path-bearing session arguments that could reach existing data.
- Keep the normal `spirits` route and `~/.spirits/agent` unchanged.
- Record the audit correction durably without rewriting the archived checkboxes.
- Keep the compatibility runner isolated with a minimal test-only adaptation.

**Non-Goals:**

- Fixing the compatibility runner’s probe, fake provider, rlm, data-write classification, or matrix.
- Changing rlm authentication inheritance, role/`/clear`/`/model`, or existing data migration.
- Production distribution, release assets, default-route switching, fork removal.
- OS-level sandboxing or restricting arbitrary file access from tools, extensions, `@file`, or absolute paths.

## Decisions

### 1. Fixed isolated agent dir: `<managed root>/agent`

Use `<managed root>/agent` as the single experimental agent dir. With the default root this is `~/.spirits/managed-pi/agent`. It persists across launches and updates, is owned by the managed route, and is distinct from both `~/.spirits/agent` and `~/.pi/agent`.

`install`, `update`, `repair`, and wrapper `help` do not create it. The first Pi launch that needs it (including managed `--help` and `--version`) resolves and creates it before spawn. This makes a path failure visible before Pi starts. The managed command receives the caller's pre-default environment (Decision 11), so the wrapper's own default injection is not mistaken for an explicit selection.

Alternatives:

- **`~/.spirits/managed-agent` outside the managed root**: simpler separation, but rollback by removing the managed root would leave agent data behind and create a second ownership boundary. Rejected.
- **A profile directory such as `agents/default`**: useful later, but this change has one experiment and no profile selection. Rejected for now.
- **Read-only use of the existing agent dir**: preserves data access but is not a write guard and requires Pi-level interception. Rejected.

撤回条件: a follow-up change that needs multiple experiment profiles or an OS sandbox can add profiles without changing the fixed default.

### 2. Explicit `SPIRITS_CODING_AGENT_DIR`: accept only the fixed path, otherwise reject

If `SPIRITS_CODING_AGENT_DIR` is set, normalize it and accept it only when its real path equals the resolved isolated agent dir. Any other value, including `~/.spirits/agent`, a relative path, a tilde path, or a path outside the managed root, fails before spawn. The comparison uses the caller's pre-default environment (Decision 11); the wrapper-injected normal default is not an explicit value. Explicit acceptance is evaluated after the path safety checks (Decision 3); a rejected value creates neither the isolated directory nor a child process.

Do not silently ignore a mismatched value. A user who set an explicit path expects it to be used; ignoring it could write to the wrong experimental location while hiding the mismatch. Do not add a force or warning-acknowledgement path.

Alternatives:

- **Ignore the explicit value and always use the fixed path**: simplest, but hides a configuration mistake. Rejected.
- **Allow any path under the managed root**: flexible, but creates an arbitrary “safe area” and more containment cases. Rejected; one fixed path is enough for the experiment.
- **Allow arbitrary paths**: directly violates the requirement that an arbitrary path is not a safe experiment area. Rejected.

撤回条件: a later change that defines a user-selected experiment profile can replace this with an explicit selector; it must not relax the existing-agent protection by default.

### 3. Path safety: canonical comparison, symlink rejection, real directory only

Resolve the canonical path of the isolated agent dir from the deepest existing ancestor plus the remaining path components. Compare it with the canonical existing agent dir and reject equality or containment in either direction. Reject if the isolated path is outside the managed root, if an existing component under the managed root is a symlink, if the agent path exists and is not a directory, or if the resolved agent dir escapes the managed root. Validate before creating anything; a failed check or a rejected explicit value leaves the filesystem unchanged.

Create a missing directory with mode `0700` and verify it is a real directory after creation. Check that the existing directory is owned by the current user when the platform exposes ownership. Do not follow a symlinked agent dir.

This is a pre-spawn path check, not an OS security boundary. A malicious concurrent process can still change the filesystem after the check; the design does not claim sandbox protection.

Alternatives:

- **Lexical comparison only**: misses symlink and `..` resolution. Rejected.
- **No path checks; rely on a fixed path**: still allows a symlinked managed root or agent dir to reach the existing data. Rejected.
- **Mount namespace / chroot sandbox**: stronger, but outside this change and not portable with the current single-binary route. Deferred.

撤回条件: if a future change adds OS-level isolation, the path checks can remain as early diagnostics.

### 4. Inherited environment: pin identity and session storage, preserve credentials

The child environment is computed from an explicitly resolved agent dir, not from the caller’s agent-dir variables. Set:

- `SPIRITS_CODING_AGENT_DIR=<managed root>/agent`
- `SPIRITS_CODING_AGENT_SESSION_DIR=<managed root>/agent/sessions`
- `PI_APP_NAME=spirits`
- `PI_CONFIG_DIR=.pi`
- `PI_PACKAGE_DIR=<current set>/pi`
- `PI_SKIP_VERSION_CHECK=1` (constant; a caller value is overridden, matching the compiled route)
- `PI_TELEMETRY=0` only when the caller did not set it; an explicit value is preserved

Remove `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR`. Preserve API keys, proxy variables, provider configuration, and other unrelated variables. The session dir is pinned by environment so an inherited or project `settings.sessionDir` cannot redirect storage outside the isolated area. These two keep the normal route's update-check and telemetry policy; this change does not alter either policy.

Alternatives:

- **Set only `SPIRITS_CODING_AGENT_DIR`**: leaves session-dir and identity overrides open. Rejected.
- **Delete every `PI_*` variable**: breaks provider configuration and violates the existing environment-preservation requirement. Rejected.
- **Rely only on the overlay `piConfig`**: inherited `PI_APP_NAME` / `PI_CONFIG_DIR` can still override identity. Rejected.

撤回条件: if Pi removes the app-name-derived env names, replace the sanitize list with the equivalent supported selector.

### 5. Reject path-bearing session options before spawn

For managed launch, reject `--session`, `--fork`, `--session-dir`, and `--export` when they appear in the forwarded arguments. These can select an existing session file or a storage directory outside the isolated agent dir. Allow `--continue`, `--resume`, `--session-id`, and `--no-session`; their lookup/storage is bounded by the pinned session dir.

Reject before spawn with the option name and a safe alternative. Do not rewrite the user’s arguments silently. The guarantee covers these known Pi path selectors, not arbitrary file paths passed to tools or extensions.

Alternatives:

- **Pass all arguments through**: preserves full Pi CLI compatibility but allows a direct bypass. Rejected.
- **Parse and allow `--session` when the value is an ID**: more compatible, but path-vs-ID resolution happens inside Pi. Rejected for the first safety change.
- **Rewrite `--session-dir` to the isolated dir**: hides a user’s explicit intent and can change session identity. Rejected.

撤回条件: a later change can allow `--session` IDs after resolving them against the isolated session store before spawn.

### 6. Command-specific side effects

| Command | Existing agent dir | Isolated agent dir | Managed root |
|---|---|---|---|
| `install` / `update` / `repair` | no access | not created | release files only |
| wrapper `help` | no access | not created | no change |
| `managed-pi --help` / `--version` | no access/change | resolved and created before spawn | no release change |
| normal `managed-pi` launch | no access/change | resolved and created before spawn | no release change |

The isolated directory is created only on the Pi launch path. This lets path errors stop the launch before Pi can create or write anything.

Alternatives:

- **Create the isolated dir during install**: catches permission errors earlier, but makes install responsible for user data. Rejected.
- **Let Pi create it on first write**: simpler, but path and symlink failures surface after spawn and after Pi has started. Rejected.

撤回条件: if install needs to validate the agent location ahead of time, add a read-only preflight without creating the directory.

### 7. Compatibility runner: minimal test-only adaptation, not a product bypass

`computeManagedEnv` takes an already resolved agent dir. `launchManagedPi` resolves the product path and performs the safety checks. The compatibility runner continues to use its own temporary agent dir by passing that resolved path to `computeManagedEnv`; it does not gain a user-facing force switch. The runner’s existing isolation remains a test property, not evidence that the product route is protected.

This keeps the runner from writing into an external `--artifact-root` while avoiding a broad runner rewrite.

Alternatives:

- **Make the runner use `<artifact-root>/agent`**: writes into the measured managed root and breaks the runner’s read-only boundary. Rejected.
- **Copy the managed set into a temporary HOME**: preserves product behavior but adds a large, slow runner change outside this scope. Rejected.
- **Add a launch force option for tests**: would create a product bypass. Rejected.

撤回条件: when the runner is repaired, it can move to a temporary managed root that uses the product path resolver end to end.

### 8. Completion correction record: additive archive file plus pointer

Add `openspec/changes/archive/2026-11-03-add-managed-pi-route/completion-correction.md`. Do not change existing checkboxes or delete the original proposal/design/spec/tasks. Append a short “完了記録の訂正” section to the archived `tasks.md` that links to the correction record. Link the correction record from `docs/spirits-managed-pi.md` as well.

The record has four sections:

1. **今回の再実行で確認できたこと**: commands, environment, Pi/bundle identifiers, observed results.
2. **以前の完了チェックを裏付けられないこと**: missing result JSON/logs/CI/release/validate; tasks that cannot be supported.
3. **実測で未達と判明したこと**: safety gap, runner probe/fake-provider/rlm/data/matrix discrepancies.
4. **後続 change で対応すること**: runner repair, rlm, role/clear/model, data compatibility, release/default switch.

State that the original execution may have happened; missing evidence alone is not proof that it did not. Where the current rerun contradicts a checked item, name the contradiction explicitly. Record which source files were read and which referenced evidence was absent. The raw audit files in `/tmp` are not permanent; the record stores the reproducible commands and observed summaries, not a claim that the original logs exist.

This change does not prove read/write compatibility. Switching the default route, or continuing existing data without manual steps, requires a separate change that proves both directions. This change records the gap in the correction record and does not change the compatibility runner's classification.

Alternatives:

- **Rewrite the archived tasks/checkboxes**: destroys the historical record. Rejected.
- **Put the correction only in a new docs directory**: discoverability from the archive is weaker. Rejected.
- **Create a separate OpenSpec change for the correction only**: splits one audit response across changes and leaves the archive pointing nowhere. Rejected.

撤回条件: if the project later adopts a standard verification-evidence location, move the correction record there and keep a link.

### 9. Module boundary and tests

Keep the new path resolver inside `packages/spirits/src/managed-pi/`; the existing `spirits:managed-pi` layer already covers it. No registry or new dependency is needed. Unit-test the resolver and argument guard with temporary HOME, managed root, and sentinel files; process-level tests use `launchManagedPi` with a spawn seam and assert the child environment and unchanged existing agent dir. Bootstrap wiring is covered by `test/managed-pi-bootstrap.test.ts`, which runs the same hand-off function the wrapper calls (`runManagedStartup`) with a fixture managed set. The test asserts that the pre-default snapshot is a copy, that applying `computeEnvDefaults` to the later environment does not leak into the snapshot, and that the defaulted environment is rejected while the snapshot is accepted. No test uses the real home or a real provider.

Alternatives:

- **Put path logic in `bin/bootstrap.ts`**: makes startup wiring responsible for testable path semantics. Rejected; `bin` should only classify and delegate.
- **Add a new layer**: unnecessary; the existing managed-pi layer owns this behavior.

撤回条件: if the resolver is reused by another route, move only the shared primitive.

### 10. Rejection message and safe experiment start

A rejected path or argument prints the fixed isolated agent dir, the rejected value or option, the reason, and the fact that the existing agent dir was not changed. It must not fall back to the default `spirits` route.

| Rejection case | Reason shown |
|---|---|
| equality with or containment of the existing agent dir | `existing agent directory containment` |
| symlink in the isolated path | `symlink in the managed agent path` |
| path outside the managed root | `outside the managed root` |
| existing non-directory | `not a directory` |
| explicit value other than the fixed path | `explicit agent directory is not the managed agent directory` |
| path-bearing session option | `unsupported managed-pi argument` plus the option name |

Every rejection also shows the fixed isolated agent dir, the rejected value or option, that the existing agent dir was not changed, and the safe start: leave `SPIRITS_CODING_AGENT_DIR` unset (or set it to the fixed path), run `spirits managed-pi install`, then `spirits managed-pi`; existing data stays available through the normal `spirits` command. To reset the experiment, remove `~/.spirits/managed-pi/agent` or the whole managed root after exiting; this does not remove `~/.spirits/agent`. Rejections create neither the isolated directory nor a child process.

Alternatives:

- **Auto-fallback to the default route**: convenient, but hides a failed safety check and can write existing data. Rejected.
- **Generic “permission denied”**: short, but does not tell the user whether the existing data was touched or how to start safely. Rejected.
- **Print the full command line and paths only in debug mode**: insufficient for a fail-closed safety message. Rejected.

撤回条件: if the route gains a safe profile selector, the message can name the selected profile instead of the fixed path.

### 11. Bootstrap hand-off: pre-default environment snapshot

`bin/bootstrap.ts` takes an independent copy of `process.env` before `applyEnvDefaults()` (`snapshotEnv`) and passes only that copy to the managed command. The normal route continues with the defaulted `process.env`. Classification, gate order, version handling, and the default application keep their current order. A small `bin/startup.ts` helper exposes the hand-off (`runManagedStartup`) so the test runs the same function the wrapper calls; it copies the snapshot again, forwards the classified action, IO, and a test-only spawn seam to `runManagedCommand`/`launchManagedPi`. The copy holds only the caller's keys and values; it is never printed, logged, or written to an artifact.

Alternatives:

- **Pass `process.env` after defaults**: the current behavior; it makes every default launch look like an explicit `~/.spirits/agent` and contradicts Decision 2. Rejected.
- **Skip the agent-dir default for the managed branch only**: works for the default case, but spreads route conditionals into `computeEnvDefaults` and still cannot tell an explicit value from an injected one if the order changes. Rejected.
- **Treat the injected default path as unset**: no wrapper change, but an explicit `~/.spirits/agent` becomes indistinguishable from unset and the rejection in Decision 2 cannot be observed. Rejected.

対価: one shallow object copy per process start. The managed layer must carry the agent dir explicitly (Decision 4), which removes the ambiguity between the normal route default and the managed isolation boundary. No shared abstraction or new layer is added; `bin` keeps only classification and delegation.

Alternatives for the helper location:

- **Keep the hand-off inside `bootstrap.ts`**: no new file, but the script runs top-level side effects, so the test cannot import the hand-off without executing the wrapper. Rejected.
- **Put the hand-off in `src/managed-pi/command.ts`**: makes the product layer own startup wiring and cannot test the pre-default snapshot at the bin boundary. Rejected.

撤回条件: if the default injection moves after route classification (or into the managed layer), the snapshot can be replaced with the classified caller env directly.

## Risks / Trade-offs

- [Risk] Path checks are TOCTOU-prone and are not an OS sandbox → Mitigation: resolve before spawn, reject symlinks/containment, create 0700, test the known bypasses, and document that arbitrary tool/file access is not contained.
- [Risk] The snapshot is accidentally replaced by the mutated `process.env` → Mitigation: the helper copies, the bootstrap test asserts the snapshot has no agent-dir key after defaults are computed, and the same test asserts the defaulted env is rejected.
- [Risk] Existing managed users lose access to their existing auth/settings in the experimental route → Mitigation: fail with a clear message, keep the default `spirits` route unchanged, provide no automatic copy, and document the isolated-dir startup path.
- [Risk] Rejecting `--session` and `--fork` reduces Pi CLI compatibility → Mitigation: allow `--continue`, `--resume`, and `--session-id` within the isolated session dir; defer ID-based `--session` support.
- [Risk] Inherited variables other than the handled list can still affect Pi → Mitigation: pin identity, package, agent, and session selectors; test `PI_APP_NAME`, `PI_CONFIG_DIR`, old/new session variables; document the boundary.
- [Risk] The compatibility runner breaks when `computeManagedEnv` changes → Mitigation: pass the runner’s temp agent dir explicitly and keep the runner’s test isolation; do not add a product force switch.
- [Risk] The correction record is mistaken for a rewrite of history → Mitigation: additive file, unchanged checkboxes, explicit “unsupported by evidence” vs “measured as not met” wording.
- [Risk] Tests accidentally touch the real home → Mitigation: inject temporary HOME and managed root, assert sentinel files and timestamps, and never call the real default paths.
- [Risk] The old managed-pi spec conflicts with the new behavior → Mitigation: MODIFIED delta replaces the existing-agent requirement with experiment isolation and records the future compatibility requirement in the proposal/design.

## Migration Plan

1. Land the path resolver, environment sanitize, launch guard, and argument guard behind the existing explicit `managed-pi` route.
2. Update tests and docs, including the bootstrap hand-off test and the limited `bin/` wiring (snapshot before defaults; normal route unchanged). The normal `spirits` route, `spirits update`, install.sh, and `~/.spirits/agent` stay unchanged.
3. Add the archive correction record and pointer; do not rewrite the original checkboxes.
4. Validate with OpenSpec, run the relevant Bun tests, and run the repository checks. Do not publish, merge, switch the default route, or fix the compatibility runner beyond the minimal environment adaptation.
5. Existing managed users start with an empty `~/.spirits/managed-pi/agent`. Existing data remains available only through the normal `spirits` route. No automatic copy or migration is performed. Switching the default route or continuing existing data without manual steps requires a separate change that proves read/write compatibility; this change only records the gap.
6. Rollback: revert the code changes; the isolated agent dir remains separate and can be removed independently. Removing `~/.spirits/managed-pi` removes the experimental route and its isolated data, not the default data.

## Open Questions

- Whether a later change should support multiple named experiment profiles under the managed root.
- Whether a later change should allow read-only import of selected existing data after write compatibility is proven.
- Whether a later change should add OS-level isolation or a sandboxed tool boundary.
- Where to retain compatibility result JSON/logs permanently; this change records commands and observed results in the correction record but does not add a new CI artifact store.