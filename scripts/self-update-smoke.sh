#!/bin/sh
#
# End-to-end self-update smoke test for compiled binaries.
#
#   sh scripts/self-update-smoke.sh <old-binary> <new-binary> <expected-version> \
#       [managed-manifest] [managed-bundle]
#
# Serves a fixture release (the new executable, its checksum, and the managed Pi set manifest and
# bundle, listed as the latest stable) over HTTP, copies the old binary into a temporary install
# directory, and runs `update` against the fixture with an isolated HOME so the managed set can never
# reach the caller's ~/.spirits. The agent-directory and package-directory variables of the caller's
# environment are dropped for every run of the installed binary: they override `HOME`, and an
# interactive spirits session that runs this smoke has them set. Fails unless the exit code is 0, `--version` reports the expected
# version, the managed set of the fixture release is installed and passes launch-time verification
# (`spirits managed-pi -- --version`), and no temp directory is left.
#
# It then runs `update` again on the updated binary with the executable-only fixture: a release that
# no longer carries the theme assets a pre-managed updater fetched. The second run must answer that
# the install is current, place nothing, and stay zero.
#
# The managed manifest is served unmodified. Its Pi artifact is the absolute URL of the official
# earendil-works/pi release, so the smoke downloads the real tarball and verifies it against the
# checksum pinned in the manifest. This smoke therefore needs network access to GitHub.
#
# `managed-manifest` defaults to `<dir of new-binary>/spirits-managed-pi-manifest.json` and
# `managed-bundle` to `<dir of new-binary>/spirits-managed-pi-extension.js` — the locations the
# release workflow builds before running this smoke. The theme assets are served only when
# `SPIRITS_SMOKE_THEME_DIR` (default `<dir of new-binary>/theme`) holds them, so a release that still
# attaches them for old updaters can be reproduced; the updated binary must never request them.
#
# Used by the release workflow and for local smoke tests.

set -eu

OLD_BINARY=${1:?usage: self-update-smoke.sh <old-binary> <new-binary> <expected-version> [managed-manifest] [managed-bundle]}
NEW_BINARY=${2:?usage: self-update-smoke.sh <old-binary> <new-binary> <expected-version> [managed-manifest] [managed-bundle]}
EXPECTED_VERSION=${3:?usage: self-update-smoke.sh <old-binary> <new-binary> <expected-version> [managed-manifest] [managed-bundle]}
NEW_BINARY_DIR=$(dirname "$NEW_BINARY")
MANAGED_MANIFEST=${4:-$NEW_BINARY_DIR/spirits-managed-pi-manifest.json}
MANAGED_BUNDLE=${5:-$NEW_BINARY_DIR/spirits-managed-pi-extension.js}
THEME_SOURCE_DIR=${SPIRITS_SMOKE_THEME_DIR:-$NEW_BINARY_DIR/theme}

[ -f "$OLD_BINARY" ] || { echo "Error: old binary not found: $OLD_BINARY" >&2; exit 1; }
[ -f "$NEW_BINARY" ] || { echo "Error: new binary not found: $NEW_BINARY" >&2; exit 1; }
[ -f "$MANAGED_MANIFEST" ] ||
	{ echo "Error: managed manifest not found: $MANAGED_MANIFEST" >&2; exit 1; }
[ -f "$MANAGED_BUNDLE" ] ||
	{ echo "Error: managed bundle not found: $MANAGED_BUNDLE" >&2; exit 1; }

# Release contract shared with install.sh and the updater.
OWNER="betiz0"
REPO="spirits"
ARTIFACT="spirits-linux-x64"
TAG_PREFIX="spirits-v"
NEW_TAG="$TAG_PREFIX$EXPECTED_VERSION"

# Managed release asset names, the same contract as install.sh and spirits-release.yml.
MANIFEST_ASSET="spirits-managed-pi-manifest.json"
BUNDLE_ASSET="spirits-managed-pi-extension.js"

# The assets a pre-managed updater fetched. Releases keep attaching them for those binaries; nothing
# from this change onward asks for them.
COMPAT_ASSETS="dark.json light.json"

