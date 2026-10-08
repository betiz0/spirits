/** Narrow an unknown value to a non-null object for defensive property access. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
