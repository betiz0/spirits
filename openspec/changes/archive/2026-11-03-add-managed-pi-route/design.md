# Design

## Context

See `proposal.md` for the motivation and the evidence classification. This design only fixes how the experimental route is built and measured.

Current constraints that shape the approach:

- `packages/spirits/bin/spirits.ts` is the compiled entry. `bin/bootstrap.ts` sets identity and env defaults before pi is imported, then `spirits.ts` calls pi's `main()` with the spirits extension as a builtin.
- The default distribution is a single compiled binary plus `theme/` from `scripts/build-binaries.ts`; `scripts/install.sh` and `src/update/` own its install and self-update. The default route must keep working without the new route.
- `packages/spirits/src/index.ts` registers the extension. `src/routing/register.ts` currently calls `pi.registerModelRoles()` unconditionally, which is the confirmed load blocker on official Pi 1.5.0.
- The lab confirmed that the official compiled Pi v1.5.0 contains Bun 1.4.4, that a prebundled extension loads through the host module alias, and that source `with { type: "text" }` does not produce raw Markdown. It did not execute a real tsrepl cell, rlm child, `/clear`, `/model ... role`, role badge, update, header, or existing-data write.
- `docs/spirits-design.md` §4.5 and `docs/spirits-m2-distribution.md` are the primary distribution references. This design does not change the default path described there.
- Pi's `piConfig.name` rebrand mechanism changes `APP_NAME`, derived env names, help banner, and package assets. `PI_PACKAGE_DIR` overrides the package dir independently of that mechanism and must not leak in.

## Goals / Non-Goals

**Goals:**

- Provide one explicit experimental route that uses a pinned official Pi artifact plus a prebundled spirits extension, without changing the default route.
- Make the artifact, extension bundle, assets, and patch/overlay state a single verified set.
- Measure real behavior, not just extension load, and leave a machine-readable compatibility result.
- Keep the existing `~/.spirits/agent` usable without manual migration.
- Keep the new route's failures visible and non-fallback.

**Non-Goals:**

- Switching the default launch path, deleting the fork, or removing any Pi core diff.
- Completing alternatives for role, `/clear`, and `/model`; this change only records their purpose, status, and alternatives.
- Rebuilding the existing `spirits update` or install.sh pipeline.
- Guaranteeing bidirectional data compatibility or destructive-conversion safety.
- Supporting macOS, Windows, or musl.
- Running real provider calls in CI.
- Adding a limited Pi patch unless the compatibility result makes it necessary in a follow-up change.

## Decisions

### 1. Command surface: a `managed-pi` subcommand, not a flag or env switch

Add:

```text
spirits managed-pi install [--version <pi-version>]
spirits managed-pi update
spirits managed-pi repair
spirits managed-pi help
spirits managed-pi [--] [pi args...]
```

`install`, `update`, `repair`, `help`, and the default launch are classified in `bin/bootstrap.ts` before pi is imported. Every other invocation keeps the existing route. The launch form passes all arguments after the subcommand, including `--`, to the managed Pi. `repair` re-installs the manifest of the current set; `help` prints the wrapper help without starting Pi.

Alternatives:

- **A flag such as `spirits --managed-pi`**: collides with Pi's own option parsing and can be mistaken for a Pi option. Rejected because the route must be an explicit command, not an ambiguous flag.
- **An environment variable**: easy to leak across shells and invisible in the command line. Rejected because a failed route must be attributable from the invocation.
- **`spirits pi`**: reads like the normal Pi route and is not obviously experimental. Rejected because the default route is itself Pi.

The normal `spirits` and `spirits update` behavior stays unchanged; the new classification only activates on the exact `managed-pi` subcommand.

撤回条件: Pi 側が将来 `managed-pi` と同名のサブコマンドを追加したら、分類名を変更する。

### 2. Artifact source: official compiled Pi, pinned per manifest

Use the official compiled Pi release artifact (Linux x64) as the dedicated Pi. The first supported set is Pi `v1.5.0` with the SHA256 already verified in the lab. A generated manifest pins:

- Pi version and platform;
- official artifact URL and SHA256;
- spirits extension bundle version and SHA256;
- managed overlay (package metadata/config) version and SHA256;
- asset inventory and overlay identifiers. Patch identifiers are added only when a follow-up change introduces a limited Pi patch; this change records none.

