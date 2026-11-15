/**
 * Decide whether `update` arguments ask for the program self-update.
 *
 * The launcher does not know the host's `update` grammar and does not try to: it accepts the
 * self-update forms and refuses everything else with the two commands that do the remaining jobs.
 * Nothing is forwarded and nothing is ignored silently, so a flag the launcher does not accept can
 * never look like a successful update.
 */

/** Positional arguments that name the program itself. */
const SELF_SOURCE_WORDS = new Set(["self", "pi"]);

/** Flags that select the program itself (`--self`) or re-download it (`--force`). */
const SELF_UPDATE_FLAGS = new Set(["--self", "--force"]);

/**
 * Project trust flags, accepted so an existing call keeps working.
 *
 * The launcher updates no extensions, so the flag changes nothing; it is not forwarded anywhere.
 */
const TRUST_FLAGS = new Set(["-a", "--approve", "-na", "--no-approve"]);

/** Result of classifying one `update` invocation. */
export type UpdateClassification =
	/** Not an `update` invocation at all. */
	| { kind: "not-update" }
	/** Replace the executable, optionally re-downloading the current version. */
	| { kind: "self-update"; force: boolean }
	/** Not a self-update form: refuse with the two commands that do the rest. */
	| { kind: "refusal"; /** The arguments as the caller typed them after `update`. */ args: string[] };

/**
 * Classify one launcher invocation.
 *
 * Accepted forms are `update`, `update self`, `update pi`, and `update --self`, each with `--force`
 * and at most one trust flag. Anything else that starts with `update` — `--extensions`, `--models`,
 * `--extension <source>`, `--all`, `-h` / `--help`, an unknown option, a positional other than
 * `self` / `pi` — is a refusal, including in combination with a self-update form.
 */
export function classifyUpdateArgs(argv: readonly string[]): UpdateClassification {
	if (argv[0] !== "update") return { kind: "not-update" };

	const args = argv.slice(1);
	let force = false;
	let source: string | undefined;
	for (const arg of args) {
		if (arg === "--force") {
			force = true;
			continue;
		}
		if (arg === "--self" || TRUST_FLAGS.has(arg)) continue;
		if (arg.startsWith("-") || source !== undefined || !SELF_SOURCE_WORDS.has(arg)) {
			return { kind: "refusal", args };
		}
		source = arg;
	}
	return { kind: "self-update", force };
}

/** Result of asking whether one invocation names a command the host dispatches itself. */
export type HostCommandClassification =
	| { kind: "not-host-command" }
	| { kind: "host-command"; /** The word the caller typed first. */ word: string; /** Everything after it. */ args: string[] };

/**
 * Refuse the words a host dispatches only from its own first argument.
 *
 * The launcher puts the spirits bundle before the caller's arguments, and the host rejects that flag after
 * one of its commands, so `spirits list` could only ever reach the model as a message. The word list comes
 * from the host descriptor, so the launcher keeps one rule over host-declared data rather than a second
 * copy of the host's command table.
 *
 * `update` is not in the list: {@link classifyUpdateArgs} owns it, because the launcher does update itself.
 */
export function classifyHostCommandArgs(
	argv: readonly string[],
	commandWords: readonly string[],
): HostCommandClassification {
	const word = argv[0] ?? "";
	if (!commandWords.includes(word)) return { kind: "not-host-command" };
	return { kind: "host-command", word, args: argv.slice(1) };
}
