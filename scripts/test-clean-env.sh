#!/usr/bin/env bash
#
# Run the product's verification the way CI runs it: with no spirits or pi variable in the environment.
#
#   bash scripts/test-clean-env.sh              every suite, in order
#   bash scripts/test-clean-env.sh <suite>...   only the named suites
#   bash scripts/test-clean-env.sh -- <cmd>     any command, in the cleaned environment
#
# Suites: check, test, install, tmux-verify.
#
# Why this exists: the host takes its identity out of the package.json at PI_PACKAGE_DIR and derives
# from that name the variable it reads for the agent directory, so a run started from a live spirits
# inherits an identity, an agent directory, a session, and the host's own knobs, while a CI run has
# none of them. Three tests changed state with the caller that way (Spirits CI #16, commit 9c428b688).
# `packages/spirits/test/preload.ts` pins the environment for every run; this script proves the pinning
# is what makes a run deterministic, by taking the caller's values away and running the suites anyway.
#
# HOME is deliberately left alone. The agent directory is pinned to a staging directory, so a run
# neither reads nor writes `~/.pi` or `~/.spirits`, and the compatibility observations still find the
# installed official set under `$HOME`. CI has no such directory, and those observations record a gap
# there, which is the difference this script cannot remove.

set -uo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

SUITES=(check test install tmux-verify)

# Drop every spirits and pi variable the caller exported. Prefix matching covers the names of both
# products, including ones this script does not know about.
scrub_env() {
	local name removed=0
	for name in $(compgen -e | grep -E '^(PI_|SPIRITS_)' || true); do
		unset "$name"
		removed=$((removed + 1))
	done
	printf 'scrubbed %s spirits/pi variable(s) from the environment\n' "$removed"
	if compgen -e | grep -E '^(PI_|SPIRITS_)' >/dev/null; then
		printf 'not ok - spirits/pi variables survived the scrub\n' >&2
		exit 1
	fi
}

run_suite() {
	local suite=$1
	printf '\n== %s ==\n' "$suite"
	case "$suite" in
		check) bun run check ;;
		test) (cd packages/spirits && bun test) ;;
		install) sh scripts/install.test.sh ;;
		tmux-verify) bash scripts/tmux-verify.test.sh ;;
		*)
			printf 'not ok - unknown suite: %s (known: %s)\n' "$suite" "${SUITES[*]}" >&2
			return 2
			;;
	esac
}

scrub_env

if [[ ${1:-} == "--" ]]; then
	shift
	exec "$@"
fi

selected=${*:-"${SUITES[*]}"}
failed=()
for suite in $selected; do
	run_suite "$suite" || failed+=("$suite")
done

printf '\n== summary ==\n'
if ((${#failed[@]} > 0)); then
	printf 'not ok - %s\n' "${failed[*]}" >&2
	exit 1
fi
printf 'ok - all suites passed with no spirits or pi variables in the environment\n'
