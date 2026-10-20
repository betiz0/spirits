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

assert_mode() { # description path expected (octal, e.g. 644)
	if [ ! -e "$2" ]; then
		fail_test "$1 (missing: $2)"
		return
	fi
	assert_eq "$1" "$3" "$(stat -c '%a' "$2")"
}

assert_content_eq() { # description path expected
	if [ ! -f "$2" ]; then
		fail_test "$1 (missing: $2)"
		return
	fi
	assert_eq "$1" "$3" "$(cat "$2")"
}

assert_no_temp_dirs() { # description install_dir
	found=$(find "$2" -maxdepth 1 -name '.spirits-tmp-*' 2>/dev/null | head -n 1)
	if [ -n "$found" ]; then fail_test "$1 (found: $found)"; else pass "$1"; fi
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
	make_theme_less_release "$1" "$2"
	make_theme_assets "$SERVER_ROOT/betiz0/spirits/releases/download/spirits-v$1" "$1"
}

# A release that only ships the executable, like 0.6.0 and earlier.
make_theme_less_release() { # version content
	dir="$SERVER_ROOT/betiz0/spirits/releases/download/spirits-v$1"
	mkdir -p "$dir"
	printf '%s\n' "$2" >"$dir/spirits-linux-x64"
	(cd "$dir" && sha256sum spirits-linux-x64 >spirits-linux-x64.sha256)
}

make_theme_assets() { # dir version
	printf '{"name":"dark","version":"%s"}\n' "$2" >"$1/dark.json"
	printf '{"name":"light","version":"%s"}\n' "$2" >"$1/light.json"
	(cd "$1" && sha256sum dark.json >dark.json.sha256 && sha256sum light.json >light.json.sha256)
}

make_broken_release() { # version content (checksum does not match)
	dir="$SERVER_ROOT/betiz0/spirits/releases/download/spirits-v$1"
	mkdir -p "$dir"
	printf '%s\n' "$2" >"$dir/spirits-linux-x64"
	printf '0000000000000000000000000000000000000000000000000000000000000000  spirits-linux-x64\n' \
		>"$dir/spirits-linux-x64.sha256"
	make_theme_assets "$dir" "$1"
}

