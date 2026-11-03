/**
 * Classify `managed-pi` invocations before Pi is imported.
 *
 * Only the exact first argument `managed-pi` activates the experimental route. Everything else
 * keeps the existing `spirits` / `spirits update` behavior.
 */

/** What the managed route should do. */
export type ManagedPiAction =
	| { kind: "none" }
	| { kind: "help" }
	| { kind: "install"; version?: string }
	| { kind: "update" }
	| { kind: "repair" }
	| { kind: "launch"; args: string[] }
	| { kind: "invalid"; message: string };

const NONE: ManagedPiAction = { kind: "none" };

function parseInstall(args: readonly string[]): ManagedPiAction {
	let version: string | undefined;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--version") {
			const value = args[index + 1];
			if (!value || value.startsWith("-")) {
				return { kind: "invalid", message: "--version requires a value." };
			}
			version = value;
			index++;
			continue;
		}
		if (arg.startsWith("--version=")) {
			const value = arg.slice("--version=".length);
			if (!value) return { kind: "invalid", message: "--version requires a value." };
			version = value;
			continue;
		}
		return { kind: "invalid", message: `Unknown managed-pi install argument: ${arg}` };
	}
	return { kind: "install", ...(version ? { version } : {}) };
}

/**
 * Classify the full CLI argument list (without the program name).
 *
 * `managed-pi --help`, `managed-pi -- --help`, and every other launch form pass the remaining
 * arguments to the managed Pi unchanged. Wrapper help is `managed-pi help`.
 */
export function classifyManagedPiArgs(argv: readonly string[]): ManagedPiAction {
	if (argv[0] !== "managed-pi") return NONE;
	if (argv.length === 1) return { kind: "launch", args: [] };
	const [subcommand, ...rest] = argv.slice(1);
	if (subcommand === "install") return parseInstall(rest);
	if (subcommand === "update") {
		return rest.length === 0 ? { kind: "update" } : { kind: "invalid", message: "managed-pi update takes no arguments." };
	}
	if (subcommand === "repair") {
		return rest.length === 0 ? { kind: "repair" } : { kind: "invalid", message: "managed-pi repair takes no arguments." };
	}
	if (subcommand === "help") {
		return rest.length === 0 ? { kind: "help" } : { kind: "invalid", message: "managed-pi help takes no arguments." };
	}
	if (subcommand === "--") return { kind: "launch", args: rest };
	return { kind: "launch", args: [subcommand, ...rest] };
}
