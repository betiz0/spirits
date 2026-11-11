/**
 * The minimal shell lexer the bash guard classifies with.
 *
 * The guard needs four facts about a command string: the words of every simple command, how many
 * stages each pipeline has, whether a heredoc feeds a command, and where standard output goes. This
 * file gets them out of a tokenizer that understands single quotes, double quotes, backslash
 * escapes, `$( )` and backtick substitutions, comments, heredocs, redirections, the leading
 * `NAME=value` assignments of a simple command, and the control operators `|`, `||`, `&&`, `;`,
 * newline, `(`, `)`.
 *
 * Three shapes decide how a command string is cut into pipelines:
 *
 * - A `\` before a newline, outside quotes, joins the two lines. A newline right after `|`, `&&`,
 *   or `||` continues the same command rather than ending it.
 * - A shell reserved word at command position (`if`, `then`, `do`, `case`, ...) records the control
 *   structure but is never a pipeline stage, and `time` / `!` are read past. Counting them as stages
 *   would turn `time bun test 2>&1 | tail -20` into a three stage pipeline and block the project's
 *   own test command.
 * - `{ ...; }` and `( ... )` are groups. A group is one stage of the pipeline it sits in, and its
 *   inner commands keep pipelines of their own (`groupPipelines`).
 *
 * This is not a bash parser, and it is not trying to be one. Anything whose shape it cannot settle
 * (an unterminated quote, an unterminated `$(`) comes back as `parseError`, and the caller
 * classifies nothing. Every unknown form is therefore a miss, never a block.
 */

/** One word of a simple command. */
export interface LexedWord {
	/** The word as it is written in the source. */
	raw: string;
	/** The word with quotes and escapes removed. `$NAME` stays as written; a substitution keeps its source text. */
	text: string;
	/** True when some part of the word came from quotes or a backslash escape. */
	quoted: boolean;
	/** True when the word contains a `$( )` or backtick substitution whose value the lexer cannot know. */
	dynamic: boolean;
}

/** One redirection of a simple command. */
export interface LexedRedirect {
	/** The file descriptor the operator names, or null when it names none. */
	fd: number | null;
	/** True when the operator writes a descriptor out (`>`, `>>`, `1>`, `&>`). */
	output: boolean;
	/** True for `>>`, `1>>`, `&>>`. */
	append: boolean;
	/** True for `>&1` and `<&0`: the target is another descriptor, not a file. */
	duplicate: boolean;
	/** The target word, or null when the operator is the end of the input. */
	target: LexedWord | null;
}

/** One heredoc operator, carrying the body line it consumed. */
export interface LexedHeredoc {
	/** `<<` or `<<-`. */
	operator: "<<" | "<<-";
	/** The delimiter with its quotes removed. */
	marker: string;
	/** True when the delimiter was quoted or escaped, which makes the body literal. */
	quoted: boolean;
	/** The body lines without the delimiter line. `<<-` drops the leading tabs of every line. */
	body: string[];
}

/** One simple command: the unit every guard classification looks at. */
export interface LexedCommand {
	/** Command word and arguments. The leading environment assignments are not here. */
	words: LexedWord[];
	/** The `NAME=value` assignments written before the command word. */
	assignments: LexedWord[];
	/** Redirections, in the order they were written. */
	redirects: LexedRedirect[];
	/** Heredocs whose operator appears in this command. */
	heredocs: LexedHeredoc[];
	/** True for a `name() { ... }` or `function name { ... }` shell function definition. */
	functionDefinition: boolean;
	/** True when this stage is a `{ ...; }` or `( ... )` group rather than a simple command. */
	group: boolean;
	/** True when the stage before it in the same pipeline writes into its standard input. */
	stdinFromPipe: boolean;
	/** Position of this command inside its pipeline, 0 for the first stage. */
	stage: number;
	/** Position of this command's pipeline in the command string, 0 for the first. */
	pipeline: number;
}

/** Result of lexing one command string. */
export interface LexResult {
	/** Pipelines in source order. The stage count of a pipeline is its length. */
	pipelines: LexedCommand[][];
	/** Pipelines written inside a `{ ...; }` or `( ... )` group, in source order. */
	groupPipelines: LexedCommand[][];
	/** Every simple command in source order. Groups are not commands. */
	commands: LexedCommand[];
	/** Reserved words that stood at command position, in source order. This is how S1 sees a loop. */
	controlWords: string[];
	/** True when the shape could not be settled. The guard classifies nothing then. */
	parseError: boolean;
	/** What could not be settled. A category name for the test output, never the command text. */
	reason: string;
}

