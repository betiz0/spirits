---
name: interactive-testing
description: Test and debug pi's interactive mode in a controlled tmux terminal. Use for TUI behavior checks and interactive release smoke tests.
---

# Interactive testing in spirits (verification runner)

This section overrides the procedure below for this repository. Use the
verification runner instead of starting panes by hand: it records what it
starts, recovers it on exit, interrupt, or timeout, and leaves an execution
record that `check` can inspect.

## Default: start `run` in the background

```bash
out=$(mktemp /tmp/spirits-verify-run.XXXXXX)
scripts/tmux-verify.sh run --session smoke -- ./dist/spirits-linux-x64 >"$out" 2>&1 &
runner=$!
session=
while [ -z "$session" ]; do
  session=$(sed -n 's/^session=//p' "$out" | head -n1)
  [ -n "$session" ] || sleep 0.1
done
```

`run` prints `session=<name>` as its first line before it starts the pane. Wait
for the record before acting on the session:

```bash
while [ ! -f "${XDG_RUNTIME_DIR:-/tmp}/spirits-verify/records/$session.env" ]; do sleep 0.1; done
```

Then drive the pane with `tmux send-keys -t "=$session:" ...` and inspect it
with `tmux capture-pane -t "=$session:" -p` as in the procedure below, and
finish with `tmux kill-session -t "=$session"`. Keep the trailing colon in the
pane target: `-t "=$session"` alone can fail to resolve a pane. `run` waits for
the pane or the session to disappear, then recovers the process tree and
removes its temporary directory.
`run --port <n>` declares a listening port. `run --temp <dir>` uses an explicit
directory that the runner never deletes.

## Timeout and `extend`

The first-stage timeout defaults to 180 seconds and is counted from the moment
the command starts. The runner prints
`timeout-stage1 session=... elapsed=... nproc=... loadavg=... mem_available_kb=... extend_deadline=...`
and then waits the same length again. Poll the output file for it:

```bash
grep -q '^timeout-stage1 ' "$out"
```

After that line, estimate how much longer the verification needs from the
reported machine environment (CPU count, load average, free memory) and the
nature of the check (for example, waiting for a model reply). Present the
estimate to the user and ask whether to extend. If the user agrees, run
`scripts/tmux-verify.sh extend --session "$session" --seconds <n>`. One
extension is accepted, only while the runner is waiting. If the user refuses,
end the run with `tmux kill-session -t "=$session"` so the runner recovers
immediately. To change the first-stage timeout before starting, put
`TIMEOUT_SECONDS=<positive integer>` in
`${XDG_CONFIG_HOME:-$HOME/.config}/spirits-verify/config`.

## Manual recovery (panes started by hand)

`scripts/tmux-verify.sh check` only knows about `run` records, so a pane started
by hand is not detected by it. Recover it manually:

1. Read the pane PID: `tmux display-message -p -t <session> '#{pane_pid}'`.
2. Confirm the PID still belongs to the same process: compare the start time in
   field 22 of `/proc/<pid>/stat` with the value you recorded.
3. Read `/proc/<pid>/cgroup`. If the path ends in `tmux-spawn-*.scope`, kill
   the whole scope with `systemctl --user kill -s KILL <unit>`, where the unit
   is the last path component. Otherwise kill the session members, for example
   with `kill -9` on every PID whose session ID (field 6 of `/proc/<pid>/stat`)
   equals the pane PID.
4. Finish with `tmux kill-session -t <session>`.

## Processes that survive signals

`strace`, `ssh-agent`, and proxy daemons can ignore SIGHUP and SIGTERM, so
`tmux kill-session` alone does not recover them. The runner uses SIGKILL for
the scope or the session members, but processes that call `setsid` leave the
session and cannot be killed that way: the runner reports them as residue
instead. Processes started with a stripped environment (`env -i`) cannot be
detected at all. Run `scripts/tmux-verify.sh check` after a run and review the
`residue ...` lines.

# Testing pi Interactive Mode with tmux

Run the TUI in a controlled terminal (from the repo root, two directories above this skill):

```bash
tmux new-session -d -s pi-test -x 80 -y 24
tmux send-keys -t pi-test "./pi-test.sh" Enter
sleep 3 && tmux capture-pane -t pi-test -p     # capture after startup
tmux send-keys -t pi-test "your prompt here" Enter
tmux send-keys -t pi-test Escape               # special keys (also C-o for ctrl+o, etc.)
tmux kill-session -t pi-test
```

For release smoke tests, start the tmux session with `-c /tmp` and replace `./pi-test.sh` with the absolute path to the release binary. Test both Node and Bun binaries separately, submit a prompt, and wait for the model reply; startup alone is not a passing smoke test.