Alternatives:

- **Build Pi ourselves**: gives control over `piConfig` and any patch, but reintroduces the build/merge cost this effort is trying to measure. Rejected for the first experiment.
- **Official npm managed install**: needs Node/npm and does not provide the Bun compiled runtime that tsrepl needs. Rejected because the lab confirmed the Node path is not a viable tsrepl host.
- **Use the system Pi**: makes the result depend on the machine and violates the explicit-route requirement. Rejected.
- **Pin the set in code instead of shipping a manifest**: removes one release asset and the manifest fetch, but the update requirement needs a new set without a new binary. Rejected because the compatibility spec requires `managed-pi update` to fetch and verify a new set.

The official artifact is not modified in place. After checksum verification, the installer extracts it into a managed release directory and writes a small overlay `package.json` with `piConfig.name=spirits` and `piConfig.configDir=.pi`. The manifest keeps the original artifact checksum and records the overlay separately, so "official artifact unchanged" and "managed metadata changed" stay distinguishable.

撤回条件: Pi の release artifact が複数プラットフォームを単一の tarball で配る形に変わったら、manifest の platform 欄と展開手順を見直す。

### 3. Managed layout and atomic update

Use a separate root, for example `~/.spirits/managed-pi/`:

```text
releases/<set-id>/pi/...
releases/<set-id>/pi/package.json          # official package with the spirits overlay
releases/<set-id>/spirits-extension.js
releases/<set-id>/manifest.json
releases/<set-id>/installed.json           # executable/bundle/overlay digests for launch
current -> releases/<set-id>
```

`install` downloads into a temporary directory under the same root, verifies all checksums, extracts, writes the overlay over `pi/package.json`, writes the manifest and the installed digests, renames the release directory into place, then atomically replaces the `current` symlink by rename. `update` does the same for a new set and only switches `current` after the new set is complete. A failed update leaves `current` pointing at the previous set. A failed install removes only its temporary directory.

The managed root is deliberately not `~/.spirits/bin` and not `~/.spirits/agent`, so the default binary, themes, and agent data are not replaced by the experiment.

Alternatives:

- **Overwrite a single managed directory in place**: simpler but loses the previous working set on a partial update. Rejected because the spec requires the previous set to stay startable.
- **Version the directory but keep `current` as a text file**: requires a read-modify-write and is less atomic than a symlink rename. Rejected because Linux x64 is the only target and symlink rename is atomic there.
- **Put the managed Pi under `~/.spirits/agent`**: mixes executable artifacts with mutable user data and makes cleanup ambiguous. Rejected.

撤回条件: 単一 set だけを扱う前提が崩れ、複数 set の並存が不要になったら、releases/current の二段構造をやめて単一ディレクトリに戻す。

### 4. Extension bundle delivery: release asset generated at build time

`scripts/build-managed-pi-inputs.ts` (name may change in implementation) builds `packages/spirits/src/index.ts` as an ESM bundle with:

- `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox` kept external;
- text assets (Markdown) inlined as strings;
- no `node_modules` copy of the host packages.

The release workflow attaches the bundle and the manifest next to the existing `spirits-linux-x64` assets. The existing artifacts and default install path are unchanged. The installer fetches the bundle from the same release set as the manifest.

撤回条件: リリース資産の数が運用上問題になったら、compiled spirits binary への埋め込み(下記の Deferred 案)へ切り替える。

Alternatives:

- **Load the TypeScript source through Pi's jiti loader**: confirmed not to preserve raw Markdown. Rejected.
- **Build the bundle on the user's machine**: needs Bun and a source checkout; the product promise is that users do not manage Bun. Rejected.
- **Embed the bundle in the compiled spirits binary and extract it**: removes one release asset but requires a reliable embedded-file extraction path and makes the experimental bundle inseparable from the default binary release. Deferred; not chosen for the first experiment.

### 5. Launch environment: absolute path, explicit env sanitization, no implicit fallback

The launch does not use `Bun.which` or PATH for `pi`. It spawns `<managed-root>/current/pi/pi` with inherited stdio and forwards the exit code. The wrapper sets:

- `SPIRITS_CODING_AGENT_DIR`: keep an explicit value; otherwise `~/.spirits/agent`.
- `PI_PACKAGE_DIR`: set to `<managed-root>/current/pi` so the managed `package.json` and assets are used.
- `PI_CODING_AGENT_DIR`: remove it from the child environment so the old name cannot select a different agent dir.
- `PI_SKIP_VERSION_CHECK` and `PI_TELEMETRY`: apply the same defaults as the existing compiled route when the caller has not set them (`1` and `0`).
- Keep all other inherited variables, including API keys, proxy variables, and provider configuration.

Before spawning, the wrapper verifies the manifest and the current set. Missing, corrupt, unsupported, or checksum-mismatched sets produce a non-zero exit with the install/repair command. No code path falls back to the default compiled binary or to `pi`.

Platform support is checked against `MANAGED_PI_PLATFORM` before spawn. A managed root copied from another architecture is rejected with the same explicit reason instead of failing as a generic spawn error.

Alternatives:

- **`execve` the managed Pi**: removes the wrapper process and simplifies signal handling, but makes pre-spawn cleanup and test injection harder. Rejected for the first experiment; `Bun.spawn` with inherited stdio and exit propagation is enough.
- **Delete every `PI_*` variable**: would break API keys and provider behavior. Rejected; only the variables with a known conflict are changed.
- **Let `PI_PACKAGE_DIR` pass through**: the lab showed a decoy package can change app name and version. Rejected.

撤回条件: 公式 Pi が `PI_PACKAGE_DIR` を廃止するか、identity を別の仕組みで固定できるようになったら、この sanitize を外す。

### 6. Identity: managed `piConfig` plus wrapper, not a core patch

The overlay `package.json` sets `piConfig.name=spirits` and keeps `configDir=.pi`. This gives `SPIRITS_CODING_AGENT_DIR` and the spirits help banner without a Pi core diff. The wrapper still sets the default agent dir because official Pi defaults to `$HOME/.pi/agent`, not `~/.spirits/agent`.

This change does not make help/update text fully spirits-specific. The compatibility report records remaining pi wording as a known gap. A later change can decide between a wrapper help replacement and a limited core patch.

Alternatives:

- **Keep `PI_APP_NAME` in Pi core**: preserves the current fork behavior but adds a core diff to the experiment. Rejected for this change.
- **Wrapper-only rename of `SPIRITS_CODING_AGENT_DIR` to `PI_CODING_AGENT_DIR`**: keeps the default path but leaves the app name as pi. Rejected because identity is part of the experiment.
- **Core patch for all help/update text**: highest fidelity but adds the merge cost being evaluated. Deferred.

撤回条件: overlay の `piConfig` だけでなく help/update の文言も overlay で差し替え可能になったら、wrapper 側の処理を削る。

### 7. Missing-API compatibility: capability detection in the extension, not a silent no-op shim

`registerDualModelRouting` checks for the optional host API before using it. If the API exists, the existing registration path is unchanged. If it is missing, the extension:

- registers the virtual model and keeps the skill-driven strong phase and settings-based default role;
- skips only the missing role registration;
- avoids relying on a host-side role field or footer badge;
- emits a one-time startup notice listing the degraded features.

The extension-side detection and notice are implemented. Exposing the measured state in the compatibility report and overriding the matrix row with it is tracked as task 11.10; until then the matrix is static and must not be read as a measurement.

The extension remains loadable, so `tsrepl`, TODO, and harness tools can be measured. The official Pi route must not pretend that `/model ... role`, default-role saving, and the badge work.

Alternatives:

- **Patch the host object with a no-op `registerModelRoles` in the wrapper**: proven to make the bundle load in the lab, but hides the missing capability and would apply to any extension. Rejected for the product route; it remains acceptable as a test-only probe if needed.
- **Maintain a separate managed-only extension build**: avoids touching the default route, but duplicates routing registration and quickly drifts. Rejected because capability detection is small and keeps one source.
- **Add a minimal Pi patch now**: preserves the current role surface, but adds a core diff before the compatibility result exists. Deferred to a follow-up decision.

撤回条件: 公式 Pi が role 相当の API を公開したら、capability detection を削除して既存経路に一本化する。

### 8. Compatibility harness: two layers, isolated fixtures, real execution

Build a test runner under `scripts/managed-pi-compat/` with two layers.

