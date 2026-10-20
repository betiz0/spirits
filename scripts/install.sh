#!/bin/sh
#
# spirits installer for Linux x86_64.
#
#   curl -fsSL https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh | sh
#   VERSION=0.1.0 sh scripts/install.sh
#   curl -fsSL https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh | sh -s -- --uninstall
#
# POSIX sh only: no `local`, no `pipefail`. Progress and errors go to stderr; the success
# summary goes to stdout. The shell rc is never edited.

set -eu

# --- Constants ------------------------------------------------------------------------------

# GitHub repository that hosts the release artifacts.
OWNER="betiz0"
REPO="spirits"

# Release artifact name produced by scripts/build-binaries.ts.
ARTIFACT="spirits-linux-x64"

# Release tag prefix; the version in `VERSION` and `spirits --version` is appended to it.
TAG_PREFIX="spirits-v"

# Install location: $HOME/.spirits/bin/spirits. Never requires root.
INSTALL_DIR="$HOME/.spirits/bin"
INSTALLED_BINARY="$INSTALL_DIR/spirits"

# Built-in themes pi reads from <install dir>/theme. Shared contract with the self-update code
# (packages/spirits/src/constants.ts).
THEME_DIR="$INSTALL_DIR/theme"
THEME_ASSETS="dark.json light.json"

# Data directory applied through PI_CODING_AGENT_DIR by the compiled binary (bin/env-defaults.ts).
AGENT_DIR="$HOME/.spirits/agent"

# Temporary directory prefix inside INSTALL_DIR. Shared contract with the self-update code
# (packages/spirits/src/constants.ts): `.spirits-tmp-<pid>`.
TMP_PREFIX=".spirits-tmp-"

# Base URLs. Overridable for tests (fixture server).
API_BASE_URL="${SPIRITS_API_BASE_URL:-https://api.github.com}"
RELEASE_BASE_URL="${SPIRITS_RELEASE_BASE_URL:-https://github.com}"

# --- Helpers --------------------------------------------------------------------------------

log() {
	printf '%s\n' "$*" >&2
}

fail() {
	printf 'Error: %s\n' "$*" >&2
	exit 1
}

# Extract the scalar after `"key": ` on a pretty-printed JSON line, dropping a trailing comma.
json_scalar() {
	value=${1#*: }
	value=${value%,}
	value=${value#\"}
	value=${value%\"}
	printf '%s' "$value"
}

# Read a pretty-printed GitHub releases array on stdin and print the first stable `spirits-v*`
# tag (draft and prerelease entries excluded). The API returns releases newest first.
first_stable_spirits_tag() {
	in_release=0
	tag=""
	draft=""
	prerelease=""
	while IFS= read -r line; do
		case "$line" in
			"  {"*)
				if [ "$in_release" = 1 ] && [ "$draft" = "false" ] && [ "$prerelease" = "false" ]; then
					case "$tag" in
						"$TAG_PREFIX"*)
							printf '%s\n' "$tag"
							return 0
							;;
					esac
				fi
				in_release=1
				tag=""
				draft=""
				prerelease=""
				;;
			'    "tag_name": '*)
				tag=$(json_scalar "$line")
				;;
			'    "draft": '*)
				draft=$(json_scalar "$line")
				;;
			'    "prerelease": '*)
				prerelease=$(json_scalar "$line")
				;;
		esac
	done
	if [ "$in_release" = 1 ] && [ "$draft" = "false" ] && [ "$prerelease" = "false" ]; then
		case "$tag" in
			"$TAG_PREFIX"*)
				printf '%s\n' "$tag"
				return 0
				;;
		esac
	fi
	return 1
}

