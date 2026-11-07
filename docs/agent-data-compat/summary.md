# agent-dir 読み書き互換 実測結果

fork (spirits 0.6.0) と managed (公式 Pi 1.5.0 + spirits 拡張 bundle) のあいだの、既存
`~/.spirits/agent` 形式データの双方向互換の実測。製品コード・ガード・既定経路は変更していない。
実データ・実認証・実 provider は不使用（ローカル fake provider と隔離 HOME）。

- runner commit: `538e6999776d8f57d3575eee42bde134ac84bfef` (tag spirits-v0.6.0-22-g538e69997, diff sha256 `8e1eea85ee2f38c2f802adb1b95ab5271187176dc1a37773b9d60c08a32bcefb`, clean=false)
- fork binary: `/home/betiz/.spirits/bin/spirits` sha256 `dc3af4cb5de45e1f96e029ed7e1c909e48556f422ed926e2a349100e8238d29d` (spirits 0.6.0 (Bun 1.4.2))
- official pi 1.5.0 tarball `df870ba0e344cb7b3358d8d8f19397b8b8d225a8669784736ad68a5c2169d53b` executable `61a84400938da652ed69aac9c1ad2ca23af3c9bd8cc2f46ce571ed84ae6a35e5`
- extension bundle `cd5f3456a1a7a0febb100a25f068ffbf629dc35093b955a87edf0446ac990ea7` manifest `0e3a9647b2b5f4be812cf5a495c6c689164f27f89421803471061abe21e41e08` overlay 1.5.0-spirits.1
- role API (pi.registerModelRoles): fork=true managed=false (decides whether the bundle may append pi.virtual-model-state)
- settings writer replay: FileSettingsStorage=identical, migrateSettings=identical, persistScopedSettings=identical (identical=true)

## 判定

