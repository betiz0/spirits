#!/bin/sh
#
# Automated tests for scripts/install.sh.
#
# Serves fixture releases (fake binary + .sha256 + releases JSON) with `python3 -m http.server`
# and runs install.sh against them. This tests the installer, not the real binary.
#
# Usage: sh scripts/install.test.sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTALL_SH="$SCRIPT_DIR/install.sh"

TEST_ROOT=$(mktemp -d)
SERVER_ROOT="$TEST_ROOT/server"
STUB_DIR="$TEST_ROOT/stub"
DARWIN_STUB_DIR="$TEST_ROOT/stub-darwin"
WORK="$TEST_ROOT/work"
mkdir -p "$SERVER_ROOT/repos/betiz0/spirits" "$STUB_DIR" "$DARWIN_STUB_DIR" "$WORK"

PASS_COUNT=0
FAIL_COUNT=0

pass() {
	PASS_COUNT=$((PASS_COUNT + 1))
	printf 'ok - %s\n' "$1"
}

fail_test() {
	FAIL_COUNT=$((FAIL_COUNT + 1))
	printf 'not ok - %s\n' "$1" >&2
}

assert_eq() { # description expected actual
	if [ "$2" = "$3" ]; then
		pass "$1"
	else
		fail_test "$1 (expected [$2], got [$3])"
	fi
}

assert_contains() { # description haystack needle
	case "$2" in
		*"$3"*) pass "$1" ;;
		*) fail_test "$1 (missing [$3])" ;;
	esac
}

assert_not_contains() { # description haystack needle
	case "$2" in
		*"$3"*) fail_test "$1 (found [$3])" ;;
		*) pass "$1" ;;
	esac
}

assert_file_exists() { # description path
	if [ -f "$2" ]; then pass "$1"; else fail_test "$1 (missing: $2)"; fi
}

assert_file_absent() { # description path
	if [ -e "$2" ]; then fail_test "$1 (exists: $2)"; else pass "$1"; fi
}

assert_executable() { # description path
	if [ -x "$2" ]; then pass "$1"; else fail_test "$1 (not executable: $2)"; fi
}

assert_content_eq() { # description path expected
	if [ ! -f "$2" ]; then
		fail_test "$1 (missing: $2)"
		return
	fi
	assert_eq "$1" "$3" "$(cat "$2")"
}

# --- Fixtures -------------------------------------------------------------------------------

# One release object in the GitHub pretty-printed shape (2-space object indent, 4-space fields).
release_object() { # tag draft prerelease
	printf '  {\n'
	printf '    "url": "https://api.github.com/repos/betiz0/spirits/releases/1",\n'
	printf '    "assets_url": "https://api.github.com/repos/betiz0/spirits/releases/1/assets",\n'
	printf '    "upload_url": "https://uploads.github.com/repos/betiz0/spirits/releases/1/assets{?name,label}",\n'
	printf '    "html_url": "https://github.com/betiz0/spirits/releases/tag/%s",\n' "$1"
	printf '    "id": 1,\n'
	printf '    "node_id": "RE_1",\n'
	printf '    "tag_name": "%s",\n' "$1"
	printf '    "target_commitish": "main",\n'
	printf '    "name": "%s",\n' "$1"
	printf '    "draft": %s,\n' "$2"
	printf '    "immutable": false,\n'
	printf '    "prerelease": %s,\n' "$3"
	printf '    "created_at": "2026-10-08T00:00:00Z",\n'
	printf '    "published_at": "2026-10-08T00:00:00Z",\n'
	printf '    "assets": []\n'
	printf '  }'
}

# Read "tag draft prerelease" lines on stdin and write the releases JSON newest-first.
write_releases() {
	output="$SERVER_ROOT/repos/betiz0/spirits/releases"
	{
		printf '[\n'
		first=1
		while read -r tag draft prerelease; do
			[ -n "$tag" ] || continue
			if [ "$first" = 1 ]; then
				first=0
			else
				printf ',\n'
			fi
			release_object "$tag" "$draft" "$prerelease"
		done
		printf '\n]\n'
	} >"$output"
}

