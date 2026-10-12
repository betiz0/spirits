/**
 * Classify `update` arguments into self / all / pi pass-through.
 *
 * Mirrors the `update` branch of pi's `parsePackageCommand` so the same accepted and rejected
 * combinations behave identically. Anything pi rejects or interprets as extensions, models, or a
 * single source is passed through unchanged.
 */

/** Which part of the update this invocation targets. */
export type UpdateTargetKind = "self" | "all" | "pass-through";

/** Classification result for an `update` invocation. */
export interface UpdateClassification {
	target: UpdateTargetKind;
	/** `--force` re-downloads even when the installed version matches. */
	force: boolean;
	/** Original `-a` / `--approve` / `-na` / `--no-approve` token, for the extension update. */
	trustFlag?: string;
}

const PASS_THROUGH: UpdateClassification = { target: "pass-through", force: false };

/**
 * Classify the full CLI argument list (as passed to pi, without the program name).
 *
 * `target` is `self` when pi would update the program itself, `all` when pi would also update
 * extensions, and `pass-through` when pi would handle extensions / models / sources, print help,
 * or report an argument error.
 */
export function classifyUpdateArgs(argv: readonly string[]): UpdateClassification {
	if (argv[0] !== "update") return PASS_THROUGH;

	let force = false;
	let help = false;
	let invalid = false;
	let source: string | undefined;
	let selfFlag = false;
	let extensionsFlag = false;
	let modelsFlag = false;
	let allFlag = false;
	let extensionSource: string | undefined;
	let trustFlag: string | undefined;

	for (let index = 1; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "-h" || arg === "--help") {
			help = true;
			continue;
		}
		if (arg === "-l" || arg === "--local") {
			invalid = true;
			continue;
		}
		if (arg === "--self") {
			selfFlag = true;
			continue;
		}
		if (arg === "--extensions") {
			extensionsFlag = true;
			continue;
		}
		if (arg === "--models") {
			modelsFlag = true;
			continue;
		}
		if (arg === "--all") {
			allFlag = true;
			continue;
		}
		if (arg === "--approve" || arg === "-a" || arg === "--no-approve" || arg === "-na") {
			trustFlag = arg;
			continue;
		}
		if (arg === "--force") {
			force = true;
			continue;
		}
		if (arg === "--extension") {
			const value = argv[index + 1];
			if (value === undefined || value.startsWith("-")) {
				invalid = true;
			} else {
				if (extensionSource !== undefined) invalid = true;
				extensionSource = value;
				index++;
			}
			continue;
		}
		if (arg.startsWith("-")) {
			invalid = true;
			continue;
		}
		if (source === undefined) {
			source = arg;
		} else {
			invalid = true;
		}
	}

	if (help || invalid) return PASS_THROUGH;

	if (allFlag && (selfFlag || extensionsFlag || modelsFlag || extensionSource !== undefined)) {
		return PASS_THROUGH;
	}
	if (allFlag && source !== undefined) return PASS_THROUGH;

	if (modelsFlag || extensionSource !== undefined) return PASS_THROUGH;
	if (source !== undefined) {
		const sourceIsSelf = source === "self" || source === "pi";
		if (!sourceIsSelf) return PASS_THROUGH;
		return extensionsFlag ? { target: "all", force, trustFlag } : { target: "self", force, trustFlag };
	}
	if (allFlag) return { target: "all", force, trustFlag };
	if (selfFlag && extensionsFlag) return { target: "all", force, trustFlag };
	if (selfFlag) return { target: "self", force, trustFlag };
	if (extensionsFlag) return PASS_THROUGH;
	return { target: "self", force, trustFlag };
}
