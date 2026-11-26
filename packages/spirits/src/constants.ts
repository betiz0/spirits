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

/**
 * Default key that collapses and expands the panel. Last candidate after the settings key and
 * ENV_TODO_TOGGLE_KEY.
 *
 * `ctrl+alt+<letter>` reaches a terminal as `ESC` plus a control character, which pi-tui matches
 * without any terminal protocol. `ctrl+shift+<letter>` needs kitty key reporting or xterm's
 * modifyOtherKeys, and tmux leaves both off by default; there the old default arrived as `0x0c`, the
 * same byte as `ctrl+l`, which pi binds to opening the model selector. A shortcut can bind a key pi
 * owns in its own config and lose silently, so this default stays inside the no-protocol forms.
 *
 * Of those forms, pi binds `ctrl+alt+]` (`tui.editor.jumpBackward`), and `h`, `i`, `j`, `m`, `[`
 * collide with another no-protocol key because their control byte is the base key itself: `ESC+0x08`
 * reads as alt+Backspace, `ESC+0x0d` as alt+Enter, `ESC+0x09` as alt+Tab, `ESC+0x0a` as a line feed,
 * and `ESC+ESC` as two escapes. `p` is inside the remaining letters, and its plain form `ctrl+p`
 * (pi's model cycle) is a different byte sequence, so the two never shadow each other.
 */
export const DEFAULT_TODO_TOGGLE_KEY = "ctrl+alt+p";

/** Environment variable holding the panel toggle key, beaten by SETTINGS_KEY_TODO_TOGGLE_KEY. */
export const ENV_TODO_TOGGLE_KEY = "SPIRITS_TODO_TOGGLE_KEY";

/** Settings key holding the panel UI settings. pi keeps the key because it keeps unknown keys. */
export const SETTINGS_KEY_TODO = "todo";

/** Settings key under SETTINGS_KEY_TODO holding the toggle key, the first candidate of the toggle key. */
export const SETTINGS_KEY_TODO_TOGGLE_KEY = "toggleKey";

/** Settings key under SETTINGS_KEY_TODO holding the initial collapsed state. Only boolean `true` collapses. */
export const SETTINGS_KEY_TODO_START_COLLAPSED = "startCollapsed";

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
// Action surface guard (bash classification)
// ---------------------------------------------------------------------------

/**
 * Custom session entry type carrying one record per guarded bash decision. pi keeps custom entries
 * out of the LLM context, so this is measurement data only. Data shape: `GuardRecord` in
 * `guard/metrics.ts`.
 */
export const ACTION_GUARD_ENTRY_TYPE = "spirits_guard";

/** Environment variable selecting the guard mode. Read once at extension load. */
export const ENV_ACTION_GUARD = "SPIRITS_ACTION_GUARD";

/** Guard mode that classifies and blocks. Used when the variable is unset or does not match exactly. */
export const ACTION_GUARD_MODE_ENFORCE = "enforce";

/** Guard mode that classifies and records, leaving execution alone. */
export const ACTION_GUARD_MODE_WARN = "warn";

/** Guard mode that classifies nothing and records nothing. */
export const ACTION_GUARD_MODE_OFF = "off";

/** A guard mode, in the spelling `SPIRITS_ACTION_GUARD` accepts. */
export type ActionGuardMode =
	| typeof ACTION_GUARD_MODE_ENFORCE
	| typeof ACTION_GUARD_MODE_WARN
	| typeof ACTION_GUARD_MODE_OFF;

/** The modes `SPIRITS_ACTION_GUARD` accepts. Anything else resolves to {@link ACTION_GUARD_MODE_ENFORCE}. */
export const ACTION_GUARD_MODES: readonly ActionGuardMode[] = [
	ACTION_GUARD_MODE_ENFORCE,
	ACTION_GUARD_MODE_WARN,
	ACTION_GUARD_MODE_OFF,
];

/** Identifier of one guard classification. Reported in the block reason and in the measurement. */
export type GuardCategoryId = "S1" | "S2" | "S3" | "P1" | "P2" | "P3";