**Layer 1: process and registration checks.** Launch the managed Pi in RPC mode with the prebundled spirits extension and a fixture probe extension. Use `get_state` / tool inventory after `session_start`, not `--help`, to decide load success. Check identity, agent dir precedence, `PI_PACKAGE_DIR` decoy resistance, `--help` side effects, and raw Markdown output.

**Layer 2: real function checks.** The probe extension wraps `pi.registerTool` at load time and captures the registered `tsrepl` definition. A probe command invokes the captured definition with a minimal `ExtensionToolContext` so a real cell runs through `Bun.Transpiler` and `node:vm` inside the official Pi process. For `tool()` calls, the probe supplies an `executeTool` that dispatches to captured definitions, and records that this bypasses Pi's permission/hook path. A second fake-provider test uses a local OpenAI-compatible endpoint and a fixture custom-provider extension to run one full model-to-`tsrepl` tool call without real credentials.

`rlm` uses the fake-provider layer. Physical-model and `spirits/auto` cases are separate. The child `rlm_usage`, abort behavior, and virtual-model resolution are recorded; a `spirits/auto` failure is a known limitation, not a test pass.

The runner writes a machine-readable result (for example JSON) with `confirmed`, `limited`, `unavailable`, `not-run`, and `failed` states. It never treats a skipped or unexecuted item as success.

Implementation status after verify2: the runner skeleton, local tsrepl probe, fake-provider transport, artifact load on the managed route, and result states are implemented. The process-level wiring of identity/environment, tool-inventory load classification, raw Markdown write-out, host-version observation, rlm, and data read/write items is still pending and tracked as tasks 11.1-11.10. Those items must be `not-run` in the result JSON until the wiring exists; a local runner-process check is not evidence of the managed Pi.

Alternatives:

- **Only use `--help` and tool registration**: cheap but cannot distinguish load from execution. Rejected because the proposal explicitly separates them.
- **Only use a fake LLM provider**: end-to-end but slow and brittle for every check. Rejected as the only layer; used for one acceptance path.
- **Run a real provider in CI**: gives the most realistic rlm test but adds credentials and cost. Rejected and out of scope for this change; real-provider tests would be a separate change.

撤回条件: 実 provider の互換性が製品判断に必要になったら、別 change で opt-in の要件とランナーを追加する。

### 9. Data: use the existing agent dir, test read compatibility on a copy, do not migrate

The managed route defaults to `~/.spirits/agent`. It does not create a new data directory, copy the old one, or rewrite files on first launch. The compatibility suite copies a redacted fixture of an existing agent dir into a temporary location and verifies that settings, auth, sessions, and external extensions can be read. Write-back compatibility is a separate result and is not claimed as success.

If an operation would require a destructive conversion (for example, a format the managed Pi cannot represent without rewriting), the compatibility suite records it as an aborted operation and leaves the fixture unchanged. The launch wrapper itself does not write user data and has no interception point for Pi's internal settings/session saves, so a product-level abort before Pi writes is deferred to a follow-up change. This change does not define a migration format and must not claim write compatibility.

Alternatives:

- **Create `~/.spirits/managed-agent`**: isolates the experiment but violates the no-manual-migration requirement and hides real compatibility. Rejected.
- **Auto-migrate on first launch**: makes the experiment convenient but risks old-version compatibility. Rejected; bidirectional compatibility was not approved.
- **Use a copy of the data for the experimental route**: safe for testing but not the user's real data. Rejected as the default; copies remain test-only.

撤回条件: 書き込み互換が確認でき、移行が安全だと分かったら、読み取り専用の制限を外す。

### 10. Role, `/clear`, and `/model`: preserve purposes, record differences, implement later

This change does not remove the existing capabilities. The default route keeps the current behavior. The managed route may be limited; the compatibility report must state which purpose is met and which is not.

