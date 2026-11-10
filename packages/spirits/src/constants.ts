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

/** File name of pi's settings inside the agent directory. pi owns the file; the managed commands merge into it. */
export const SETTINGS_FILE_NAME = "settings.json";

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

/** Directory next to the installed executable that pi reads built-in themes from. Shared with scripts/install.sh. */
export const THEME_ASSETS_DIR_NAME = "theme";

/** Built-in theme asset file names distributed with the executable. Shared with scripts/install.sh. */
export const THEME_ASSET_NAMES: readonly string[] = ["dark.json", "light.json"];

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

// ---------------------------------------------------------------------------
// tsrepl cell log (usage measurement)
// ---------------------------------------------------------------------------

/**
 * Custom session entry type carrying one record per executed cell. pi keeps custom entries out of
 * the LLM context, so this is measurement data only. Data shape: `CellMetrics` in `repl/metrics.ts`.
 */
export const TSREPL_CELL_ENTRY_TYPE = "tsrepl_cell";

// ---------------------------------------------------------------------------
// Bundled skills
// ---------------------------------------------------------------------------

/** Environment variable that disables the bundled skills. Set to `0` to disable; unset or any other value keeps them enabled. */
export const ENV_BUNDLED_SKILLS = "SPIRITS_BUNDLED_SKILLS";

// ---------------------------------------------------------------------------
// Dual model routing (`spirits/auto`)
// ---------------------------------------------------------------------------

/** Settings key holding the strong model spec. pi keeps the key because it keeps unknown keys. */
export const SETTINGS_KEY_MODELS = "models";

/** Settings key under SETTINGS_KEY_MODELS holding the strong model spec string. */
export const SETTINGS_KEY_STRONG_MODEL = "strong";

/** Settings key under SETTINGS_KEY_MODELS holding the default role pi's `/model` save key writes. */
export const SETTINGS_KEY_ROLE = "role";

/** Settings key of pi's default model provider, the normal target when it is set. */
export const SETTINGS_KEY_DEFAULT_PROVIDER = "defaultProvider";

/** Settings key of pi's default model id, the normal target when it is set. */
export const SETTINGS_KEY_DEFAULT_MODEL = "defaultModel";

/** Settings key of pi's default thinking level, written by `/spirits-model <ref> <level>`. */
export const SETTINGS_KEY_THINKING_LEVEL = "defaultThinkingLevel";

/** Separates the provider from the model id in a model key. Shared with pi's model references. */
export const MODEL_SPEC_SEPARATOR = "/";

/** Provider of the routing virtual model. No provider uses the id, so the model is always selectable. */
export const ROUTING_PROVIDER_ID = "spirits";

/** Model id of the routing virtual model, selected as `/model spirits/auto`. */
export const ROUTING_MODEL_ID = "auto";

/** Name shown for the routing virtual model in the model selector. */
export const ROUTING_MODEL_NAME = "Auto";

/** Role of every request that is not made during a strong phase. */
export const MODEL_ROLE_NORMAL = "normal";

/** Role of the requests a strong-phase skill makes. */
export const MODEL_ROLE_STRONG = "strong";

/** Role vocabulary spirits registers with pi's `/model`, in the spelling the save key stores. */
export const MODEL_ROLES: readonly string[] = [MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG];

/**
 * pi's custom entry type that stores the router state and the routed role on a session branch. pi
 * keeps the constant inside its package, so spirits reads and writes the entry through this name.
 * On the managed route this entry belongs to the official core: spirits reads it (to inherit a role
 * a fork wrote) and never writes it.
 */
export const ROUTING_STATE_ENTRY_TYPE = "pi.virtual-model-state";

// ---------------------------------------------------------------------------
// Managed-route command surface (`/spirits-model`, `/spirits-role`, `/spirits-clear`)
// ---------------------------------------------------------------------------

/** Command that selects the model, thinking level, and role in one line where the host has no `/model` role vocabulary. */
export const COMMAND_SPIRITS_MODEL = "spirits-model";