| 項目 | fork→managed | managed→fork | 総合 | 詳細 |
|---|---|---|---|---|
| goal entry (spirits_goal) | compatible | compatible | bidirectional | authored on disk fork=1 managed=1; read by the other host managed=1 fork=1; read back after both hosts wrote fork=2 managed=2 |
| todo entry (spirits_todo) | compatible | compatible | bidirectional | authored on disk fork=1 managed=1; read by the other host managed=1 fork=1; read back after both hosts wrote fork=2 managed=2 |
| memory entry (spirits_memory) | compatible | compatible | bidirectional | authored on disk fork=1 managed=1; read by the other host managed=1 fork=1; read back after both hosts wrote fork=2 managed=2 |
| tsrepl cell entry (tsrepl_cell) | compatible | compatible | bidirectional | authored on disk fork=4 managed=4; read by the other host managed=5 fork=5; read back after both hosts wrote fork=9 managed=9 |
| rlm usage entry (rlm_usage) | compatible | compatible | bidirectional | authored on disk fork=1 managed=1; read by the other host managed=1 fork=1; read back after both hosts wrote fork=2 managed=2 |
| routing state entry (pi.virtual-model-state) | compatible | not-run | one-way | authored on disk fork=1 managed=0; read by the other host managed=1 fork=1; read back after both hosts wrote fork=1 managed=1; managed authored none because the bundle appends it only through the host role API, absent in official pi 1.5.0 |
| skills/ read | compatible | compatible | bidirectional | the skill saved by one host is listed by the other: fork->managed {"listed":true,"command":true}, managed->fork {"listed":true,"command":true} |
| goal() read | compatible | compatible | bidirectional | goal() returned the other host's goal: fork->managed true, managed->fork true |
| settings.json test write: read by the other host and kept by its writer | compatible | compatible | bidirectional | the test write uses Pi's own procedure (proper-lockfile lock, migrate, merge modified fields, 2-space rewrite); the other host then reads the file and writes it with `install <local package>` |
| settings.json real writer diff | compatible | compatible | bidirectional | each host's own settings writer ran over a tree written by each host and kept every tracked key: fork-writes-fork-tree {"ok":true,"removed":[],"changed":[],"added":["packages"]}, official-writes-fork-tree {"ok":true,"removed":[],"changed":[],"added":[]}, official-writes-managed-tree {"ok":true,"remo |
| auth.json write | not-run | not-run | not-run | pi writes auth.json only from the interactive `/login` flow; the RPC protocol and the extension API expose no credential write, so no headless product write path exists |
| models.json write | not-run | not-run | not-run | neither host wrote models.json during any phase; the file is user-authored and no headless product write path was observed |
| models-store.json | not-run | not-run | not-run | observed but not exercised |
| trust.json | not-run | not-run | not-run | project trust is granted interactively; no phase created or changed trust.json |
| bundled-skills/ coexistence | compatible | compatible | bidirectional | each host writes only its own version directory and leaves the other's byte-identical (fork=["0.6.0"], bundle=["0.0.0-dev"]). Neither host reads the other's version directory, so a leftover tree is inert rather than wrong. |
| operator agent dir untouched | compatible | compatible | bidirectional | /home/betiz/.spirits/agent kept its content and modification times across every phase (sessions/ excluded: this runner's own session transcript lives there) |
| settings.json read | compatible | compatible | bidirectional | forkToManaged: managed read the fork's settings through getSettings(): 8 keys read, tracked keys all present / managedToFork: fork read the managed settings through getSettings(): 8 keys read, tracked keys all present |
| sessions read | compatible | compatible | bidirectional | forkToManaged: managed loaded the fork session: 31 entries read back identical, custom types {"spirits_goal":1,"spirits_todo":1,"spirits_memory":1,"tsrepl_cell":5,"rlm_usage":1,"pi.virtual-model-state":1} / managedToFork: fork loaded the managed session: 30 entries read back identical, custom types  |
| sessions rewrite (append-only) | compatible | compatible | bidirectional | forkToManaged: sessions/2026-11-07T09-50-41-605Z_01a1b56a-dbc4-73d0-924f-c8b864208b31.jsonl grew by 21 entries with every earlier line byte-identical / managedToFork: sessions/2026-11-07T09-50-45-215Z_01a1b56a-e9df-7677-91c4-d85dd03dc8df.jsonl grew by 21 entries with every earlier line byte-identica |
| auth.json read | compatible | compatible | bidirectional | forkToManaged: managed read the fork-side auth.json: auth.json entries reported as configured, control provider reported unconfigured / managedToFork: fork read the managed-side auth.json: auth.json entries reported as configured, control provider reported unconfigured |
| models.json read | compatible | compatible | bidirectional | forkToManaged: managed resolved the provider from models.json: both models.json models are listed and 2 provider request(s) named fake-model / managedToFork: fork resolved the provider from models.json: both models.json models are listed and 2 provider request(s) named fake-model |
| memory/notes.md read (system prompt) | compatible | compatible | bidirectional | forkToManaged: memory/notes.md read (system prompt): the line written by the fork reaches the managed system prompt: true (2 request(s) inspected) / managedToFork: memory/notes.md read (system prompt): the line written by managed reaches the fork system prompt: true (2 request(s) inspected) |
| prompts/spirits/code-mode.md read (system prompt) | compatible | compatible | bidirectional | forkToManaged: prompts/spirits/code-mode.md read (system prompt): the line written by the fork reaches the managed system prompt: true (2 request(s) inspected) / managedToFork: prompts/spirits/code-mode.md read (system prompt): the line written by managed reaches the fork system prompt: true (2 requ |

## フェーズの終了状態

- a1-fork-create: exit=0
- a1-fork-write-diff: exit=?
- a1-fork-settingswrite: exit=0
- a1-fork-settingswrite-diff: exit=?
- a1-fork-after-install: exit=0
- a2-managed-fresh: exit=0
- a2-managed-fresh-diff: exit=?
- a2-managed-loaded: exit=0
- a2-managed-loaded-diff: exit=?
- a2-managed-write: exit=0
- a2-managed-write-diff: exit=?
- a2-managed-settingswrite: exit=0
- a2-managed-settingswrite-diff: exit=?
- a3-fork-reread: exit=0
- a3-fork-reread-diff: exit=?
- b1-managed-create: exit=0
- b1-managed-write-diff: exit=?
- b1-managed-settingswrite: exit=0
- b1-managed-settingswrite-diff: exit=?
- b1-managed-after-install: exit=0
- b2-fork-fresh: exit=0
- b2-fork-fresh-diff: exit=?
- b2-fork-loaded: exit=0
- b2-fork-loaded-diff: exit=?
- b2-fork-write: exit=0
- b2-fork-write-diff: exit=?
- b2-fork-settingswrite: exit=0
- b2-fork-settingswrite-diff: exit=?
- b3-managed-reread: exit=0
- b3-managed-reread-diff: exit=?
- tw-fork-to-managed-other-reads: exit=0
- tw-fork-to-managed-settingswrite: exit=0
- tw-managed-to-fork-other-reads: exit=0
- tw-managed-to-fork-settingswrite: exit=0

## ツリー差分

### a1 fork created

- added bundled-skills
- added bundled-skills/0.6.0
- added bundled-skills/0.6.0/sprt-architecture-guards
- added bundled-skills/0.6.0/sprt-architecture-guards/SKILL.md
- added bundled-skills/0.6.0/sprt-architecture-guards/references
- added bundled-skills/0.6.0/sprt-architecture-guards/references/check-generation.md
- added bundled-skills/0.6.0/sprt-architecture-guards/references/convention-registry.md
- added bundled-skills/0.6.0/sprt-architecture-guards/references/principles.md
- added bundled-skills/0.6.0/sprt-opsx-review-change
- added bundled-skills/0.6.0/sprt-opsx-review-change/SKILL.md
- added bundled-skills/0.6.0/sprt-opsx-verify-deep
- added bundled-skills/0.6.0/sprt-opsx-verify-deep/SKILL.md
- added memory
- added memory/notes.md
- added models-store.json
- added prompts
- added prompts/spirits
- added prompts/spirits/code-mode.md
- added prompts/spirits/code-mode.md.bak
- added sessions
- added sessions/2026-11-07T09-50-41-605Z_01a1b56a-dbc4-73d0-924f-c8b864208b31.jsonl
- added skills
- added skills/adc-probe-skill
- added skills/adc-probe-skill/SKILL.md

### a2 managed fresh-session read on the fork tree

- added bundled-skills/0.0.0-dev
- added bundled-skills/0.0.0-dev/sprt-architecture-guards
- added bundled-skills/0.0.0-dev/sprt-architecture-guards/SKILL.md
- added bundled-skills/0.0.0-dev/sprt-architecture-guards/references
- added bundled-skills/0.0.0-dev/sprt-architecture-guards/references/check-generation.md
- added bundled-skills/0.0.0-dev/sprt-architecture-guards/references/convention-registry.md
- added bundled-skills/0.0.0-dev/sprt-architecture-guards/references/principles.md
- added bundled-skills/0.0.0-dev/sprt-opsx-review-change
- added bundled-skills/0.0.0-dev/sprt-opsx-review-change/SKILL.md
- added bundled-skills/0.0.0-dev/sprt-opsx-verify-deep
- added bundled-skills/0.0.0-dev/sprt-opsx-verify-deep/SKILL.md
- added sessions/2026-11-07T09-50-42-817Z_01a1b56a-e081-743a-a786-0fe036d71619.jsonl

### a2 managed read of the fork session

- modified sessions/2026-11-07T09-50-41-605Z_01a1b56a-dbc4-73d0-924f-c8b864208b31.jsonl lines +6/-0 prefix=kept

### a2 managed write pass on the fork tree

- modified memory/notes.md lines +1/-0 prefix=kept
- modified prompts/spirits/code-mode.md.bak
- modified sessions/2026-11-07T09-50-41-605Z_01a1b56a-dbc4-73d0-924f-c8b864208b31.jsonl lines +21/-0 prefix=kept

### a3 fork read pass on the managed tree

- modified sessions/2026-11-07T09-50-41-605Z_01a1b56a-dbc4-73d0-924f-c8b864208b31.jsonl lines +6/-0 prefix=kept

### b1 managed created

- added bundled-skills
- added bundled-skills/0.0.0-dev
- added bundled-skills/0.0.0-dev/sprt-architecture-guards
- added bundled-skills/0.0.0-dev/sprt-architecture-guards/SKILL.md
- added bundled-skills/0.0.0-dev/sprt-architecture-guards/references
- added bundled-skills/0.0.0-dev/sprt-architecture-guards/references/check-generation.md
- added bundled-skills/0.0.0-dev/sprt-architecture-guards/references/convention-registry.md
- added bundled-skills/0.0.0-dev/sprt-architecture-guards/references/principles.md
- added bundled-skills/0.0.0-dev/sprt-opsx-review-change
- added bundled-skills/0.0.0-dev/sprt-opsx-review-change/SKILL.md
- added bundled-skills/0.0.0-dev/sprt-opsx-verify-deep
- added bundled-skills/0.0.0-dev/sprt-opsx-verify-deep/SKILL.md
- added memory
- added memory/notes.md
- added models-store.json
- added prompts
- added prompts/spirits
- added prompts/spirits/code-mode.md
- added prompts/spirits/code-mode.md.bak
- added sessions
- added sessions/2026-11-07T09-50-45-215Z_01a1b56a-e9df-7677-91c4-d85dd03dc8df.jsonl
- added skills
- added skills/adc-probe-skill
- added skills/adc-probe-skill/SKILL.md

### b2 fork fresh-session read on the managed tree

- added bundled-skills/0.6.0
- added bundled-skills/0.6.0/sprt-architecture-guards
- added bundled-skills/0.6.0/sprt-architecture-guards/SKILL.md
- added bundled-skills/0.6.0/sprt-architecture-guards/references
- added bundled-skills/0.6.0/sprt-architecture-guards/references/check-generation.md
- added bundled-skills/0.6.0/sprt-architecture-guards/references/convention-registry.md
- added bundled-skills/0.6.0/sprt-architecture-guards/references/principles.md
- added bundled-skills/0.6.0/sprt-opsx-review-change
- added bundled-skills/0.6.0/sprt-opsx-review-change/SKILL.md
- added bundled-skills/0.6.0/sprt-opsx-verify-deep
- added bundled-skills/0.6.0/sprt-opsx-verify-deep/SKILL.md
- added sessions/2026-11-07T09-50-46-456Z_01a1b56a-eeb8-701f-99d1-eb4a7ecd3579.jsonl

### b2 fork read of the managed session

- modified sessions/2026-11-07T09-50-45-215Z_01a1b56a-e9df-7677-91c4-d85dd03dc8df.jsonl lines +7/-0 prefix=kept

### b2 fork write pass on the managed tree

- modified memory/notes.md lines +1/-0 prefix=kept
- modified prompts/spirits/code-mode.md.bak
- modified sessions/2026-11-07T09-50-45-215Z_01a1b56a-e9df-7677-91c4-d85dd03dc8df.jsonl lines +21/-0 prefix=kept

### b3 managed read pass on the fork tree

- modified sessions/2026-11-07T09-50-45-215Z_01a1b56a-e9df-7677-91c4-d85dd03dc8df.jsonl lines +6/-0 prefix=kept

## settings.json

```json
{
	"forkTreeToManaged": {
		"fromSlot": "a3-fork-reread",
		"toSlot": "tw-a-managed",
		"testWrite": {
			"addedKeys": [
				"adcTestKey"
			],
			"removedKeys": []
		},
		"writtenValues": {
			"defaultProvider": "compat-fake",
			"defaultModel": "fake-model",
			"defaultThinkingLevel": "medium",
			"models": {
				"strong": "compat-fake/fake-strong",
				"role": "strong"
			},
			"adcSpiritsKey": {
				"origin": "test-write",
				"marker": "ADC-mw683gt5-ev76f9"
			},
			"adcTestKey": {
				"origin": "test-write",
				"marker": "ADC-mw683gt5-ev76f9"
			}
		},
		"readByOtherHost": {
			"defaultProvider": "compat-fake",
			"defaultModel": "fake-model",
			"defaultThinkingLevel": "medium",
			"models": {
				"strong": "compat-fake/fake-strong",
				"role": "strong"
			},
			"adcSpiritsKey": {
				"origin": "test-write",
				"marker": "ADC-mw683gt5-ev76f9"
			},
			"adcTestKey": {
				"origin": "test-write",
				"marker": "ADC-mw683gt5-ev76f9"
			}
		},
		"otherWriterCommand": "install <local package>",
		"otherWriterExit": 0,
		"valuesAfterOtherWriter": {
			"defaultProvider": "compat-fake",
			"defaultModel": "fake-model",
			"defaultThinkingLevel": "medium",
			"models": {
				"strong": "compat-fake/fake-strong",
				"role": "strong"
			},
			"adcSpiritsKey": {
				"origin": "test-write",
				"marker": "ADC-mw683gt5-ev76f9"
			},
			"adcTestKey": {
				"origin": "test-write",
				"marker": "ADC-mw683gt5-ev76f9"
			}
		},
		"survival": {
			"ok": true,
			"missing": [],
			"added": []
		},
		"settingsTextAfter": "{\n  \"lastChangelogVersion\": \"0.0.0\",\n  \"defaultProvider\": \"compat-fake\",\n  \"defaultModel\": \"fake-model\",\n  \"defaultThinkingLevel\": \"medium\",\n  \"enabledModels\": [\n    \"compat-fake/*\"\n  ],\n  \"models\": {\n    \"strong\": \"compat-fake/fake-strong\",\n    \"role\": \"strong\"\n  },\n  \"adcSpiritsKey\": {\n    \"origin\": \"test-write\",\n    \"marker\": \"ADC-mw683gt5-ev76f9\"\n  },\n  \"packages\": [\n    \"../../../../localpkg\",\n    \"../../../../../localpkg\"\n  ],\n  \"adcTestKey\": {\n    \"origin\": \"test-write\",\n    \"marker\": \"ADC-mw683gt5-ev76f9\"\n  }\n}"
	},
	"managedTreeToFork": {
		"fromSlot": "b3-managed-reread",
		"toSlot": "tw-b-fork",
		"testWrite": {
			"addedKeys": [
				"adcTestKey"
			],
			"removedKeys": []
		},
		"writtenValues": {
			"defaultProvider": "compat-fake",
			"defaultModel": "fake-model",
			"defaultThinkingLevel": "medium",
			"models": {
				"strong": "compat-fake/fake-strong",
				"role": "strong"
			},
			"adcSpiritsKey": {
				"origin": "test-write",
				"marker": "ADC-mw683gt5-ev76f9"
			},
			"adcTestKey": {
				"origin": "test-write",
				"marker": "ADC-mw683gt5-ev76f9"
			}
		},
		"readByOtherHost": {
			"defaultProvider": "compat-fake",
			"defaultModel": "fake-model",
			"defaultThinkingLevel": "medium",
			"models": {
				"strong": "compat-fake/fake-strong",
				"role": "strong"
			},
			"adcSpiritsKey": {
				"origin": "test-write",
				"marker": "ADC-mw683gt5-ev76f9"
			},
			"adcTestKey": {
				"origin": "test-write",
				"marker": "ADC-mw683gt5-ev76f9"
			}
		},
		"otherWriterCommand": "install <local package>",
		"otherWriterExit": 0,
		"valuesAfterOtherWriter": {
			"defaultProvider": "compat-fake",
			"defaultModel": "fake-model",
			"defaultThinkingLevel": "medium",
			"models": {
				"strong": "compat-fake/fake-strong",
				"role": "strong"
			},
			"adcSpiritsKey": {
				"origin": "test-write",
				"marker": "ADC-mw683gt5-ev76f9"
			},
			"adcTestKey": {
				"origin": "test-write",
				"marker": "ADC-mw683gt5-ev76f9"
			}
		},
		"survival": {
			"ok": true,
			"missing": [],
			"added": []
		},
		"settingsTextAfter": "{\n  \"lastChangelogVersion\": \"0.0.0\",\n  \"defaultProvider\": \"compat-fake\",\n  \"defaultModel\": \"fake-model\",\n  \"defaultThinkingLevel\": \"medium\",\n  \"enabledModels\": [\n    \"compat-fake/*\"\n  ],\n  \"models\": {\n    \"strong\": \"compat-fake/fake-strong\",\n    \"role\": \"strong\"\n  },\n  \"adcSpiritsKey\": {\n    \"origin\": \"test-write\",\n    \"marker\": \"ADC-mw683gt5-ev76f9\"\n  },\n  \"packages\": [\n    \"../../../../../localpkg\",\n    \"../../../../localpkg\"\n  ],\n  \"adcTestKey\": {\n    \"origin\": \"test-write\",\n    \"marker\": \"ADC-mw683gt5-ev76f9\"\n  }\n}"
	},
	"writerDiffs": {
		"forkOnFork": [
			"modified settings.json keys+ packages"
		],
		"officialOnFork": [
			"modified settings.json keys~ packages"
		],
		"officialOnManaged": [
			"modified settings.json keys+ packages"
		],
		"forkOnManaged": [
			"modified settings.json keys~ packages"
		]
	}
}
```

