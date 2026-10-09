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

# Data directory applied through PI_CODING_AGENT_DIR by the compiled binary (bin/env-defaults.ts).
AGENT_DIR="$HOME/.spirits/agent"

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

# --- Main -----------------------------------------------------------------------------------

# Fail on an unsupported platform before reporting missing helper commands.
check_platform

if [ "${1:-}" = "--uninstall" ]; then
	printf 'To remove the spirits binary:\n  rm -f %s\n' "$INSTALLED_BINARY"
	printf 'To remove the data directory (settings, sessions, extensions):\n  rm -rf %s\n' "$AGENT_DIR"
	printf 'If you added %s to your PATH, remove that line from your shell rc.\n' "$INSTALL_DIR"
	exit 0
fi

command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required."

tag=$(resolve_tag)
binary_url="$RELEASE_BASE_URL/$OWNER/$REPO/releases/download/$tag/$ARTIFACT"
checksum_url="$binary_url.sha256"

tmpdir=$(mktemp -d) || fail "Failed to create a temporary directory."
trap 'rm -rf "$tmpdir"' EXIT INT TERM

log "Downloading $tag from $binary_url..."
curl -fsSL -o "$tmpdir/$ARTIFACT" "$binary_url" || fail "Failed to download $binary_url."
curl -fsSL -o "$tmpdir/$ARTIFACT.sha256" "$checksum_url" || fail "Failed to download $checksum_url."

log "Verifying checksum..."
(cd "$tmpdir" && sha256sum -c "$ARTIFACT.sha256" >&2) || fail "Checksum verification failed; nothing was installed."

mkdir -p "$INSTALL_DIR" || fail "Failed to create $INSTALL_DIR."
mv "$tmpdir/$ARTIFACT" "$INSTALLED_BINARY" || fail "Failed to install $INSTALLED_BINARY."
chmod 755 "$INSTALLED_BINARY" || fail "Failed to mark $INSTALLED_BINARY executable."

printf 'Installed spirits %s to %s\n' "${tag#"$TAG_PREFIX"}" "$INSTALLED_BINARY"
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
