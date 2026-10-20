#!/usr/bin/env bash
#
# Tests for scripts/tmux-verify.sh.
#
# Usage: bash scripts/tmux-verify.test.sh
#
# The suite runs against an isolated tmux server (TMUX_TMPDIR) and isolated
# state/config/temp directories. When tmux or strace is missing, the suite is
# skipped locally and fails in CI: a silent skip would hide recovery
# regressions.
#
# Path-dependent cases (records with a dedicated tmux-spawn scope exist only
# when a systemd user session is available) rewrite SCOPE_UNIT in the record to
# force the session-id recovery path. The record is the single source of truth
# for recovery (design D6), so this exercises both paths everywhere.

set -uo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VERIFY="$SCRIPT_DIR/tmux-verify.sh"

if ! command -v tmux >/dev/null 2>&1 || ! command -v strace >/dev/null 2>&1; then
	if [[ -n ${CI:-} ]]; then
		printf 'not ok - tmux and strace are required in CI\n' >&2
		exit 1
	fi
	printf 'skip - tmux-verify tests require tmux and strace\n'
	exit 0
fi

TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/spirits-verify-test.XXXXXX")
touch "$TEST_ROOT/.spirits-verify-test-owned"
mkdir -p "$TEST_ROOT/tmux"
export TMUX_TMPDIR="$TEST_ROOT/tmux"
unset TMUX

PASS=0
FAIL=0
CASE_NAME=
CASE_DIR=
RECORDS=
RUN_LOG=
RUNNER_PID=
RUNNER_RC=0
SESSION=
CLEANUP_PIDS=()

ok() {
	PASS=$((PASS + 1))
	printf 'ok - %s: %s\n' "$CASE_NAME" "$1"
}

not_ok() {
	FAIL=$((FAIL + 1))
	printf 'not ok - %s: %s\n' "$CASE_NAME" "$1" >&2
}

skip() {
	printf 'skip - %s: %s\n' "$CASE_NAME" "$1"
}

assert_eq() { # description expected actual
	if [[ $2 == "$3" ]]; then ok "$1"; else not_ok "$1 (expected [$2], got [$3])"; fi
}

assert_ne() { # description unexpected actual
	if [[ $2 != "$3" ]]; then ok "$1"; else not_ok "$1 (both [$2])"; fi
}

assert_contains() { # description haystack needle
	if [[ $2 == *"$3"* ]]; then ok "$1"; else not_ok "$1 (missing [$3])"; fi
}

assert_not_contains() { # description haystack needle
	if [[ $2 == *"$3"* ]]; then not_ok "$1 (found [$3])"; else ok "$1"; fi
}

assert_file_exists() { # description path
	if [[ -f $2 ]]; then ok "$1"; else not_ok "$1 (missing: $2)"; fi
}

assert_file_absent() { # description path
	if [[ -e $2 ]]; then not_ok "$1 (exists: $2)"; else ok "$1"; fi
}

assert_dir_exists() { # description path
	if [[ -d $2 ]]; then ok "$1"; else not_ok "$1 (missing: $2)"; fi
}

assert_dir_absent() { # description path
	if [[ -e $2 ]]; then not_ok "$1 (exists: $2)"; else ok "$1"; fi
}

assert_alive() { # description pid
	if kill -0 "$2" 2>/dev/null; then ok "$1"; else not_ok "$1 (not running: $2)"; fi
}

assert_dead() { # description pid
	if kill -0 "$2" 2>/dev/null; then not_ok "$1 (still running: $2)"; else ok "$1"; fi
}

assert_between() { # description low high value
	if [[ $4 -ge $2 && $4 -le $3 ]]; then
		ok "$1"
	else
		not_ok "$1 (expected $2..$3, got $4)"
	fi
}

# --- helpers --------------------------------------------------------------------------------

now_ms() {
	date +%s%3N
}

case_dir() { # name
	CASE_NAME=$1
	CASE_DIR="$TEST_ROOT/cases/$1"
	mkdir -p "$CASE_DIR/tmp" "$CASE_DIR/config" "$CASE_DIR/state"
	export SPIRITS_VERIFY_STATE_DIR="$CASE_DIR/state"
	export XDG_CONFIG_HOME="$CASE_DIR/config"
	export TMPDIR="$CASE_DIR/tmp"
	RECORDS="$CASE_DIR/state/records"
}

write_timeout_config() { # seconds
	mkdir -p "$CASE_DIR/config/spirits-verify"
	printf 'TIMEOUT_SECONDS=%s\n' "$1" >"$CASE_DIR/config/spirits-verify/config"
}

