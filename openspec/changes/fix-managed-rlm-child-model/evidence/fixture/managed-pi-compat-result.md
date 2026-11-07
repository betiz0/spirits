# Managed Pi compatibility result

- Mode: fixture
- Label: fixture-only
- Runner completed: false (every recorded item was processed; false when any item stayed not-run. It says nothing about whether the observations passed.)
- Compatibility met: false (official mode only, and every required observation is confirmed. A required item that is limited, unavailable, not-run, or failed keeps it false; a fixture run is always false. It does not certify migration or deleting the fork: the base spec keeps the existing agent dir write-back and persistent settings write unproven, and those stay outside the required list. It also says nothing about whether role, /clear, or /model is available: the matrix item is confirmed as soon as any purpose is observed, so read its observed purpose count instead.)
- Results: confirmed=19 limited=3 unavailable=0 not-run=10 failed=0
- Note: `rlm child abort` is confirmed conditionally: the product appends `rlm_usage` after the parent turn ends, so the record is readable in the read taken after the child stops, never at `agent_settled`.
- Note: `role/clear/model matrix` is confirmed when any purpose was observed on the dedicated Pi; the observed purpose count is printed next to it, and `compatibilityMet` does not follow from it. This run observed 1 of 9 purposes.
- Existing agent dir untouched: true
- Runner version: 2467ad412a06a6a1c739c4326249d0eb02acd1ff (diff sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855, 0 untracked, clean=true)

## Required observations not confirmed

- [not-run] bundled SKILL.md is raw markdown: the session did not write a bundled SKILL.md
- [not-run] managed tsrepl simple cell: the fixture host accepted the tool call without executing cell code
- [not-run] managed tsrepl Bun.Transpiler cell: the fixture host accepted the tool call without executing cell code
- [not-run] managed tsrepl node:vm cell: the fixture host accepted the tool call without executing cell code
- [not-run] cell failure is not reported as a load failure: the fixture host did not execute the failing cell
- [limited] rlm physical model child: child completed without final answer, usage
- [limited] rlm child usage: child completed without an rlm_usage record
- [not-run] rlm child abort: no child session reached the provider, so nothing was running when the abort arrived (abort sent=true, abort accepted=true, child seen=false, cell aborted=false, child stopped=false, usage at settle=1, usage after stop=0)

## Outside the required list, not confirmed

- [not-run] existing agent dir write-back compatibility: no observation proves a dedicated-Pi write landing in an existing agent dir; the dedicated Pi write path is a separate item
- [not-run] settings write compatibility: the Pi extension API does not expose a persistent settings write; Node file writes are not a substitute
- [not-run] direct execute probe is auxiliary: the direct execute probe needs another extension's tool definition; Pi hands every extension its own API object, so no definition is reachable; tsrepl was observed in the tool inventory
- [limited] rlm child answer: child completed without a final answer
- [not-run] rlm auto parent: the host answers with fixed events and never requests the provider, so the auto parent was never exercised (child created=true, requested model=none, final answer=yes, usage=false, child target in fixture=true, host requests providers=false)

## Items

- [confirmed] role/clear/model matrix is internally consistent: 9 purpose rows, every row derived from a purpose definition
- [confirmed] tsrepl simple cell: local probe cell returned 2 (probe bypasses Pi hooks)
- [confirmed] fake provider reaches tsrepl: local fake provider transport only; not real-provider compatibility
- [confirmed] compatibility matrix validation: every row is derived from a purpose definition
- [confirmed] managed extension load: session started and tsrepl is registered
- [confirmed] agent dir precedence: agent dir and identity are pinned
- [confirmed] help touches only the isolated home: help only touched the isolated home
- [confirmed] api key and proxy survive: API key and proxy survived the managed environment
- [confirmed] package dir decoy does not change identity: the decoy package dir did not change the version
- [not-run] bundled SKILL.md is raw markdown: the session did not write a bundled SKILL.md
- [confirmed] host version: host version matches the artifact
- [not-run] managed tsrepl simple cell: the fixture host accepted the tool call without executing cell code
- [not-run] managed tsrepl Bun.Transpiler cell: the fixture host accepted the tool call without executing cell code
- [not-run] managed tsrepl node:vm cell: the fixture host accepted the tool call without executing cell code
- [not-run] cell failure is not reported as a load failure: the fixture host did not execute the failing cell
- [confirmed] data read compatibility: read 2 settings keys and 1 session entries through the dedicated Pi
- [confirmed] auth read compatibility: the dedicated Pi resolved the credential copied into the isolated agent dir (source: stored)
- [confirmed] external extension read compatibility: the extension copied into the agent dir registered /compat-redacted-command
- [confirmed] dedicated Pi write path: session, model, and thinking level were written and read back through the dedicated Pi
- [not-run] existing agent dir write-back compatibility: no observation proves a dedicated-Pi write landing in an existing agent dir; the dedicated Pi write path is a separate item
- [not-run] settings write compatibility: the Pi extension API does not expose a persistent settings write; Node file writes are not a substitute
- [confirmed] model tool call reaches tsrepl: tsrepl ran through the normal model-to-tool path
- [not-run] direct execute probe is auxiliary: the direct execute probe needs another extension's tool definition; Pi hands every extension its own API object, so no definition is reachable; tsrepl was observed in the tool inventory
- [confirmed] no real credentials are read: only the fake bearer token was sent
- [not-run] rlm child abort: no child session reached the provider, so nothing was running when the abort arrived (abort sent=true, abort accepted=true, child seen=false, cell aborted=false, child stopped=false, usage at settle=1, usage after stop=0)
- [confirmed] rlm child creation: child session was created
- [limited] rlm child answer: child completed without a final answer
- [limited] rlm child usage: child completed without an rlm_usage record
- [limited] rlm physical model child: child completed without final answer, usage
- [not-run] rlm auto parent: the host answers with fixed events and never requests the provider, so the auto parent was never exercised (child created=true, requested model=none, final answer=yes, usage=false, child target in fixture=true, host requests providers=false)
- [confirmed] role/clear/model matrix: confirmed here means observed on the dedicated Pi, including 0 purpose(s) observed as unavailable; 1 of 9 purposes observed, rows derive from those observations
- [confirmed] existing agent dir untouched: the seeded existing agent dir kept its content and modification times across every launch

## Required observations

- managed extension load: confirmed
- agent dir precedence: confirmed
- package dir decoy does not change identity: confirmed
- help touches only the isolated home: confirmed
- api key and proxy survive: confirmed
- bundled SKILL.md is raw markdown: not-run
- host version: confirmed
- managed tsrepl simple cell: not-run
- managed tsrepl Bun.Transpiler cell: not-run
- managed tsrepl node:vm cell: not-run
- cell failure is not reported as a load failure: not-run
- model tool call reaches tsrepl: confirmed
- no real credentials are read: confirmed
- rlm physical model child: limited
- rlm child usage: limited
- rlm child abort: not-run
- data read compatibility: confirmed
- dedicated Pi write path: confirmed
- role/clear/model matrix: confirmed
- existing agent dir untouched: confirmed
