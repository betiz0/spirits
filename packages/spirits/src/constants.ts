/**
 * Project-wide fixed values shared by multiple modules.
 *
 * Layer 2 constants (constants-discipline): values referenced outside the file that owns them.
 */

/** Environment variable pi reads to locate its agent directory. */
export const ENV_AGENT_DIR = "PI_CODING_AGENT_DIR";

/** Environment variable that disables pi's update check. */
export const ENV_SKIP_VERSION_CHECK = "PI_SKIP_VERSION_CHECK";

/** spirits config root under `$HOME`. Kept separate from the install dir `~/.spirits/bin`. */
export const SPIRITS_CONFIG_DIR_NAME = ".spirits";

/** Agent directory segment under the config root (`~/.spirits/agent`). */
export const SPIRITS_AGENT_DIR_NAME = "agent";

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
