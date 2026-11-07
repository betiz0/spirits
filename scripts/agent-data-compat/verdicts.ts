/**
 * Verdict rules for the agent-directory compatibility run.
 *
 * Every item carries a result per direction, and the overall label is derived from the pair. The
 * four reported labels are the ones the investigation asks for; a direction that could not be
 * measured is kept as `not-run` in the pair so the reader never has to guess whether a missing
 * measurement was a failure.
 */

/** Result of one direction of one item. */
export type DirectionResult = "compatible" | "incompatible" | "not-run";

/** Overall label of an item, derived from both directions. */
export type Overall = "bidirectional" | "one-way" | "incompatible" | "not-run";

/** Display labels, in the wording the investigation reports. */
export const OVERALL_LABEL: Record<Overall, string> = {
	bidirectional: "双方向で互換",
	"one-way": "片方向のみ",
	incompatible: "互換なし",
	"not-run": "not-run",
};

/** Derive the overall label from the two directions. */
export function overallOf(forkToManaged: DirectionResult, managedToFork: DirectionResult): Overall {
	if (forkToManaged === "compatible" && managedToFork === "compatible") return "bidirectional";
	if (forkToManaged === "not-run" && managedToFork === "not-run") return "not-run";
	if (forkToManaged === "compatible" || managedToFork === "compatible") return "one-way";
	return "incompatible";
}

/** One summarized session entry, as written by the probe extension. */
export interface DumpEntry {
	type: string;
	id?: string;
	parentId?: string | null;
	timestamp?: string;
	customType?: string;
	data?: unknown;
	message?: { role?: string; sha256?: string; chars?: number; preview?: string };
	extra?: Record<string, unknown>;
}

/** A mismatch found when comparing entries across hosts. */
export interface EntryMismatch {
	id?: string;
	type?: string;
	customType?: string;
	fields: string[];
	baseline?: unknown;
	observed?: unknown;
}

/** Compare the entries a second host read against the entries the first host recorded. */
export function compareEntries(
	baseline: readonly DumpEntry[],
	observed: readonly DumpEntry[],
): { ok: boolean; compared: number; missing: string[]; mismatches: EntryMismatch[] } {
	const observedById = new Map(observed.map((entry) => [String(entry.id), entry]));
	const fields = ["type", "customType", "parentId", "timestamp", "data", "message", "extra"] as const;
	const missing: string[] = [];
	const mismatches: EntryMismatch[] = [];
	let compared = 0;
	for (const entry of baseline) {
		if (entry.type === "session") continue;
		const id = String(entry.id);
		const other = observedById.get(id);
		if (other === undefined) {
			missing.push(entry.customType ? `${entry.type}:${entry.customType}:${id}` : `${entry.type}:${id}`);
			continue;
		}
		compared += 1;
		const differs: Array<keyof DumpEntry> = [];
		for (const field of fields) {
			const beforeValue = entry[field];
			const afterValue = other[field];
			if (beforeValue === undefined && afterValue === undefined) continue;
			if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) differs.push(field);
		}
		if (differs.length > 0) {
			mismatches.push({
				id: entry.id,
				type: entry.type,
				...(entry.customType === undefined ? {} : { customType: entry.customType }),
				fields: differs,
				baseline: differs.map((field) => [field, entry[field]]),
				observed: differs.map((field) => [field, other[field]]),
			});
		}
	}
	return { ok: missing.length === 0 && mismatches.length === 0, compared, missing, mismatches };
}

/** Custom entry types of interest, counted from a probe dump's `session.byType`. */
export function customEntryCounts(byType: Record<string, number> | undefined): Record<string, number> {
	const wanted = ["spirits_goal", "spirits_todo", "spirits_memory", "tsrepl_cell", "rlm_usage", "pi.virtual-model-state"];
	const counts: Record<string, number> = {};
	for (const name of wanted) counts[name] = byType?.[`custom:${name}`] ?? 0;
	return counts;
}

/** Keys of `before` that are still present in `after`, and the ones that disappeared. */
export function keySurvival(
	before: readonly string[],
	after: readonly string[],
	required: readonly string[],
): { ok: boolean; missing: string[]; added: string[] } {
	const missing = required.filter((key) => !after.includes(key));
	return { ok: missing.length === 0, missing, added: after.filter((key) => !before.includes(key)) };
}

/** Deep-equal two JSON-ish settings objects. */
export function settingsEqual(a: unknown, b: unknown): { ok: boolean; differingKeys: string[] } {
	const keys = new Set([...keysOf(a), ...keysOf(b)]);
	const differing: string[] = [];
	for (const key of keys) {
		const left = (a as Record<string, unknown> | undefined)?.[key];
		const right = (b as Record<string, unknown> | undefined)?.[key];
		if (JSON.stringify(left) === JSON.stringify(right)) continue;
		differing.push(key);
	}
	return { ok: differing.length === 0, differingKeys: differing };
}

function keysOf(value: unknown): string[] {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
	return Object.keys(value as Record<string, unknown>);
}

/** A value read back from a settings object, stringified for the evidence file. */
export function settingValue(settings: unknown, ...path: string[]): unknown {
	let current: unknown = settings;
	for (const key of path) {
		if (current === null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}
