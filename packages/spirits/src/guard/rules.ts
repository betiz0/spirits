/**
 * The bash guard's classifications.
 *
 * Six categories in two families. S1 to S3 stop the shell being used as a programming language, and
 * the guard applies them only to a bash call the model issued itself. P1 to P3 stop code written in
 * another language, and the guard applies those to a nested call (one a tsrepl cell made through
 * `tool("bash")` or `sh`) as well, since that is where the change's own purpose would otherwise stay
 * reachable. P3 is the ban on Python by name: it reads command names alone, so it catches the runs
 * that are neither inline code nor a scratch script.
 *
 * The thresholds and the exception shapes live here, in values named for the decision they encode.
 * The wording that guides the model lives in `spirits:shared`, so editing a prompt never edits a
 * verdict.
 */

import {
	BASH_PIPE_ALLOW_FILTERS,
	SCRATCH_CODE_CATEGORIES,
	SHELL_PROGRAMMING_CATEGORIES,
	type GuardCategoryId,
} from "../constants.ts";
import { lex, stdoutTargets, type LexedCommand, type LexedWord, type LexResult } from "./lex.ts";

/**
 * The two decisions the pipeline rule is made of, kept apart so the stricter alternative the design
 * keeps reachable is one value away: with {@link PipelineThresholds.filterOnlyPipelinesPass} off,
 * every pipeline of {@link PipelineThresholds.stageThreshold} stages or more is S2.
 */
export interface PipelineThresholds {
	/**
	 * Stages at which a pipeline starts to count as shell programming. Unit: stages.
	 *
	 * Two-stage pipelines were 57.3% of the measured bash calls, so the line sits at three.
	 */
	stageThreshold: number;
	/** Whether a chain whose stages behind the first are all allow-listed filters passes. */
	filterOnlyPipelinesPass: boolean;
}

/** The shipped thresholds, taken from the measured distribution in the change's design. */
export const DEFAULT_PIPELINE_THRESHOLDS: PipelineThresholds = {
	stageThreshold: 3,
	filterOnlyPipelinesPass: true,
};

/** Control words that make a command position a shell control structure. */
const CONTROL_WORDS: readonly string[] = ["for", "while", "until", "if", "case", "select"];

/** Filters and text processors: the shell doing the work instead of running a tool. */
const PROGRAMMABLE_FILTERS: readonly string[] = ["awk", "gawk", "mawk", "jq", "xargs"];

/** `sed -n '1,50p' file` reads a range, so sed is judged on its arguments rather than its name. */
const SED_COMMAND = "sed";
/**
 * The only quiet spelling sed is excused for: `-n`.
 *
 * `--quiet` and `--silent` do the same job, but the exception stays the one shape a person reaches
 * for when reading lines rather than a general hole, and the spec names `-n` alone.
 */
const SED_QUIET_OPTIONS: readonly string[] = ["-n"];

/**
 * The pieces of one print command: `<address>[,<address>]p`, joined by `;`. `p` is the only sed
 * command the read shape allows, so `w`, `s`, and `{ … }` end the parse.
 */
const SED_PRINT_COMMAND = "p";
const SED_ADDRESS_SEPARATOR = ",";
const SED_SCRIPT_SEPARATOR = ";";
/** The two non-numeric addresses: the last line and a `/regex/` range. */
const SED_LAST_LINE_ADDRESS = "$";
const SED_REGEX_DELIMITER = "/";
/** A decimal line number, which is the third address form. */
const DECIMAL_DIGITS = "0123456789";

/** A heredoc handed to `git commit` is a commit message, not a generated file. */
const COMMIT_COMMAND = "git";
const COMMIT_SUBCOMMAND = "commit";

/** Command tee writes its standard input out to, which makes a heredoc into a file. */
const TEE_COMMAND = "tee";