resolve_tag() {
	if [ -n "${VERSION:-}" ]; then
		printf '%s%s\n' "$TAG_PREFIX" "$VERSION"
		return 0
	fi
	log "Resolving the latest spirits release..."
	releases=$(curl -fsSL "$API_BASE_URL/repos/$OWNER/$REPO/releases?per_page=100") ||
		fail "Failed to fetch releases from $API_BASE_URL."
	tag=$(printf '%s\n' "$releases" | first_stable_spirits_tag) || tag=""
	if [ -z "$tag" ]; then
		fail "No stable spirits-v* release found. Retry with VERSION=<x.y.z>."
	fi
	printf '%s\n' "$tag"
}

check_platform() {
	os=$(uname -s)
	arch=$(uname -m)
	if [ "$os" != "Linux" ] || [ "$arch" != "x86_64" ]; then
		fail "このバージョンは Linux x86_64 専用です (検出: $os/$arch)。"
	fi
}

# Remove `.spirits-tmp-<pid>` directories whose owner process is gone. A live PID (including
# another user's; `kill -0` fails with EPERM there) is left alone. Runs after the platform and
# dependency checks and before version resolution, so `--uninstall` never touches the directory.
cleanup_stale_tmpdirs() {
	[ -d "$INSTALL_DIR" ] || return 0
	for entry in "$INSTALL_DIR"/"$TMP_PREFIX"*; do
		[ -e "$entry" ] || continue
		name=${entry##*/}
		pid=${name#"$TMP_PREFIX"}
		case "$pid" in
			''|0|*[!0-9]*) continue ;;
		esac
		if kill -0 "$pid" 2>/dev/null; then
			continue
		fi
		rm -rf "$entry" 2>/dev/null || true
	done
}

# Print the version from the installed binary's `--version` first line (`spirits <version> ...`).
# Returns non-zero when the binary is missing, exits non-zero, or prints an unexpected shape.
installed_version() {
	[ -x "$INSTALLED_BINARY" ] || return 1
	output=$("$INSTALLED_BINARY" --version 2>/dev/null) || return 1
	first_line=$(printf '%s\n' "$output" | head -n 1)
	case "$first_line" in
		'spirits '*) ;;
		*) return 1 ;;
	esac
	version=${first_line#spirits }
	version=${version%% *}
	[ -n "$version" ] || return 1
	printf '%s\n' "$version"
}

# Both built-in theme files must be present as regular files. A missing directory or a
# directory named like an asset counts as missing.
theme_assets_present() {
	for name in $THEME_ASSETS; do
		[ -f "$THEME_DIR/$name" ] || return 1
	done
	return 0
}

# --- Main -----------------------------------------------------------------------------------

# Fail on an unsupported platform before reporting missing helper commands.
check_platform

if [ "${1:-}" = "--uninstall" ]; then
	printf 'To remove the spirits binary:\n  rm -f %s\n' "$INSTALLED_BINARY"
	printf 'To remove the installed theme assets:\n  rm -rf %s\n' "$THEME_DIR"
	printf 'To remove the data directory (settings, sessions, extensions):\n  rm -rf %s\n' "$AGENT_DIR"
	printf 'If you added %s to your PATH, remove that line from your shell rc.\n' "$INSTALL_DIR"
	exit 0
fi

command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required."

cleanup_stale_tmpdirs

