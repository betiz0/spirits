# Managed Pi compatibility result

- Mode: official
- Label: official
- Runner completed: false (every recorded item was processed; false when any item stayed not-run. It says nothing about whether the observations passed.)
- Compatibility met: true (official mode only, and every required observation is confirmed. A required item that is limited, unavailable, not-run, or failed keeps it false; a fixture run is always false. It does not certify migration or deleting the fork: the base spec keeps the existing agent dir write-back and persistent settings write unproven, and those stay outside the required list. It also says nothing about whether role, /clear, or /model is available: the matrix item is confirmed as soon as any purpose is observed, so read its observed purpose count instead.)
- Results: confirmed=34 limited=0 unavailable=0 not-run=3 failed=0
- Note: `rlm child abort` is confirmed conditionally: the product appends `rlm_usage` after the parent turn ends, so the record is readable in the read taken after the child stops, never at `agent_settled`.
- Note: `role/clear/model matrix` is confirmed when any purpose was observed on the dedicated Pi; the observed purpose count is printed next to it, and `compatibilityMet` does not follow from it. This run observed 9 of 9 purposes.
- Existing agent dir untouched: true
- Runner version: d8265a9b565b23a2d901912f5191a2af6988a405 (diff sha256 b1add87bfedc0d93f345e845be0d965d499fe5fcd18266551751f7ad444409bc, 1 untracked, clean=false)
- Measured bundle commit: d8265a9b565b23a2d901912f5191a2af6988a405

## Required observations not confirmed

- none

## Outside the required list, not confirmed

- [not-run] existing agent dir write-back compatibility: no observation proves a dedicated-Pi write landing in an existing agent dir; the dedicated Pi write path is a separate item
- [not-run] settings write compatibility: the Pi extension API does not expose a persistent settings write; Node file writes are not a substitute
- [not-run] direct execute probe is auxiliary: the direct execute probe needs another extension's tool definition; Pi hands every extension its own API object, so no definition is reachable; tsrepl was observed in the tool inventory

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
- [confirmed] bundled SKILL.md is raw markdown: written SKILL.md is raw markdown
- [confirmed] host version: host version matches the artifact
- [confirmed] managed tsrepl simple cell: cell returned 2 through the normal model-to-tool path
- [confirmed] managed tsrepl Bun.Transpiler cell: cell returned 2 through the normal model-to-tool path
- [confirmed] managed tsrepl node:vm cell: cell returned 3 through the normal model-to-tool path
- [confirmed] cell failure is not reported as a load failure: cell failure is separate from extension load
- [confirmed] data read compatibility: read 3 settings keys and 2 session entries through the dedicated Pi
- [confirmed] auth read compatibility: the dedicated Pi resolved the credential copied into the isolated agent dir (source: stored)
- [confirmed] external extension read compatibility: the extension copied into the agent dir registered /compat-redacted-command
- [confirmed] dedicated Pi write path: session, model, and thinking level were written and read back through the dedicated Pi
- [not-run] existing agent dir write-back compatibility: no observation proves a dedicated-Pi write landing in an existing agent dir; the dedicated Pi write path is a separate item
- [not-run] settings write compatibility: the Pi extension API does not expose a persistent settings write; Node file writes are not a substitute
- [confirmed] model tool call reaches tsrepl: tsrepl ran through the normal model-to-tool path
- [not-run] direct execute probe is auxiliary: the direct execute probe needs another extension's tool definition; Pi hands every extension its own API object, so no definition is reachable; tsrepl was observed in the tool inventory
- [confirmed] no real credentials are read: only the fake bearer token was sent
- [confirmed] rlm child abort: the aborted child recorded rlm_usage only after the child stopped; conditional on reading after the parent turn ends, because the product appends rlm_usage once the aborted tool call unwinds (abort sent=true, abort accepted=true, child seen=true, cell aborted=true, child stopped=true, usage at settle=0, usage after stop=1)
- [confirmed] rlm child creation: child session was created
- [confirmed] rlm child answer: child returned a final answer
- [confirmed] rlm child usage: rlm_usage was recorded by the child
- [confirmed] rlm physical model child: physical-model child completed with a final answer and usage
- [confirmed] rlm auto parent: the auto parent handed the child fake-model, which answered and recorded rlm_usage
- [confirmed] clear boundary automatic compaction: the compaction after the boundary came from the extension hook with the clear note in 0 summarization request(s), and the following request carried compat-clear-auto-after-1794302940693 without compat-clear-auto-before-1794302940693
- [confirmed] clear boundary manual compaction: a compaction with cleared conversation in its span was taken over with the clear note in 0 summarization requests, and a clean span kept pi's own summary in 2 request(s)
- [confirmed] clear boundary fork: the fork created 392be4.jsonl and its request carried the conversation kept after the boundary without compat-clear-fork-before-1794302951246
- [confirmed] clear boundary tree move: moving the leaf to before the boundary brought compat-clear-tree-before-1794302956755 back into the request, which is the documented drop-off
- [confirmed] clear boundary resume: the resumed session ession.jsonl kept the boundary and sent no compat-clear-resume-before-1794302962253
- [confirmed] role/clear/model matrix: confirmed here means observed on the dedicated Pi, including 0 purpose(s) observed as unavailable; 9 of 9 purposes observed, rows derive from those observations
- [confirmed] existing agent dir untouched: the seeded existing agent dir kept its content and modification times across every launch

## Required observations

- managed extension load: confirmed
- agent dir precedence: confirmed
- package dir decoy does not change identity: confirmed
- help touches only the isolated home: confirmed
- api key and proxy survive: confirmed
- bundled SKILL.md is raw markdown: confirmed
- host version: confirmed
- managed tsrepl simple cell: confirmed
- managed tsrepl Bun.Transpiler cell: confirmed
- managed tsrepl node:vm cell: confirmed
- cell failure is not reported as a load failure: confirmed
- model tool call reaches tsrepl: confirmed
- no real credentials are read: confirmed
- rlm physical model child: confirmed
- rlm child usage: confirmed
- rlm child abort: confirmed
- data read compatibility: confirmed
- dedicated Pi write path: confirmed
- role/clear/model matrix: confirmed
- clear boundary automatic compaction: confirmed
- clear boundary manual compaction: confirmed
- clear boundary fork: confirmed
- clear boundary tree move: confirmed
- clear boundary resume: confirmed
- existing agent dir untouched: confirmed
