#!/bin/sh
#
# End-to-end self-update smoke test for compiled binaries.
#
#   sh scripts/self-update-smoke.sh <old-binary> <new-binary> <expected-version>
#
# Serves a fixture release (the new binary listed as the latest stable) over HTTP, copies the old
# binary into a temporary install directory, and runs `update` against the fixture. Fails unless
# the exit code is 0, `--version` contains the expected version, and no temp directory is left.
#
# Used by the release workflow and for local smoke tests.

set -eu

OLD_BINARY=${1:?usage: self-update-smoke.sh <old-binary> <new-binary> <expected-version>}
NEW_BINARY=${2:?usage: self-update-smoke.sh <old-binary> <new-binary> <expected-version>}
EXPECTED_VERSION=${3:?usage: self-update-smoke.sh <old-binary> <new-binary> <expected-version>}

[ -f "$OLD_BINARY" ] || { echo "Error: old binary not found: $OLD_BINARY" >&2; exit 1; }
[ -f "$NEW_BINARY" ] || { echo "Error: new binary not found: $NEW_BINARY" >&2; exit 1; }

# Release contract shared with install.sh and the updater.
OWNER="betiz0"
REPO="spirits"
ARTIFACT="spirits-linux-x64"
TAG_PREFIX="spirits-v"
NEW_TAG="$TAG_PREFIX$EXPECTED_VERSION"

WORK_DIR=$(mktemp -d)
SERVER_ROOT="$WORK_DIR/server"
INSTALL_DIR="$WORK_DIR/install"
mkdir -p "$SERVER_ROOT/repos/$OWNER/$REPO" "$SERVER_ROOT/$OWNER/$REPO/releases/download/$NEW_TAG" "$INSTALL_DIR"

SERVER_PID=""
cleanup() {
	if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
	rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

# Fixture release: the new binary is the only stable `spirits-v*` release.
printf '[{"tag_name":"%s","draft":false,"prerelease":false}]\n' "$NEW_TAG" \
	>"$SERVER_ROOT/repos/$OWNER/$REPO/releases"
cp "$NEW_BINARY" "$SERVER_ROOT/$OWNER/$REPO/releases/download/$NEW_TAG/$ARTIFACT"
(cd "$SERVER_ROOT/$OWNER/$REPO/releases/download/$NEW_TAG" && sha256sum "$ARTIFACT" >"$ARTIFACT.sha256")

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

echo "Running self-update from $OLD_BINARY to spirits $EXPECTED_VERSION..." >&2
if ! SPIRITS_API_BASE_URL="$BASE_URL" SPIRITS_RELEASE_BASE_URL="$BASE_URL" \
	"$INSTALL_DIR/spirits" update >"$WORK_DIR/update.out" 2>"$WORK_DIR/update.err"; then
	cat "$WORK_DIR/update.out" >&2 || true
	cat "$WORK_DIR/update.err" >&2 || true
	echo "Error: self-update exited non-zero." >&2
	exit 1
fi

version_line=$("$INSTALL_DIR/spirits" --version | head -n 1)
case "$version_line" in
	*"$EXPECTED_VERSION"*) ;;
	*)
		echo "Error: updated binary reports [$version_line], expected version $EXPECTED_VERSION." >&2
		exit 1
		;;
esac

leftover=$(find "$INSTALL_DIR" -maxdepth 1 -name '.spirits-tmp-*' | head -n 1)
if [ -n "$leftover" ]; then
	echo "Error: temporary directory left behind: $leftover" >&2
	exit 1
fi

echo "Self-update smoke passed: $version_line" >&2