/** Categories that stop a model-issued bash call only; a nested call is left alone. */
export const SHELL_PROGRAMMING_CATEGORIES: readonly GuardCategoryId[] = ["S1", "S2", "S3"];

/**
 * Categories that stop a model-issued bash call and a nested one alike.
 *
 * P3 sits here because the ban on Python is about the language running, not about how the call was
 * issued: a cell that shells out to Python is the same action as the model typing it into bash.
 */
export const SCRATCH_CODE_CATEGORIES: readonly GuardCategoryId[] = ["P1", "P2", "P3"];

/** What one category stops, and the one-line tsrepl form it should become. */
export interface GuardCategoryGuidance {
	/** One line naming what the classification stops. */
	readonly description: string;
	/** One line of tsrepl the model should write instead. */
	readonly example: string;
}

/** Per-category text, shared by the block reason (`guard/messages.ts`). */
export const GUARD_CATEGORY_GUIDANCE: Readonly<Record<GuardCategoryId, GuardCategoryGuidance>> = {
	S1: {
		description: "シェルの制御構文・関数定義(for / while / until / if / case / select)",
		example: 'for (const f of (await sh("ls src")).output.split("\\n")) { print(f) }',
	},
	S2: {
		description:
			"awk / jq / xargs、表示コマンドだけの形ではない sed、許可フィルタ以外を含む長いパイプ。部分の読み取りは read、書き換えは edit、出力の加工は tsrepl のセル",
		example:
			'const files = (await sh("rg -n TODO src")).output.split("\\n").map((line) => line.split(":")[0])',
	},
	S3: {
		description: "ヒアドキュメントでファイル内容を生成する書き込み。作成は write、書き換えは edit",
		example: '作成は write("notes.md", body)、既存ファイルの書き換えは edit("notes.md", before, after)',
	},
	P1: {
		description: "他言語(python、node、bun など)のインラインコード",
		example:
			'const tag = JSON.parse((await sh("gh release list --json tagName --limit 1")).output)[0].tagName',
	},
	P2: {
		description: "一時ディレクトリ配下の TypeScript 以外のスクリプト実行",
		example: '使い捨てスクリプトはセル本体に書く: return (await sh("bun /tmp/probe.ts")).exit_code',
	},
	P3: {
		description:
			"Python の実行(python 系コマンド・pip / uv 系のツール・*.py の直接実行)。対象プロジェクトのスクリプトやテストも含め、どの形も例外はありません",
		example: '処理は tsrepl のセルに書く: const data = JSON.parse(await (await use("node:fs/promises")).readFile("out.json", "utf8"))',
	},
};

/**
 * Commands a bash pipe may chain after its first stage without the pipe counting as S2. One copy:
 * `guard/rules.ts` classifies with it, `tools.ts` lists it in the tsrepl guidelines.
 */
export const BASH_PIPE_ALLOW_FILTERS: readonly string[] = [
	"head",
	"tail",
	"wc",
	"grep",
	"rg",
	"sort",
	"uniq",
	"cut",
	"tr",
	"cat",
	"nl",
	"column",
];

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

/**
 * Settings key under SETTINGS_KEY_MODELS holding the normal role's model, a single `provider/id` or
 * model id. Unset means pi's own default model, which is why the key stays optional.
 */
export const SETTINGS_KEY_NORMAL_MODEL = "normal";

/**
 * Settings key under SETTINGS_KEY_MODELS holding the per-role thinking levels, keyed by role name.
 * The same key name reads the per-step thinking level under {@link SETTINGS_KEY_STEPS}.
 */
export const SETTINGS_KEY_THINKING = "thinking";

/**
 * Settings key under SETTINGS_KEY_MODELS holding the per-step settings, keyed by step name. Each
 * entry holds `role` and `thinking`, both optional.
 */
export const SETTINGS_KEY_STEPS = "steps";

/** Settings key of pi's default model provider, the normal target when it is set. */
export const SETTINGS_KEY_DEFAULT_PROVIDER = "defaultProvider";

/** Settings key of pi's default model id, the normal target when it is set. */
export const SETTINGS_KEY_DEFAULT_MODEL = "defaultModel";

