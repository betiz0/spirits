#!/usr/bin/env bash
#
# tmux verification runner.
#
# Usage:
#   scripts/tmux-verify.sh run --session <name> [--temp <dir>] [--port <n>] -- <command...>
#   scripts/tmux-verify.sh extend --session <name> --seconds <n>
#   scripts/tmux-verify.sh check [--session <name>] [--prune]
#
# `run` starts the command in a tmux pane behind a FIFO gate, persists a record
# of how to recover the process tree before the command starts, waits for the
# pane to end or for the two-stage timeout, and then kills what is left.
# The design is documented in openspec/changes/harden-verification-cleanup/design.md.
#
# Exit codes for `run`:
#   0    ended and nothing was left behind
#   1    something was left behind
#   2    startup error (missing tmux, bad setting, bad name, collision, bad state dir)
#   124  two-stage timeout
#   128+n interrupted by signal n
#
# Exit codes for `extend`:
#   0    the extension was accepted
#   1    the session was not awaiting an extension, or it was not accepted
#   2    usage error
#
# Exit codes for `check`:
#   0    no residue
#   1    residue found
#   2    usage or environment error

set -euo pipefail

SCRIPT_PATH=$(readlink -f -- "$0" 2>/dev/null || printf '%s' "$0")
STATE_DIR_BASE=${SPIRITS_VERIFY_STATE_DIR:-${XDG_RUNTIME_DIR:-/tmp}/spirits-verify}
RECORDS_DIR="$STATE_DIR_BASE/records"
DEFAULT_TIMEOUT_SECONDS=180
SCOPE_WAIT_SECONDS=3
REAP_WAIT_SECONDS=5
EXTEND_WAIT_SECONDS=3
GATE_TIMEOUT_SECONDS=10
ESCAPED_QUOTE="'\\''"

# Record fields. Every field is written to the record file and read back with
# `source`; values are quoted with printf %q and the directory is verified to be
# owned by the user before it is read.
SESSION=
PANE_PID=
PANE_STARTTIME=
PANE_SESSION_ID=
CGROUP_PATH=
SCOPE_UNIT=
TMUX_SERVER_PID=
TEMP_PATH=
TEMP_OWNED=0
PORT=
TIMEOUT_SECONDS=$DEFAULT_TIMEOUT_SECONDS
COMMAND_STR=
STATUS=
PHASE=
STAGE2_SECONDS=
EXTEND_DEADLINE=
STARTED_AT=
RECORD_FILE=
FIFO_PATH=

die() {
	printf 'tmux-verify: error: %s\n' "$*" >&2
	exit 2
}

usage() {
	cat <<'EOF'
Usage:
  tmux-verify.sh run --session <name> [--temp <dir>] [--port <n>] -- <command...>
  tmux-verify.sh extend --session <name> --seconds <n>
  tmux-verify.sh check [--session <name>] [--prune]

run:
  Start <command...> in a uniquely named tmux session and print
  "session=<name>" as the first line. Wait for the pane to end, the session to
  disappear, or the timeout, then recover the processes. The first-stage
  timeout defaults to 180 seconds and can be changed with TIMEOUT_SECONDS in
  ${XDG_CONFIG_HOME:-$HOME/.config}/spirits-verify/config.

extend:
  While run is waiting for an extension after the first-stage timeout, accept
  one extension of the given number of seconds.

check:
  Inspect the records for processes, scopes, temporary paths, and declared
  ports that are still around. Without --session every record except the ones
  that ended clean is checked. --prune removes the records confirmed clean.

Exit codes:
  run 0 clean / 1 residue / 2 startup error / 124 timeout / 128+n signal
  extend 0 accepted / 1 rejected / 2 usage error
  check 0 clean / 1 residue / 2 usage or environment error
EOF
}