| Feature | Purpose to preserve | Current mechanism | Managed route status in this change | Alternatives / differences |
|---|---|---|---|---|
| role routing | Automatically send review/deep-verify work to strong and everything else to normal while the user keeps one selection | `spirits/auto` virtual model, skill input phase, `models.strong`, `models.role`, role field on the route, footer badge | Virtual routing and skill-driven strong phase can work; `/model ... role`, default-role save, route role field, and badge are unavailable or unverified | Extension command plus own status line, or a limited Pi patch. Differences: command name, saved key, badge placement, session record format. |
| role lock | Let a user pin normal or strong without changing the model, and carry it across runs | `/model` role suffix and role registration | Missing without the host API; the default route is unchanged | `/spirits-role` or settings-only lock. Difference: explicit new command and no `/model` suffix. |
| role visibility | Show which role handled the last request | Core footer badge reading the route role | Not available; report as limited/unavailable | Extension status line/footer overlay. Difference: placement and persistence; must not claim the core badge exists. |
| `/clear` | Remove the conversation from LLM context and display while keeping the session file/ID, model, thinking level, TODO, and prior history in `/tree` | Core `clearConversation()` and `/clear` | Unverified/unavailable; `ctx.newSession()` creates a new session file/ID and is not equivalent | Limited Pi patch, or a redefined "start a new session" command. Difference: same-ID/history behavior is lost in the latter. |
| `/model` level | Choose a model and thinking level in one line and optionally save defaults | Core `/model` parser and save key | Base model/thinking behavior is expected to work; save-key semantics need verification | Extension command plus own save path. Difference: command surface, completion/hint, and settings key ownership. |
| `/model` role suffix | Combine model, thinking level, and role selection in one line and optionally save the default role | Core parser, role vocabulary, settings save | Missing without the host API; report the item | Keep a limited patch, or split role selection into an extension command. Difference: UX and saved key. |

For each row, this change implements only the capability detection and reporting needed for the managed route. The actual alternative or patch is a follow-up change. This is not approval to delete the purpose: the default route remains, and the report must name the gap.

Alternatives for the overall approach:

- **Implement all alternatives in this change**: gives a usable managed route sooner, but mixes the experiment with product behavior changes and makes the compatibility result harder to interpret. Rejected.
- **Do not load the managed extension until role/clear/model are solved**: avoids a degraded route, but prevents measuring tsrepl and rlm now. Rejected because measurement is the purpose of this change.
- **Patch Pi now to keep the current surface**: highest short-term fidelity, but assumes the answer before the experiment. Deferred.

撤回条件: 互換性マトリクスで代替案が十分と分かったら、後続 change で代替実装に進み、この表を履歴に置き換える。

### 11. Tests and CI boundaries

- Unit tests for the manifest, checksum, layout, atomic switch, env computation, and argument classification run under `packages/spirits` with `bun test`.
- Process tests use a local fixture server and a temporary managed root. They never read real `~/.spirits`, `~/.pi`, or a real provider.
- This change adds no real-provider tests. The runner uses only auth-free routes and a local fake provider, makes no external inference request, and never reports a fake-provider success as real-provider compatibility. Opt-in real-provider tests are a separate change.
- The compatibility runner is a script, not a new test framework. It emits a result file and a short human-readable summary.

Alternatives:

- **Put everything in `bun test`**: simple, but process-level tests with the official artifact are slow and need a fixture root. Rejected for all layers; unit tests stay in `bun test`.
- **Use the real GitHub release in tests**: tests the real network path but is flaky and cannot run offline. Rejected; fixtures mirror the manifest shape.

撤回条件: release 資産の取得経路そのものを検証する必要が出たら、別 change でネットワークを使う opt-in テストを追加する。

### 12. Reuse from `src/update`: unit of reuse, not a shared update framework

`src/update/` already has streamed SHA256 download, temporary-directory cleanup, and single-file placement. The managed route needs the first two and not the third. Reuse is fixed per function so the default self-update does not become coupled to the experiment.

**Used as-is:**

- `resolveIdleTimeoutMs` (timeout.ts) for the request idle timeout.
- `guardTempDir`, `parseTempDirPid`, and `cleanStaleTempDirs` (cleanup.ts), with the temporary directory under the managed root and the existing `.spirits-tmp-<pid>` naming.
- `resolveLatestStableRelease`, `releaseArtifactUrl`, and `resolveReleaseBaseUrl` (release.ts) to resolve the manifest and bundle from the same `spirits-v*` release. Task 11.16 closes the verify2 deviation by keeping these three functions as an explicit reuse contract: the manifest and extension bundle must come from the same release tag, the functions already implement the fixture-overridable GitHub release contract, and duplicating the release-list parser in `src/managed-pi/` would create a second source of truth for a value that must stay equal. `src/managed-pi/` still owns manifest fetch/validation, the release layout, and the switch; only release discovery and URL assembly are reused.

**Changed function and its contract:**