start_run() { # log args...
	RUN_LOG=$1
	shift
	bash "$VERIFY" run "$@" >"$RUN_LOG" 2>&1 &
	RUNNER_PID=$!
	CLEANUP_PIDS+=("$RUNNER_PID")
	SESSION=
	local i
	for i in $(seq 1 150); do
		SESSION=$(sed -n 's/^session=//p' "$RUN_LOG" 2>/dev/null | head -n1)
		if [[ -n $SESSION && -f "$RECORDS/$SESSION.env" ]]; then
			return 0
		fi
		if ! kill -0 "$RUNNER_PID" 2>/dev/null; then
			return 1
		fi
		sleep 0.1
	done
	return 1
}

wait_runner() {
	RUNNER_RC=0
	wait "$RUNNER_PID" 2>/dev/null || RUNNER_RC=$?
}

record_value() { # key
	(
		set +u
		# shellcheck disable=SC1090
		. "$RECORDS/$SESSION.env"
		printf '%s' "${!1}"
	)
}

write_fake_record() { # session [KEY='value' ...]
	local session=$1
	shift
	mkdir -p "$RECORDS"
	{
		printf 'SESSION=%q\n' "$session"
		printf 'PANE_PID=%q\n' ''
		printf 'PANE_STARTTIME=%q\n' ''
		printf 'PANE_SESSION_ID=%q\n' ''
		printf 'CGROUP_PATH=%q\n' ''
		printf 'SCOPE_UNIT=%q\n' ''
		printf 'TMUX_SERVER_PID=%q\n' ''
		printf 'TEMP_PATH=%q\n' ''
		printf 'TEMP_OWNED=%q\n' 0
		printf 'PORT=%q\n' ''
		printf 'TIMEOUT_SECONDS=%q\n' 180
		printf 'COMMAND_STR=%q\n' ''
		printf 'STATUS=%q\n' running
		printf 'PHASE=%q\n' stage1
		printf 'STAGE2_SECONDS=%q\n' ''
		printf 'EXTEND_DEADLINE=%q\n' ''
		printf 'STARTED_AT=%q\n' "$(date +%s)"
		printf '%s\n' "$@"
	} >"$RECORDS/$session.env"
}

force_session_path() {
	sed -i "s|^SCOPE_UNIT=.*|SCOPE_UNIT=''|" "$RECORDS/$SESSION.env"
}

wait_output() { # file pattern ticks(0.1s)
	local i
	for ((i = 0; i < $3; i++)); do
		if grep -q -- "$2" "$1" 2>/dev/null; then return 0; fi
		sleep 0.1
	done
	return 1
}

wait_file() { # path ticks(0.1s)
	local i
	for ((i = 0; i < $2; i++)); do
		[[ -e $1 ]] && return 0
		sleep 0.1
	done
	return 1
}

kill_all_session_members() { # pane pid
	local members
	members=$(ps -eo pid=,sid= | awk -v s="$1" '$2==s{print $1}')
	if [[ -n $members ]]; then
		# shellcheck disable=SC2086
		kill -9 $members 2>/dev/null || true
	fi
	kill -9 "$1" 2>/dev/null || true
}

free_port() {
	python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
}