tag=$(resolve_tag)
new_version=${tag#"$TAG_PREFIX"}

# `VERSION` requests an explicit placement (repair/reinstall) and always downloads. Without it,
# a same-version install with both theme assets is skipped; a same-version install with missing
# theme assets repairs only the assets; an unreadable `--version` falls through to the download.
version_specified=0
if [ -n "${VERSION:-}" ]; then version_specified=1; fi
repair_only=0
old_version=$(installed_version) || old_version=""
if [ "$version_specified" = 0 ] && [ -n "$old_version" ] && [ "$old_version" = "$new_version" ]; then
	if theme_assets_present; then
		printf 'spirits %s is already up to date\n' "$new_version"
		exit 0
	fi
	repair_only=1
fi

mkdir -p "$INSTALL_DIR" || fail "Failed to create $INSTALL_DIR."
tmpdir="$INSTALL_DIR/$TMP_PREFIX$$"
mkdir -p "$tmpdir" || fail "Failed to create $tmpdir."
on_interrupt() {
	rm -rf "$tmpdir"
	exit 130
}
on_terminate() {
	rm -rf "$tmpdir"
	exit 143
}
trap 'rm -rf "$tmpdir"' EXIT
trap on_interrupt INT
trap on_terminate TERM

log "Downloading theme assets for $tag..."
for name in $THEME_ASSETS; do
	asset_url="$RELEASE_BASE_URL/$OWNER/$REPO/releases/download/$tag/$name"
	curl -fsSL -o "$tmpdir/$name" "$asset_url" || fail "Failed to download $asset_url."
	curl -fsSL -o "$tmpdir/$name.sha256" "$asset_url.sha256" || fail "Failed to download $asset_url.sha256."
done

if [ "$repair_only" = 0 ]; then
	binary_url="$RELEASE_BASE_URL/$OWNER/$REPO/releases/download/$tag/$ARTIFACT"
	checksum_url="$binary_url.sha256"
	log "Downloading $tag from $binary_url..."
	curl -fsSL -o "$tmpdir/$ARTIFACT" "$binary_url" || fail "Failed to download $binary_url."
	curl -fsSL -o "$tmpdir/$ARTIFACT.sha256" "$checksum_url" || fail "Failed to download $checksum_url."
fi

log "Verifying checksums..."
for name in $THEME_ASSETS; do
	(cd "$tmpdir" && sha256sum -c "$name.sha256" >&2) ||
		fail "Checksum verification failed; nothing was installed."
done
if [ "$repair_only" = 0 ]; then
	(cd "$tmpdir" && sha256sum -c "$ARTIFACT.sha256" >&2) ||
		fail "Checksum verification failed; nothing was installed."
fi

# Theme assets first, binary last: a failure leaves the installed executable in place.
mkdir -p "$THEME_DIR" || fail "Failed to create $THEME_DIR."
for name in $THEME_ASSETS; do
	chmod 644 "$tmpdir/$name" || fail "Failed to make $tmpdir/$name readable."
	mv -f "$tmpdir/$name" "$THEME_DIR/$name" || fail "Failed to install $THEME_DIR/$name."
done

if [ "$repair_only" = 1 ]; then
	rm -rf "$tmpdir"
	trap - EXIT INT TERM
	printf 'spirits %s is already up to date; restored the missing theme assets\n' "$new_version"
	printf 'Theme assets installed to %s\n' "$THEME_DIR"
	exit 0
fi

chmod 755 "$tmpdir/$ARTIFACT" || fail "Failed to mark $tmpdir/$ARTIFACT executable."
mv -f "$tmpdir/$ARTIFACT" "$INSTALLED_BINARY" || fail "Failed to install $INSTALLED_BINARY."
rm -rf "$tmpdir"
trap - EXIT INT TERM

if [ -n "$old_version" ]; then
	printf '%s -> %s\n' "$old_version" "$new_version"
else
	printf 'Installed spirits %s\n' "$new_version"
fi
printf 'Installed to %s\n' "$INSTALLED_BINARY"
printf 'Installed theme assets to %s\n' "$THEME_DIR"
printf 'Start it with:\n  %s\n' "$INSTALLED_BINARY"

case ":$PATH:" in
	*":$INSTALL_DIR:"*)
		;;
	*)
		printf 'Add it to your PATH (append to your shell rc; the installer does not edit it):\n  export PATH="%s:$PATH"\n' "$INSTALL_DIR"
		;;
esac

if command -v bun >/dev/null 2>&1; then
	printf 'Bun %s found on PATH (extensions can resolve their dependencies).\n' "$(bun --version 2>/dev/null || printf '?')"
else
	printf 'Bun was not found on PATH. Bun is required separately for extension dependency resolution.\n'
fi
