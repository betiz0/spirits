#!/bin/sh
#
# End-to-end self-update smoke test for compiled binaries.
#
#   sh scripts/self-update-smoke.sh <old-binary> <new-binary> <expected-version> \
#       [theme-dir] [managed-manifest] [managed-bundle]
#
# Serves a fixture release (the new binary, its theme assets, and the managed Pi set manifest and
# bundle, listed as the latest stable) over HTTP, copies the old binary into a temporary install
# directory, and runs `update` against the fixture with an isolated HOME so the managed set can
# never reach the caller's ~/.spirits. Fails unless the exit code is 0, `--version` contains the
# expected version, the theme assets were placed, and the managed set of the fixture release is
# installed and passes launch-time verification (`spirits managed-pi -- --version`), and no temp
# directory is left. It then removes `theme/` to reproduce the state an older updater leaves behind,
# runs `update` again to check the repair path, and asserts the managed set again.
#
# The managed manifest is served unmodified. Its Pi artifact is the absolute URL of the official
# earendil-works/pi release, so the smoke downloads the real tarball and verifies it against the
# checksum pinned in the manifest. This smoke therefore needs network access to GitHub.
#
# `theme-dir` defaults to `<dir of new-binary>/theme`, `managed-manifest` to
# `<dir of new-binary>/spirits-managed-pi-manifest.json`, and `managed-bundle` to
# `<dir of new-binary>/spirits-managed-pi-extension.js` — the locations the release workflow builds
# before running this smoke.
#
# Used by the release workflow and for local smoke tests.

set -eu

OLD_BINARY=${1:?usage: self-update-smoke.sh <old-binary> <new-binary> <expected-version> [theme-dir] [managed-manifest] [managed-bundle]}
NEW_BINARY=${2:?usage: self-update-smoke.sh <old-binary> <new-binary> <expected-version> [theme-dir] [managed-manifest] [managed-bundle]}
EXPECTED_VERSION=${3:?usage: self-update-smoke.sh <old-binary> <new-binary> <expected-version> [theme-dir] [managed-manifest] [managed-bundle]}
THEME_SOURCE_DIR=${4:-$(dirname "$NEW_BINARY")/theme}
NEW_BINARY_DIR=$(dirname "$NEW_BINARY")
MANAGED_MANIFEST=${5:-$NEW_BINARY_DIR/spirits-managed-pi-manifest.json}
MANAGED_BUNDLE=${6:-$NEW_BINARY_DIR/spirits-managed-pi-extension.js}

[ -f "$OLD_BINARY" ] || { echo "Error: old binary not found: $OLD_BINARY" >&2; exit 1; }
[ -f "$NEW_BINARY" ] || { echo "Error: new binary not found: $NEW_BINARY" >&2; exit 1; }
for name in dark.json light.json; do
	[ -f "$THEME_SOURCE_DIR/$name" ] ||
		{ echo "Error: theme asset not found: $THEME_SOURCE_DIR/$name" >&2; exit 1; }
done
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

# Set id of the served manifest; the installed set must land under releases/<set-id>.
SET_ID=$(sed -n 's/^[[:space:]]*"setId": "\([^"]*\)".*/\1/p' "$MANAGED_MANIFEST" | head -n 1)
[ -n "$SET_ID" ] || { echo "Error: could not read setId from $MANAGED_MANIFEST" >&2; exit 1; }

WORK_DIR=$(mktemp -d)
SERVER_ROOT="$WORK_DIR/server"
INSTALL_DIR="$WORK_DIR/install"
# Isolated HOME for every run of the installed binary: the managed set follows `homedir()`, and
# without this the smoke would write into the invoking user's ~/.spirits/managed-pi.
FAKE_HOME="$WORK_DIR/home"
MANAGED_ROOT="$FAKE_HOME/.spirits/managed-pi"
MANAGED_SET_DIR="$MANAGED_ROOT/releases/$SET_ID"
mkdir -p "$SERVER_ROOT/repos/$OWNER/$REPO" "$SERVER_ROOT/$OWNER/$REPO/releases/download/$NEW_TAG" "$INSTALL_DIR" "$FAKE_HOME"

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
for name in dark.json light.json; do
	cp "$THEME_SOURCE_DIR/$name" "$SERVER_ROOT/$OWNER/$REPO/releases/download/$NEW_TAG/$name"
	(cd "$SERVER_ROOT/$OWNER/$REPO/releases/download/$NEW_TAG" && sha256sum "$name" >"$name.sha256")
