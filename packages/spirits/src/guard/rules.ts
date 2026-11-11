/**
 * The bash guard's classifications.
 *
 * Five categories in two families. S1 to S3 stop the shell being used as a programming language, and
 * the guard applies them only to a bash call the model issued itself. P1 and P2 stop scratch code
 * written in another language, and the guard applies those to a nested call (one a tsrepl cell made
 * through `tool("bash")` or `sh`) as well, since that is where the change's own purpose would
 * otherwise stay reachable.
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
const SED_RANGE_PRINT_PATTERN = /^[0-9]+,[0-9]+p$/;
/**
 * The only quiet spelling sed is excused for: `-n`.
 *
 * `--quiet` and `--silent` do the same job, but the exception stays the one shape a person reaches
 * for when reading lines rather than a general hole, and the spec names `-n` alone.
 */
const SED_QUIET_OPTIONS: readonly string[] = ["-n"];

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

/**
 * The four wrappers the guard reads past. Shells are deliberately absent: passing a script to
 * `bash` or `sh` is out of scope for this change.
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
	uv: { valueOptions: ["--with", "--python", "-p", "--project"], flags: ["--no-project"], subcommand: "run" },
};

/** A `nice` adjustment written as one word: `nice -5 python3`. */
const NUMERIC_OPTION_PATTERN = /^[-+][0-9]+$/;

/** Script extensions an interpreter may run from a temporary directory. */
const TYPESCRIPT_EXTENSIONS: readonly string[] = [".ts", ".mts", ".cts"];

/** Environment-variable spellings of a temporary directory in a path operand. */
const TEMPORARY_PREFIXES: readonly string[] = ["$TMPDIR/", "${TMPDIR}/"];

/** Categories in reporting order. */
const CATEGORY_ORDER: readonly GuardCategoryId[] = ["S1", "S2", "S3", "P1", "P2"];

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
	if (!nested) {
		if (hitsControlSyntax(result)) hits.add("S1");
		if (hitsProgrammablePipeline(result, thresholds)) hits.add("S2");
		if (hitsHeredocFile(result.commands)) hits.add("S3");
	}
	if (hitsInlineCode(result.commands)) hits.add("P1");
	if (hitsTempScript(result.commands, scope)) hits.add("P2");

	const applicable = nested ? SCRATCH_CODE_CATEGORIES : SHELL_PROGRAMMING_CATEGORIES.concat(SCRATCH_CODE_CATEGORIES);
	return {
		categories: CATEGORY_ORDER.filter((id) => hits.has(id) && applicable.includes(id)),
		parseError: false,
	};
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
		if (name === SED_COMMAND && !isSedRangePrint(command)) return true;
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
 * The one sed shape the guard passes: `-n`, a single `A,Bp` script, and file names.
 *
 * `-e`, `-i`, `'5p'`, and `'1,$p'` all fail it, which sends editing and one-line prints to the cell.
 */
function isSedRangePrint(command: LexedCommand): boolean {
	let quiet = false;
	let rangeSeen = false;
	for (const word of command.words.slice(1)) {
		const text = word.text;
		if (SED_QUIET_OPTIONS.includes(text)) {
			quiet = true;
			continue;
		}
		if (text.startsWith("-")) return false;
		if (!rangeSeen && SED_RANGE_PRINT_PATTERN.test(text)) {
			rangeSeen = true;
			continue;
		}
		// After the script, everything left has to be a file name.
		if (!rangeSeen) return false;
	}
	// Without `-n` sed prints the whole file beside running the script, so it is not the read shape.
	return quiet && rangeSeen;
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
// P1 and P2: interpreters
// ---------------------------------------------------------------------------

/** An interpreter command, with the words the interpreter itself sees. */
interface InterpreterCommand {
	id: string;
	/** The words after the interpreter name: its options, its script, its arguments. */
	operands: LexedWord[];
	/** The command it sits in, for the standard-input questions. */
	command: LexedCommand;
}

/**
 * Find the interpreter in a simple command, reading past `env`, `timeout`, `nice`, and `uv run`.
 *
 * A wrapper argument this file does not know is a give-up: the command is left unclassified rather
 * than guessed at, which is the direction a wrong guess has to fall in.
 */
function findInterpreter(command: LexedCommand): InterpreterCommand | undefined {
	let index = 0;
	for (;;) {
		const word = command.words[index];
		if (word === undefined) return undefined;
		const name = baseName(word);
		if (name === "") return undefined;

		const wrapper = WRAPPERS[name];
		if (wrapper !== undefined) {
			const next = readPastWrapper(command.words, index, wrapper);
			if (next === undefined) return undefined;
			index = next;
			continue;
		}

		const interpreter = INTERPRETER_PATTERNS.find((entry) => entry.pattern.test(name));
		if (interpreter === undefined) return undefined;
		return { id: interpreter.id, operands: command.words.slice(index + 1), command };
	}
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
		const interpreter = findInterpreter(command);
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
		const interpreter = findInterpreter(command);
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
	const text = word.text;
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
