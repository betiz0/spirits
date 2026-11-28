/**
 * The verified change a session's verification reports belong to.
 *
 * The pin moves only on user input, and only **while nothing is pinned** (design Decision 12 of the
 * report-saving change): the first argument of the input that opened the verification step, or —
 * while nothing is pinned, which is the clarification the verify prompts ask with — a later input
 * that is exactly the name of a change the openspec CLI lists. Once fixed, the target does not move
 * until `clear` (step end, session start, tree move): a later input that names another listed
 * change must not redirect the reports, or the save destination stops being a function of the
 * verified change — the exact failure Decision 1 rejected for model-supplied names (d-verify1 C-1).
 * The model never pins anything: it passes only a report body to the save tool.
 *
 * A name the CLI does not list, a partial match, and a name that is ambiguous across stores are all
 * no-ops here; the verify prompt asks again, and un-pinned saves are refused by the tool.
 *
 * The store travels with the verification, not with the pinning line alone: the line that opened the
 * verification holds its `--store` through `rememberStore` before any target exists, and a line
 * that pins takes "its own store → the held store" (design Decision 3, d-verify2 C-1). The same
 * store is the one the change-name list is read from, so a change that exists only in that store can
 * pin and a change that exists only locally cannot (d-verify3 C-1): pinning and saving look at one
 * change set.
 */

/** The pinned change name, or undefined while the verification is still clarifying its target. */
export interface VerifyPin {
	/** The change the reports of this session's verification go to. */
	pinned(): string | undefined;
	/** The store the pinned verification carries, or undefined to let openspec resolve nearest. */
	storeId(): string | undefined;
	/**
	 * Hold the store the line that **opened** the verification declared, before a target exists
	 * (design Decision 3: the holding moment is the opening input, not the pinning one). Ignored
	 * once the target is pinned; `undefined` drops a held store.
	 */
	rememberStore(storeId: string | undefined): void;
	/** Offer one line of user input. Takes only while un-pinned, and only an exact listed name. */
	offer(inputText: string, storeId?: string): Promise<void>;
	/** Drop the pin and its store (session start, step end). A restored step starts un-pinned. */
	clear(): void;
}

/**
 * Build the pin around the exact change-name list.
 *
 * `listChangeNames` is the injection point (design Decision 13); `verify/register.ts` wires the
 * `openspec list --json` reader, which takes the store to read (d-verify3 C-1).
 */
export function createVerifyPin(deps: { listChangeNames: (storeId?: string) => Promise<string[]> }): VerifyPin {
	let pinned: string | undefined;
	// The store the pinned verification resolves against.
	let storeId: string | undefined;
	// The store read from the line that opened the verification. Held before any target exists:
	// `/opsx-verify --store s1` clarifies, and the answer that names the change carries no store —
	// dropping the opening line's store there made the resolution run without it (d-verify2 C-1).
	let heldStore: string | undefined;
	return {
		pinned: () => pinned,
		storeId: () => (pinned === undefined ? undefined : storeId),
		rememberStore(offered) {
			if (pinned !== undefined) return;
			heldStore = offered;
		},
		async offer(inputText, offeredStore) {
			// Once fixed the pin is frozen until clear: no offered line moves it, not even an exact
			// listed name, and the frozen pin costs no CLI call (d-verify1 C-1).
			if (pinned !== undefined) return;
			const candidate = inputText.trim();
			if (candidate === "") return;
			// The store travels with the verification: the line that pins wins over the store the
			// opening line left behind, and an answer that carries none keeps the opening store. The
			// list is read through that same store, so the pin and the save cannot land in different
			// change sets (d-verify3 C-1).
			const store = offeredStore ?? heldStore;
			const names: string[] = await deps.listChangeNames(store).catch(() => []);
			if (names.includes(candidate)) {
				pinned = candidate;
				storeId = store;
			}
		},
		clear() {
			pinned = undefined;
			storeId = undefined;
			heldStore = undefined;
		},
	};
}
