#!/usr/bin/env bash
#
# Regression smoke test for the compiled spirits binary's .env autoload behavior.
#
#   bash scripts/test-dotenv-smoke.sh <binary>
#
# Reproduces the binary-distribution spec scenarios: the binary must ignore
# .env, .env.local, and .env.<NODE_ENV> in the startup directory, while shell
# environment variables must still reach the process.
#
# A probe extension writes process.env as JSON to a record file from the
# session_start event and exits. Every case runs with isolated cwd and agent
# directories so the user's real agent directory is never read.

set -euo pipefail

BINARY=${1:?usage: test-dotenv-smoke.sh <binary>}

[ -f "$BINARY" ] || {
	echo "Error: binary not found: $BINARY" >&2
	exit 1
}
BINARY=$(cd "$(dirname "$BINARY")" && pwd)/$(basename "$BINARY")

WORK_DIR=$(mktemp -d)
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT INT TERM

PROBE="$WORK_DIR/probe.js"
cat >"$PROBE" <<'PROBE_EOF'
import { writeFileSync } from "node:fs";

export default function (pi) {
	pi.on("session_start", () => {
		const record = process.env.SPIRITS_DOTENV_SMOKE_RECORD;
		if (!record) throw new Error("SPIRITS_DOTENV_SMOKE_RECORD is required");
		writeFileSync(record, JSON.stringify(process.env, null, 2));
		process.exit(0);
	});
}
PROBE_EOF

FAILED=0

# run_case <name> <cwd> <agent> <record> [VAR=value ...]
run_case() {
	local name="$1" cwd="$2" agent="$3" record="$4"
	shift 4
	mkdir -p "$cwd" "$agent"
	rm -f "$record"
	local code=0
	(
		cd "$cwd"
		env -u SPIRITS_DOTENV_PROBE -u SPIRITS_DOTENV_LOCAL_PROBE -u SPIRITS_DOTENV_MODE_PROBE \
			SPIRITS_CODING_AGENT_DIR="$agent" SPIRITS_DOTENV_SMOKE_RECORD="$record" "$@" \
			"$BINARY" -e "$PROBE" -p probe >"$WORK_DIR/$name.out" 2>"$WORK_DIR/$name.err"
	) || code=$?
	if [ ! -f "$record" ]; then
		echo "FAIL ($name): probe did not run (exit $code); stderr: $(tail -n 3 "$WORK_DIR/$name.err" | tr '\n' ' ')" >&2
		FAILED=1
		return 1
	fi
	return 0
}

# check_absent <name> <record> <key> <scenario>
check_absent() {
	local name="$1" record="$2" key="$3" scenario="$4"
	if grep -q "\"$key\"" "$record"; then
		echo "FAIL ($name): $scenario: $key was loaded from a .env file" >&2
		FAILED=1
	else
		echo "PASS ($name): $scenario: $key is absent"
	fi
}

# check_present <name> <record> <key> <value> <scenario>
check_present() {
	local name="$1" record="$2" key="$3" value="$4" scenario="$5"
	if grep -q "\"$key\": \"$value\"" "$record"; then
		echo "PASS ($name): $scenario: $key=$value is present"
	else
		echo "FAIL ($name): $scenario: $key=$value is missing" >&2
		FAILED=1
	fi
}

# (a) .env in the startup directory must be ignored.
a_cwd="$WORK_DIR/a-cwd"
mkdir -p "$a_cwd"
printf 'SPIRITS_DOTENV_PROBE=1\n' >"$a_cwd/.env"
if run_case a "$a_cwd" "$WORK_DIR/a-agent" "$WORK_DIR/a-record.json"; then
	check_absent a "$WORK_DIR/a-record.json" SPIRITS_DOTENV_PROBE "startup .env"
fi

# (b) .env.local and .env.<NODE_ENV> must be ignored.
b_cwd="$WORK_DIR/b-cwd"
mkdir -p "$b_cwd"
printf 'SPIRITS_DOTENV_LOCAL_PROBE=1\n' >"$b_cwd/.env.local"
printf 'SPIRITS_DOTENV_MODE_PROBE=1\n' >"$b_cwd/.env.production"
if run_case b "$b_cwd" "$WORK_DIR/b-agent" "$WORK_DIR/b-record.json" NODE_ENV=production; then
	check_absent b "$WORK_DIR/b-record.json" SPIRITS_DOTENV_LOCAL_PROBE "startup .env.local"
	check_absent b "$WORK_DIR/b-record.json" SPIRITS_DOTENV_MODE_PROBE "startup .env.production"
fi

# (c) Shell environment variables must reach the binary.
if run_case c "$WORK_DIR/c-cwd" "$WORK_DIR/c-agent" "$WORK_DIR/c-record.json" SPIRITS_DOTENV_PROBE=1; then
	check_present c "$WORK_DIR/c-record.json" SPIRITS_DOTENV_PROBE 1 "shell environment"
fi

if [ "$FAILED" -ne 0 ]; then
	echo "Error: .env autoload smoke test failed." >&2
	exit 1
fi

echo "All .env autoload smoke checks passed."