done
# The managed set is served at the same release-download path a real release uses, so the updater's
# post-update managed install fetches the manifest and resolves the relative bundle URL against it.
cp "$MANAGED_MANIFEST" "$SERVER_ROOT/$OWNER/$REPO/releases/download/$NEW_TAG/$MANIFEST_ASSET"
(cd "$SERVER_ROOT/$OWNER/$REPO/releases/download/$NEW_TAG" && sha256sum "$MANIFEST_ASSET" >"$MANIFEST_ASSET.sha256")
cp "$MANAGED_BUNDLE" "$SERVER_ROOT/$OWNER/$REPO/releases/download/$NEW_TAG/$BUNDLE_ASSET"
(cd "$SERVER_ROOT/$OWNER/$REPO/releases/download/$NEW_TAG" && sha256sum "$BUNDLE_ASSET" >"$BUNDLE_ASSET.sha256")

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

# After a successful `spirits update` the binary installs the managed set of the release it belongs
# to. Assert the placement the layout guarantees, then launch through the managed route: the launch
# verifies the installed state, the overlay, the bundle, and the Pi executable before spawning.
assert_managed_set() {
	label=$1
	[ -L "$MANAGED_ROOT/current" ] || {
		echo "Error [$label]: $MANAGED_ROOT/current is not a symlink." >&2
		exit 1
	}
	current_target=$(readlink "$MANAGED_ROOT/current")
	[ "$current_target" = "releases/$SET_ID" ] || {
		echo "Error [$label]: current points at [$current_target], expected [releases/$SET_ID]." >&2
		exit 1
	}
	[ -x "$MANAGED_SET_DIR/pi/pi" ] || {
		echo "Error [$label]: managed Pi executable missing or not executable: $MANAGED_SET_DIR/pi/pi" >&2
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
	if ! HOME="$FAKE_HOME" "$INSTALL_DIR/spirits" managed-pi -- --version \
		>"$WORK_DIR/managed-$label.out" 2>"$WORK_DIR/managed-$label.err"; then
		cat "$WORK_DIR/managed-$label.out" >&2 || true
		cat "$WORK_DIR/managed-$label.err" >&2 || true
		echo "Error [$label]: managed launch verification failed." >&2
		exit 1
	fi
	echo "Managed set verified [$label]: current -> releases/$SET_ID" >&2
}

echo "Running self-update from $OLD_BINARY to spirits $EXPECTED_VERSION..." >&2
if ! HOME="$FAKE_HOME" SPIRITS_API_BASE_URL="$BASE_URL" SPIRITS_RELEASE_BASE_URL="$BASE_URL" \
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

for name in dark.json light.json; do
	if ! cmp -s "$THEME_SOURCE_DIR/$name" "$INSTALL_DIR/theme/$name"; then
		echo "Error: theme asset not placed or differs: $INSTALL_DIR/theme/$name" >&2
		exit 1
	fi
done

leftover=$(find "$INSTALL_DIR" -maxdepth 1 -name '.spirits-tmp-*' | head -n 1)
if [ -n "$leftover" ]; then
	echo "Error: temporary directory left behind: $leftover" >&2
	exit 1
fi

assert_managed_set after-update

# Reproduce the state an older updater leaves behind: same version, missing theme assets.
rm -rf "$INSTALL_DIR/theme"
echo "Running self-update again to repair the missing theme assets..." >&2
if ! HOME="$FAKE_HOME" SPIRITS_API_BASE_URL="$BASE_URL" SPIRITS_RELEASE_BASE_URL="$BASE_URL" \
	"$INSTALL_DIR/spirits" update >"$WORK_DIR/repair.out" 2>"$WORK_DIR/repair.err"; then
	cat "$WORK_DIR/repair.out" >&2 || true
	cat "$WORK_DIR/repair.err" >&2 || true
	echo "Error: theme repair update exited non-zero." >&2
	exit 1
fi

for name in dark.json light.json; do
	if ! cmp -s "$THEME_SOURCE_DIR/$name" "$INSTALL_DIR/theme/$name"; then
		echo "Error: theme asset not repaired: $INSTALL_DIR/theme/$name" >&2
		exit 1
	fi
done

grep -q "repaired the missing theme assets" "$WORK_DIR/repair.out" || {
	echo "Error: repair run did not report the theme repair." >&2
	exit 1
}

leftover=$(find "$INSTALL_DIR" -maxdepth 1 -name '.spirits-tmp-*' | head -n 1)
if [ -n "$leftover" ]; then
	echo "Error: temporary directory left behind after repair: $leftover" >&2
	exit 1
fi

assert_managed_set after-theme-repair

echo "Self-update smoke passed: $version_line" >&2