/** Interpreter names, matched on the last path segment so `/usr/bin/python3` counts. */
const INTERPRETER_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
	{ id: "python", pattern: /^python[0-9]*(\.[0-9]*)*$/ },
	{ id: "node", pattern: /^node(?:js)?$/ },
	{ id: "bun", pattern: /^bun$/ },
	{ id: "deno", pattern: /^deno$/ },
	{ id: "perl", pattern: /^perl[0-9._]*$/ },
	{ id: "ruby", pattern: /^ruby[0-9._]*$/ },
	{ id: "php", pattern: /^php[0-9._]*$/ },
];

/** The interpreter table's python id, which is the entry P3 reads instead of restating the name. */
const PYTHON_INTERPRETER_ID = "python";

/**
 * The python name pattern, taken from the interpreter table so the two spellings cannot drift apart.
 *
 * Versioned and path-qualified names are the table's business. P3 adds only the tool names below.
 */
const PYTHON_NAME_PATTERN: RegExp | undefined = INTERPRETER_PATTERNS.find(
	(entry) => entry.id === PYTHON_INTERPRETER_ID,
)?.pattern;

/**
 * Tools that run Python without naming an interpreter: installers, runners, test and notebook front
 * ends. Judged on the command name alone, in every position {@link walkCommandPositions} reads, so a
 * project's own `pytest` or `uv run` is a hit like any other.
 */
const PYTHON_TOOL_NAMES: readonly string[] = [
	"pip",
	"pip3",
	"pipx",
	"uv",
	"uvx",
	"pytest",
	"poetry",
	"hatch",
	"pdm",
	"tox",
	"ipython",
	"jupyter",
];

/** A Python file run as a command: `./scratch.py`, `scripts/run.py --flag`. */
const PYTHON_SCRIPT_EXTENSION = ".py";

/**
 * The five wrappers the guard reads past: `env`, `timeout`, `nice`, `nohup`, `uv run`.
 *
 * `nohup` carries no option table because the shape the guard reads past is the bare one, and an
 * option it cannot account for is a give-up. `sudo` is absent on purpose: its options take values
 * often enough that reading past it would need a rule bigger than the reach it buys.
 *
 * Shells are absent as well: a script handed to `bash` or `sh` stays out of scope, and a string
 * handed to a shell's `-c` is judged as a command string of its own rather than through a wrapper.
 */
interface WrapperShape {
	/** Options that take their value in the next word. */
	valueOptions: readonly string[];
	/** Options that stand alone. */
	flags: readonly string[];
	/** True when `-N` (a sign and a decimal integer, as in `nice -5`) counts as one option. */
	numericOption?: boolean;
	/** True when the wrapper reads `NAME=value` assignments before the command (`env`). */
	assignments?: boolean;
	/** True when the first non-option word is the wrapper's own argument, not the command. */
	ownArgument?: boolean;
	/** The subcommand that has to follow the wrapper name (`uv run`). */
	subcommand?: string;
}

const WRAPPERS: Readonly<Record<string, WrapperShape>> = {
	env: { valueOptions: ["-u", "--unset"], flags: ["-i", "--ignore-environment"], assignments: true },
	timeout: { valueOptions: ["-s", "-k", "--signal", "--kill-after"], flags: [], ownArgument: true },
	nice: { valueOptions: ["-n", "--adjustment"], flags: [], numericOption: true },
	nohup: { valueOptions: [], flags: [] },
	uv: { valueOptions: ["--with", "--python", "-p", "--project"], flags: ["--no-project"], subcommand: "run" },
};

/** A `nice` adjustment written as one word: `nice -5 python3`. */
const NUMERIC_OPTION_PATTERN = /^[-+][0-9]+$/;

/** Script extensions an interpreter may run from a temporary directory. */
const TYPESCRIPT_EXTENSIONS: readonly string[] = [".ts", ".mts", ".cts"];

/** Environment-variable spellings of a temporary directory in a path operand. */
const TEMPORARY_PREFIXES: readonly string[] = ["$TMPDIR/", "${TMPDIR}/"];

/** Categories in reporting order. */
const CATEGORY_ORDER: readonly GuardCategoryId[] = ["S1", "S2", "S3", "P1", "P2", "P3"];