test_port_listening() { # port
	local hex file local_addr state
	hex=$(printf '%04X' "$1")
	for file in /proc/net/tcp /proc/net/tcp6; do
		[[ -r $file ]] || continue
		while read -r _ local_addr _ state _; do
			[[ ${local_addr##*:} == "$hex" && $state == 0A ]] && return 0
		done <"$file"
	done
	return 1
}

is_self_ancestor() { # pid
	local target=$1 cur=$$
	while [[ $cur -gt 1 ]]; do
		[[ $cur == "$target" ]] && return 0
		cur=$(ps -o ppid= -p "$cur" 2>/dev/null | tr -d ' ')
		[[ -n $cur ]] || break
	done
	return 1
}

sweep_test_processes() {
	local d pid
	for d in /proc/[0-9]*; do
		pid=${d#/proc/}
		[[ $pid == "$$" || $pid == "$PPID" ]] && continue
		is_self_ancestor "$pid" && continue
		[[ -r $d/environ ]] || continue
		if tr '\0' '\n' 2>/dev/null <"$d/environ" | grep -Fq "$TEST_ROOT"; then
			kill -9 "$pid" 2>/dev/null || true
		fi
	done
}

cleanup() {
	local status=$?
	trap - EXIT
	tmux kill-server >/dev/null 2>&1 || true
	local pid
	if [[ ${#CLEANUP_PIDS[@]} -gt 0 ]]; then
		for pid in "${CLEANUP_PIDS[@]}"; do
			kill -9 "$pid" >/dev/null 2>&1 || true
		done
	fi
	sweep_test_processes
	case "$TEST_ROOT" in
		*/spirits-verify-test.*)
			if [[ -d $TEST_ROOT && ! -L $TEST_ROOT && -f $TEST_ROOT/.spirits-verify-test-owned ]]; then
				rm -rf -- "$TEST_ROOT"
			else
				printf 'Refusing to remove unverified test directory: %s\n' "$TEST_ROOT" >&2
			fi
			;;
		*)
			printf 'Refusing to remove unexpected test directory: %s\n' "$TEST_ROOT" >&2
			;;
	esac
	exit "$status"
}
trap cleanup EXIT

# --- cases ----------------------------------------------------------------------------------

case_usage_and_env() {
	case_dir usage-and-env
	local bin="$CASE_DIR/bin"
	local out="$CASE_DIR/out.log"
	mkdir -p "$bin"
	ln -s "$BASH" "$bin/bash"

	PATH="$bin" "$BASH" "$VERIFY" run --session notmux -- sleep 1 >"$out" 2>&1
	assert_eq "tmux-less PATH exits 2" 2 "$?"
	assert_contains "tmux-less PATH explains tmux" "$(cat "$out")" "tmux"
	assert_eq "tmux-less PATH creates no record" "" "$(ls -A "$RECORDS" 2>/dev/null)"
	assert_eq "tmux-less PATH leaves no session" "" "$(tmux list-sessions 2>/dev/null)"

	write_timeout_config 0
	bash "$VERIFY" run --session zero -- sleep 1 >"$out" 2>&1
	assert_eq "TIMEOUT_SECONDS=0 exits 2" 2 "$?"
	assert_eq "TIMEOUT_SECONDS=0 creates no record" "" "$(ls -A "$RECORDS" 2>/dev/null)"

	write_timeout_config abc
	bash "$VERIFY" run --session abc -- sleep 1 >"$out" 2>&1
	assert_eq "TIMEOUT_SECONDS=abc exits 2" 2 "$?"

	bash "$VERIFY" run --session 'bad.name' -- sleep 1 >"$out" 2>&1
	assert_eq "invalid session name exits 2" 2 "$?"
	assert_eq "invalid inputs leave no session" "" "$(tmux list-sessions 2>/dev/null)"
	assert_eq "invalid inputs leave no record" "" "$(ls -A "$RECORDS" 2>/dev/null)"
}

case_records_before_command() {
	case_dir records-before-command
	local temp="$CASE_DIR/temp"
	mkdir -p "$temp"
	cat >"$CASE_DIR/check-record.sh" <<'SH'
#!/usr/bin/env bash
set -u
rec="$SPIRITS_VERIFY_STATE_DIR/records/$SPIRITS_VERIFY_SESSION.env"
out="$SPIRITS_VERIFY_TMPDIR/record-check.txt"
fail=""
if [ ! -f "$rec" ]; then
	fail="missing-record"
else
	. "$rec"
	for name in SESSION PANE_PID PANE_STARTTIME PANE_SESSION_ID CGROUP_PATH TMUX_SERVER_PID TEMP_PATH TIMEOUT_SECONDS COMMAND_STR STATUS PHASE; do
		[ -n "${!name-}" ] || fail="$fail empty:$name"
	done
	[ "${SCOPE_UNIT+x}" = x ] || fail="$fail missing:SCOPE_UNIT"
	[ "${PORT+x}" = x ] || fail="$fail missing:PORT"
	[ "$SESSION" = "$SPIRITS_VERIFY_SESSION" ] || fail="$fail session-mismatch"
	[ "$PANE_PID" = "$$" ] || fail="$fail pane-pid:$PANE_PID:$$"
	[ "$STATUS" = running ] || fail="$fail status:$STATUS"
	[ "$PHASE" = stage1 ] || fail="$fail phase:$PHASE"
fi
if [ -z "$fail" ]; then
	printf 'pass\n' >"$out"
else
	printf 'fail:%s\n' "$fail" >"$out"
fi
sleep 300
SH
	start_run "$CASE_DIR/run.log" --session records --temp "$temp" -- bash "$CASE_DIR/check-record.sh"
	assert_eq "run announces the session" 0 "$?"
	wait_file "$temp/record-check.txt" 100
	assert_file_exists "the command sees its own record" "$temp/record-check.txt"
	assert_eq "the record has every field before the command runs" "pass" "$(cat "$temp/record-check.txt" 2>/dev/null)"
	tmux kill-session -t "=$SESSION"
	wait_runner
	assert_eq "explicit temp run exits 0" 0 "$RUNNER_RC"
	assert_dir_exists "explicit temp is kept" "$temp"
}

case_unique_session_name() {
	case_dir unique-session-name
	mkdir -p "$CASE_DIR/t1" "$CASE_DIR/t2"
	start_run "$CASE_DIR/r1.log" --session same --temp "$CASE_DIR/t1" -- sleep 1
	assert_eq "first run starts" 0 "$?"
	local first=$SESSION
	wait_runner
	assert_eq "first run exits 0" 0 "$RUNNER_RC"
	start_run "$CASE_DIR/r2.log" --session same --temp "$CASE_DIR/t2" -- sleep 1
	assert_eq "second run starts" 0 "$?"
	local second=$SESSION
	wait_runner
	assert_eq "second run exits 0" 0 "$RUNNER_RC"
	assert_ne "session names differ" "$first" "$second"
	assert_file_exists "first record exists" "$RECORDS/$first.env"
	assert_file_exists "second record exists" "$RECORDS/$second.env"
}

case_reap_signal_ignoring() {
	case_dir reap-signal-ignoring
	start_run "$CASE_DIR/run.log" --session reap -- bash -c 'exec strace -f -o "$SPIRITS_VERIFY_TMPDIR/trace" sleep 300'
	assert_eq "run starts" 0 "$?"
	sleep 1
	local pane
	pane=$(record_value PANE_PID)
	local child
	child=$(pgrep -P "$pane" sleep 2>/dev/null | head -n1)
	assert_ne "the pane command is running" "" "$pane"
	tmux kill-session -t "=$SESSION"
	wait_runner
	assert_eq "run exits 0 after kill-session" 0 "$RUNNER_RC"
	assert_dead "strace was recovered" "$pane"
	if [[ -n $child ]]; then
		assert_dead "the traced sleep was recovered" "$child"
	else
		not_ok "the traced sleep was found before recovery (pane=$pane)"
	fi
	local scope cgroup
	scope=$(record_value SCOPE_UNIT)
	cgroup=$(record_value CGROUP_PATH)
	if [[ -n $scope ]]; then
		assert_eq "the pane scope is empty" "" "$(cat "/sys/fs/cgroup$cgroup/cgroup.procs" 2>/dev/null)"
	fi
}

case_reap_on_interrupt() {
	case_dir reap-on-interrupt
	start_run "$CASE_DIR/run.log" --session interrupt -- bash -c 'trap "" HUP; exec sleep 300'
	assert_eq "run starts" 0 "$?"
	sleep 0.5
	local pane
	pane=$(record_value PANE_PID)
	kill -TERM "$RUNNER_PID"
	wait_runner
	assert_eq "SIGTERM exit code is 143" 143 "$RUNNER_RC"
	assert_dead "the pane process was recovered" "$pane"
	assert_eq "the session is gone" "" "$(tmux list-sessions 2>/dev/null)"
}

case_keep_preexisting() {
	case_dir keep-preexisting
	sleep 300 &
	local pre=$!
	CLEANUP_PIDS+=("$pre")
	start_run "$CASE_DIR/run.log" --session keep -- bash -c 'trap "" HUP; exec sleep 300'
	assert_eq "run starts" 0 "$?"
	sleep 0.5
	local pane
	pane=$(record_value PANE_PID)
	assert_ne "the pane process is not the preexisting process" "$pre" "$pane"
	force_session_path
	tmux kill-session -t "=$SESSION"
	wait_runner
	assert_eq "run exits 0" 0 "$RUNNER_RC"
	assert_alive "the preexisting process survives" "$pre"
	assert_dead "the pane process was recovered" "$pane"
	kill -9 "$pre" 2>/dev/null || true
	wait "$pre" 2>/dev/null
}

case_pid_reuse_not_killed() {
	case_dir pid-reuse-not-killed
	start_run "$CASE_DIR/run.log" --session reuse -- bash -c 'trap "" HUP; exec sleep 300'
	assert_eq "run starts" 0 "$?"
	sleep 0.5
	local pane start
	pane=$(record_value PANE_PID)
	start=$(record_value PANE_STARTTIME)
	force_session_path
	sed -i "s|^PANE_STARTTIME=.*|PANE_STARTTIME=$((start + 1))|" "$RECORDS/$SESSION.env"
	tmux kill-session -t "=$SESSION"
	wait_runner
	assert_eq "run exits 0 when the pid was reused" 0 "$RUNNER_RC"
	assert_contains "the reused pid is reported" "$(cat "$RUN_LOG")" "reused pid=$pane"
	assert_alive "the unrelated process survives" "$pane"
	kill -9 "$pane" 2>/dev/null || true
}

case_setsid_escapee_reported() {
	case_dir setsid-escapee-reported
	mkdir -p "$CASE_DIR/temp"
	start_run "$CASE_DIR/run.log" --session escapee --temp "$CASE_DIR/temp" \
		-- bash -c 'setsid sleep 300 & echo $! > "$SPIRITS_VERIFY_TMPDIR/escapee.pid"; wait'
	assert_eq "run starts" 0 "$?"
	wait_file "$CASE_DIR/temp/escapee.pid" 50
	local escapee
	escapee=$(cat "$CASE_DIR/temp/escapee.pid" 2>/dev/null)
	assert_ne "the escapee started" "" "$escapee"
	force_session_path
	tmux kill-session -t "=$SESSION"
	wait_runner
	assert_eq "run exits 1 on residue" 1 "$RUNNER_RC"
	assert_contains "the escapee is reported" "$(cat "$RUN_LOG")" "kind=process id=$escapee reason=escapee"
	assert_alive "the escapee is not killed" "$escapee"
	kill -9 "$escapee" 2>/dev/null || true
}

case_timeout_stage1_notice() {
	case_dir timeout-stage1-notice
	write_timeout_config 2
	local t0
	t0=$(now_ms)
	start_run "$CASE_DIR/run.log" --session notice -- sleep 300
	assert_eq "run starts" 0 "$?"
	wait_output "$RUN_LOG" "timeout-stage1" 60
	local elapsed
	elapsed=$(($(now_ms) - t0))
	local out
	out=$(cat "$RUN_LOG")
	assert_contains "the notice includes nproc" "$out" "nproc="
	assert_contains "the notice includes loadavg" "$out" "loadavg="
	assert_contains "the notice includes mem_available_kb" "$out" "mem_available_kb="
	assert_contains "the notice includes extend_deadline" "$out" "extend_deadline="
	assert_between "the notice arrives after the first stage" 1500 4000 "$elapsed"
	local pane
	pane=$(record_value PANE_PID)
	assert_alive "the pane survives the first stage" "$pane"
	tmux kill-session -t "=$SESSION"
	wait_runner
	assert_eq "run exits 0 after kill-session" 0 "$RUNNER_RC"
}

case_timeout_no_extension() {
	case_dir timeout-no-extension
	write_timeout_config 2
	local t0
	t0=$(now_ms)
	start_run "$CASE_DIR/run.log" --session noext -- sleep 300
	assert_eq "run starts" 0 "$?"
	wait_runner
	local elapsed
	elapsed=$(($(now_ms) - t0))
	assert_eq "run exits 124" 124 "$RUNNER_RC"
	assert_contains "the timeout names stage 1" "$(cat "$RUN_LOG")" "stage=1"
	assert_between "recovery happens after the extension wait" 3500 7500 "$elapsed"
}

case_timeout_extended() {
	case_dir timeout-extended
	write_timeout_config 2
	start_run "$CASE_DIR/run.log" --session ext -- sleep 300
	assert_eq "run starts" 0 "$?"
	wait_output "$RUN_LOG" "timeout-stage1" 60
	bash "$VERIFY" extend --session "$SESSION" --seconds 3 >"$CASE_DIR/extend.log" 2>&1
	local extend_rc=$?
	local t_accepted
	t_accepted=$(now_ms)
	assert_eq "extend is accepted" 0 "$extend_rc"
	wait_runner
	local elapsed
	elapsed=$(($(now_ms) - t_accepted))
	assert_eq "run exits 124" 124 "$RUNNER_RC"
	assert_contains "the timeout names stage 2" "$(cat "$RUN_LOG")" "stage=2"
	assert_between "recovery happens after the extended timeout" 2500 5500 "$elapsed"
}

case_extend_rejected() {
	case_dir extend-rejected
	write_timeout_config 2
	start_run "$CASE_DIR/run.log" --session rejected -- sleep 300
	assert_eq "run starts" 0 "$?"
	bash "$VERIFY" extend --session "$SESSION" --seconds 3 >"$CASE_DIR/early.log" 2>&1
	local early_rc=$?
	assert_ne "extend before the wait is rejected" 0 "$early_rc"
	wait_output "$RUN_LOG" "timeout-stage1" 60
	bash "$VERIFY" extend --session "$SESSION" --seconds 3 >"$CASE_DIR/accept.log" 2>&1
	assert_eq "extend during the wait is accepted" 0 "$?"
	bash "$VERIFY" extend --session "$SESSION" --seconds 5 >"$CASE_DIR/again.log" 2>&1
	local again_rc=$?
	assert_ne "a second extend is rejected" 0 "$again_rc"
	assert_eq "the accepted stage-2 seconds are unchanged" 3 "$(record_value STAGE2_SECONDS)"
	tmux kill-session -t "=$SESSION"
	wait_runner
	assert_eq "run exits 0 after kill-session" 0 "$RUNNER_RC"
}

case_kill_session_during_wait() {
	case_dir kill-session-during-wait
	write_timeout_config 2
	start_run "$CASE_DIR/run.log" --session killd -- sleep 300
	assert_eq "run starts" 0 "$?"
	wait_output "$RUN_LOG" "timeout-stage1" 60
	local t0
	t0=$(now_ms)
	tmux kill-session -t "=$SESSION"
	wait_runner
	local elapsed
	elapsed=$(($(now_ms) - t0))
	assert_eq "run exits 0" 0 "$RUNNER_RC"
	assert_between "recovery is quick during the wait" 0 2000 "$elapsed"
}

case_timeout_with_residue() {
	case_dir timeout-with-residue
	write_timeout_config 2
	start_run "$CASE_DIR/run.log" --session timeoutres -- bash -c \
		'setsid sleep 300 & echo $! > "$SPIRITS_VERIFY_TMPDIR/escapee.pid"; sleep 300'
	assert_eq "run starts" 0 "$?"
	# The scope path would also kill the setsid process through the cgroup, so
	# force the session-id path to exercise the residue report.
	force_session_path
	local temp escapee
	temp=$(record_value TEMP_PATH)
	wait_file "$temp/escapee.pid" 50
	escapee=$(cat "$temp/escapee.pid" 2>/dev/null)
	assert_ne "the escapee started" "" "$escapee"
	wait_runner
	assert_eq "run exits 1 on residue" 1 "$RUNNER_RC"
	local out
	out=$(cat "$RUN_LOG")
	assert_contains "the timeout is reported" "$out" "timeout session=$SESSION"
	assert_contains "stage 1 is reported" "$out" "stage=1"
	assert_contains "the residue is reported" "$out" "residue session=$SESSION"
	kill -9 "$escapee" 2>/dev/null || true
}

case_extend_after_deadline() {
	case_dir extend-after-deadline
	write_timeout_config 2
	start_run "$CASE_DIR/run.log" --session lateext -- sleep 300
	assert_eq "run starts" 0 "$?"
	wait_output "$RUN_LOG" "timeout-stage1" 60
	# The record is the single source of truth, so age the recorded deadline to
	# test the extend-side check deterministically (design D6).
	local past
	past=$(($(date +%s) - 1))
	sed -i "s|^EXTEND_DEADLINE=.*|EXTEND_DEADLINE='$past'|" "$RECORDS/$SESSION.env"
	bash "$VERIFY" extend --session "$SESSION" --seconds 3 >"$CASE_DIR/extend.log" 2>&1
	local extend_rc=$?
	assert_ne "extend after the deadline is rejected" 0 "$extend_rc"
	assert_eq "no second stage was accepted" "" "$(record_value STAGE2_SECONDS)"
	wait_runner
	assert_eq "run exits 124" 124 "$RUNNER_RC"
	assert_contains "the timeout names stage 1" "$(cat "$RUN_LOG")" "stage=1"
}

case_temp_and_port_released() {
	case_dir temp-and-port-released
	if ! command -v python3 >/dev/null 2>&1; then
		skip "python3 is not available"
		return 0
	fi
	local port
	port=$(free_port)
	start_run "$CASE_DIR/run.log" --session port --port "$port" \
		-- python3 -m http.server "$port" --bind 127.0.0.1
	assert_eq "run starts" 0 "$?"
	local i
	for ((i = 0; i < 50; i++)); do
		test_port_listening "$port" && break
		sleep 0.1
	done
	if test_port_listening "$port"; then ok "the declared port is listening"; else not_ok "the declared port is listening"; fi
	local temp
	temp=$(record_value TEMP_PATH)
	tmux kill-session -t "=$SESSION"
	wait_runner
	assert_eq "run exits 0" 0 "$RUNNER_RC"
	if test_port_listening "$port"; then not_ok "the declared port is released"; else ok "the declared port is released"; fi
	assert_dir_absent "the automatic temporary directory is removed" "$temp"
}

case_explicit_temp_kept() {
	case_dir explicit-temp-kept
	mkdir -p "$CASE_DIR/keep"
	start_run "$CASE_DIR/run.log" --session explicit --temp "$CASE_DIR/keep" \
		-- bash -c 'printf hi > "$SPIRITS_VERIFY_TMPDIR/file"; sleep 1'
	assert_eq "run starts" 0 "$?"
	wait_runner
	assert_eq "run exits 0" 0 "$RUNNER_RC"
	assert_file_exists "the file in the explicit temp remains" "$CASE_DIR/keep/file"
	assert_dir_exists "the explicit temp remains" "$CASE_DIR/keep"
}

case_held_temp_kept() {
	case_dir held-temp-kept
	cat >"$CASE_DIR/hold.sh" <<'SH'
#!/usr/bin/env bash
: > "$SPIRITS_VERIFY_TMPDIR/hold"
setsid bash -c 'exec 9<"$SPIRITS_VERIFY_TMPDIR/hold"; sleep 300' &
echo $! > "$SPIRITS_VERIFY_TMPDIR/holder.pid"
wait
SH
	start_run "$CASE_DIR/run.log" --session held -- bash "$CASE_DIR/hold.sh"
	assert_eq "run starts" 0 "$?"
	local temp
	temp=$(record_value TEMP_PATH)
	wait_file "$temp/holder.pid" 50
	local holder
	holder=$(cat "$temp/holder.pid" 2>/dev/null)
	assert_ne "the holder started" "" "$holder"
	force_session_path
	tmux kill-session -t "=$SESSION"
	wait_runner
	assert_eq "run exits 1 on residue" 1 "$RUNNER_RC"
	assert_contains "the open temp file is reported" "$(cat "$RUN_LOG")" "kind=temp"
	assert_dir_exists "the held temporary directory is kept" "$temp"
	kill -9 "$holder" 2>/dev/null || true
	rm -rf -- "$temp"
}

case_check_after_runner_kill() {
	case_dir check-after-runner-kill
	start_run "$CASE_DIR/run.log" --session killed -- sleep 300
	assert_eq "run starts" 0 "$?"
	sleep 0.5
	local pane temp
	pane=$(record_value PANE_PID)
	temp=$(record_value TEMP_PATH)
	kill -9 "$RUNNER_PID" 2>/dev/null || true
	wait "$RUNNER_PID" 2>/dev/null
	bash "$VERIFY" check --session "$SESSION" >"$CASE_DIR/check1.log" 2>&1
	assert_eq "check finds residue" 1 "$?"
	assert_contains "check reports the pane pid" "$(cat "$CASE_DIR/check1.log")" "id=$pane"
	tmux kill-session -t "=$SESSION" 2>/dev/null || true
	kill_all_session_members "$pane"
	rm -rf -- "$temp"
	sleep 0.3
	bash "$VERIFY" check --session "$SESSION" >"$CASE_DIR/check2.log" 2>&1
	assert_eq "check is clean after manual recovery" 0 "$?"
	assert_contains "check prints the clean line" "$(cat "$CASE_DIR/check2.log")" "clean session=$SESSION"
}

case_check_skips_clean() {
	case_dir check-skips-clean
	start_run "$CASE_DIR/run.log" --session cleanrec -- sleep 1
	assert_eq "run starts" 0 "$?"
	wait_runner
	assert_eq "run exits 0" 0 "$RUNNER_RC"
	bash "$VERIFY" check >"$CASE_DIR/check1.log" 2>&1
	assert_eq "check without arguments exits 0" 0 "$?"
	assert_eq "clean records are not reported" "clean" "$(cat "$CASE_DIR/check1.log")"
	bash "$VERIFY" check --session "$SESSION" >"$CASE_DIR/check2.log" 2>&1
	assert_eq "check with the session exits 0" 0 "$?"
	assert_eq "check prints the clean line" "clean session=$SESSION" "$(cat "$CASE_DIR/check2.log")"
}

case_check_prune() {
	case_dir check-prune
	start_run "$CASE_DIR/clean.log" --session pruneclean -- sleep 1
	assert_eq "clean run starts" 0 "$?"
	wait_runner
	local clean_rec="$RECORDS/$SESSION.env"
	start_run "$CASE_DIR/dirty.log" --session prunedirty -- sleep 300
	assert_eq "dirty run starts" 0 "$?"
	sleep 0.5
	local dirty_rec="$RECORDS/$SESSION.env"
	local pane temp
	pane=$(record_value PANE_PID)
	temp=$(record_value TEMP_PATH)
	kill -9 "$RUNNER_PID" 2>/dev/null || true
	wait "$RUNNER_PID" 2>/dev/null
	bash "$VERIFY" check --prune >"$CASE_DIR/prune.log" 2>&1
	assert_eq "check --prune exits 1 while residue remains" 1 "$?"
	assert_file_absent "the clean record is pruned" "$clean_rec"
	assert_file_exists "the residue record remains" "$dirty_rec"
	tmux kill-session -t "=$SESSION" 2>/dev/null || true
	kill_all_session_members "$pane"
	rm -rf -- "$temp"
}

case_check_pid_reuse_not_residue() {
	case_dir check-pid-reuse-not-residue
	setsid sleep 300 &
	local leader=$!
	CLEANUP_PIDS+=("$leader")
	sleep 0.2
	if ! kill -0 "$leader" 2>/dev/null; then
		not_ok "the session leader did not stay alive"
		return 0
	fi
	local start
	start=$(awk '{print $22}' "/proc/$leader/stat" 2>/dev/null)
	if [[ -z $start ]]; then
		not_ok "the session leader start time is readable"
		return 0
	fi
	ok "the session leader start time is readable"
	write_fake_record reuse "PANE_PID='$leader'" "PANE_SESSION_ID='$leader'" "PANE_STARTTIME='$((start + 1))'"
	bash "$VERIFY" check --session reuse >"$CASE_DIR/check.log" 2>&1
	assert_eq "check exits 0 when the pid was reused" 0 "$?"
	local out
	out=$(cat "$CASE_DIR/check.log")
	assert_contains "the reused pid is reported" "$out" "reused pid=$leader"
	assert_not_contains "the reused process is not residue" "$out" "residue"
	kill -9 "$leader" 2>/dev/null || true
}

case_check_port_residue() {
	case_dir check-port-residue
	if ! command -v python3 >/dev/null 2>&1; then
		skip "python3 is not available"
		return 0
	fi
	local port
	port=$(free_port)
	start_run "$CASE_DIR/run.log" --session portres --port "$port" \
		-- python3 -m http.server "$port" --bind 127.0.0.1
	assert_eq "run starts" 0 "$?"
	local i
	for ((i = 0; i < 50; i++)); do
		test_port_listening "$port" && break
		sleep 0.1
	done
	if test_port_listening "$port"; then ok "the declared port is listening"; else not_ok "the declared port is listening"; fi
	kill -9 "$RUNNER_PID" 2>/dev/null || true
	wait "$RUNNER_PID" 2>/dev/null
	bash "$VERIFY" check --session "$SESSION" >"$CASE_DIR/check.log" 2>&1
	assert_eq "check finds residue" 1 "$?"
	local out
	out=$(cat "$CASE_DIR/check.log")
	assert_contains "the port residue is reported" "$out" "kind=port id=$port"
	assert_contains "the port residue has a reason" "$out" "reason=listen"
	local pane temp
	pane=$(record_value PANE_PID)
	temp=$(record_value TEMP_PATH)
	tmux kill-session -t "=$SESSION" 2>/dev/null || true
	kill_all_session_members "$pane"
	rm -rf -- "$temp"
}

case_check_dir_fail_closed() {
	case_dir check-dir-fail-closed
	mkdir -p "$CASE_DIR/elsewhere"
	ln -s "$CASE_DIR/elsewhere" "$RECORDS"
	bash "$VERIFY" check >"$CASE_DIR/check-symlink.log" 2>&1
	assert_eq "a symlinked records directory exits 2" 2 "$?"
	rm -f "$RECORDS"
	export SPIRITS_VERIFY_STATE_DIR="$CASE_DIR/state-link"
	ln -s "$CASE_DIR/elsewhere" "$CASE_DIR/state-link"
	bash "$VERIFY" check >"$CASE_DIR/check-state.log" 2>&1
	local rc=$?
	export SPIRITS_VERIFY_STATE_DIR="$CASE_DIR/state"
	assert_eq "a symlinked state directory exits 2" 2 "$rc"
}

# --- run ------------------------------------------------------------------------------------

run_case() {
	local fn=$1
	"$fn"
}

run_case case_usage_and_env
run_case case_records_before_command
run_case case_unique_session_name
run_case case_reap_signal_ignoring
run_case case_reap_on_interrupt
run_case case_keep_preexisting
run_case case_pid_reuse_not_killed
run_case case_setsid_escapee_reported
run_case case_timeout_stage1_notice
run_case case_timeout_no_extension
run_case case_timeout_extended
run_case case_extend_rejected
run_case case_kill_session_during_wait
run_case case_timeout_with_residue
run_case case_extend_after_deadline
run_case case_temp_and_port_released
run_case case_explicit_temp_kept
run_case case_held_temp_kept
run_case case_check_after_runner_kill
run_case case_check_skips_clean
run_case case_check_prune
run_case case_check_pid_reuse_not_residue
run_case case_check_port_residue
run_case case_check_dir_fail_closed

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [[ $FAIL -ne 0 ]]; then
	exit 1
fi