make_broken_theme_release() { # version content (theme checksum does not match)
	dir="$SERVER_ROOT/betiz0/spirits/releases/download/spirits-v$1"
	mkdir -p "$dir"
	printf '%s\n' "$2" >"$dir/spirits-linux-x64"
	(cd "$dir" && sha256sum spirits-linux-x64 >spirits-linux-x64.sha256)
	make_theme_assets "$dir" "$1"
	printf '0000000000000000000000000000000000000000000000000000000000000000  dark.json\n' \
		>"$dir/dark.json.sha256"
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
	if [ -n "${STALL_PID:-}" ]; then kill "$STALL_PID" 2>/dev/null || true; fi
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
assert_file_exists "fresh install places theme assets" "$home/.spirits/bin/theme/dark.json"
assert_file_exists "fresh install places light theme assets" "$home/.spirits/bin/theme/light.json"
assert_content_eq "fresh install theme content matches the release" "$home/.spirits/bin/theme/dark.json" '{"name":"dark","version":"0.1.0"}'
assert_mode "theme assets are placed with mode 644" "$home/.spirits/bin/theme/dark.json" "644"
assert_mode "theme assets are placed with mode 644 (light)" "$home/.spirits/bin/theme/light.json" "644"
assert_contains "VERSION install shows the start command" "$(cat "$RUN_OUT")" "spirits"
assert_contains "VERSION install shows the PATH bun version" "$(cat "$RUN_OUT")" "9.9.9-test"

# 3. Checksum mismatch: exit 1, existing install untouched, no temp directory left.
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
assert_no_temp_dirs "checksum mismatch leaves no temp directory" "$home/.spirits/bin"

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
assert_content_eq "re-running a different version replaces theme assets" "$home/.spirits/bin/theme/dark.json" '{"name":"dark","version":"0.2.0"}'

# 6b. Same-version latest run with missing themes repairs only the theme assets.
write_releases <<'EOF'
spirits-v0.2.0 false false
spirits-v0.1.0 false false
EOF
rm -rf "$home/.spirits/bin/theme"
printf '#!/bin/sh\necho "spirits 0.2.0 (installed)"\n' >"$home/.spirits/bin/spirits"
chmod 755 "$home/.spirits/bin/spirits"
run_install "$home" "" "$STUB_DIR:$PATH"
assert_eq "same-version repair exits 0" "0" "$RUN_RC"
assert_contains "same-version run repairs missing theme assets" "$(cat "$RUN_OUT")" "restored the missing theme assets"
assert_contains "same-version repair keeps the binary" "$("$home/.spirits/bin/spirits" --version)" "installed"
assert_file_exists "same-version repair places the dark theme" "$home/.spirits/bin/theme/dark.json"
assert_file_exists "same-version repair places the light theme" "$home/.spirits/bin/theme/light.json"
assert_content_eq "same-version repair restores the dark theme content" "$home/.spirits/bin/theme/dark.json" '{"name":"dark","version":"0.2.0"}'
assert_content_eq "same-version repair restores the light theme content" "$home/.spirits/bin/theme/light.json" '{"name":"light","version":"0.2.0"}'
assert_mode "same-version repair restores the theme mode" "$home/.spirits/bin/theme/dark.json" "644"
assert_no_temp_dirs "same-version repair leaves no temp directory" "$home/.spirits/bin"

# 6c. A theme checksum mismatch keeps the binary and the existing theme assets.
make_broken_theme_release 0.5.0 "fake spirits 0.5.0"
write_releases <<'EOF'
spirits-v0.5.0 false false
spirits-v0.2.0 false false
EOF
home="$WORK/home-theme-broken"
mkdir -p "$home/.spirits/bin/theme"
printf 'existing install\n' >"$home/.spirits/bin/spirits"
printf 'old dark\n' >"$home/.spirits/bin/theme/dark.json"
printf 'old light\n' >"$home/.spirits/bin/theme/light.json"
run_install "$home" "" "$STUB_DIR:$PATH"
assert_eq "theme checksum mismatch exits 1" "1" "$RUN_RC"
assert_contains "theme checksum mismatch reports verification" "$(cat "$RUN_ERR")" "Checksum"
assert_content_eq "theme checksum mismatch keeps the existing installation" "$home/.spirits/bin/spirits" "existing install"
assert_content_eq "theme checksum mismatch keeps the existing dark theme" "$home/.spirits/bin/theme/dark.json" "old dark"
assert_content_eq "theme checksum mismatch keeps the existing light theme" "$home/.spirits/bin/theme/light.json" "old light"
assert_no_temp_dirs "theme checksum mismatch leaves no temp directory" "$home/.spirits/bin"

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
assert_contains "uninstall names the theme directory" "$(cat "$RUN_OUT")" "$home/.spirits/bin/theme"
assert_contains "uninstall prints a remove command" "$(cat "$RUN_OUT")" "rm"
assert_file_exists "uninstall keeps the installed binary" "$home/.spirits/bin/spirits"
assert_content_eq "uninstall keeps the data directory" "$home/.spirits/agent/settings.json" "settings"

# 10. Uninstall without an installation: still exits 0 with guidance.
home="$WORK/home-uninstall-none"
mkdir -p "$home"
run_uninstall "$home" "$MIN_PATH_DIR"
assert_eq "uninstall without an install exits 0" "0" "$RUN_RC"
assert_contains "uninstall without an install still prints guidance" "$(cat "$RUN_OUT")" "$home/.spirits/agent"

# 11. Stale temp directory of an exited process is removed.
write_releases <<'EOF'
spirits-v0.1.0 false false
EOF
sh -c 'exit 0' &
dead_pid=$!
wait "$dead_pid" || true
home="$WORK/home-stale"
mkdir -p "$home/.spirits/bin/.spirits-tmp-$dead_pid"
printf 'leftover\n' >"$home/.spirits/bin/.spirits-tmp-$dead_pid/junk"
run_install "$home" "0.1.0" "$STUB_DIR:$PATH"
assert_eq "stale temp cleanup install exits 0" "0" "$RUN_RC"
assert_file_absent "stale temp dir of an exited process is removed" "$home/.spirits/bin/.spirits-tmp-$dead_pid"

# 12. Temp directory of a running process is kept.
sleep 30 &
alive_pid=$!
home="$WORK/home-alive"
mkdir -p "$home/.spirits/bin/.spirits-tmp-$alive_pid"
run_install "$home" "0.1.0" "$STUB_DIR:$PATH"
assert_eq "running temp dir install exits 0" "0" "$RUN_RC"
if [ -d "$home/.spirits/bin/.spirits-tmp-$alive_pid" ]; then
	pass "temp dir of a running process is kept"
else
	fail_test "temp dir of a running process is kept (missing)"
fi
kill "$alive_pid" 2>/dev/null || true
wait "$alive_pid" 2>/dev/null || true

# 13. --uninstall does not clean stale temp directories.
home="$WORK/home-uninstall-stale"
mkdir -p "$home/.spirits/bin/.spirits-tmp-999999"
run_uninstall "$home" "$PATH"
assert_eq "uninstall with stale temp dir exits 0" "0" "$RUN_RC"
if [ -d "$home/.spirits/bin/.spirits-tmp-999999" ]; then
	pass "uninstall leaves stale temp dirs alone"
else
	fail_test "uninstall leaves stale temp dirs alone (removed)"
fi

# 14. SIGINT during the download keeps the existing install and removes the temp directory.
STALL_DIR="$TEST_ROOT/stall"
mkdir -p "$STALL_DIR"
cat >"$STALL_DIR/server.py" <<'PYEOF'
import http.server
import json
import sys
import time

port = int(sys.argv[1])

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.endswith(".sha256"):
            body = (("0" * 64) + "  spirits-linux-x64\n").encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/repos/"):
            body = json.dumps([{"tag_name": "spirits-v0.5.0", "draft": False, "prerelease": False}]).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(200)
        self.send_header("Content-Length", "1000000")
        self.end_headers()
        self.wfile.write(b"start")
        self.wfile.flush()
        time.sleep(60)

    def log_message(self, format, *args):
        pass

http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
PYEOF
STALL_PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
python3 "$STALL_DIR/server.py" "$STALL_PORT" >"$STALL_DIR/server.log" 2>&1 &
STALL_PID=$!
STALL_BASE="http://127.0.0.1:$STALL_PORT"
i=0
while [ "$i" -lt 50 ]; do
	if curl -fsS "$STALL_BASE/repos/betiz0/spirits/releases" >/dev/null 2>&1; then
		break
	fi
	i=$((i + 1))
	sleep 0.1
done

home="$WORK/home-signal"
mkdir -p "$home/.spirits/bin"
printf 'existing install\n' >"$home/.spirits/bin/spirits"
chmod 755 "$home/.spirits/bin/spirits"

HOME="$home" VERSION="" SPIRITS_API_BASE_URL="$STALL_BASE" SPIRITS_RELEASE_BASE_URL="$STALL_BASE" \
	setsid sh "$INSTALL_SH" >"$WORK/signal.out" 2>"$WORK/signal.err" </dev/null &
signal_pid=$!

i=0
while [ "$i" -lt 100 ]; do
	if [ -d "$home/.spirits/bin/.spirits-tmp-$signal_pid" ]; then
		break
	fi
	i=$((i + 1))
	sleep 0.1
done

kill -INT "-$signal_pid" 2>/dev/null || true
signal_rc=0
wait "$signal_pid" || signal_rc=$?
if [ "$signal_rc" -ne 0 ]; then
	pass "SIGINT during the download exits non-zero"
else
	fail_test "SIGINT during the download exits non-zero (got 0)"
fi
assert_content_eq "SIGINT keeps the existing install" "$home/.spirits/bin/spirits" "existing install"
assert_no_temp_dirs "SIGINT leaves no temporary directory" "$home/.spirits/bin"

# 15. Latest resolution skips a same-version install without downloading.
write_releases <<'EOF'
spirits-v0.1.0 false false
EOF
TAG_PREFIX="spirits-v"
make_script_release() { # version
	dir="$SERVER_ROOT/betiz0/spirits/releases/download/"$TAG_PREFIX"$1"
	mkdir -p "$dir"
	printf '#!/bin/sh\necho "spirits %s (fake)"\n' "$1" >"$dir/spirits-linux-x64"
	chmod 755 "$dir/spirits-linux-x64"
	(cd "$dir" && sha256sum spirits-linux-x64 >spirits-linux-x64.sha256)
	make_theme_assets "$dir" "$1"
}
make_script_release 0.1.0
home="$WORK/home-uptodate"
mkdir -p "$home"
run_install "$home" "0.1.0" "$STUB_DIR:$PATH"
assert_eq "up-to-date setup exits 0" "0" "$RUN_RC"
run_install "$home" "" "$STUB_DIR:$PATH"
assert_eq "same-version latest run exits 0" "0" "$RUN_RC"
assert_contains "same-version latest run reports up to date" "$(cat "$RUN_OUT")" "already up to date"
make_broken_release 0.1.0 "tampered"
run_install "$home" "" "$STUB_DIR:$PATH"
assert_eq "same-version latest run skips the download" "0" "$RUN_RC"
assert_contains "same-version latest run keeps the binary" "$("$home/.spirits/bin/spirits" --version)" "0.1.0"

# 16. VERSION re-places even when the version matches.
mkdir -p "$SERVER_ROOT/betiz0/spirits/releases/download/"$TAG_PREFIX"0.1.0"
printf '#!/bin/sh\necho "spirits 0.1.0 (repaired)"\n' \
	>"$SERVER_ROOT/betiz0/spirits/releases/download/"$TAG_PREFIX"0.1.0/spirits-linux-x64"
chmod 755 "$SERVER_ROOT/betiz0/spirits/releases/download/"$TAG_PREFIX"0.1.0/spirits-linux-x64"
(cd "$SERVER_ROOT/betiz0/spirits/releases/download/"$TAG_PREFIX"0.1.0" && sha256sum spirits-linux-x64 >spirits-linux-x64.sha256)
printf 'old dark\n' >"$home/.spirits/bin/theme/dark.json"
printf 'old light\n' >"$home/.spirits/bin/theme/light.json"
run_install "$home" "0.1.0" "$STUB_DIR:$PATH"
assert_eq "VERSION same-version run exits 0" "0" "$RUN_RC"
assert_contains "VERSION same-version run re-places the binary" "$("$home/.spirits/bin/spirits" --version)" "repaired"
assert_content_eq "VERSION same-version run replaces the dark theme" "$home/.spirits/bin/theme/dark.json" '{"name":"dark","version":"0.1.0"}'
assert_content_eq "VERSION same-version run replaces the light theme" "$home/.spirits/bin/theme/light.json" '{"name":"light","version":"0.1.0"}'
assert_contains "VERSION same-version run reports the transition" "$(cat "$RUN_OUT")" "0.1.0 -> 0.1.0"

# 17. A different latest version replaces the installed binary.
write_releases <<'EOF'
spirits-v0.2.0 false false
spirits-v0.1.0 false false
EOF
make_script_release 0.2.0
run_install "$home" "" "$STUB_DIR:$PATH"
assert_eq "different latest version exits 0" "0" "$RUN_RC"
assert_contains "different latest version reports the transition" "$(cat "$RUN_OUT")" "0.1.0 -> 0.2.0"
assert_contains "different latest version replaces the binary" "$("$home/.spirits/bin/spirits" --version)" "0.2.0"

# 18. A newer installed prerelease is replaced by the latest stable.
write_releases <<'EOF'
spirits-v0.1.0 false false
EOF
home="$WORK/home-prerelease"
mkdir -p "$home/.spirits/bin"
printf '#!/bin/sh\necho "spirits 0.4.0-rc.1 (fake)"\n' >"$home/.spirits/bin/spirits"
chmod 755 "$home/.spirits/bin/spirits"
run_install "$home" "" "$STUB_DIR:$PATH"
assert_eq "prerelease replacement exits 0" "0" "$RUN_RC"
assert_contains "prerelease replacement reports the transition" "$(cat "$RUN_OUT")" "0.4.0-rc.1 -> 0.1.0"
assert_contains "prerelease replacement installs the stable version" "$("$home/.spirits/bin/spirits" --version)" "0.1.0"
assert_content_eq "prerelease replacement installs the stable dark theme" "$home/.spirits/bin/theme/dark.json" '{"name":"dark","version":"0.1.0"}'

# 19. A failing --version falls through to the download.
home="$WORK/home-versionfail"
mkdir -p "$home/.spirits/bin"
printf '#!/bin/sh\nexit 1\n' >"$home/.spirits/bin/spirits"
chmod 755 "$home/.spirits/bin/spirits"
run_install "$home" "" "$STUB_DIR:$PATH"
assert_eq "unreadable --version exits 0" "0" "$RUN_RC"
assert_not_contains "unreadable --version shows no transition" "$(cat "$RUN_OUT")" " -> "
assert_contains "unreadable --version installs the latest" "$("$home/.spirits/bin/spirits" --version)" "0.1.0"
assert_content_eq "unreadable --version installs the latest dark theme" "$home/.spirits/bin/theme/dark.json" '{"name":"dark","version":"0.1.0"}'

# 20. A same-version repair fails on a theme checksum mismatch and keeps the binary.
make_broken_theme_release 0.6.0 "fake spirits 0.6.0"
write_releases <<'EOF'
spirits-v0.6.0 false false
EOF
home="$WORK/home-repair-broken-theme"
mkdir -p "$home/.spirits/bin/theme"
printf '#!/bin/sh\necho "spirits 0.6.0 (installed)"\n' >"$home/.spirits/bin/spirits"
chmod 755 "$home/.spirits/bin/spirits"
printf 'old dark\n' >"$home/.spirits/bin/theme/dark.json"
run_install "$home" "" "$STUB_DIR:$PATH"
assert_eq "same-version repair fails on a theme checksum mismatch" "1" "$RUN_RC"
assert_contains "same-version repair failure reports verification" "$(cat "$RUN_ERR")" "Checksum"
assert_not_contains "same-version repair failure reports no repair" "$(cat "$RUN_OUT")" "restored the missing theme assets"
assert_contains "same-version repair failure keeps the binary" "$("$home/.spirits/bin/spirits" --version)" "installed"
assert_content_eq "same-version repair failure keeps the existing dark theme" "$home/.spirits/bin/theme/dark.json" "old dark"
assert_file_absent "same-version repair failure places no light theme" "$home/.spirits/bin/theme/light.json"
assert_no_temp_dirs "same-version repair failure leaves no temp directory" "$home/.spirits/bin"

# 21. A theme-less release fails a VERSION install without touching the install.
make_theme_less_release 0.7.0 "fake spirits 0.7.0"
home="$WORK/home-theme-less-version"
mkdir -p "$home/.spirits/bin"
printf 'existing install\n' >"$home/.spirits/bin/spirits"
chmod 755 "$home/.spirits/bin/spirits"
run_install "$home" "0.7.0" "$STUB_DIR:$PATH"
assert_eq "theme-less release fails the VERSION install" "1" "$RUN_RC"
assert_contains "theme-less release reports the failed download" "$(cat "$RUN_ERR")" "Failed to download"
assert_content_eq "theme-less release keeps the existing install" "$home/.spirits/bin/spirits" "existing install"
assert_file_absent "theme-less release places no theme directory" "$home/.spirits/bin/theme"
assert_no_temp_dirs "theme-less release leaves no temp directory" "$home/.spirits/bin"

# 22. A theme-less latest release fails the same-version repair without touching the install.
write_releases <<'EOF'
spirits-v0.7.0 false false
EOF
home="$WORK/home-theme-less-latest"
mkdir -p "$home/.spirits/bin"
printf '#!/bin/sh\necho "spirits 0.7.0 (installed)"\n' >"$home/.spirits/bin/spirits"
chmod 755 "$home/.spirits/bin/spirits"
run_install "$home" "" "$STUB_DIR:$PATH"
assert_eq "theme-less latest release fails without touching the install" "1" "$RUN_RC"
assert_contains "theme-less latest release reports the failed download" "$(cat "$RUN_ERR")" "Failed to download"
assert_contains "theme-less latest release keeps the binary" "$("$home/.spirits/bin/spirits" --version)" "installed"
assert_file_absent "theme-less latest release places no theme directory" "$home/.spirits/bin/theme"
assert_no_temp_dirs "theme-less latest release leaves no temp directory" "$home/.spirits/bin"

# 23. A regular file at the theme path fails the placement and keeps the binary.
write_releases <<'EOF'
spirits-v0.1.0 false false
EOF
home="$WORK/home-theme-not-a-dir"
mkdir -p "$home/.spirits/bin"
printf 'existing install\n' >"$home/.spirits/bin/spirits"
chmod 755 "$home/.spirits/bin/spirits"
printf 'not a directory\n' >"$home/.spirits/bin/theme"
run_install "$home" "0.1.0" "$STUB_DIR:$PATH"
assert_eq "a regular file at the theme path fails the install" "1" "$RUN_RC"
assert_contains "a regular file at the theme path reports the failure" "$(cat "$RUN_ERR")" "Failed to create"
assert_content_eq "a regular file at the theme path keeps the binary" "$home/.spirits/bin/spirits" "existing install"
assert_content_eq "a regular file at the theme path is left alone" "$home/.spirits/bin/theme" "not a directory"
assert_no_temp_dirs "a regular file at the theme path leaves no temp directory" "$home/.spirits/bin"

# --- Summary --------------------------------------------------------------------------------

printf '\n%s passed, %s failed\n' "$PASS_COUNT" "$FAIL_COUNT"
if [ "$FAIL_COUNT" -ne 0 ]; then
	exit 1
fi