/** Shells whose `-c` operand is a command string the guard reads again. */
const SHELL_NAMES: readonly string[] = ["bash", "sh", "zsh", "dash", "ksh"];

/** The shell builtin that runs its arguments as a command string. */
const EVAL_COMMAND = "eval";

/** The option letter that makes a shell read its next operand as a command string. */
const SHELL_COMMAND_OPTION = "c";

/** The single option prefix. */
const OPTION_PREFIX = "-";
/** The word that closes a shell's option region: what follows is a script file and its arguments. */
const OPTION_REGION_END = "--";

/**
 * How far the `-c` / `eval` reading recurses. The string the bash tool was handed is depth 0, so a
 * script three shell levels down is still read and the level after it is not.
 *
 * The cap is what bounds the cost: a written-out `eval eval eval eval …` cannot make the guard lex
 * more than {@link MAX_RECLASSIFIED_DEPTH} extra strings per shell call it meets.
 */
const MAX_RECLASSIFIED_DEPTH = 3;

/** What the path judgements need. Neither comes from the command string. */
export interface GuardScope {
	/** Session working directory. A relative script path resolves against it. */
	cwd: string;
	/** Temporary directories, resolved once when the guard registers. */
	tempDirectories: readonly string[];
}

/** How a call was issued, and the thresholds to judge it with. */
export interface ClassifyOptions {
	/** True when another tool issued the bash call, which drops the S family. */
	nested?: boolean;
	/** Overrides for the shipped pipeline thresholds. */
	thresholds?: PipelineThresholds;
}

/** What the guard decided about one command string. */
export interface GuardVerdict {
	/** The category ids the command hit, in reporting order. Empty when the command runs. */
	categories: GuardCategoryId[];
	/** True when the command string could not be lexed. Nothing is classified then. */
	parseError: boolean;
}

/**
 * Classify one bash command string.
 *
 * Never throws: an input the lexer cannot settle comes back with no categories, so a bug here costs
 * a miss rather than a blocked bash tool. pi blocks a tool when a `tool_call` handler fails, which is
 * exactly what the caller must not let happen.
 */
export function classify(command: string, scope: GuardScope, options: ClassifyOptions = {}): GuardVerdict {
	const result = lex(command);
	if (result.parseError) return { categories: [], parseError: true };

	const thresholds = options.thresholds ?? DEFAULT_PIPELINE_THRESHOLDS;
	const nested = options.nested === true;
	const hits = new Set<GuardCategoryId>();
	collectHits(result, scope, nested, 0, thresholds, hits);

	const applicable = nested ? SCRATCH_CODE_CATEGORIES : SHELL_PROGRAMMING_CATEGORIES.concat(SCRATCH_CODE_CATEGORIES);
	return {
		categories: CATEGORY_ORDER.filter((id) => hits.has(id) && applicable.includes(id)),
		parseError: false,
	};
}

/**
 * Add the categories one lexed command string hits, then those of every command string it hands to a
 * shell's `-c` or to `eval`.
 *
 * The reach is the outer call's: a nested call drops the S family however many shells the text passes
 * through, because who issued the call is a fact about the call, not about the quoting. A string the
 * lexer cannot settle adds nothing, and the walk stops at {@link MAX_RECLASSIFIED_DEPTH}.
 */
function collectHits(
	result: LexResult,
	scope: GuardScope,
	nested: boolean,
	depth: number,
	thresholds: PipelineThresholds,
	hits: Set<GuardCategoryId>,
): void {
	if (!nested) {
		if (hitsControlSyntax(result)) hits.add("S1");
		if (hitsProgrammablePipeline(result, thresholds)) hits.add("S2");
		if (hitsHeredocFile(result.commands)) hits.add("S3");
	}
	if (hitsInlineCode(result.commands)) hits.add("P1");
	if (hitsTempScript(result.commands, scope)) hits.add("P2");
	if (hitsPython(result.commands)) hits.add("P3");
	if (depth >= MAX_RECLASSIFIED_DEPTH) return;
	for (const command of result.commands) {
		for (const script of reclassifiedScripts(command)) {
			const inner = lex(script);
			// An inner string the lexer cannot settle is a miss, exactly as at the top level.
			if (inner.parseError) continue;
			collectHits(inner, scope, nested, depth + 1, thresholds, hits);
		}
	}
}