/** Separates the provider from the model id in a model key. Shared with pi's model references. */
export const MODEL_SPEC_SEPARATOR = "/";

/** Provider of the routing virtual model. No provider uses the id, so the model is always selectable. */
export const ROUTING_PROVIDER_ID = "spirits";

/** Model id of the routing virtual model, selected as `/model spirits/auto`. */
export const ROUTING_MODEL_ID = "auto";

/** Name shown for the routing virtual model in the model selector. */
export const ROUTING_MODEL_NAME = "Auto";

/**
 * The routing model as a user types it into `/model`, built from the two constants above so no message
 * can spell it differently from what spirits registers. Earlier the warning line carried its own copy of
 * the spelling, which is how it came to name something the session could not select.
 */
export const ROUTING_MODEL_REFERENCE = `${ROUTING_PROVIDER_ID}${MODEL_SPEC_SEPARATOR}${ROUTING_MODEL_ID}`;

/**
 * The host mode with a terminal in front of a person.
 *
 * Named rather than spelled at each read because the operations spirits can name — a selector, a key, a
 * slash command — only exist there, and the host's own mode union uses this word for it.
 */
export const EXTENSION_MODE_TUI = "tui";

/** The mode whose whole output contract is the model's answer on stdout, so the extension adds nothing. */
export const EXTENSION_MODE_PRINT = "print";

/**
 * The mode where a client drives the session over a pipe.
 *
 * A person is behind the input there too, and the host delivers an extension's notice and editor
 * requests to the client, so the fit gate treats it like the terminal: refuse with a reason, restore
 * the text as far as the host lets it (design Decision D7 of the fit-gate change).
 */
export const EXTENSION_MODE_RPC = "rpc";

/**
 * The host's own commands, spelled the way the host's help spells them.
 *
 * Only the interactive terminal is told these, because they are operations on a screen that only exists
 * there, and each one was read out of the pinned host rather than guessed: both are in its command table.
 * Keys are not carried here — the host draws its own key hints, so a key of ours would go stale the day a
 * binding moves, and the operations below are named by what they do.
 */
export const HOST_COMMANDS = {
	/** Opens the model selector. */
	model: "/model",
	/** Sets which models a session may select, saved into the settings file. */
	scopedModels: "/scoped-models",
} as const;

/**
 * True when a selected model is the virtual model spirits routes, which is the one condition the
 * routing is in force under.
 *
 * The single test every surface uses — the badge, the list, `status`, the setting warning, and the
 * step-start confirmation — so none of them can call a session routed while another calls it off. The
 * The provider, id, and virtual-model api must all match: a physical model can use the same name, but it
 * does not route. The parameter is the shape the readers hold rather than a host type, so this file keeps
 * importing nothing.
 */
export function isRoutingModel(model: { provider?: string; id?: string; api?: string } | undefined): boolean {
	return model?.provider === ROUTING_PROVIDER_ID && model.id === ROUTING_MODEL_ID && model.api === PI_VIRTUAL_MODEL_API;
}

/** Role of every request that is not made during a strong phase. */
export const MODEL_ROLE_NORMAL = "normal";

/** Role of the requests a strong-phase skill makes. */
export const MODEL_ROLE_STRONG = "strong";

/** Role vocabulary spirits registers with pi's `/model`, in the spelling the save key stores. */
export const MODEL_ROLES: readonly string[] = [MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG];

/**
 * The thinking level words spirits accepts, in pi's spelling. Declared as a union so a settings value
 * that survived the vocabulary check carries it, and `routing` can hand the same list to pi.
 */
export type ThinkingLevelName = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * The thinking levels spirits accepts as a setting value, lowest to highest. `routing/register.ts`
 * offers the same list to pi for `spirits/auto`; pi clamps a level the routed model cannot take.
 */