/** Command that pins the session role without changing the model. */
export const COMMAND_SPIRITS_ROLE = "spirits-role";

/**
 * spirits-owned session entry carrying the role the session is locked to on the managed route. The
 * fork route records the role in pi's routing-state entry instead; this entry exists so the managed
 * route never writes an entry the official core owns. Data: `{ role }`.
 */
export const ROLE_ENTRY_TYPE = "spirits_role";

/** Command that removes the conversation before it from the LLM context. */
export const COMMAND_SPIRITS_CLEAR = "spirits-clear";

/**
 * spirits-owned session entry marking a conversation boundary written by `/spirits-clear`. Entries
 * before the newest one on the branch are dropped from the LLM context. Data: `{ at }`.
 */
export const CLEAR_ENTRY_TYPE = "spirits_clear";

/** Extension status key holding the role badge shown on the footer's extension status line. */
export const ROLE_STATUS_KEY = "spirits";

/** Prefix of the skill commands the `input` event reports before pi expands them. */
export const SKILL_COMMAND_PREFIX = "/skill:";

/** Skills whose agent run goes to the strong role. */
export const STRONG_PHASE_SKILL_NAMES: readonly string[] = ["sprt-opsx-review-change", "sprt-opsx-verify-deep"];

/**
 * pi's api id for virtual catalog entries. pi keeps `isVirtualModel` inside the package, so spirits
 * reads this value off `PiModel.api` to keep virtual models out of routing targets. Pinned by
 * `test/pi-runtime/virtual-model-api.test.ts`.
 */
export const PI_VIRTUAL_MODEL_API = "pi-virtual";

/** Notification suppressed after the first one in a run: a configured strong model cannot be used. */
export const NOTIFY_KEY_STRONG_UNUSABLE = "routing-strong-unusable";

/** Notification suppressed after the first one in a run: normal fell back to the previous model. */
export const NOTIFY_KEY_PREVIOUS_FALLBACK = "routing-previous-fallback";

/** Days a non-current bundled version directory is kept before cleanup. Unit: days. */
export const BUNDLED_SKILLS_STALE_AFTER_DAYS = 7;

// ---------------------------------------------------------------------------
// Managed Pi experimental route (`spirits managed-pi`)
// ---------------------------------------------------------------------------

/** Managed root under `~/.spirits`; deliberately separate from bin/ and agent/. */
export const MANAGED_PI_ROOT_NAME = "managed-pi";

/** Isolated agent directory under the managed root (`<managed root>/agent`). */
export const MANAGED_PI_AGENT_DIR_NAME = "agent";

/** Release set directory under the managed root. */
export const MANAGED_PI_RELEASES_DIR_NAME = "releases";

/** Symlink under the managed root that points at the current verified set. */
export const MANAGED_PI_CURRENT_LINK_NAME = "current";

/** Only platform the managed route ships for. */
export const MANAGED_PI_PLATFORM = "linux-x64";

/** First Pi version supported by the managed route. */
export const MANAGED_PI_FIRST_PI_VERSION = "1.5.0";

/** Official Pi release artifact for the first supported set. */
export const MANAGED_PI_FIRST_ARTIFACT_NAME = "pi-linux-x64.tar.gz";

/** SHA256 of the official Pi 1.5.0 linux-x64 artifact (from the release SHA256SUMS file). */
export const MANAGED_PI_FIRST_ARTIFACT_SHA256 =
	"df870ba0e344cb7b3358d8d8f19397b8b8d225a8669784736ad68a5c2169d53b";

/** SHA256 of the overlay package.json generated from the first official artifact. */
export const MANAGED_PI_FIRST_OVERLAY_SHA256 =
	"883b0b1462dd22bbcfa5c5020aeb79979b74adc39d059d6dbc8fa8318135a6ad";

/** Overlay version recorded for the first supported set. */
export const MANAGED_PI_FIRST_OVERLAY_VERSION = "1.5.0-spirits.1";