/**
 * The command strings a simple command hands over for a second reading: the operand after a shell's
 * `-c`, and `eval`'s operands joined by a space.
 *
 * Nothing comes back when the shell gets a script file instead of `-c`, when the operand is text the
 * shell expands (`"echo $X; pytest"`, `"$(cat cmd.txt)"`), and when there is no operand at all.
 * Missing is the direction a wrong guess has to fall in, and it is what keeps `sudo` and `ssh` out of
 * the reading. A single-quoted operand is not an expansion: the guard reads exactly what runs.
 */
function reclassifiedScripts(command: LexedCommand): string[] {
	const name = commandName(command);
	if (SHELL_NAMES.includes(name)) return shellDashCScripts(command);
	if (name === EVAL_COMMAND) return evalScripts(command);
	return [];
}

/**
 * The command string a shell was told to run: the operand after its own option region, when that
 * region carried a `c`.
 *
 * The option region is where the search stops. `bash scripts/run.sh -c "pytest"` and
 * `bash -- scripts/run.sh -c "pytest"` hand `-c` to the script, not to the shell, and the guard does
 * not read script files. Bash keeps taking options after `-c` and reads its command string from the
 * first non-option word, so `bash -c -x "pytest"` runs `pytest`.
 *
 * An option or an operand the shell expands ends the reading: the guard judges text it will not see.
 */
function shellDashCScripts(command: LexedCommand): string[] {
	let wantsCommandString = false;
	for (const word of command.words.slice(1)) {
		const text = word.text;
		// `--` closes the option region, so what follows is a script file and its arguments.
		if (text === OPTION_REGION_END) break;
		if (isShellOption(text)) {
			if (word.expands) return [];
			// A long option spells its word out, so only a 1-character bundle (`-c`, `-lc`, `-ec`) carries `c`.
			if (!text.startsWith(OPTION_REGION_END) && text.includes(SHELL_COMMAND_OPTION)) {
				wantsCommandString = true;
			}
			continue;
		}
		// Without a `c` this word is the script file, whose contents are out of scope.
		if (!wantsCommandString) return [];
		return word.expands ? [] : [word.text];
	}
	return [];
}

/** An option word of a shell: a leading `-` with something after it (`-c`, `-lc`, `--norc`). */
function isShellOption(text: string): boolean {
	return text.startsWith(OPTION_PREFIX) && text.length > OPTION_PREFIX.length;
}

/**
 * `eval`'s operands, joined the way the shell joins them before reading them.
 *
 * One expanding operand is enough: the joined string is no longer the text the guard read.
 */
function evalScripts(command: LexedCommand): string[] {
	const operands = command.words.slice(1);
	if (operands.length === 0 || operands.some((word) => word.expands)) return [];
	return [operands.map((word) => word.text).join(" ")];
}

// ---------------------------------------------------------------------------
// S1: shell control syntax and function definitions
// ---------------------------------------------------------------------------

function hitsControlSyntax(result: LexResult): boolean {
	// A loop is the reserved word at command position plus the commands it runs, and the two halves
	// never share a command: the reserved words never become stages (design decision 6).
	if (result.controlWords.some((word) => CONTROL_WORDS.includes(word))) return true;
	return result.commands.some((command) => command.functionDefinition);
}

// ---------------------------------------------------------------------------
// S2: programmable filters and long pipelines
// ---------------------------------------------------------------------------