/** Characters that end a word and carry meaning of their own. */
const WORD_END_CHARACTERS = " \t\r\n|&;()<>";

/** How a reserved word at command position cuts the command string. */
type SyntaxKind = "prefix" | "record" | "group-open" | "group-close" | "function";

/**
 * Words bash treats as control syntax when they open a command.
 *
 * Splitting on them is what makes `for f in *; do python3 -c 'print(1)'; done` read as a loop and an
 * interpreter call rather than one command whose arguments happen to spell both. They are only
 * control syntax at the head of a command, so `echo for` stays one command.
 *
 * `prefix` is read past (`time bun test` runs `bun`), `record` closes the command before it and
 * stands for the control structure it opens, and the group kinds bound `{ ...; }`. None of them is a
 * pipeline stage; see the file header.
 */
const SYNTAX_WORDS: Readonly<Record<string, SyntaxKind>> = {
	"!": "prefix",
	time: "prefix",
	function: "function",
	"{": "group-open",
	"}": "group-close",
	"[[": "record",
	"]]": "record",
	case: "record",
	coproc: "record",
	do: "record",
	done: "record",
	elif: "record",
	else: "record",
	esac: "record",
	fi: "record",
	for: "record",
	if: "record",
	in: "record",
	select: "record",
	then: "record",
	until: "record",
	while: "record",
};

/** A word that is only digits is a file descriptor when it touches a redirection operator. */
const DESCRIPTOR_PATTERN = /^[0-9]+$/;

/** `NAME=value` written before a command word. */
const ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** A heredoc operator whose body still has to be read. */
interface PendingHeredoc {
	heredoc: LexedHeredoc;
	/** `<<-` drops the leading tabs of the body lines and of the delimiter line. */
	stripTabs: boolean;
}

function makeWord(raw: string, text: string, quoted: boolean, dynamic: boolean): LexedWord {
	return { raw, text, quoted, dynamic };
}

function makeCommand(stage: number, pipeline: number): LexedCommand {
	return {
		words: [],
		assignments: [],
		redirects: [],
		heredocs: [],
		functionDefinition: false,
		group: false,
		stdinFromPipe: false,
		stage,
		pipeline,
	};
}

/** Whether a command holds anything, which is what makes it a stage or a command of its own. */
function isFilled(command: LexedCommand): boolean {
	return command.words.length > 0 || command.redirects.length > 0 || command.heredocs.length > 0;
}

function isWordEnd(character: string): boolean {
	return WORD_END_CHARACTERS.includes(character);
}

/**
 * Split a bash command string into pipelines of simple commands.
 *
 * Never throws: a shape the lexer cannot settle comes back with `parseError` set.
 */
export function lex(command: string): LexResult {
	const lexer = new Lexer(command);
	return lexer.run();
}

/**
 * The file targets a command sends its standard output to (`>`, `>>`, `1>`, `&>`).
 *
 * A redirection that names another descriptor (`>&2`) is not a file, and a descriptor other than 1
 * is not standard output.
 */
export function stdoutTargets(command: LexedCommand): LexedWord[] {
	const targets: LexedWord[] = [];
	for (const redirect of command.redirects) {
		if (!redirect.output || redirect.duplicate || redirect.target === null) continue;
		if (redirect.fd !== null && redirect.fd !== 1) continue;
		targets.push(redirect.target);
	}
	return targets;
}

class Lexer {
	readonly #src: string;
	#i = 0;
	/** The pipelines of the command string itself, in source order. */
	readonly #pipelines: LexedCommand[][] = [];
	/** Every command in source order, including the commands inside a group. */
	readonly #commands: LexedCommand[] = [];
	/** Reserved words that stood at command position. `for`, `while`, `if`, ... for S1. */
	readonly #controlWords: string[] = [];
	/** The pipeline being built in the innermost open group, or the command string's own. */
	#pipeline: LexedCommand[] = [];
	/** Where a closed pipeline goes: the command string's list, or the group list inside a group. */
	#target: LexedCommand[][] = this.#pipelines;
	/** The enclosing pipelines saved by each open group. Its length is the group depth. */
	readonly #groups: LexedCommand[][] = [];
	/** Closed group pipelines, kept in one flat list because a group is judged on its own stages. */
	readonly #closedGroupPipelines: LexedCommand[][] = [];
	#command: LexedCommand = makeCommand(0, 0);
	readonly #pending: PendingHeredoc[] = [];
	/** End offset of the last word handed back, so a digit word touching `>` becomes a descriptor. */
	#lastWordEnd = -1;
	#lastWord: LexedWord | null = null;
	/** The command seen before a `(` that may turn out to be `name()`. */
	#definition: LexedCommand | null = null;
	/** True between `function` and the name that follows it. */
	#definingFunction = false;
	/** True right after `|`, `&&`, `||`, where a newline continues the command. */
	#afterOperator = false;
	#reason = "";