- `downloadVerifiedArtifact` (download.ts) keeps its current options and behavior: fetch a `sha256sum`-style checksum URL, stream the artifact, verify, and remove the partial file on mismatch. The stream-hash-and-remove behavior moves into a function that takes the expected digest directly. The manifest path calls the new function with the digest it read from the manifest; the checksum-URL path delegates to it. Existing callers and `test/update-download.test.ts` stay unchanged.

**Stays in `src/managed-pi/`:**

- the `releases/<set-id>/` layout and the `current` symlink switch;
- the multi-artifact verification loop, overlay write, and manifest parse/verify;
- environment computation, argument classification, and launch.

**Deliberately not reused:**

- `apply.ts` (`applyVerifiedBinary`, `applyVerifiedThemeAssets`). They place one file by rename. A managed set switches a whole directory and a symlink, so the atomicity unit differs. Forcing the set switch through the single-file helper would mix two units and make rollback unclear. `src/managed-pi/` writes its own switch and shares only the primitives above.

Alternatives:

- **Copy the download and cleanup code into `src/managed-pi/`**: no dependency on `update`, but duplicates a verified hash path and risks the ARCH-DUP ratchet. Rejected because the behavior is identical and only the checksum source differs.
- **Build a generic update framework in a new shared module**: removes every difference, but turns two callers into a framework and adds a third seam. Rejected; the reuse unit is per function.

撤回条件: 共通化が 3 つ目の呼び出し元を必要としたら、その部分だけ shared へ移す。逆に `managed-pi` が `update` の他の資産(自己更新全体、ダウンロード後の配置、テーマ更新)へ依存し始めたら、managed-pi 内へ戻す。リリース解決と URL 組み立ては、manifest と bundle を同じ release から取る契約のために例外的に再利用し、上記のとおりタスク 11.16 で見直す。

Regression:

- `test/update-*.test.ts` pass unchanged.
- A test pins that the digest-taking download function removes the partial file on mismatch, so the self-update path keeps its cleanup behavior.

### 13. Module boundary: `src/managed-pi/` is its own registry layer

`packages/spirits/src/managed-pi/` is registered in `docs/architecture/convention-registry.md` as the `spirits:managed-pi` layer. Its allowed dependencies are `spirits:shared`, the reused parts of `spirits:update`, and bare Pi imports; `spirits:bin` gains `spirits:managed-pi` so the entry can classify and launch the route.

Alternatives:

- **Put the code under `src/update/`**: adds no layer, but mixes the experimental route into the default self-update layer and makes the module reachable from the default path. Rejected because the default route must stay independent.
- **Put the code under `bin/`**: no new layer, but `bin` is startup wiring and the manifest, layout, and env logic would be untested unit code. Rejected.
- **Add the directory without a registry entry**: simplest edit, but `ARCH-LAYER-UNKNOWN` fails the repository check. Rejected.

対価: one new layer row and one member row plus the `bin` allow-list entry. In exchange the experimental route cannot be imported by `repl`, `rlm`, `harness`, `todo`, or `routing`, and `bin` only gains the classification entry point.

撤回条件: a follow-up change that retires the experimental route removes the layer entry and the directory together.

## Risks / Trade-offs

- [Risk] The official Pi artifact changes its package layout or stops shipping the Bun runtime → Mitigation: pin the Pi version and SHA256 in the manifest, fail closed on mismatch, and keep the default route independent.
- [Risk] The extension bundle accidentally includes a second Pi SDK → Mitigation: keep host packages external, assert the host version at load, and include an rlm same-host check.
- [Risk] The managed route writes to the existing `~/.spirits/agent` in a way an older spirits cannot read → Mitigation: no automatic migration, read compatibility tested on a copy, write compatibility marked unverified; conversion-requiring operations abort.
- [Risk] Capability detection changes the default route when APIs are present → Mitigation: branch on the actual host capability and keep the existing registration path for hosts that have it; add a regression test with the current fork.
- [Risk] The probe extension's direct tool invocation bypasses Pi's permission and hook path → Mitigation: label that result as a tsrepl runtime check, not a full tool-permission check; add one fake-provider end-to-end call for the real path.
- [Risk] The fake provider diverges from real provider behavior → Mitigation: use it only for tool-call and rlm transport checks; never report a fake-provider success as real-provider compatibility, and keep real-provider tests out of this change.
- [Risk] Release assets for the experimental bundle drift from the compiled spirits version → Mitigation: generate the bundle and manifest from the same build, record both checksums, and verify at install and launch.
- [Risk] `PI_PACKAGE_DIR` or `PI_CODING_AGENT_DIR` leaks in from the shell → Mitigation: set/remove them explicitly and cover them with a decoy test.
- [Risk] The managed route is mistaken for a supported default path → Mitigation: name it `managed-pi`, print an experimental notice at startup and in help, and keep documentation separate from the default install instructions.
- [Risk] `--help` creates an agent dir before the user sees the route → Mitigation: resolve and set the agent dir before spawning help, and test that only the isolated home is touched.