function hitsProgrammablePipeline(result: LexResult, thresholds: PipelineThresholds): boolean {
	for (const command of result.commands) {
		const name = commandName(command);
		if (PROGRAMMABLE_FILTERS.includes(name)) return true;
		if (name === SED_COMMAND && !isSedPrintOnly(command)) return true;
	}
	// A group is one stage from outside and keeps its own pipelines inside, so both lists are judged.
	for (const pipeline of result.pipelines.concat(result.groupPipelines)) {
		if (hitsLongPipeline(pipeline, thresholds)) return true;
	}
	return false;
}

/**
 * A pipeline of `stageThreshold` stages or more is S2 unless every stage behind the first is an
 * allow-listed filter. The first stage is where the reading happens, so it is never the reason.
 */
function hitsLongPipeline(pipeline: readonly LexedCommand[], thresholds: PipelineThresholds): boolean {
	if (pipeline.length < thresholds.stageThreshold) return false;
	if (!thresholds.filterOnlyPipelinesPass) return true;
	return pipeline.slice(1).some((stage) => !isAllowedFilter(commandName(stage)));
}

function isAllowedFilter(name: string): boolean {
	return name !== "" && BASH_PIPE_ALLOW_FILTERS.includes(name);
}

/**
 * The one sed shape the guard passes: `-n`, a script of print commands only, and file names.
 *
 * `-e`, `-i`, `--quiet`, a `w` command, and braces all fail it, which sends editing and anything the
 * print reading cannot settle to the cell.
 */
function isSedPrintOnly(command: LexedCommand): boolean {
	let quiet = false;
	let scriptSeen = false;
	for (const word of command.words.slice(1)) {
		const text = word.text;
		if (SED_QUIET_OPTIONS.includes(text)) {
			quiet = true;
			continue;
		}
		if (text.startsWith("-")) return false;
		if (!scriptSeen && isSedPrintScript(text)) {
			scriptSeen = true;
			continue;
		}
		// After the script, everything left has to be a file name.
		if (!scriptSeen) return false;
	}
	// Without `-n` sed prints the whole file beside running the script, so it is not the read shape.
	return quiet && scriptSeen;
}

/**
 * Whether a sed script is print commands and nothing else: `1,50p`, `58p`, `100,140p;195,215p`.
 *
 * The script is read from the left rather than split on `;`, because a `/regex/` address may itself
 * hold a `;` (`/a;b/,/c/p`). Whatever the reading cannot settle is a miss toward S2, which is the
 * behaviour the guard had before this parser existed.
 */
function isSedPrintScript(script: string): boolean {
	let cursor = 0;
	for (;;) {
		const end = readSedPrintCommand(script, cursor);
		if (end === undefined) return false;
		if (end === script.length) return true;
		if (script[end] !== SED_SCRIPT_SEPARATOR) return false;
		cursor = end + 1;
		// A script may end on the separator: `1,2p;`.
		if (cursor === script.length) return true;
	}
}

/** Offset just past one `<address>[,<address>]p`, or undefined when the script does not read that way. */
function readSedPrintCommand(script: string, index: number): number | undefined {
	let cursor = readSedAddress(script, index);
	if (cursor === undefined) return undefined;
	if (script[cursor] === SED_ADDRESS_SEPARATOR) {
		const second = readSedAddress(script, cursor + 1);
		if (second === undefined) return undefined;
		cursor = second;
	}
	if (script[cursor] !== SED_PRINT_COMMAND) return undefined;
	return cursor + 1;
}

/** Offset just past one address, or undefined. Addresses are a decimal line, `$`, or `/regex/`. */
function readSedAddress(script: string, index: number): number | undefined {
	const character = script[index];
	if (character === SED_LAST_LINE_ADDRESS) return index + 1;
	if (character === SED_REGEX_DELIMITER) return readSedRegex(script, index);
	let cursor = index;
	while (cursor < script.length && DECIMAL_DIGITS.includes(script[cursor])) {
		cursor += 1;
	}
	return cursor > index ? cursor : undefined;
}