	constructor(source: string) {
		this.#src = source;
	}

	run(): LexResult {
		while (this.#i < this.#src.length && this.#reason === "") {
			this.#step();
		}
		if (this.#reason === "") {
			this.#consumeHeredocs();
			// An unclosed group still has to hand back what it read, as a group pipeline.
			while (this.#groups.length > 0) {
				this.#closeGroup();
			}
			this.#closeSequence();
		}
		// A stage that is not the first one reads what the stage before it wrote.
		for (const pipeline of this.#pipelines.concat(this.#closedGroupPipelines)) {
			for (let index = 1; index < pipeline.length; index += 1) {
				pipeline[index].stdinFromPipe = true;
			}
		}
		return {
			pipelines: this.#pipelines,
			groupPipelines: this.#closedGroupPipelines,
			commands: this.#commands,
			controlWords: this.#controlWords,
			parseError: this.#reason !== "",
			reason: this.#reason,
		};
	}

	#step(): void {
		const character = this.#src[this.#i];
		if (character === " " || character === "\t" || character === "\r") {
			this.#i += 1;
			return;
		}
		const continues = this.#afterOperator;
		this.#afterOperator = false;
		if (character === "\n") {
			this.#i += 1;
			// After `|`, `&&`, or `||` the shell reads on into the next line instead of ending here.
			if (!continues) {
				this.#closeSequence();
			}
			// A heredoc body starts on the line after the operator.
			this.#consumeHeredocs();
			return;
		}
		if (this.#definition !== null) {
			// The only thing that may follow `name` + `(` is the closing parenthesis.
			this.#readDefinitionClose();
			return;
		}
		if (character === "#") {
			this.#skipComment();
			return;
		}
		if (character === "|") {
			if (this.#src[this.#i + 1] === "|") {
				this.#i += 2;
				this.#closeSequence();
				this.#afterOperator = true;
				return;
			}
			this.#i += 1;
			this.#endStage();
			this.#afterOperator = true;
			return;
		}
		if (character === "&") {
			if (this.#src[this.#i + 1] === "&") {
				this.#i += 2;
				this.#closeSequence();
				this.#afterOperator = true;
				return;
			}
			if (this.#src[this.#i + 1] === ">") {
				const fd = this.#takeDescriptor();
				this.#i += 2;
				this.#readRedirect(fd, true, this.#src[this.#i] === ">", true);
				return;
			}
			// A background `&` ends the command the way `;` does.
			this.#i += 1;
			this.#closeSequence();
			return;
		}
		if (character === ";") {
			this.#i += 1;
			this.#closeSequence();
			return;
		}
		if (character === "(" || character === ")") {
			if (character === "(") {
				this.#openParenthesis();
				return;
			}
			// A `)` with no open group closes the command on its own, which is what a `case` pattern needs.
			this.#i += 1;
			this.#closeGroup();
			return;
		}
		if (character === ">") {
			// The descriptor is the word that touches the operator, so it is read before stepping over it.
			const fd = this.#takeDescriptor();
			const append = this.#src[this.#i + 1] === ">";
			this.#i += append ? 2 : 1;
			this.#readRedirect(fd, true, append, false);
			return;
		}
		if (character === "<") {
			const fd = this.#takeDescriptor();
			if (this.#src[this.#i + 1] === "<") {
				if (this.#src[this.#i + 2] === "<") {
					// A here string feeds one word in; it is an input redirection with a word target.
					this.#i += 3;
					this.#readRedirect(fd, false, false, false);
					return;
				}
				const stripTabs = this.#src[this.#i + 2] === "-";
				this.#i += stripTabs ? 3 : 2;
				this.#queueHeredoc(stripTabs);
				return;
			}
			this.#i += 1;
			this.#readRedirect(fd, false, false, false);
			return;
		}
		this.#addWord(this.#readWord());
	}

	/**
	 * A `(` after a lone literal word is the `name()` of a function definition. Any other word
	 * between the parentheses makes it a subshell boundary instead.
	 */
	#openParenthesis(): void {
		if (this.#isDefinitionCandidate()) {
			this.#definition = this.#command;
			this.#i += 1;
			return;
		}
		this.#i += 1;
		this.#openGroup();
	}

	#isDefinitionCandidate(): boolean {
		const command = this.#command;
		if (command.words.length !== 1 || command.assignments.length !== 0) return false;
		if (command.redirects.length !== 0 || command.heredocs.length !== 0) return false;
		const name = command.words[0];
		if (name.quoted || name.dynamic) return false;
		return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name.text);
	}

	/** Finish `name(`: the next token must be `)`, or the `(` was a group boundary. */
	#readDefinitionClose(): void {
		const definition = this.#definition;
		this.#definition = null;
		this.#skipSpaces();
		if (this.#src[this.#i] !== ")") {
			this.#openGroup();
			return;
		}
		this.#i += 1;
		if (definition !== null) {
			definition.functionDefinition = true;
		}
		this.#closeSequence();
	}

	#skipSpaces(): void {
		while (this.#i < this.#src.length && (this.#src[this.#i] === " " || this.#src[this.#i] === "\t")) {
			this.#i += 1;
		}
	}

	#skipComment(): void {
		while (this.#i < this.#src.length && this.#src[this.#i] !== "\n") {
			this.#i += 1;
		}
	}

	#addWord(word: LexedWord): void {
		if (this.#command.words.length === 0 && !word.quoted && ASSIGNMENT_PATTERN.test(word.text)) {
			this.#command.assignments.push(word);
			return;
		}
		// A word left behind by a line continuation carries nothing.
		if (word.text === "" && !word.quoted) return;
		const head = this.#isCommandHead();
		const syntax = !word.quoted && !word.dynamic ? SYNTAX_WORDS[word.text] : undefined;
		if (syntax === "prefix" && head) return;
		if (syntax === "function" && head) {
			this.#definingFunction = true;
			this.#closeSequence();
			return;
		}
		if (this.#definingFunction) {
			// The word after `function` is the function's name, and the name marks the definition.
			this.#definingFunction = false;
			this.#command.functionDefinition = true;
			this.#command.words.push(word);
			return;
		}
		const atGroupEdge = head || this.#command.functionDefinition;
		if (syntax === "group-open" && atGroupEdge) {
			this.#openGroup();
			return;
		}
		if (syntax === "group-close" && atGroupEdge) {
			this.#closeGroup();
			return;
		}
		if (syntax === "record" && head) {
			// A control word opens a structure. It is a fact for S1, never a pipeline stage.
			this.#controlWords.push(word.text);
			this.#closeSequence();
			return;
		}
		this.#command.words.push(word);
	}

	/**
	 * `{ ...; }` and `( ... )` are one stage of the enclosing pipeline.
	 *
	 * The commands inside keep pipelines of their own, so a long chain inside a group still reads as
	 * a long chain while the group itself stays a single stage from the outside.
	 */
	#openGroup(): void {
		// A filled command in front of the brace is the `function name` of a definition, and that
		// definition is the group: one stage, not a stage for the name and a stage for the body.
		const carrier = isFilled(this.#command) ? this.#command : makeCommand(this.#pipeline.length, this.#target.length);
		carrier.group = true;
		this.#pipeline.push(carrier);
		if (carrier === this.#command) this.#commands.push(carrier);
		this.#command = makeCommand(this.#pipeline.length, this.#target.length);
		this.#groups.push(this.#pipeline);
		this.#pipeline = [];
		this.#target = this.#closedGroupPipelines;
		this.#lastWord = null;
	}

	/** End the innermost open group and read on in the pipeline that holds it. */
	#closeGroup(): void {
		this.#closeSequence();
		const enclosing = this.#groups.pop();
		if (enclosing === undefined) return;
		this.#pipeline = enclosing;
		this.#target = this.#groups.length > 0 ? this.#closedGroupPipelines : this.#pipelines;
		this.#command = makeCommand(this.#pipeline.length, this.#target.length);
	}

	#isCommandHead(): boolean {
		return this.#command.words.length === 0 && this.#command.assignments.length === 0;
	}

	/** Take the digits of a word that touches the redirection operator at the current offset. */
	#takeDescriptor(): number | null {
		const word = this.#lastWord;
		if (word === null || this.#lastWordEnd !== this.#i) return null;
		if (!DESCRIPTOR_PATTERN.test(word.text)) return null;
		if (this.#command.words.at(-1) !== word) return null;
		this.#command.words.pop();
		this.#lastWord = null;
		return Number(word.text);
	}

	/** A pipeline stage ends and the next one starts. An empty stage carries nothing. */
	#endStage(): void {
		if (isFilled(this.#command)) {
			this.#pipeline.push(this.#command);
			this.#commands.push(this.#command);
		}
		this.#command = makeCommand(this.#pipeline.length, this.#target.length);
		this.#lastWord = null;
	}

	/** The current pipeline ends, and so does the command. */
	#closeSequence(): void {
		const pipeline = this.#pipeline;
		if (isFilled(this.#command)) {
			pipeline.push(this.#command);
			this.#commands.push(this.#command);
		}
		if (pipeline.length > 0) {
			this.#target.push(pipeline);
		}
		this.#pipeline = [];
		this.#command = makeCommand(0, this.#target.length);
		this.#lastWord = null;
	}

	#queueHeredoc(stripTabs: boolean): void {
		this.#skipSpaces();
		const marker = this.#atWordStart() ? this.#readWord() : null;
		const heredoc: LexedHeredoc = {
			operator: stripTabs ? "<<-" : "<<",
			marker: marker === null ? "" : marker.text,
			quoted: marker !== null && marker.quoted,
			body: [],
		};
		this.#command.heredocs.push(heredoc);
		this.#pending.push({ heredoc, stripTabs });
	}

	/** Read the body of every queued heredoc, one line at a time, up to its delimiter line. */
	#consumeHeredocs(): void {
		while (this.#pending.length > 0) {
			const pending = this.#pending.shift();
			if (pending === undefined) break;
			const body: string[] = [];
			while (this.#i < this.#src.length) {
				const newline = this.#src.indexOf("\n", this.#i);
				const lineEnd = newline === -1 ? this.#src.length : newline;
				const line = this.#src.slice(this.#i, lineEnd);
				this.#i = newline === -1 ? this.#src.length : newline + 1;
				const stripped = pending.stripTabs ? line.replace(/^\t+/, "") : line;
				if (stripped === pending.heredoc.marker) break;
				body.push(stripped);
			}
			pending.heredoc.body = body;
		}
	}

	#readRedirect(fd: number | null, output: boolean, append: boolean, bothStreams: boolean): void {
		this.#skipSpaces();
		// `>&1` and `>&-` name another descriptor rather than a file.
		const duplicate = this.#src[this.#i] === "&";
		if (duplicate) this.#i += 1;
		const target = this.#atWordStart() ? this.#readWord() : null;
		this.#command.redirects.push({
			fd: bothStreams ? 1 : fd,
			output,
			append,
			duplicate,
			target,
		});
	}

	#atWordStart(): boolean {
		if (this.#i >= this.#src.length) return false;
		return !isWordEnd(this.#src[this.#i]);
	}

	#readWord(): LexedWord {
		const start = this.#i;
		let text = "";
		let quoted = false;
		let dynamic = false;
		while (this.#i < this.#src.length) {
			const character = this.#src[this.#i];
			if (isWordEnd(character)) break;
			if (character === "'") {
				quoted = true;
				const end = this.#src.indexOf("'", this.#i + 1);
				if (end === -1) {
					this.#fail("unterminated single quote");
					break;
				}
				text += this.#src.slice(this.#i + 1, end);
				this.#i = end + 1;
				continue;
			}
			if (character === '"') {
				quoted = true;
				const read = this.#readDoubleQuoted();
				text += read.text;
				dynamic = dynamic || read.dynamic;
				if (this.#reason !== "") break;
				continue;
			}
			if (character === "\\") {
				const next = this.#src[this.#i + 1];
				if (next === undefined) {
					this.#i += 1;
					break;
				}
				// `\` + a newline joins the two lines. It quotes nothing and adds nothing.
				if (next === "\n") {
					this.#i += 2;
					continue;
				}
				quoted = true;
				text += next;
				this.#i += 2;
				continue;
			}
			if (character === "`") {
				const substitution = this.#readBacktick();
				if (this.#reason !== "") break;
				text += substitution;
				dynamic = true;
				continue;
			}
			if (character === "$" && this.#src[this.#i + 1] === "(") {
				const substitution = this.#readSubstitution();
				if (this.#reason !== "") break;
				text += substitution;
				dynamic = true;
				continue;
			}
			// `$NAME` and `${NAME}` stay as written: a path under `$TMPDIR` is still recognizable.
			text += character;
			this.#i += 1;
		}
		const word = makeWord(this.#src.slice(start, this.#i), text, quoted, dynamic);
		this.#lastWord = word;
		this.#lastWordEnd = this.#i;
		return word;
	}

	/** Read a double quoted run. Inside, a backslash only escapes `$`, `` ` ``, `"`, `\`, newline. */
	#readDoubleQuoted(): { text: string; dynamic: boolean } {
		let text = "";
		let dynamic = false;
		this.#i += 1;
		while (this.#i < this.#src.length) {
			const character = this.#src[this.#i];
			if (character === '"') {
				this.#i += 1;
				return { text, dynamic };
			}
			if (character === "\\") {
				const next = this.#src[this.#i + 1];
				if (next === "$" || next === "`" || next === '"' || next === "\\" || next === "\n") {
					text += next === "\n" ? "" : next;
					this.#i += 2;
					continue;
				}
				text += character;
				this.#i += 1;
				continue;
			}
			if (character === "`") {
				const substitution = this.#readBacktick();
				if (this.#reason !== "") return { text, dynamic };
				text += substitution;
				dynamic = true;
				continue;
			}
			if (character === "$" && this.#src[this.#i + 1] === "(") {
				const substitution = this.#readSubstitution();
				if (this.#reason !== "") return { text, dynamic };
				text += substitution;
				dynamic = true;
				continue;
			}
			text += character;
			this.#i += 1;
		}
		this.#fail("unterminated double quote");
		return { text, dynamic };
	}

	/** Read `$( ... )` and hand back its source. The contents are never scanned. */
	#readSubstitution(): string {
		const start = this.#i;
		let depth = 0;
		let index = this.#i + 1;
		while (index < this.#src.length) {
			const character = this.#src[index];
			if (character === "'") {
				index = skipSingleQuoted(this.#src, index);
				if (index === -1) break;
				continue;
			}
			if (character === '"') {
				index = skipDoubleQuoted(this.#src, index);
				if (index === -1) break;
				continue;
			}
			if (character === "\\") {
				index += 2;
				continue;
			}
			if (character === "(") {
				depth += 1;
			} else if (character === ")") {
				depth -= 1;
				if (depth === 0) {
					index += 1;
					const source = this.#src.slice(start, index);
					this.#i = index;
					return source;
				}
			}
			index += 1;
		}
		this.#fail("unterminated command substitution");
		return "";
	}

	/** Read a backquoted run and hand back its source. The contents are never scanned. */
	#readBacktick(): string {
		const start = this.#i;
		let index = this.#i + 1;
		while (index < this.#src.length) {
			if (this.#src[index] === "\\") {
				index += 2;
				continue;
			}
			if (this.#src[index] === "`") {
				index += 1;
				const source = this.#src.slice(start, index);
				this.#i = index;
				return source;
			}
			index += 1;
		}
		this.#fail("unterminated backtick");
		return "";
	}

	/**
	 * Record what could not be settled. The message names the shape and never the command, because a
	 * parse failure reaches the log but must not reach the model with command text in it.
	 */
	#fail(reason: string): void {
		if (this.#reason === "") this.#reason = reason;
		this.#i = this.#src.length;
	}
}

/** Offset just past the closing single quote, or -1 when there is none. */
function skipSingleQuoted(source: string, index: number): number {
	const end = source.indexOf("'", index + 1);
	return end === -1 ? -1 : end + 1;
}

/** Offset just past the closing double quote, or -1 when there is none. */
function skipDoubleQuoted(source: string, index: number): number {
	let cursor = index + 1;
	while (cursor < source.length) {
		if (source[cursor] === "\\") {
			cursor += 2;
			continue;
		}
		if (source[cursor] === '"') return cursor + 1;
		cursor += 1;
	}
	return -1;
}
