/**
 * Host function registry.
 *
 * The REPL core only knows the entry shape. Later phases register their own entries and
 * the core never imports or inspects their implementations. Built-in entries (`out`,
 * `print`, `use`, `tool`) are passed to the constructor and reserve their names.
 */

import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";

/** Per-cell execution state handed to each entry's `create`. */
export interface HostFnScope {
	/** Tool-call signal combined with the cell timeout. */
	signal: AbortSignal;
	/** Context of the tool call that started this cell. */
	toolContext: ExtensionToolContext;
	/** Append one output line; calls after the cell finished are discarded. */
	print(text: string): void;
	/** Set the cell value; calls after the cell finished are discarded. */
	setValue(value: unknown): void;
	/** Whether the cell has finished (completed, failed, or timed out). */
	finished: boolean;
}

export type HostFnCallable = (...args: unknown[]) => unknown;

export interface HostFnEntry {
	name: string;
	description: string;
	/** Build the function bound to one cell's scope. */
	create(scope: HostFnScope): HostFnCallable;
}

export class HostFnRegistry {
	readonly #entries = new Map<string, HostFnEntry>();

	constructor(builtins: readonly HostFnEntry[] = []) {
		for (const entry of builtins) {
			this.#entries.set(entry.name, entry);
		}
	}

	/** Register a host function. Throws for a built-in or already registered name. */
	register(entry: HostFnEntry): void {
		if (this.#entries.has(entry.name)) {
			throw new Error(`host function "${entry.name}" is already registered`);
		}
		this.#entries.set(entry.name, entry);
	}

	has(name: string): boolean {
		return this.#entries.has(name);
	}

	get(name: string): HostFnEntry | undefined {
		return this.#entries.get(name);
	}

	list(): HostFnEntry[] {
		return [...this.#entries.values()];
	}
}