/** Offset just past a `/…/` address. A backslash escapes the next character, including the delimiter. */
function readSedRegex(script: string, index: number): number | undefined {
	let cursor = index + 1;
	while (cursor < script.length) {
		const character = script[cursor];
		if (character === "\\") {
			cursor += 2;
			continue;
		}
		if (character === SED_REGEX_DELIMITER) return cursor + 1;
		cursor += 1;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// S3: heredoc written out to a file
// ---------------------------------------------------------------------------

function hitsHeredocFile(commands: readonly LexedCommand[]): boolean {
	return commands.some((command) => {
		if (command.heredocs.length === 0) return false;
		if (isCommitMessage(command)) return false;
		if (stdoutTargets(command).length > 0) return true;
		return commandName(command) === TEE_COMMAND;
	});
}

function isCommitMessage(command: LexedCommand): boolean {
	return commandName(command) === COMMIT_COMMAND && command.words[1]?.text === COMMIT_SUBCOMMAND;
}

// ---------------------------------------------------------------------------
// P1, P2, P3: interpreters and Python
// ---------------------------------------------------------------------------

/** An interpreter command, with the words the interpreter itself sees. */
interface InterpreterCommand {
	id: string;
	/** The words after the interpreter name: its options, its script, its arguments. */
	operands: LexedWord[];
	/** The command it sits in, for the standard-input questions. */
	command: LexedCommand;
}

/** What the walk over one simple command's command positions found. */
interface CommandWalk {
	/**
	 * Every command position read as a settled name, wrapper names included, in the order read.
	 *
	 * A quoted name counts: `"pytest" -q` runs pytest, and the quotes change nothing about what the
	 * shell starts. A word the shell expands names nothing, so it is absent.
	 */
	pythonNames: string[];
	/** The interpreter the walk landed on, when it landed on one. */
	interpreter?: InterpreterCommand;
}

/**
 * Walk a simple command's command positions, reading past the wrappers.
 *
 * P1 and P2 want the interpreter the walk ends on, and they read a command name only when it is
 * written bare (requirements "引用符を解釈する判定"). P3 also reads a quoted name, so the walk keeps
 * the two views apart. It records every name it passed through so that `uv run pytest` is caught by
 * `uv` itself while `env python3 x.py` is caught by the name that follows the wrapper.
 *
 * A wrapper argument this file does not know is a give-up: the walk stops with the names it has read
 * and reports no interpreter, which is the direction a wrong guess has to fall in.
 */
function walkCommandPositions(command: LexedCommand): CommandWalk {
	const pythonNames: string[] = [];
	let index = 0;
	for (;;) {
		const word = command.words[index];
		if (word === undefined) return { pythonNames };
		const pythonName = staticName(word);
		if (pythonName !== "") pythonNames.push(pythonName);

		const name = baseName(word);
		if (name === "") return { pythonNames };

		const wrapper = wrapperShape(name);
		if (wrapper !== undefined) {
			const next = readPastWrapper(command.words, index, wrapper);
			if (next === undefined) return { pythonNames };
			index = next;
			continue;
		}

		const interpreter = INTERPRETER_PATTERNS.find((entry) => entry.pattern.test(name));
		if (interpreter === undefined) return { pythonNames };
		return {
			pythonNames,
			interpreter: { id: interpreter.id, operands: command.words.slice(index + 1), command },
		};
	}
}

/**
 * The wrapper table read on its own keys only.
 *
 * A bare `table[name]` hands back `Object.prototype` members for a command named `constructor`, and
 * that is not a wrapper. The table is a lookup by command name, so only its own keys mean anything.
 */
function wrapperShape(name: string): WrapperShape | undefined {
	return Object.hasOwn(WRAPPERS, name) ? WRAPPERS[name] : undefined;
}

/** Offset of the wrapped command, or undefined when a wrapper argument cannot be read. */
function readPastWrapper(words: readonly LexedWord[], index: number, wrapper: WrapperShape): number | undefined {
	let cursor = index + 1;
	if (wrapper.subcommand !== undefined) {
		if (words[cursor]?.text !== wrapper.subcommand) return undefined;
		cursor += 1;
	}
	for (;;) {
		const word = words[cursor];
		if (word === undefined) return undefined;
		const text = word.text;
		if (wrapper.valueOptions.includes(text)) {
			// The value is the next word, and a wrapper that ends there runs nothing.
			if (words[cursor + 1] === undefined) return undefined;
			cursor += 2;
			continue;
		}
		if (wrapper.flags.includes(text) || (wrapper.assignments === true && isAssignment(text))) {
			cursor += 1;
			continue;
		}
		if (wrapper.numericOption === true && NUMERIC_OPTION_PATTERN.test(text)) {
			cursor += 1;
			continue;
		}
		if (text.startsWith("-")) return undefined;
		if (wrapper.ownArgument === true) {
			if (words[cursor + 1] === undefined) return undefined;
			return cursor + 1;
		}
		return cursor;
	}
}

function hitsInlineCode(commands: readonly LexedCommand[]): boolean {
	return commands.some((command) => {
		const interpreter = walkCommandPositions(command).interpreter;
		return interpreter !== undefined && inlineCodeShape(interpreter);
	});
}

/** Whether the interpreter gets its program text on the command line or on standard input. */
function inlineCodeShape(interpreter: InterpreterCommand): boolean {
	const { id, operands, command } = interpreter;
	// Only the interpreter's own options decide. The first operand that is not an option is a script,
	// a `-m` module name, or a subcommand, and everything behind it belongs to that target.
	// Reading the whole list stops on `python3 -m pytest -c pytest.ini`, where `-c` is pytest's.
	const lead = interpreterOwnOperands(operands);
	switch (id) {
		case "python":
			if (hasOperand(lead, "-c") || hasOperand(lead, "-")) return true;
			// `-m` runs an installed module, which is a tool run rather than inline code.
			if (hasOperand(lead, "-m")) return false;
			return scriptOperand(operands) === undefined && (command.heredocs.length > 0 || command.stdinFromPipe);
		case "node":
			return hasOperand(lead, "-e") || hasOperand(lead, "-p");
		case "bun":
			return hasOperand(lead, "-e");
		case "deno":
			return firstNonOption(operands) === "eval";
		case "perl":
		case "ruby":
			return hasOperand(lead, "-e");
		case "php":
			return hasOperand(lead, "-r");
		default:
			return false;
	}
}

function hitsTempScript(commands: readonly LexedCommand[], scope: GuardScope): boolean {
	return commands.some((command) => {
		const interpreter = walkCommandPositions(command).interpreter;
		if (interpreter === undefined) return false;
		const script = scriptOperand(interpreter.operands, interpreter.id);
		if (script === undefined || script.dynamic) return false;
		return scriptPaths(script.text, scope).some((path) => isTempScriptPath(path, scope));
	});
}

/**
 * The absolute paths a script operand can stand for.
 *
 * A `$TMPDIR/...` operand resolves once per known temporary directory: the guard does not read the
 * environment of the command it is judging, and every candidate that lands in a temporary directory
 * is a scratch script.
 */
function scriptPaths(operand: string, scope: GuardScope): string[] {
	const prefix = TEMPORARY_PREFIXES.find((candidate) => operand.startsWith(candidate));
	if (prefix === undefined) return [resolvePath(operand, scope.cwd)];
	const rest = operand.slice(prefix.length);
	return scope.tempDirectories.map((directory) => absolutePath(directory, rest));
}

function isTempScriptPath(path: string, scope: GuardScope): boolean {
	if (hasTypescriptExtension(path)) return false;
	// A project that lives inside a temporary directory still runs its own scripts.
	if (isInside(path, scope.cwd)) return false;
	return scope.tempDirectories.some((directory) => isInside(path, directory));
}

function hasTypescriptExtension(path: string): boolean {
	return TYPESCRIPT_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/**
 * Whether any command of the string starts Python (P3).
 *
 * Names alone decide it, with no options and no paths to read: the ban is on the language running,
 * so `python3 -m json.tool` and `pytest -q` hit beside `python3 -c`. A command that merely names a
 * Python file as an argument (`cat setup.py`) holds no command position there and stays free.
 */
function hitsPython(commands: readonly LexedCommand[]): boolean {
	return commands.some((command) =>
		walkCommandPositions(command).pythonNames.some((name) => isPythonName(name)),
	);
}

/** Whether one command-position name is a Python interpreter, a Python tool, or a `.py` file. */
function isPythonName(name: string): boolean {
	if (PYTHON_NAME_PATTERN?.test(name) === true) return true;
	return PYTHON_TOOL_NAMES.includes(name) || name.endsWith(PYTHON_SCRIPT_EXTENSION);
}

// ---------------------------------------------------------------------------
// word and path helpers
// ---------------------------------------------------------------------------

/** The command name of a simple command, or "" when it is not a plain literal word. */
function commandName(command: LexedCommand): string {
	return baseName(command.words[0]);
}

/** The last path segment of a word, or "" when the word carries quotes or an expansion. */
function baseName(word: LexedWord | undefined): string {
	if (word === undefined || word.quoted || word.dynamic) return "";
	return pathTail(word.text);
}

/**
 * The last path segment of a word the shell runs as written, or "" when nothing settles it.
 *
 * Quotes around a command name change what the shell starts, so P3 reads through them. An expansion
 * is the other direction: the name is only known when the shell has run it, so it names nothing.
 */
function staticName(word: LexedWord | undefined): string {
	if (word === undefined || word.expands) return "";
	return pathTail(word.text);
}

function pathTail(text: string): string {
	const slash = text.lastIndexOf("/");
	return slash === -1 ? text : text.slice(slash + 1);
}

function isAssignment(text: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=/.test(text);
}

function hasOperand(operands: readonly LexedWord[], operand: string): boolean {
	return operands.some((word) => word.text === operand);
}

/** The first operand that is not an option, which is where `deno eval` sits. */
function firstNonOption(operands: readonly LexedWord[]): string | undefined {
	return operands.find((word) => !word.text.startsWith("-"))?.text;
}

/**
 * The operands the interpreter itself was given: everything before the first non-option word.
 *
 * `python3 scripts/check.py -c config.yaml` hands `-c` to the script, and `bun build src/index.ts
 * --outdir dist -e react` hands `-e` to `build`. Both run the project, so neither is inline code.
 */
function interpreterOwnOperands(operands: readonly LexedWord[]): LexedWord[] {
	const end = operands.findIndex((word) => !word.text.startsWith("-"));
	return end === -1 ? [...operands] : operands.slice(0, end);
}

/**
 * The script an interpreter runs: the first operand that is neither an option nor the `run` of
 * `bun run` / `deno run`.
 *
 * An option that takes a value (`python3 -W ignore x.py`) leaves its value in the way, and the
 * judgement then reads that value as the script. It is a miss, which is the allowed direction; the
 * alternative is guessing which options take values.
 */
function scriptOperand(operands: readonly LexedWord[], interpreterId?: string): LexedWord | undefined {
	const skipsRun = interpreterId === "bun" || interpreterId === "deno";
	for (let index = 0; index < operands.length; index += 1) {
		const text = operands[index].text;
		if (text.startsWith("-")) continue;
		if (skipsRun && text === "run") continue;
		return operands[index];
	}
	return undefined;
}

/** Collapse `.` and `..` in a path, dropping anything above the root. */
function normalizePath(path: string): string {
	const segments: string[] = [];
	for (const segment of path.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return `/${segments.join("/")}`;
}

function resolvePath(path: string, cwd: string): string {
	if (path.startsWith("/")) return normalizePath(path);
	return absolutePath(cwd, path);
}

function absolutePath(directory: string, rest: string): string {
	return normalizePath(`${directory.replace(/\/+$/, "")}/${rest.replace(/^\/+/, "")}`);
}

function isInside(path: string, directory: string): boolean {
	const root = directory.replace(/\/+$/, "");
	if (root === "" || root === "/") return root === "/" && path !== "/";
	return path === root || path.startsWith(`${root}/`);
}