# Set id of the served manifest; the installed set must land under releases/<set-id>.
SET_ID=$(sed -n 's/^[[:space:]]*"setId": "\([^"]*\)".*/\1/p' "$MANAGED_MANIFEST" | head -n 1)
[ -n "$SET_ID" ] || { echo "Error: could not read setId from $MANAGED_MANIFEST" >&2; exit 1; }

WORK_DIR=$(mktemp -d)
SERVER_ROOT="$WORK_DIR/server"
SERVE_DIR="$SERVER_ROOT/$OWNER/$REPO/releases/download/$NEW_TAG"
INSTALL_DIR="$WORK_DIR/install"
# Isolated HOME for every run of the installed binary: the managed set follows `homedir()`, and
# without this the smoke would write into the invoking user's ~/.spirits/managed-pi.
FAKE_HOME="$WORK_DIR/home"
MANAGED_ROOT="$FAKE_HOME/.spirits/managed-pi"
MANAGED_SET_DIR="$MANAGED_ROOT/releases/$SET_ID"
mkdir -p "$SERVER_ROOT/repos/$OWNER/$REPO" "$SERVE_DIR" "$INSTALL_DIR" "$FAKE_HOME"

SERVER_PID=""
cleanup() {
	if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
	rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

serve_with_checksum() { # path
	cp "$1" "$SERVE_DIR/$(basename "$1")"
	(cd "$SERVE_DIR" && sha256sum "$(basename "$1")" >"$(basename "$1").sha256")
}

# Fixture release: the new executable is the only stable `spirits-v*` release.
printf '[{"tag_name":"%s","draft":false,"prerelease":false}]\n' "$NEW_TAG" \
	>"$SERVER_ROOT/repos/$OWNER/$REPO/releases"
serve_with_checksum "$NEW_BINARY"
serve_with_checksum "$MANAGED_MANIFEST"
serve_with_checksum "$MANAGED_BUNDLE"
compat_assets_served=no
for name in $COMPAT_ASSETS; do
	if [ -f "$THEME_SOURCE_DIR/$name" ]; then
		compat_assets_served=yes
		serve_with_checksum "$THEME_SOURCE_DIR/$name"
	fi
done

PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$SERVER_ROOT" >"$WORK_DIR/server.log" 2>&1 &
SERVER_PID=$!
BASE_URL="http://127.0.0.1:$PORT"

i=0
while [ "$i" -lt 100 ]; do
	if curl -fsS "$BASE_URL/repos/$OWNER/$REPO/releases" >/dev/null 2>&1; then
		break
	fi
	i=$((i + 1))
	sleep 0.1
done

cp "$OLD_BINARY" "$INSTALL_DIR/spirits"
chmod 755 "$INSTALL_DIR/spirits"

# Every run of the installed binary sees only the isolated HOME. An agent directory named by the
# caller's environment wins over `HOME` in the managed route, and the launch guard refuses a managed
# start whose explicit agent directory is outside the managed root - which is what happens when this
# smoke runs from an interactive spirits session. Dropping the redirecting variables is what makes
# "isolated HOME" true for the run instead of only for the paths the script itself builds.
run_installed() {
	env \
		-u SPIRITS_CODING_AGENT_DIR -u SPIRITS_CODING_AGENT_SESSION_DIR \
		-u PI_CODING_AGENT_DIR -u PI_CODING_AGENT_SESSION_DIR \
		-u PI_APP_NAME -u PI_CONFIG_DIR -u PI_PACKAGE_DIR \
		"$@"
}

fail_with_output() { # label out-file err-file
	echo "Error [$1]:" >&2
	cat "$2" >&2 || true
	cat "$3" >&2 || true
	exit 1
}

# After a successful `spirits update` the binary installs the managed set of the release it belongs
# to. Assert the placement the layout guarantees, then launch through the managed route: the launch
# verifies the installed state, the overlay, the bundle, and the host executable before spawning.
assert_managed_set() {
	label=$1
	[ -L "$MANAGED_ROOT/current" ] || {
		echo "Error [$label]: $MANAGED_ROOT/current is not a symlink." >&2
		exit 1
	}
	current_target=$(readlink "$MANAGED_ROOT/current")
	# The guard's own report is the useful artifact when this fails, so the launch keeps its output.
	[ "$current_target" = "releases/$SET_ID" ] || {
		echo "Error [$label]: current points at [$current_target], expected [releases/$SET_ID]." >&2
		exit 1
	}
	[ -x "$MANAGED_SET_DIR/pi/pi" ] || {
		echo "Error [$label]: managed host executable missing or not executable: $MANAGED_SET_DIR/pi/pi" >&2
		exit 1
	}
	cmp -s "$MANAGED_BUNDLE" "$MANAGED_SET_DIR/spirits-extension.js" || {
		echo "Error [$label]: installed bundle differs from the release bundle." >&2
		exit 1
	}
	[ -f "$MANAGED_SET_DIR/installed.json" ] || {
		echo "Error [$label]: no installed state: $MANAGED_SET_DIR/installed.json" >&2
		exit 1
	}
	if ! run_installed HOME="$FAKE_HOME" "$INSTALL_DIR/spirits" managed-pi -- --version \
		>"$WORK_DIR/managed-$label.out" 2>"$WORK_DIR/managed-$label.err"; then
		fail_with_output "$label: managed launch verification failed" \
			"$WORK_DIR/managed-$label.out" "$WORK_DIR/managed-$label.err"
	fi
	echo "Managed set verified [$label]: current -> releases/$SET_ID" >&2
}

assert_no_temp_dirs() { # label
	leftover=$(find "$INSTALL_DIR" -maxdepth 1 -name '.spirits-tmp-*' | head -n 1)
	if [ -n "$leftover" ]; then
		echo "Error [$1]: temporary directory left behind: $leftover" >&2
		exit 1
	fi
}

echo "Running self-update from $OLD_BINARY to spirits $EXPECTED_VERSION..." >&2
if ! run_installed HOME="$FAKE_HOME" SPIRITS_API_BASE_URL="$BASE_URL" SPIRITS_RELEASE_BASE_URL="$BASE_URL" \
	"$INSTALL_DIR/spirits" update >"$WORK_DIR/update.out" 2>"$WORK_DIR/update.err"; then
	fail_with_output "self-update exited non-zero" "$WORK_DIR/update.out" "$WORK_DIR/update.err"
fi

version_line=$(run_installed "$INSTALL_DIR/spirits" --version | head -n 1)
case "$version_line" in
	*"$EXPECTED_VERSION"*) ;;
	*)
		echo "Error: updated binary reports [$version_line], expected version $EXPECTED_VERSION." >&2
		exit 1
		;;