sh_quote() {
	local s=$1 out="'"
	while [[ $s == *"'"* ]]; do
		out+="${s%%\'*}$ESCAPED_QUOTE"
		s=${s#*\'}
	done
	printf '%s' "$out$s'"
}

# --- /proc helpers --------------------------------------------------------------------------

proc_field() { # pid field_number(1-based)
	local pid=$1 field=$2 stat idx
	[[ -r /proc/$pid/stat ]] || return 1
	stat=$(</proc/$pid/stat) || return 1
	# Drop "pid (comm) "; comm is the last thing before the space-separated fields.
	stat=${stat##*) }
	local -a fields=($stat)
	idx=$((field - 3))
	[[ $idx -ge 0 && $idx -lt ${#fields[@]} ]] || return 1
	printf '%s' "${fields[idx]}"
}

session_members() { # pane_pid earliest_starttime
	local pane_pid=$1 pane_start=$2 d pid start session
	for d in /proc/[0-9]*; do
		pid=${d#/proc/}
		start=$(proc_field "$pid" 22 2>/dev/null) || continue
		if [[ $start -lt $pane_start ]]; then
			continue
		fi
		session=$(proc_field "$pid" 6 2>/dev/null) || continue
		[[ $session == "$pane_pid" ]] || continue
		printf '%s\n' "$pid"
	done
}

collect_escapees() { # session pane_pid earliest_starttime
	local session_name=$1 pane_pid=$2 pane_start=$3 d pid start proc_session
	for d in /proc/[0-9]*; do
		pid=${d#/proc/}
		[[ $pid == "$pane_pid" ]] && continue
		start=$(proc_field "$pid" 22 2>/dev/null) || continue
		if [[ $start -lt $pane_start ]]; then
			continue
		fi
		[[ -r $d/environ ]] || continue
		if ! tr '\0' '\n' 2>/dev/null <"$d/environ" | grep -Fxq "SPIRITS_VERIFY_SESSION=$session_name"; then
			continue
		fi
		proc_session=$(proc_field "$pid" 6 2>/dev/null) || proc_session=
		[[ $proc_session == "$pane_pid" ]] && continue
		printf '%s\n' "$pid"
	done
}

# --- record helpers -------------------------------------------------------------------------

load_record() { # file
	local file=$1
	[[ -f $file && ! -L $file && -O $file ]] || return 1
	SESSION=
	PANE_PID=
	PANE_STARTTIME=
	PANE_SESSION_ID=
	CGROUP_PATH=
	SCOPE_UNIT=
	TMUX_SERVER_PID=
	TEMP_PATH=
	TEMP_OWNED=0
	PORT=
	TIMEOUT_SECONDS=$DEFAULT_TIMEOUT_SECONDS
	COMMAND_STR=
	STATUS=
	PHASE=
	STAGE2_SECONDS=
	EXTEND_DEADLINE=
	STARTED_AT=
	# shellcheck disable=SC1090
	. "$file"
}

write_record() {
	local tmp="$RECORDS_DIR/.$SESSION.env.tmp"
	{
		printf 'SESSION=%q\n' "$SESSION"
		printf 'PANE_PID=%q\n' "$PANE_PID"
		printf 'PANE_STARTTIME=%q\n' "$PANE_STARTTIME"
		printf 'PANE_SESSION_ID=%q\n' "$PANE_SESSION_ID"
		printf 'CGROUP_PATH=%q\n' "$CGROUP_PATH"
		printf 'SCOPE_UNIT=%q\n' "$SCOPE_UNIT"
		printf 'TMUX_SERVER_PID=%q\n' "$TMUX_SERVER_PID"
		printf 'TEMP_PATH=%q\n' "$TEMP_PATH"
		printf 'TEMP_OWNED=%q\n' "$TEMP_OWNED"
		printf 'PORT=%q\n' "$PORT"
		printf 'TIMEOUT_SECONDS=%q\n' "$TIMEOUT_SECONDS"
		printf 'COMMAND_STR=%q\n' "$COMMAND_STR"
		printf 'STATUS=%q\n' "$STATUS"
		printf 'PHASE=%q\n' "$PHASE"
		printf 'STAGE2_SECONDS=%q\n' "$STAGE2_SECONDS"
		printf 'EXTEND_DEADLINE=%q\n' "$EXTEND_DEADLINE"
		printf 'STARTED_AT=%q\n' "$STARTED_AT"
	} >"$tmp"
	mv -f -- "$tmp" "$RECORD_FILE"
}

record_set() { # key value
	local key=$1 value=$2 tmp found=0 line
	[[ -f $RECORD_FILE ]] || return 0
	tmp="$RECORDS_DIR/.$SESSION.env.tmp.$$"
	{
		while IFS= read -r line || [[ -n $line ]]; do
			case "$line" in
				"$key="*)
					printf '%s=%q\n' "$key" "$value"
					found=1
					;;
				*) printf '%s\n' "$line" ;;
			esac
		done <"$RECORD_FILE"
		[[ $found == 1 ]] || printf '%s=%q\n' "$key" "$value"
	} >"$tmp"
	mv -f -- "$tmp" "$RECORD_FILE"
}

# --- state directory ------------------------------------------------------------------------

# extend and check read records; like run, they must not read through a
# symlinked or foreign-owned state/records directory (design D5, fail-closed).
require_owned_state_dir() {
	if [[ -L $STATE_DIR_BASE ]]; then
		die "state directory is a symlink: $STATE_DIR_BASE"
	fi
	if [[ -e $STATE_DIR_BASE ]]; then
		[[ -d $STATE_DIR_BASE && -O $STATE_DIR_BASE ]] ||
			die "state directory is not owned by the user: $STATE_DIR_BASE"
	fi
	if [[ -L $RECORDS_DIR ]]; then
		die "records directory is a symlink: $RECORDS_DIR"
	fi
	if [[ -e $RECORDS_DIR ]]; then
		[[ -d $RECORDS_DIR && -O $RECORDS_DIR ]] ||
			die "records directory is not owned by the user: $RECORDS_DIR"
	fi
}

ensure_state_dir() {
	if [[ -L $STATE_DIR_BASE ]]; then
		die "state directory is a symlink: $STATE_DIR_BASE"
	fi
	mkdir -p -- "$STATE_DIR_BASE" 2>/dev/null || die "cannot create state directory: $STATE_DIR_BASE"
	[[ -d $STATE_DIR_BASE && ! -L $STATE_DIR_BASE && -O $STATE_DIR_BASE ]] ||
		die "state directory is not owned by the user: $STATE_DIR_BASE"
	chmod 700 -- "$STATE_DIR_BASE"
	if [[ -L $RECORDS_DIR ]]; then
		die "records directory is a symlink: $RECORDS_DIR"
	fi
	mkdir -p -- "$RECORDS_DIR" 2>/dev/null || die "cannot create records directory: $RECORDS_DIR"
	[[ -d $RECORDS_DIR && ! -L $RECORDS_DIR && -O $RECORDS_DIR ]] ||
		die "records directory is not owned by the user: $RECORDS_DIR"
	chmod 700 -- "$RECORDS_DIR"
}

# --- recovery -------------------------------------------------------------------------------

scope_is_pane_specific() { # cgroup path (without "0::")
	local path=$1 procs
	[[ -n $path && -d /sys/fs/cgroup$path ]] || return 1
	procs=$(cat "/sys/fs/cgroup$path/cgroup.procs" 2>/dev/null) || return 1
	if printf '%s\n' "$procs" | grep -qx "$TMUX_SERVER_PID"; then
		return 1
	fi
	if printf '%s\n' "$procs" | grep -qx "$$"; then
		return 1
	fi
	return 0
}

kill_scope() {
	local attempt
	systemctl --user kill --signal=SIGKILL "$SCOPE_UNIT" >/dev/null 2>&1 || true
	# Retry for at most REAP_WAIT_SECONDS (0.2s per attempt).
	for ((attempt = 0; attempt < REAP_WAIT_SECONDS * 5; attempt++)); do
		[[ -s /sys/fs/cgroup$CGROUP_PATH/cgroup.procs ]] || break
		printf 1 >"/sys/fs/cgroup$CGROUP_PATH/cgroup.kill" 2>/dev/null || true
		sleep 0.2
	done
}

add_residue() { # kind id reason
	RESIDUE_LINES+=("residue session=$SESSION kind=$1 id=$2 reason=$3")
}

recover_session_members() {
	[[ -n ${PANE_PID:-} && $PANE_PID =~ ^[0-9]+$ ]] || return 0
	local start p attempt
	if [[ -r /proc/$PANE_PID/stat ]]; then
		start=$(proc_field "$PANE_PID" 22 2>/dev/null) || start=
		if [[ -n $start && $start != "$PANE_STARTTIME" ]]; then
			printf 'reused pid=%s\n' "$PANE_PID"
			return 0
		fi
	fi
	local -a members=()
	for ((attempt = 0; attempt < REAP_WAIT_SECONDS * 5; attempt++)); do
		members=()
		mapfile -t members < <(session_members "$PANE_PID" "$PANE_STARTTIME")
		[[ ${#members[@]} -gt 0 ]] || break
		for p in "${members[@]}"; do
			kill -9 "$p" 2>/dev/null || true
		done
		sleep 0.2
	done
	members=()
	mapfile -t members < <(session_members "$PANE_PID" "$PANE_STARTTIME")
	for p in "${members[@]}"; do
		add_residue process "$p" session-member
	done
}

temp_holder_pids() { # root path
	local root=$1 escaped
	escaped=${root//\\/\\\\}
	escaped=${escaped//\*/\\*}
	escaped=${escaped//\?/\\?}
	escaped=${escaped//\[/\\[}
	find /proc/[0-9]*/fd -maxdepth 1 -lname "$escaped" -o -lname "$escaped/*" 2>/dev/null |
		cut -d/ -f3 | sort -u
}

cleanup_temp() {
	[[ -n ${TEMP_PATH:-} ]] || return 0
	[[ -e $TEMP_PATH ]] || return 0
	local -a holders=()
	mapfile -t holders < <(temp_holder_pids "$TEMP_PATH")
	local p tmp_root
	for p in "${holders[@]}"; do
		add_residue temp "$p" fd-open
	done
	[[ ${TEMP_OWNED:-0} == 1 ]] || return 0
	[[ -d $TEMP_PATH && ! -L $TEMP_PATH ]] || return 0
	[[ ${#holders[@]} -eq 0 ]] || return 0
	tmp_root=${TMPDIR:-/tmp}
	tmp_root=${tmp_root%/}
	case "$TEMP_PATH" in
		"$tmp_root"/spirits-verify.*) ;;
		*) return 0 ;;
	esac
	[[ -f $TEMP_PATH/.spirits-verify-owned ]] || return 0
	rm -rf -- "$TEMP_PATH" 2>/dev/null || true
	if [[ -e $TEMP_PATH ]]; then
		add_residue temp "$TEMP_PATH" remove-failed
	fi
}

port_listening() { # port
	local port=$1 hex=$1 file local_addr state
	hex=$(printf '%04X' "$port")
	for file in /proc/net/tcp /proc/net/tcp6; do
		[[ -r $file ]] || continue
		while read -r _ local_addr _ state _; do
			[[ ${local_addr##*:} == "$hex" ]] || continue
			[[ $state == 0A ]] && return 0
		done <"$file"
	done
	return 1
}

check_port() {
	[[ -n ${PORT:-} ]] || return 0
	if port_listening "$PORT"; then
		add_residue port "$PORT" listen
	fi
}

recover() {
	RESIDUE_LINES=()
	if [[ -n ${RECORD_FILE:-} && -f $RECORD_FILE ]]; then
		load_record "$RECORD_FILE" || true
		if [[ -n ${SCOPE_UNIT:-} && -n ${CGROUP_PATH:-} && -d /sys/fs/cgroup$CGROUP_PATH ]]; then
			if scope_is_pane_specific "$CGROUP_PATH"; then
				local procs p
				kill_scope
				procs=$(cat "/sys/fs/cgroup$CGROUP_PATH/cgroup.procs" 2>/dev/null || true)
				for p in $procs; do
					add_residue process "$p" scope-pane
				done
				[[ -z $procs ]] || add_residue scope "$SCOPE_UNIT" procs-remain
			else
				recover_session_members
			fi
		else
			recover_session_members
		fi
		local -a escapees=()
		if [[ -n ${PANE_PID:-} && $PANE_PID =~ ^[0-9]+$ ]]; then
			mapfile -t escapees < <(collect_escapees "$SESSION" "$PANE_PID" "$PANE_STARTTIME")
			local p
			for p in "${escapees[@]}"; do
				add_residue process "$p" escapee
			done
		fi
	fi
	cleanup_temp
	check_port
	if [[ -n ${SESSION:-} ]]; then
		tmux kill-session -t "=$SESSION" >/dev/null 2>&1 || true
	fi
	rm -f -- "${FIFO_PATH:-}" 2>/dev/null || true
}

finalize_record() {
	[[ -n ${RECORD_FILE:-} && -f $RECORD_FILE ]] || return 0
	local status=clean
	[[ ${#RESIDUE_LINES[@]} -eq 0 ]] || status=residue
	record_set STATUS "$status"
	record_set PHASE done
	rm -f -- "$RECORD_FILE.extend" 2>/dev/null || true
}

handle_signal() { # exit code
	trap '' INT TERM HUP
	recover || true
	finalize_record || true
	exit "$1"
}

# --- timeout configuration ------------------------------------------------------------------

read_timeout() {
	local config="${XDG_CONFIG_HOME:-$HOME/.config}/spirits-verify/config"
	local line value
	TIMEOUT_SECONDS=$DEFAULT_TIMEOUT_SECONDS
	[[ -f $config ]] || return 0
	[[ ! -L $config ]] || die "timeout config is a symlink: $config"
	[[ -r $config ]] || die "timeout config is not readable: $config"
	while IFS= read -r line || [[ -n $line ]]; do
		case "$line" in
			TIMEOUT_SECONDS=*)
				value=${line#TIMEOUT_SECONDS=}
				value=${value%$'\r'}
				value=${value#"${value%%[![:space:]]*}"}
				value=${value%"${value##*[![:space:]]}"}
				if [[ ! $value =~ ^[0-9]+$ ]] || [[ $value -le 0 ]]; then
					die "TIMEOUT_SECONDS must be a positive integer in $config"
				fi
				TIMEOUT_SECONDS=$value
				;;
		esac
	done <"$config"
}

# --- run ------------------------------------------------------------------------------------

cmd_run() {
	local session_base= temp_arg= port= arg
	while [[ $# -gt 0 ]]; do
		case "$1" in
			--session)
				[[ $# -ge 2 ]] || die "--session requires a value"
				session_base=$2
				shift 2
				;;
			--temp)
				[[ $# -ge 2 ]] || die "--temp requires a value"
				temp_arg=$2
				shift 2
				;;
			--port)
				[[ $# -ge 2 ]] || die "--port requires a value"
				port=$2
				shift 2
				;;
			--)
				shift
				break
				;;
			-h | --help)
				usage
				exit 0
				;;
			*)
				die "unknown argument: $1"
				;;
		esac
	done
	local -a command=("$@")

	command -v tmux >/dev/null 2>&1 || die "tmux is required but was not found in PATH"
	[[ -n $session_base ]] || die "--session is required"
	[[ $session_base =~ ^[A-Za-z0-9_-]+$ ]] || die "--session allows only [A-Za-z0-9_-]: $session_base"
	[[ ${#command[@]} -gt 0 ]] || die "no verification command was given after --"
	if [[ -n $port ]]; then
		[[ $port =~ ^[0-9]+$ ]] && [[ $port -ge 1 ]] && [[ $port -le 65535 ]] ||
			die "--port must be a number between 1 and 65535: $port"
	fi
	read_timeout

	ensure_state_dir

	local hash
	hash=$(printf '%s' "$session_base:$BASHPID:$EPOCHREALTIME:$RANDOM" | sha256sum | cut -c1-8)
	SESSION="$session_base-$hash"
	RECORD_FILE="$RECORDS_DIR/$SESSION.env"
	FIFO_PATH="$STATE_DIR_BASE/run-$SESSION.fifo"

	if tmux has-session -t "=$SESSION" >/dev/null 2>&1; then
		die "tmux session already exists: $SESSION"
	fi
	[[ ! -e $RECORD_FILE ]] || die "record already exists: $RECORD_FILE"

	if [[ -n $temp_arg ]]; then
		TEMP_PATH=$temp_arg
		mkdir -p -- "$TEMP_PATH" 2>/dev/null || die "cannot create --temp directory: $TEMP_PATH"
		[[ -d $TEMP_PATH && ! -L $TEMP_PATH && -O $TEMP_PATH ]] ||
			die "--temp directory is not owned by the user: $TEMP_PATH"
		TEMP_OWNED=0
	else
		TEMP_PATH=$(mktemp -d "${TMPDIR:-/tmp}/spirits-verify.XXXXXX") || die "cannot create temporary directory"
		: >"$TEMP_PATH/.spirits-verify-owned"
		TEMP_OWNED=1
	fi
	PORT=$port
	COMMAND_STR=$(printf '%q ' "${command[@]}")
	COMMAND_STR=${COMMAND_STR% }
	STATUS=running
	PHASE=stage1
	STAGE2_SECONDS=
	EXTEND_DEADLINE=
	STARTED_AT=$(date +%s)

	trap 'handle_signal 130' INT
	trap 'handle_signal 143' TERM
	trap 'handle_signal 129' HUP

	rm -f -- "$FIFO_PATH"
	mkfifo -- "$FIFO_PATH" || die "cannot create gate fifo: $FIFO_PATH"

	local gate_cmd="exec bash $(sh_quote "$SCRIPT_PATH") __gate $(sh_quote "$FIFO_PATH")"
	for arg in "${command[@]}"; do
		gate_cmd+=" $(sh_quote "$arg")"
	done

	printf 'session=%s\n' "$SESSION"
	tmux new-session -d -s "$SESSION" \
		-e "SPIRITS_VERIFY_SESSION=$SESSION" \
		-e "SPIRITS_VERIFY_TMPDIR=$TEMP_PATH" \
		"$gate_cmd" >/dev/null || die "tmux new-session failed"

	PANE_PID=$(tmux display-message -p -t "=$SESSION:" '#{pane_pid}') || die "cannot read the pane pid"
	TMUX_SERVER_PID=$(tmux display-message -p -t "=$SESSION:" '#{pid}') || die "cannot read the tmux server pid"
	[[ -n $PANE_PID && $PANE_PID =~ ^[0-9]+$ ]] || die "tmux returned an invalid pane pid: $PANE_PID"
	PANE_STARTTIME=$(proc_field "$PANE_PID" 22 2>/dev/null) || die "cannot read the pane start time"
	PANE_SESSION_ID=$(proc_field "$PANE_PID" 6 2>/dev/null) || die "cannot read the pane session id"

	# tmux moves the pane into its transient scope asynchronously; retry briefly
	# before deciding whether the pane has a dedicated scope.
	SCOPE_UNIT=
	local cgroup path procs attempt
	for ((attempt = 0; attempt < SCOPE_WAIT_SECONDS * 10; attempt++)); do
		cgroup=$(cat "/proc/$PANE_PID/cgroup" 2>/dev/null) || cgroup=0::
		path=${cgroup#0::}
		CGROUP_PATH=$path
		case "$path" in
			*/tmux-spawn-*.scope)
				procs=$(cat "/sys/fs/cgroup$path/cgroup.procs" 2>/dev/null || true)
				if ! printf '%s\n' "$procs" | grep -qx "$TMUX_SERVER_PID" &&
					! printf '%s\n' "$procs" | grep -qx "$$"; then
					SCOPE_UNIT=${path##*/}
					break
				fi
				;;
		esac
		sleep 0.1
	done

	write_record

	printf 'go\n' >"$FIFO_PATH"

	local run_start_ns deadline_ns result=ended timeout_stage=
	local phase=stage1
	local extend_file="$RECORD_FILE.extend"
	run_start_ns=$(date +%s%N)
	deadline_ns=$((run_start_ns + TIMEOUT_SECONDS * 1000000000))
	while :; do
		if [[ $phase == awaiting-extension && -f $extend_file ]]; then
			local seconds
			seconds=$(cat "$extend_file" 2>/dev/null) || seconds=
			if [[ -n ${EXTEND_DEADLINE:-} && $(date +%s) -gt $EXTEND_DEADLINE ]]; then
				# The request came in after the acceptance deadline; drop it and
				# let the deadline branch below recover.
				rm -f -- "$extend_file"
			elif [[ $seconds =~ ^[1-9][0-9]*$ ]]; then
				rm -f -- "$extend_file"
				phase=extended
				STAGE2_SECONDS=$seconds
				deadline_ns=$(date +%s%N)
				deadline_ns=$((deadline_ns + seconds * 1000000000))
				record_set PHASE extended
				record_set STAGE2_SECONDS "$seconds"
				printf 'extended session=%s seconds=%s\n' "$SESSION" "$seconds"
			else
				rm -f -- "$extend_file"
			fi
		fi

		if ! pane_running; then
			result=ended
			break
		fi

		if [[ $(date +%s%N) -ge $deadline_ns ]]; then
			case "$phase" in
				stage1)
					phase=awaiting-extension
					EXTEND_DEADLINE=$(($(date +%s) + TIMEOUT_SECONDS))
					deadline_ns=$(date +%s%N)
					deadline_ns=$((deadline_ns + TIMEOUT_SECONDS * 1000000000))
					# Record the phase and the deadline before printing the notice so
					# an immediate `extend` always sees an updated record.
					record_set PHASE awaiting-extension
					record_set EXTEND_DEADLINE "$EXTEND_DEADLINE"
					printf 'timeout-stage1 session=%s elapsed=%s nproc=%s loadavg=%s mem_available_kb=%s extend_deadline=%s\n' \
						"$SESSION" \
						"$(($(date +%s%N) - run_start_ns) / 1000000000)" \
						"$(nproc)" \
						"$(cut -d' ' -f1-3 /proc/loadavg)" \
						"$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)" \
						"$EXTEND_DEADLINE"
					;;
				awaiting-extension)
					timeout_stage=1
					result=timeout
					break
					;;
				extended)
					timeout_stage=2
					result=timeout
					break
					;;
			esac
		fi
		sleep 0.5
	done

	recover
	if [[ $result == timeout ]]; then
		printf 'timeout session=%s stage=%s\n' "$SESSION" "$timeout_stage"
	fi
	local line
	for line in "${RESIDUE_LINES[@]}"; do
		printf '%s\n' "$line"
	done
	finalize_record
	if [[ ${#RESIDUE_LINES[@]} -gt 0 ]]; then
		exit 1
	fi
	if [[ $result == timeout ]]; then
		exit 124
	fi
	exit 0
}

pane_running() {
	[[ -d /proc/$PANE_PID ]] || return 1
	tmux has-session -t "=$SESSION" >/dev/null 2>&1
}

# --- extend ---------------------------------------------------------------------------------

cmd_extend() {
	local session= seconds= arg
	while [[ $# -gt 0 ]]; do
		case "$1" in
			--session)
				[[ $# -ge 2 ]] || die "--session requires a value"
				session=$2
				shift 2
				;;
			--seconds)
				[[ $# -ge 2 ]] || die "--seconds requires a value"
				seconds=$2
				shift 2
				;;
			-h | --help)
				usage
				exit 0
				;;
			*)
				die "unknown argument: $1"
				;;
		esac
	done
	[[ -n $session ]] || die "--session is required"
	[[ $session =~ ^[A-Za-z0-9_-]+$ ]] || die "invalid session name: $session"
	[[ $seconds =~ ^[1-9][0-9]*$ ]] || die "--seconds must be a positive integer: $seconds"

	require_owned_state_dir
	local record="$RECORDS_DIR/$session.env"
	[[ -f $record && ! -L $record && -O $record ]] || die "no record for session: $session"
	load_record "$record"
	if [[ $PHASE != awaiting-extension ]]; then
		printf 'tmux-verify: session %s is not awaiting an extension\n' "$session" >&2
		exit 1
	fi
	if [[ -n ${EXTEND_DEADLINE:-} && $(date +%s) -gt $EXTEND_DEADLINE ]]; then
		printf 'tmux-verify: the extension deadline for session %s has passed\n' "$session" >&2
		exit 1
	fi

	local request="$record.extend"
	local tmp="$record.extend.tmp.$$"
	printf '%s' "$seconds" >"$tmp"
	mv -f -- "$tmp" "$request"

	local attempt
	for ((attempt = 0; attempt < EXTEND_WAIT_SECONDS * 10; attempt++)); do
		if ! load_record "$record" 2>/dev/null; then
			rm -f -- "$request"
			printf 'tmux-verify: the record disappeared while extending %s\n' "$session" >&2
			exit 1
		fi
		if [[ $PHASE == extended && $STAGE2_SECONDS == "$seconds" ]]; then
			exit 0
		fi
		sleep 0.1
	done
	rm -f -- "$request"
	printf 'tmux-verify: session %s did not accept the extension\n' "$session" >&2
	exit 1
}

# --- check ----------------------------------------------------------------------------------

check_record() { # record file; prints residue/clean lines; 0 clean, 1 residue
	local file=$1
	local -a lines=()
	local -a holders=() members=() escapees=()
	if ! load_record "$file"; then
		printf 'tmux-verify: cannot read record: %s\n' "$file" >&2
		return 1
	fi

	if [[ -n $SCOPE_UNIT && -n $CGROUP_PATH && -d /sys/fs/cgroup$CGROUP_PATH ]]; then
		local procs p
		procs=$(cat "/sys/fs/cgroup$CGROUP_PATH/cgroup.procs" 2>/dev/null || true)
		for p in $procs; do
			lines+=("residue session=$SESSION kind=process id=$p reason=scope-pane")
		done
		[[ -z $procs ]] || lines+=("residue session=$SESSION kind=scope id=$SCOPE_UNIT reason=procs-remain")
	else
		if [[ -n $PANE_PID && $PANE_PID =~ ^[0-9]+$ && -r /proc/$PANE_PID/stat ]]; then
			local start
			start=$(proc_field "$PANE_PID" 22 2>/dev/null) || start=
			if [[ -n $start && $start != "$PANE_STARTTIME" ]]; then
				printf 'reused pid=%s\n' "$PANE_PID"
			else
				lines+=("residue session=$SESSION kind=process id=$PANE_PID reason=pane-alive")
			fi
		fi
		if [[ -n $PANE_PID && $PANE_PID =~ ^[0-9]+$ ]]; then
			local cur_start reused=0
			cur_start=$(proc_field "$PANE_PID" 22 2>/dev/null) || cur_start=
			if [[ -n $cur_start && $cur_start != "$PANE_STARTTIME" ]]; then
				reused=1
			fi
			if [[ $reused -eq 0 ]]; then
				mapfile -t members < <(session_members "$PANE_PID" "$PANE_STARTTIME")
				local p
				for p in "${members[@]}"; do
					[[ $p == "$PANE_PID" ]] && continue
					lines+=("residue session=$SESSION kind=process id=$p reason=session-member")
				done
			fi
			mapfile -t escapees < <(collect_escapees "$SESSION" "$PANE_PID" "$PANE_STARTTIME")
			for p in "${escapees[@]}"; do
				lines+=("residue session=$SESSION kind=process id=$p reason=escapee")
			done
		fi
	fi

	if [[ -n $TEMP_PATH && -e $TEMP_PATH ]]; then
		mapfile -t holders < <(temp_holder_pids "$TEMP_PATH")
		if [[ $TEMP_OWNED == 1 ]]; then
			lines+=("residue session=$SESSION kind=temp id=$TEMP_PATH reason=exists")
		fi
		local p
		for p in "${holders[@]}"; do
			lines+=("residue session=$SESSION kind=temp id=$p reason=fd-open")
		done
	fi

	if [[ -n $PORT ]] && port_listening "$PORT"; then
		lines+=("residue session=$SESSION kind=port id=$PORT reason=listen")
	fi

	if [[ ${#lines[@]} -eq 0 ]]; then
		printf 'clean session=%s\n' "$SESSION"
		return 0
	fi
	local line
	for line in "${lines[@]}"; do
		printf '%s\n' "$line"
	done
	return 1
}

cmd_check() {
	local only= prune=0
	while [[ $# -gt 0 ]]; do
		case "$1" in
			--session)
				[[ $# -ge 2 ]] || die "--session requires a value"
				only=$2
				shift 2
				;;
			--prune)
				prune=1
				shift
				;;
			-h | --help)
				usage
				exit 0
				;;
			*)
				die "unknown argument: $1"
				;;
		esac
	done
	[[ -z $only ]] || [[ $only =~ ^[A-Za-z0-9_-]+$ ]] || die "invalid session name: $only"
	require_owned_state_dir

	local -a files=() clean_files=()
	local file
	if [[ -n $only ]]; then
		file="$RECORDS_DIR/$only.env"
		[[ -f $file && ! -L $file && -O $file ]] || die "no record for session: $only"
		files+=("$file")
	elif [[ -d $RECORDS_DIR ]]; then
		for file in "$RECORDS_DIR"/*.env; do
			[[ -f $file && ! -L $file && -O $file ]] || continue
			load_record "$file" || continue
			[[ $STATUS == clean ]] && continue
			files+=("$file")
		done
	fi

	local rc=0
	for file in "${files[@]}"; do
		if check_record "$file"; then
			clean_files+=("$file")
		else
			rc=1
		fi
	done
	if [[ ${#files[@]} -eq 0 ]]; then
		printf 'clean\n'
	fi

	if [[ $prune == 1 ]]; then
		for file in "$RECORDS_DIR"/*.env; do
			[[ -f $file && ! -L $file && -O $file ]] || continue
			if load_record "$file" && [[ $STATUS == clean ]]; then
				rm -f -- "$file"
			fi
		done
		for file in "${clean_files[@]}"; do
			rm -f -- "$file"
		done
	fi
	exit "$rc"
}

# --- gate -----------------------------------------------------------------------------------

cmd_gate() {
	[[ $# -ge 1 ]] || exit 2
	local fifo=$1
	shift
	exec 3<>"$fifo"
	if ! IFS= read -r -t "$GATE_TIMEOUT_SECONDS" _ <&3; then
		printf 'tmux-verify: gate was not released; not starting the command\n' >&2
		exit 2
	fi
	exec 3<&-
	exec "$@"
}

# --- entry point ----------------------------------------------------------------------------

main() {
	local sub=${1:-}
	case "$sub" in
		run)
			shift
			cmd_run "$@"
			;;
		extend)
			shift
			cmd_extend "$@"
			;;
		check)
			shift
			cmd_check "$@"
			;;
		__gate)
			shift
			cmd_gate "$@"
			;;
		-h | --help)
			usage
			;;
		'')
			usage
			exit 2
			;;
		*)
			die "unknown subcommand: $sub"
			;;
	esac
}

# RESIDUE_LINES is written by recover/finalize and read at the end of run.
RESIDUE_LINES=()
main "$@"