make_release() { # version content
	dir="$SERVER_ROOT/betiz0/spirits/releases/download/spirits-v$1"
	mkdir -p "$dir"
	printf '%s\n' "$2" >"$dir/spirits-linux-x64"
	(cd "$dir" && sha256sum spirits-linux-x64 >spirits-linux-x64.sha256)
}

make_broken_release() { # version content (checksum does not match)
	dir="$SERVER_ROOT/betiz0/spirits/releases/download/spirits-v$1"
	mkdir -p "$dir"
	printf '%s\n' "$2" >"$dir/spirits-linux-x64"
	printf '0000000000000000000000000000000000000000000000000000000000000000  spirits-linux-x64\n' \
		>"$dir/spirits-linux-x64.sha256"
}

# Fake `uname` reporting Darwin for the unsupported-platform case.
cat >"$DARWIN_STUB_DIR/uname" <<'EOF'
#!/bin/sh
case "$1" in
	-m) echo "x86_64" ;;
	*) echo "Darwin" ;;
esac
EOF
chmod +x "$DARWIN_STUB_DIR/uname"

# Fake `bun` used for the success-message case.
cat >"$STUB_DIR/bun" <<'EOF'
#!/bin/sh
echo "9.9.9-test"
EOF
chmod +x "$STUB_DIR/bun"

# Minimal PATH for cases that must not see curl/sha256sum: `sh` plus a Linux `uname` stub.
MIN_PATH_DIR="$TEST_ROOT/stub-min-path"
mkdir -p "$MIN_PATH_DIR"
ln -s /bin/sh "$MIN_PATH_DIR/sh"
cat >"$MIN_PATH_DIR/uname" <<'EOF'
#!/bin/sh
case "$1" in
	-m) echo "x86_64" ;;
	*) echo "Linux" ;;
esac
EOF
chmod +x "$MIN_PATH_DIR/uname"

# --- Fixture server -------------------------------------------------------------------------

PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$SERVER_ROOT" >"$TEST_ROOT/server.log" 2>&1 &
SERVER_PID=$!
BASE_URL="http://127.0.0.1:$PORT"