esac

assert_no_temp_dirs "after-update"
assert_managed_set after-update

# The state a pre-managed release leaves behind: theme assets next to the executable. The updated
# binary neither reads nor re-fetches them, so the fixture drops them and the run stays zero.
rm -rf "$INSTALL_DIR/theme"
if [ "$compat_assets_served" = yes ]; then
	for name in $COMPAT_ASSETS; do
		rm -f "$SERVE_DIR/$name" "$SERVE_DIR/$name.sha256"
	done
fi

echo "Running self-update again on the current version with an executable-only release..." >&2
if ! run_installed HOME="$FAKE_HOME" SPIRITS_API_BASE_URL="$BASE_URL" SPIRITS_RELEASE_BASE_URL="$BASE_URL" \
	"$INSTALL_DIR/spirits" update >"$WORK_DIR/repair.out" 2>"$WORK_DIR/repair.err"; then
	fail_with_output "the current-version run exited non-zero" "$WORK_DIR/repair.out" "$WORK_DIR/repair.err"
fi

grep -q "already up to date" "$WORK_DIR/repair.out" || {
	echo "Error: the current-version run did not report the install as current." >&2
	cat "$WORK_DIR/repair.out" >&2
	exit 1
}
if [ -e "$INSTALL_DIR/theme" ]; then
	echo "Error: the current-version run placed theme assets: $INSTALL_DIR/theme" >&2
	exit 1
fi

assert_no_temp_dirs "after-current-version-run"
assert_managed_set after-current-version-run

echo "Self-update smoke passed: $version_line" >&2