## Migration Plan

1. Land the experimental route and compatibility suite behind the explicit `managed-pi` subcommand. The default binary, install.sh, `spirits update`, and `~/.spirits/agent` behavior are unchanged.
2. Run the compatibility suite in an isolated environment and publish the result with confirmed, limited, unavailable, and not-run items. Do not switch the default route based on this change.
3. A user opts in with `spirits managed-pi install`, then `spirits managed-pi`. To roll back, remove the managed root after exiting; the default `spirits` and its data remain in place.
4. Follow-up changes, informed by the result, decide role/`/clear`/`/model` alternatives, any limited Pi patch, default-route switching, fork removal, and production distribution integration.

## Open Questions

- Whether the experimental extension bundle ships as a release asset or is embedded in the compiled spirits binary is deferred to the follow-up that productionizes the route. This design chooses the release asset for the first experiment.
- Whether a limited Pi patch for role/`/clear`/`/model` is necessary is deferred until the compatibility matrix exists; this change does not assume a patch.
- Whether write-back compatibility with older versions can be guaranteed is deferred. This change only tests reads on a copy and must not claim more.
- Whether real-provider compatibility tests are needed at all is deferred to a separate change. This change adds none and only records what the auth-free and fake-provider layers can establish.


## verify2 で確定した差異とフォロー

2026-11-03 の verify2（`sprt-opsx-verify-deep`）で、成果物と実装の間に次を確認した。タスク 11.1-11.17 が解消するまで、この change は完了扱いにしない。

- **ランナーの未配線**: 環境分離、ロード判定、probe、tsrepl の専用 Pi 実行、host version、rlm、既存データ、マトリクスの項目は、分類関数と単体テストだけがあり、`scripts/managed-pi-compat/run.ts` に配線されていない。`run.ts` のセル実行は runner 自身の Bun プロセスであり、専用 Pi の証拠ではない。
- **未実行の成功扱い**: `run.ts` の host version は manifest の値を自分自身と比較して `confirmed` を記録していた。観測がない項目は `not-run` にする。
- **隔離の境界**: 実 `~/.spirits` 配下の managed root を `--artifact-root` で読む経路と、互換性テストの隔離要件が矛盾していた。テストは実 `~/.spirits/agent` などユーザーデータを読み書きしない。managed root の読み取りは明示指定時だけ許可する。
- **データ書き込みの中止**: wrapper には Pi 内部の保存を中断する経路がない。この change は互換性ランナーで aborted を記録するに留め、製品経路での変換検出は後続 change とする。
- **レイアウトとコマンド**: 実際の overlay は `pi/package.json` の上書きで、`overlay/` ディレクトリは無い。`installed.json` を追加し、`repair` と `help` をコマンド面に含める。
- **release 解決の依存**: `src/managed-pi/command.ts` が `src/update/release.ts` に依存する。manifest と bundle を同じ release から取得するためで、タスク 11.16 で見直す。
- **既存テストの timeout 引き上げ**: `test/architecture-conventions.fixtures.test.ts` の beforeAll と root discovery の timeout を延ばした。タスク 11.17 では、この環境がネットワーク非接続で CI の Bun 1.4.2 を取得できず、CI 条件そのものを再現できなかった。Bun 1.4.4 のローカル実行では 76 ケースが成功したが、フィクスチャ走査と root discovery の実測時間は環境依存で、CI の 30 秒へ戻せることを確認できていない。そのため 60 秒 / 120 秒のまま維持し、CI で 1.4.2 の実行時間を確認してから戻す。理由をここに残し、未確認の短縮を根拠に完了扱いしない。
