/**
 * Project-wide fixed values shared by multiple modules.
 *
 * Layer 2 constants (constants-discipline): values referenced outside the file that owns them.
 */

/** App name the compiled and source entries run as. Drives APP_NAME in pi's config. */
export const SPIRITS_APP_NAME = "spirits";

/** Environment variable pi reads to locate its agent directory (derived from SPIRITS_APP_NAME). */
export const ENV_AGENT_DIR = "SPIRITS_CODING_AGENT_DIR";

/** Environment variable that disables pi's update check. */
export const ENV_SKIP_VERSION_CHECK = "PI_SKIP_VERSION_CHECK";

/** Environment variable that overrides install telemetry and pi-attributed provider headers. */
export const ENV_TELEMETRY = "PI_TELEMETRY";

/** spirits config root under `$HOME`. Kept separate from the install dir `~/.spirits/bin`. */
export const SPIRITS_CONFIG_DIR_NAME = ".spirits";

/** Agent directory segment under the config root (`~/.spirits/agent`). */
export const SPIRITS_AGENT_DIR_NAME = "agent";

// ---------------------------------------------------------------------------
// Self update (`spirits update` and scripts/install.sh)
// ---------------------------------------------------------------------------

/** GitHub repository that hosts the release artifacts. Shared contract with scripts/install.sh. */
export const GITHUB_OWNER = "betiz0";
export const GITHUB_REPO = "spirits";

/** Release tag prefix; the version is appended (`spirits-v0.3.0`). */
export const RELEASE_TAG_PREFIX = "spirits-v";

/** Release artifact name produced by scripts/build-binaries.ts. */
export const RELEASE_ARTIFACT_NAME = "spirits-linux-x64";

/** Base URL of the GitHub API. The environment override exists for fixtures. */
export const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";
export const ENV_UPDATE_API_BASE_URL = "SPIRITS_API_BASE_URL";

/** Base URL for release downloads. The environment override exists for fixtures. */
export const DEFAULT_GITHUB_RELEASE_BASE_URL = "https://github.com";
export const ENV_UPDATE_RELEASE_BASE_URL = "SPIRITS_RELEASE_BASE_URL";

/** Default idle timeout for update HTTP requests. Unit: seconds. Set via ENV_UPDATE_IDLE_TIMEOUT_SECONDS. */
export const DEFAULT_UPDATE_IDLE_TIMEOUT_SECONDS = 10;

export const ENV_UPDATE_IDLE_TIMEOUT_SECONDS = "SPIRITS_UPDATE_IDLE_TIMEOUT_SECONDS";

/** Temporary directory name prefix inside the install directory. Shared contract with scripts/install.sh. */
export const UPDATE_TEMP_DIR_PREFIX = ".spirits-tmp-";

/** Platform and architecture the distributed binary is built for. */
export const SUPPORTED_PLATFORM = "linux";
export const SUPPORTED_ARCH = "x64";

/** Environment variable that disables network access (same rule as pi). */
export const ENV_OFFLINE = "PI_OFFLINE";

/** Installer command shown in failure messages when a manual repair is needed. */
export const INSTALL_COMMAND = `curl -fsSL https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/scripts/install.sh | sh`;

// ---------------------------------------------------------------------------
// Continual harness (M4 memory / skills / code-mode prompt)
// ---------------------------------------------------------------------------

/** Default excerpt lines per memory file. Unit: lines. Set via ENV_MEMORY_PREVIEW_LINES. */
export const DEFAULT_MEMORY_PREVIEW_LINES = 20;

/** Default character cap for the whole `spirits_memory` section. Unit: JS string length. Set via ENV_MEMORY_CHAR_LIMIT. */
export const DEFAULT_MEMORY_INJECTION_CHAR_LIMIT = 4000;

/** Default line count above which a memory file is listed as a cleanup candidate. Unit: lines. Set via ENV_MEMORY_LINE_LIMIT. */
export const DEFAULT_MEMORY_FILE_LINE_LIMIT = 200;

/** Environment variable overriding DEFAULT_MEMORY_PREVIEW_LINES. */
export const ENV_MEMORY_PREVIEW_LINES = "SPIRITS_MEMORY_PREVIEW_LINES";

/** Environment variable overriding DEFAULT_MEMORY_INJECTION_CHAR_LIMIT. */
export const ENV_MEMORY_CHAR_LIMIT = "SPIRITS_MEMORY_CHAR_LIMIT";

/** Environment variable overriding DEFAULT_MEMORY_FILE_LINE_LIMIT. */
export const ENV_MEMORY_LINE_LIMIT = "SPIRITS_MEMORY_LINE_LIMIT";

// ---------------------------------------------------------------------------
// Session TODO panel
// ---------------------------------------------------------------------------

/** Default TODO lines shown in the interactive panel. Unit: lines. Set via ENV_TODO_MAX_LINES. */
export const DEFAULT_TODO_MAX_LINES = 5;

/** Environment variable overriding DEFAULT_TODO_MAX_LINES. */
export const ENV_TODO_MAX_LINES = "SPIRITS_TODO_MAX_LINES";

/** File `note()` appends to. Also the only file whose excerpt is taken from the tail. */
export const MEMORY_NOTES_FILE_NAME = "notes.md";

/** Maximum skill name length. Unit: characters. Agent Skills spec (same limit as pi). */
export const SKILL_NAME_MAX_LENGTH = 64;

/** Skill name pattern. Agent Skills spec. Shared by skills.ts and tools.ts. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Maximum skill description length. Unit: JS string length. Agent Skills spec (same limit as pi). */
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

/** codemode tool names. External contract, mentioned in guidance.ts and prompt.ts. */
export const TOOL_NAME_SKILL_SAVE = "spirits_skill_save";
export const TOOL_NAME_SKILL_LIST = "spirits_skill_list";
export const TOOL_NAME_SKILL_DELETE = "spirits_skill_delete";
export const TOOL_NAME_PROMPT_SET = "spirits_prompt_set";