cleanup() {
	kill "$SERVER_PID" 2>/dev/null || true
	rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

i=0
while [ "$i" -lt 50 ]; do
	if curl -fsS "$BASE_URL/repos/betiz0/spirits/releases" >/dev/null 2>&1; then
		break
	fi
	i=$((i + 1))
	sleep 0.1
done

# --- Run helper -----------------------------------------------------------------------------

RUN_OUT="$WORK/out"
RUN_ERR="$WORK/err"
RUN_RC=0

run_install() { # home version path
	: >"$RUN_OUT"
	: >"$RUN_ERR"
	RUN_RC=0
	HOME="$1" VERSION="$2" SPIRITS_API_BASE_URL="$BASE_URL" SPIRITS_RELEASE_BASE_URL="$BASE_URL" PATH="$3" \
		sh "$INSTALL_SH" >"$RUN_OUT" 2>"$RUN_ERR" || RUN_RC=$?
}

run_uninstall() { # home path
	: >"$RUN_OUT"
	: >"$RUN_ERR"
	RUN_RC=0
	HOME="$1" PATH="$2" sh "$INSTALL_SH" --uninstall >"$RUN_OUT" 2>"$RUN_ERR" || RUN_RC=$?
}

# --- Cases ----------------------------------------------------------------------------------

write_releases <<'EOF'
spirits-v0.1.0 false false
EOF

# 1. Unsupported platform: exit 1, error on stderr, nothing installed.
home="$WORK/home-platform"
mkdir -p "$home"
run_install "$home" "" "$DARWIN_STUB_DIR:$PATH"
assert_eq "unsupported platform exits 1" "1" "$RUN_RC"
assert_contains "unsupported platform reports Linux x86_64" "$(cat "$RUN_ERR")" "Linux x86_64"
assert_not_contains "unsupported platform error not on stdout" "$(cat "$RUN_OUT")" "Error:"
assert_file_absent "unsupported platform installs nothing" "$home/.spirits/bin/spirits"

# 1b. Unsupported platform wins over missing helper commands (check_platform runs first).
home="$WORK/home-platform-order"
mkdir -p "$home"
run_install "$home" "" "$DARWIN_STUB_DIR:$MIN_PATH_DIR"
assert_eq "platform check runs before helper checks" "1" "$RUN_RC"
assert_contains "platform check still reports Linux x86_64" "$(cat "$RUN_ERR")" "Linux x86_64"
assert_not_contains "platform check does not report sha256sum" "$(cat "$RUN_ERR")" "sha256sum"
assert_file_absent "platform check with missing helpers installs nothing" "$home/.spirits/bin/spirits"

# 2. VERSION install: downloads the tagged artifact, installs with the exec bit, reports Bun.
make_release 0.1.0 "fake spirits 0.1.0"
home="$WORK/home-version"
mkdir -p "$home"
run_install "$home" "0.1.0" "$STUB_DIR:$PATH"
assert_eq "VERSION install exits 0" "0" "$RUN_RC"
assert_file_exists "VERSION install places the binary" "$home/.spirits/bin/spirits"
assert_executable "VERSION install sets the exec bit" "$home/.spirits/bin/spirits"
assert_content_eq "VERSION install downloads spirits-v0.1.0" "$home/.spirits/bin/spirits" "fake spirits 0.1.0"
assert_contains "VERSION install shows the start command" "$(cat "$RUN_OUT")" "spirits"
assert_contains "VERSION install shows the PATH bun version" "$(cat "$RUN_OUT")" "9.9.9-test"

# 3. Checksum mismatch: exit 1, existing install untouched.
make_broken_release 0.9.9 "broken spirits 0.9.9"
home="$WORK/home-broken"
mkdir -p "$home/.spirits/bin"
printf 'existing install\n' >"$home/.spirits/bin/spirits"
chmod 755 "$home/.spirits/bin/spirits"
run_install "$home" "0.9.9" "$STUB_DIR:$PATH"
assert_eq "checksum mismatch exits 1" "1" "$RUN_RC"
assert_contains "checksum mismatch reports verification" "$(cat "$RUN_ERR")" "Checksum"
assert_not_contains "checksum mismatch error not on stdout" "$(cat "$RUN_OUT")" "Error:"
assert_content_eq "checksum mismatch keeps the existing install" "$home/.spirits/bin/spirits" "existing install"

# 4. latest: pi `v*`, draft, and prerelease are ignored; first stable `spirits-v*` wins.
make_release 0.2.0 "fake spirits 0.2.0"
make_release 0.3.0-rc.1 "fake spirits 0.3.0-rc.1"
write_releases <<'EOF'
v9.9.9 false false
spirits-v0.4.0 true false
spirits-v0.3.0-rc.1 false true
spirits-v0.2.0 false false
spirits-v0.1.0 false false
EOF
home="$WORK/home-latest"
mkdir -p "$home"
run_install "$home" "" "$STUB_DIR:$PATH"
assert_eq "latest install exits 0" "0" "$RUN_RC"
assert_content_eq "latest picks the first stable spirits-v* release" "$home/.spirits/bin/spirits" "fake spirits 0.2.0"

# 5. No stable spirits release: exit 1, nothing installed.
write_releases <<'EOF'
v9.9.9 false false
spirits-v0.4.0 true false
spirits-v0.3.0-rc.1 false true
EOF
home="$WORK/home-none"
mkdir -p "$home/.spirits/bin"
printf 'existing install\n' >"$home/.spirits/bin/spirits"
chmod 755 "$home/.spirits/bin/spirits"
run_install "$home" "" "$STUB_DIR:$PATH"
assert_eq "no spirits release exits 1" "1" "$RUN_RC"
assert_contains "no spirits release reports the failure" "$(cat "$RUN_ERR")" "No stable spirits"
assert_content_eq "no spirits release keeps the existing install" "$home/.spirits/bin/spirits" "existing install"

# 6. Re-run the same version, then a different version.
home="$WORK/home-version"
run_install "$home" "0.1.0" "$STUB_DIR:$PATH"
assert_eq "re-running the same version exits 0" "0" "$RUN_RC"
assert_executable "re-running the same version keeps the exec bit" "$home/.spirits/bin/spirits"
run_install "$home" "0.2.0" "$STUB_DIR:$PATH"
assert_eq "re-running a different version exits 0" "0" "$RUN_RC"
assert_content_eq "re-running a different version replaces the binary" "$home/.spirits/bin/spirits" "fake spirits 0.2.0"
assert_executable "re-running a different version keeps the exec bit" "$home/.spirits/bin/spirits"

# 7. Success without bun on PATH: still exits 0 and points at Bun for extension dependencies.
NO_BUN_PATH="/usr/bin:/bin"
home="$WORK/home-nobun"
mkdir -p "$home"
if PATH="$NO_BUN_PATH" command -v bun >/dev/null 2>&1; then
	fail_test "bun-absent case (bun unexpectedly found in $NO_BUN_PATH)"
else
	run_install "$home" "0.1.0" "$NO_BUN_PATH"
	assert_eq "install without bun exits 0" "0" "$RUN_RC"
	assert_contains "install without bun mentions the separate Bun requirement" "$(cat "$RUN_OUT")" "Bun was not found"
fi

# 8. PATH guidance: the suggestion is printed and the shell rc is not touched.
home="$WORK/home-path"
mkdir -p "$home"
printf 'original rc\n' >"$home/.bashrc"
run_install "$home" "0.1.0" "$STUB_DIR:$PATH"
assert_eq "PATH guidance install exits 0" "0" "$RUN_RC"
assert_contains "PATH guidance prints the export line" "$(cat "$RUN_OUT")" "export PATH="
assert_contains "PATH guidance names the install dir" "$(cat "$RUN_OUT")" "$home/.spirits/bin"
assert_content_eq "PATH guidance leaves the shell rc unchanged" "$home/.bashrc" "original rc"

# 9. Uninstall guidance: prints removal commands, changes nothing, needs no curl/sha256sum.
home="$WORK/home-uninstall"
mkdir -p "$home/.spirits/agent"
printf 'settings\n' >"$home/.spirits/agent/settings.json"
run_install "$home" "0.1.0" "$STUB_DIR:$PATH"
assert_eq "uninstall setup install exits 0" "0" "$RUN_RC"
run_uninstall "$home" "$MIN_PATH_DIR"
assert_eq "uninstall exits 0" "0" "$RUN_RC"
assert_contains "uninstall names the binary path" "$(cat "$RUN_OUT")" "$home/.spirits/bin/spirits"
assert_contains "uninstall names the data directory" "$(cat "$RUN_OUT")" "$home/.spirits/agent"
assert_contains "uninstall prints a remove command" "$(cat "$RUN_OUT")" "rm"
assert_file_exists "uninstall keeps the installed binary" "$home/.spirits/bin/spirits"
assert_content_eq "uninstall keeps the data directory" "$home/.spirits/agent/settings.json" "settings"

# 10. Uninstall without an installation: still exits 0 with guidance.
home="$WORK/home-uninstall-none"
mkdir -p "$home"
run_uninstall "$home" "$MIN_PATH_DIR"
assert_eq "uninstall without an install exits 0" "0" "$RUN_RC"
assert_contains "uninstall without an install still prints guidance" "$(cat "$RUN_OUT")" "$home/.spirits/agent"

# --- Summary --------------------------------------------------------------------------------

printf '\n%s passed, %s failed\n' "$PASS_COUNT" "$FAIL_COUNT"
if [ "$FAIL_COUNT" -ne 0 ]; then
	exit 1
fi