export const THINKING_LEVELS: readonly ThinkingLevelName[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * pi's custom entry type that stores the router state and the routed role on a session branch. pi
 * keeps the constant inside its package, so spirits reads and writes the entry through this name.
 * On the managed route this entry belongs to the official core: spirits reads it (to inherit a role
 * a fork wrote) and never writes it.
 */
export const ROUTING_STATE_ENTRY_TYPE = "pi.virtual-model-state";

// ---------------------------------------------------------------------------
// Managed-route command surface (`/spirits-role`, `/spirits-clear`)
// ---------------------------------------------------------------------------

/**
 * Command that locks the session role, sets a role's or step's target and thinking level, and reports
 * how the routing is running. The model itself is pi's to select: `/spirits-role` names what a role
 * routes to, never what the session is set to.
 */
export const COMMAND_SPIRITS_ROLE = "spirits-role";

/**
 * Word the list's first row and the command's first argument share: write the session's own selection
 * (its lock and its model) into pi's global settings.
 *
 * One constant because the row, the grammar, the usage line, and the completion all name the same
 * operation, and a copy in each place is how the completion came to offer a word the grammar refused.
 * The blank row that separates `save` from the settings rows is a layout detail of the list alone and
 * stays there.
 */
export const ROLE_SAVE_WORD = "save";

/**
 * Row id of the `save` row, kept apart from the word so a step or a role named `save` could not be
 * mistaken for it. The id is what the list adapter matches to decide that a key press saves.
 */
export const ROLE_SAVE_ROW = "save:selection";

/** Model references the `save` row lists when it explains how to make a global `models.normal` resolvable. Unit: references. */
export const ROLE_SAVE_SUGGESTION_MAX = 3;

/**
 * spirits-owned session entry carrying the role the session is locked to on the managed route. The
 * fork route records the role in pi's routing-state entry instead; this entry exists so the managed
 * route never writes an entry the official core owns. Data: `{ role }`.
 */
export const ROLE_ENTRY_TYPE = "spirits_role";

/**
 * spirits-owned session entry carrying the workflow step in effect on the managed route. Only the
 * step name is stored; its role and thinking level are resolved from the settings on every request,
 * so an edit takes effect on the next request (design Decision 12). A step that has ended appends a
 * record with `step: null`, which is what stops a reload from restoring it. Data: `{ step }`.
 */
export const STEP_ENTRY_TYPE = "spirits_step";

/** Command that removes the conversation before it from the LLM context. */
export const COMMAND_SPIRITS_CLEAR = "spirits-clear";

/**
 * spirits-owned session entry marking a conversation boundary written by `/spirits-clear`. Entries
 * before the newest one on the branch are dropped from the LLM context. Data: `{ at }`.
 */
export const CLEAR_ENTRY_TYPE = "spirits_clear";

/**
 * Extension status key holding the role badge, the first half of the managed route's footer line.
 *
 * The footer sorts extension statuses by key, so this key is the shorter prefix of
 * {@link ROLE_MODEL_STATUS_KEY}: the role always comes first and the model that answers after it, which
 * is the order the two read as one sentence.
 */
export const ROLE_STATUS_KEY = "spirits";

/**
 * Extension status key holding the physical model that answers, drawn after {@link ROLE_STATUS_KEY}.
 *
 * It is a key of its own so a footer that refuses one write still gets the other, and so the role stays
 * readable when there is no model to name.
 */
export const ROLE_MODEL_STATUS_KEY = "spirits-model";

/**
 * Word the badge shows while the session runs on a physical model, so the routing is not in force.
 *
 * The alternative — drawing nothing — reads as "spirits is not running" rather than as a fact about the
 * session's model, and the host's own stats line already names the physical model and its level, so the
 * badge adds no model here.
 */
export const ROLE_BADGE_OFF = "off";

/**
 * Word the badge shows when the routing is in force and no role resolves to a model at all, which is the
 * one state where the routing cannot answer whatever it is asked.
 */
export const ROLE_BADGE_NONE = "!";

/**
 * Maximum length of the answering model on the footer's status line. Unit: characters.
 *
 * The footer joins every extension's status onto one line and truncates its tail, so a long reference
 * would eat the space of the other extensions and of the model display itself. The provider is dropped
 * first, and an id past this length becomes its first {@link ROLE_MODEL_ELLIPSIS_AFTER} characters plus
 * the ellipsis, which keeps the whole display at 24.
 */
export const ROLE_MODEL_DISPLAY_MAX_LENGTH = 24;

/** Characters kept from an over-long model id before the ellipsis. Unit: characters. */
export const ROLE_MODEL_ELLIPSIS_AFTER = ROLE_MODEL_DISPLAY_MAX_LENGTH - 1;

/** Prefix of the skill commands the `input` event reports before pi expands them. */
export const SKILL_COMMAND_PREFIX = "/skill:";

/**
 * One workflow step: the work interval a starter slash command opens, with the role and the run it
 * keeps. `defaultRole` is absent when the step follows the session lock, which is the case for every
 * step but the two report skills. `continuing` keeps the step in effect after its run settles, so an
 * answer to the step's question runs on the same role (design Decision 2).
 *
 * The list is the single source, mirrored by `test/constants-steps.test.ts` against the table in the
 * `dual-model-routing` spec.
 */
export interface StepDefinition {
	/** Step name, the key of `models.steps.<name>` and the word `/spirits-role <step> …` takes. */
	name: string;
	/** Slash commands that start the step, in the spelling the user types. */
	starters: readonly string[];
	/** Role the step takes when `models.steps.<name>.role` is unset. Absent means "follow the lock". */
	defaultRole?: string;
	/** True when the step outlives its run and takes the following idle inputs too. */
	continuing: boolean;
}

/** The workflow steps spirits routes, in the order the settings list shows them. */
export const STEP_DEFINITIONS: readonly StepDefinition[] = [
	{ name: "opsx-propose", starters: ["/opsx-propose", "/skill:openspec-propose"], continuing: true },
	{ name: "opsx-new", starters: ["/opsx-new", "/skill:openspec-new-change"], continuing: true },
	{ name: "opsx-continue", starters: ["/opsx-continue", "/skill:openspec-continue-change"], continuing: true },
	{ name: "opsx-ff", starters: ["/opsx-ff", "/skill:openspec-ff-change"], continuing: true },
	{ name: "opsx-apply", starters: ["/opsx-apply", "/skill:openspec-apply-change"], continuing: true },
	{ name: "opsx-verify", starters: ["/opsx-verify", "/skill:openspec-verify-change"], continuing: true },
	{ name: "opsx-archive", starters: ["/opsx-archive", "/skill:openspec-archive-change"], continuing: true },
	{ name: "opsx-bulk-archive", starters: ["/opsx-bulk-archive", "/skill:openspec-bulk-archive-change"], continuing: true },
	{ name: "opsx-sync", starters: ["/opsx-sync", "/skill:openspec-sync-specs"], continuing: true },
	{ name: "opsx-update", starters: ["/opsx-update", "/skill:openspec-update-change"], continuing: true },
	{ name: "opsx-explore", starters: ["/opsx-explore", "/skill:openspec-explore"], continuing: true },
	{ name: "opsx-onboard", starters: ["/opsx-onboard", "/skill:openspec-onboard"], continuing: true },
	{ name: "sprt-opsx-review-change", starters: ["/skill:sprt-opsx-review-change"], defaultRole: MODEL_ROLE_STRONG, continuing: false },
	{ name: "sprt-opsx-verify-deep", starters: ["/skill:sprt-opsx-verify-deep"], defaultRole: MODEL_ROLE_STRONG, continuing: false },
	{ name: "sprt-architecture-guards", starters: ["/skill:sprt-architecture-guards"], continuing: true },
];

/**
 * How long the confirmation before a step's start waits for the user, and how much earlier the timer
 * that decides a timeout fires. Unit: milliseconds.
 *
 * pi's own countdown closes the dialog no earlier than its `timeout`, so spirits runs a timer of its own
 * {@link STEP_CONFIRM_TIMEOUT_SLACK_MS} ahead and reads a dialog that closes after that as the wait
 * running out, and one that closed before it as the user pressing Esc — the host returns `undefined` for
 * both. The slack is far wider than a keystroke can land, so the boundary is the timer, not the race.
 */
export const STEP_CONFIRM_TIMEOUT_MS = 10_000;
export const STEP_CONFIRM_TIMEOUT_SLACK_MS = 100;

/** The two answers the step-start confirmation offers, in the words the dialog shows. */
export const STEP_CONFIRM_CONTINUE = "continue";
export const STEP_CONFIRM_CANCEL = "cancel";

/**
 * The `input` event's source word for a line typed at the terminal.
 *
 * The other two sources are a session driven over RPC and a line another extension sent, and neither has a
 * person who can be asked, so this is the one source the confirmation is asked under — the host's own union,
 * spelled once here.
 */
export const INPUT_SOURCE_INTERACTIVE = "interactive";

/**
 * The `input` event's source word for a line another extension sent.
 *
 * Nobody typed it and the sending extension cannot answer a refusal, so the fit gate never judges
 * one. The host's own union, spelled once here.
 */
export const INPUT_SOURCE_EXTENSION = "extension";

/**
 * Prefix that sends an input line to the shell instead of a model.
 *
 * The terminal intercepts it before the `input` event; an RPC client can still deliver such a line,
 * and classifying it would need the host's own escaping rules, so the gate stays out of it (fail
 * open, design Decision D7 of the fit-gate change).
 */
export const SHELL_INPUT_PREFIX = "!";

/**
 * pi's compaction settings, keyed the way the settings file nests them.
 *
 * The fit gate reads the same numbers pi's own threshold check resolves — reserve, keep, and the
 * per-model overrides — because a second default of its own would drift from pi on the next host
 * bump (design Decision D2 of the fit-gate change). The fallback values come from the host's
 * exported `DEFAULT_COMPACTION_SETTINGS`, not from these keys.
 */
export const SETTINGS_KEY_COMPACTION = "compaction";

/** Settings key under {@link SETTINGS_KEY_COMPACTION} holding the per-model override table. */
export const SETTINGS_KEY_COMPACTION_MODEL_OVERRIDES = "modelOverrides";

/** Settings key holding the tokens pi keeps free below the window, ordinary or per-model. */
export const SETTINGS_KEY_COMPACTION_RESERVE_TOKENS = "reserveTokens";

/** Settings key holding the tokens pi keeps recent in a compaction, ordinary or per-model. */
export const SETTINGS_KEY_COMPACTION_KEEP_RECENT_TOKENS = "keepRecentTokens";

/**
 * pi's api id for virtual catalog entries. pi keeps `isVirtualModel` inside the package, so spirits
 * reads this value off `PiModel.api` to keep virtual models out of routing targets. Pinned by
 * `test/pi-runtime/virtual-model-api.test.ts`.
 */
export const PI_VIRTUAL_MODEL_API = "pi-virtual";

/** Notification suppressed after the first one in a run: a configured strong model cannot be used. */
export const NOTIFY_KEY_STRONG_UNUSABLE = "routing-strong-unusable";

/** Notification suppressed after the first one in a run: the configured normal model cannot be used. */
export const NOTIFY_KEY_NORMAL_UNUSABLE = "routing-normal-unusable";

/** Notification suppressed after the first one in a run: normal fell back to the previous model. */
export const NOTIFY_KEY_PREVIOUS_FALLBACK = "routing-previous-fallback";

/**
 * The fit gate's refusal wording (design Decision D6 of the fit-gate change).
 *
 * One notice per blocked decision, naming the target, its window, the reserve-inclusive threshold,
 * the measured conversation, and pi's keep. The cause line is one of {@link FIT_BLOCK_CAUSES}.
 */
export const FIT_BLOCK_CAUSES = {
	/** The ahead compaction finished and the conversation is still past the threshold. */
	stillOver: "still past the threshold after compaction",
	/** The ahead compaction reported a failure; the gate appends the host's own message. */
	compactionFailed: "the ahead compaction did not complete",
	/** The ahead compaction was cancelled (Esc, the same path as `/compact`). */
	cancelled: "the ahead compaction was cancelled",
	/** pi's automatic compaction is switched off, so the gate compacted nothing (Decision D8). */
	compactionDisabled: "automatic compaction is disabled, so nothing was compacted",
} as const;

/** Which {@link FIT_BLOCK_CAUSES} line a blocked decision reports. */
export type FitBlockCause = (typeof FIT_BLOCK_CAUSES)[keyof typeof FIT_BLOCK_CAUSES];

/** Everything the fit gate's refusal names, already read as numbers and a model key. */
export interface FitBlockNoticeFields {
	/** The model that would have answered, in `provider/id` spelling. */
	model: string;
	/** That model's context window, in tokens. */
	contextWindow: number;
	/** The reserve-inclusive threshold it is measured against, in tokens. */
	threshold: number;
	/** The measured conversation including the received text, in estimated tokens. */
	estimate: number;
	/** pi's `compaction.keepRecentTokens` resolved for the target, in tokens. */
	keepRecentTokens: number;
	/** Why this decision refused. */
	cause: FitBlockCause;
	/** The host's own failure line, appended only when a compaction failed. */
	detail?: string;
	/** True on a path where the editor restore is not guaranteed, which the notice must say. */
	restoreUncertain: boolean;
}

/**
 * Build the one notice a blocked request gets.
 *
 * The wording lives here so the numbers can never be shown in one place and hidden in another: a
 * user has to be able to compare the estimate against the threshold without opening a settings file
 * (spec `dual-model-routing` / 送らないことを選んだ理由を出す).
 */
export function fitBlockNotice(fields: FitBlockNoticeFields): string {
	const parts = [
		`not sent: estimated ${fields.estimate} tokens exceeds the fit threshold ${fields.threshold}`,
		`(context window ${fields.contextWindow} minus reserve ${fields.contextWindow - fields.threshold}) of ${fields.model}`,
		`${fields.cause}.`,
	];
	if (fields.detail) parts.push(` ${fields.detail}.`);
	parts.push(` pi keeps the most recent ${fields.keepRecentTokens} tokens of a compaction.`);
	if (fields.restoreUncertain) parts.push(" the typed text may not come back to the input field.");
	return parts.join(" ");
}

/**
 * The notice for an input that arrived while the gate's ahead compaction is in flight.
 *
 * One per rejected input; the text goes back to the editor by append, so a queue typed during the
 * compaction survives whole (design Decision D10 of the fit-gate change).
 */
export const FIT_GATE_INFLIGHT_NOTICE =
	"spirits/auto is compacting the conversation before the next request; this input was not sent.";

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

/**
 * The official Pi host this build is pinned to. Updating a host version means editing this object
 * and nothing else, and the steps in `docs/spirits-host-upgrade.md` (type mirror check, bundle and
 * manifest rebuild, official-mode compatibility run) all key off it.
 *
 * `artifactSha256` is the trust root of the downloaded artifact, taken from the release `SHA256SUMS`
 * file. `overlaySha256` is the digest of the generated `package.json` the identity overlay writes
 * into the extracted artifact, so it changes when the artifact's own `package.json` changes.
 */
export const PINNED_PI = {
	/** Host version the managed set installs. */
	version: "1.6.0",
	/** Release asset name of the host artifact for {@link MANAGED_PI_PLATFORM}. */
	artifactName: "pi-linux-x64.tar.gz",
	/** SHA256 of the host artifact. */
	artifactSha256: "ef77dbe4379b3bdeb425a1e1b862fa3c915c255000dfe4965c98eee96a5765d1",
	/** Overlay version recorded in the manifest for this pinned Pi version. */
	overlayVersion: "1.6.0-spirits.1",
	/** SHA256 of the overlay `package.json` generated from the pinned artifact. */
	overlaySha256: "e0c6b589a26f3438c5b9224294b769a999fabee3eba06383fafceb68be031cd0",
} as const;

/** Pinned Pi version, kept as a name for the manifest and the build scripts. */
export const MANAGED_PI_FIRST_PI_VERSION = PINNED_PI.version;

/** Official Pi release asset for the pinned set. */
export const MANAGED_PI_FIRST_ARTIFACT_NAME = PINNED_PI.artifactName;

/** SHA256 of the pinned official Pi artifact. */
export const MANAGED_PI_FIRST_ARTIFACT_SHA256 = PINNED_PI.artifactSha256;

/** SHA256 of the overlay package.json generated from the pinned artifact. */
export const MANAGED_PI_FIRST_OVERLAY_SHA256 = PINNED_PI.overlaySha256;

/** Overlay version recorded for the pinned set. */
export const MANAGED_PI_FIRST_OVERLAY_VERSION = PINNED_PI.overlayVersion;

/** Extension bundle release asset name. */
export const MANAGED_PI_EXTENSION_ASSET_NAME = "spirits-managed-pi-extension.js";

/** Extension bundle file name inside a release set. */
export const MANAGED_PI_SET_EXTENSION_NAME = "spirits-extension.js";

/** Manifest file name inside a release set. */
export const MANAGED_PI_SET_MANIFEST_NAME = "manifest.json";

/** Verification state file name inside a release set. */
export const MANAGED_PI_SET_INSTALLED_STATE_NAME = "installed.json";

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
 * Environment variable that used to select the launch route. Only `fork` is read, and only to refuse:
 * a release that still carries it in the environment is a release that expects an embedded Pi, and
 * silently starting the host instead would hide that.
 */
export const ENV_ROUTE = "SPIRITS_ROUTE";

/** Value of {@link ENV_ROUTE} that refuses the launch (see `forkRouteRefusal`). */
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

/** Install command shown when the managed set is absent. */
export const MANAGED_PI_INSTALL_COMMAND = "spirits managed-pi install";

/** Command that updates the pinned host and the spirits extension bundle. */
export const MANAGED_PI_UPDATE_COMMAND = "spirits managed-pi update";

/**
 * Why a host `update` cannot be spelled through the launcher, shown to the operator.
 *
 * Measured on the pinned host: `spirits -- update --extensions` reaches the host as
 * `-e <bundle> update --extensions`, where `update` is a prompt message and `--extensions` an
 * unknown option. The host dispatches `update` only when it is its first argument.
 */
export const HOST_UPDATE_PASSTHROUGH_WARNING =
	'The host reads "update" only as its own first argument, so "spirits -- update ..." is a prompt to the model, not a host command.';

/**
 * Why the launcher refuses a host command instead of forwarding it, shown to the operator.
 *
 * Measured on the pinned host: `-e <bundle> list` makes the host read `list` as a prompt to the model, and
 * `<host> list -e <bundle>` reports `Unknown option -e for "list"`. The bundle argument can therefore be
 * neither after nor around a host command.
 */
export const HOST_COMMAND_PASSTHROUGH_NOTE =
	"The launcher loads the spirits bundle before your arguments, and the host rejects that flag after one of its own commands.";

/** Tag of the last commit that still contained the Pi fork, and the source of a rollback build. */
export const FORK_FINAL_TAG_NAME = "spirits-fork-final";

/** Document that carries the full host-version upgrade and rollback steps. */
export const HOST_UPGRADE_DOC_PATH = "docs/spirits-host-upgrade.md";

/**
 * The two lines that get a user back to a previous spirits binary, shown with every managed failure.
 *
 * A repair command alone is no help when the network is unreachable, so the way back is always
 * stated: move the install directory aside and restore a saved binary, or rebuild one from the
 * fork final tag. The long form lives in {@link HOST_UPGRADE_DOC_PATH}.
 */
export const MANAGED_PI_ROLLBACK_HINT = `Rollback: move "$HOME/${SPIRITS_CONFIG_DIR_NAME}/bin" aside and restore a saved \`spirits\` binary, or rebuild it from the ${FORK_FINAL_TAG_NAME} tag. Steps: ${HOST_UPGRADE_DOC_PATH}`;

/**
 * Summary a cleared conversation writes when the extension takes a compaction over. It names what
 * happened and carries none of the cleared conversation, which is the point of the interception.
 */
export const CLEAR_COMPACTION_SUMMARY =
	"Conversation cleared by /spirits-clear. Everything before that boundary is out of context and is not summarized here.";