/** Extension bundle release asset name. */
export const MANAGED_PI_EXTENSION_ASSET_NAME = "spirits-managed-pi-extension.js";

/** Manifest release asset name. */
export const MANAGED_PI_MANIFEST_ASSET_NAME = "spirits-managed-pi-manifest.json";

/** Prefix of the temporary directory inside the managed root. Reuses the self-update contract. */
export const MANAGED_PI_TEMP_DIR_PREFIX = ".spirits-tmp-";

/** Environment variable the official Pi reads for the agent directory after the overlay rename. */
export const ENV_MANAGED_AGENT_DIR = "SPIRITS_CODING_AGENT_DIR";

/** Old agent-dir name that must not select the managed route's data. */
export const ENV_OLD_AGENT_DIR = "PI_CODING_AGENT_DIR";

/** Session directory name under the isolated agent dir. */
export const MANAGED_PI_SESSION_DIR_NAME = "sessions";

/** Environment variable pi reads for the session directory (derived from the app name). */
export const ENV_MANAGED_SESSION_DIR = "SPIRITS_CODING_AGENT_SESSION_DIR";

/** Old session-dir name that must not redirect managed sessions outside the isolated agent dir. */
export const ENV_OLD_SESSION_DIR = "PI_CODING_AGENT_SESSION_DIR";

/**
 * App-name and config-dir variables a fork-route install may have left in the environment. The
 * official Pi reads neither (its identity comes from `piConfig` in the package.json beside the
 * executable), so they are dropped from the child environment rather than pinned: leaving a
 * fork-era value there would describe a knob the managed route does not have.
 */
export const ENV_OLD_APP_NAME = "PI_APP_NAME";
export const ENV_OLD_CONFIG_DIR = "PI_CONFIG_DIR";

/** Pi's package-dir override; the wrapper pins it to the managed package. */
export const ENV_PACKAGE_DIR = "PI_PACKAGE_DIR";

/** Base URLs for the managed manifest; fixtures override them through the existing release URL vars. */
export const ENV_MANAGED_PI_MANIFEST_URL = "SPIRITS_MANAGED_PI_MANIFEST_URL";

// ---------------------------------------------------------------------------
// Default route (`spirits` starting managed) and the first-launch agent backup
// ---------------------------------------------------------------------------

/**
 * Environment variable that selects the launch route. `fork` starts the compiled fork; unset and
 * any other value start managed. Pi owns a `--fork` CLI flag, so the escape hatch is an environment
 * variable and never a flag.
 */
export const ENV_ROUTE = "SPIRITS_ROUTE";

/** Value of {@link ENV_ROUTE} that keeps the fork route. */
export const ROUTE_FORK_VALUE = "fork";

/** Backups root under `$HOME` (`~/.spirits/backups`), beside `bin`, `agent`, and `managed-pi`. */
export const SPIRITS_BACKUPS_DIR_NAME = "backups";

/** Prefix of one agent backup directory inside the backups root (`agent-<UTC time>`). */
export const AGENT_BACKUP_DIR_PREFIX = "agent-";

/** Suffix of the directory a backup is copied into before it is renamed to its final name. */
export const AGENT_BACKUP_TEMP_SUFFIX = ".partial";

/** Record in the managed root that the first-launch agent backup was taken. */
export const AGENT_BACKUP_STATE_FILE_NAME = "agent-backup.json";

/** Repair command shown whenever managed assets are missing, corrupt, or failed to download. */
export const MANAGED_PI_REPAIR_COMMAND = "spirits managed-pi repair";

/** Escape hatch shown together with a managed launch failure. */
export const MANAGED_PI_FORK_ROUTE_HINT = `SPIRITS_ROUTE=${ROUTE_FORK_VALUE} spirits`;

/**
 * Summary a cleared conversation writes when the extension takes a compaction over. It names what
 * happened and carries none of the cleared conversation, which is the point of the interception.
 */
export const CLEAR_COMPACTION_SUMMARY =
	"Conversation cleared by /spirits-clear. Everything before that boundary is out of context and is not summarized here.";
