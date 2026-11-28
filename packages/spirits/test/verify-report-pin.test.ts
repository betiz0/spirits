/**
 * The verification target pin (design Decision 12): only exact listed change names take, only from
 * offered (user) input, and only **while nothing is pinned** — once fixed, the target never moves
 * (d-verify1 C-1). The model has no route to the pin — the interface itself is the guarantee the
 * test reads.
 */

import { expect, test } from "bun:test";
import { createVerifyPin } from "../src/verify/pin.ts";

function pinWith(names: string[] | ((storeId: string | undefined) => string[])) {
	let listCalls = 0;
	const seen: Array<string | undefined> = [];
	const pin = createVerifyPin({
		listChangeNames: async (storeId) => {
			listCalls += 1;
			seen.push(storeId);
			return typeof names === "function" ? names(storeId) : names;
		},
	});
	return { pin, listCalls: () => listCalls, seen };
}

test("an exact listed name pins while un-pinned; anything else leaves it un-pinned", async () => {
	const { pin } = pinWith(["alpha", "beta-change"]);

	await pin.offer("それ");
	expect(pin.pinned()).toBeUndefined();

	// A partial name is not a name.
	await pin.offer("alph");
	expect(pin.pinned()).toBeUndefined();

	// Whitespace around the name is the editor's, not the name's.
	await pin.offer("  alpha\n");
	expect(pin.pinned()).toBe("alpha");
});

test("once pinned, no offered line moves the target (d-verify1 C-1)", async () => {
	const { pin, listCalls } = pinWith(["alpha", "beta-change"]);

	await pin.offer("alpha");
	expect(pin.pinned()).toBe("alpha");

	// An unresolvable line after a pin does not clear it.
	await pin.offer("それ");
	expect(pin.pinned()).toBe("alpha");

	// The failure this pins down: another listed change, offered exactly, must NOT re-pin. Under
	// the pre-fix pin this moved the target, sending alpha's report into beta's directory.
	await pin.offer("beta-change");
	expect(pin.pinned()).toBe("alpha");

	// A frozen pin is free: it does not even consult the CLI again.
	expect(listCalls()).toBe(1);
});

test("a blank line does not even consult the CLI", async () => {
	const { pin, listCalls } = pinWith(["alpha"]);
	await pin.offer("   ");
	expect(listCalls()).toBe(0);
	expect(pin.pinned()).toBeUndefined();
});

test("the store travels with the pinning line only (d-verify1 W-1)", async () => {
	const { pin } = pinWith(["alpha", "beta-change"]);

	// The opening line's `--store` is kept with the target it names.
	await pin.offer("alpha", "s1");
	expect(pin.pinned()).toBe("alpha");
	expect(pin.storeId()).toBe("s1");

	// A later line — even one that would pin on its own — moves neither, store included.
	await pin.offer("beta-change", "s2");
	expect(pin.pinned()).toBe("alpha");
	expect(pin.storeId()).toBe("s1");
});

// d-verify2 C-1: `/opsx-verify --store s1` (store, no name) clarifies, and the answer carries no
// store. The opening line's store must reach the resolution anyway — dropping it there made the
// save resolve against the nearest root, not the named store.
test("a store remembered before the pin is adopted when a later line pins", async () => {
	const { pin } = pinWith(["alpha", "beta-change"]);

	// The opening line has the store and no usable name; the store is held un-pinned.
	pin.rememberStore("s1");
	expect(pin.pinned()).toBeUndefined();
	expect(pin.storeId()).toBeUndefined();

	// A rejected offer does not drop the held store.
	await pin.offer("それ");
	await pin.offer("alph");

	// The clarification answer carries no store and still pins with the held one.
	await pin.offer("alpha");
	expect(pin.pinned()).toBe("alpha");
	expect(pin.storeId()).toBe("s1");
});

test("a pinning line's own store wins, and the held store is frozen and cleared like the pin", async () => {
	const { pin } = pinWith(["alpha", "beta-change"]);

	// The line that pins carries its own store: it wins over the held one.
	pin.rememberStore("s1");
	await pin.offer("alpha", "s9");
	expect(pin.storeId()).toBe("s9");

	// After the pin, remembering moves nothing (the verification is frozen).
	pin.rememberStore("s2");
	expect(pin.storeId()).toBe("s9");

	// clear drops the pin and the store together; a fresh step holds nothing from the old one.
	pin.clear();
	await pin.offer("beta-change");
	expect(pin.pinned()).toBe("beta-change");
	expect(pin.storeId()).toBeUndefined();
});

// d-verify3 C-1: the name list is read through the store the verification carries, so pin and save
// look at one change set — the store's changes pin, the local-only ones cannot.
test("the name list is read through the store that pins (d-verify3 C-1)", async () => {
	const { pin, seen } = pinWith((storeId) => (storeId === "s1" ? ["in-store"] : ["local-only"]));

	// A store on the pinning line reads that store's list.
	await pin.offer("local-only", "s1");
	expect(pin.pinned()).toBeUndefined();
	await pin.offer("in-store", "s1");
	expect(pin.pinned()).toBe("in-store");
	expect(pin.storeId()).toBe("s1");
	expect(seen).toEqual(["s1", "s1"]);
});

test("a held store reaches the name list of a later answer that carries none", async () => {
	const { pin, seen } = pinWith((storeId) => (storeId === "s1" ? ["in-store"] : ["local-only"]));

	pin.rememberStore("s1");
	// The clarification answer carries no store: the list must still be the held store's.
	await pin.offer("local-only");
	expect(pin.pinned()).toBeUndefined();
	await pin.offer("in-store");
	expect(pin.pinned()).toBe("in-store");
	expect(pin.storeId()).toBe("s1");
	expect(seen).toEqual(["s1", "s1"]);
});

test("an un-stored pin reads the nearest root's list", async () => {
	const { pin, seen } = pinWith(() => ["local-only"]);
	await pin.offer("local-only");
	expect(pin.pinned()).toBe("local-only");
	expect(pin.storeId()).toBeUndefined();
	expect(seen).toEqual([undefined]);
});

test("an un-stored pin stays un-stored; clear drops both", async () => {
	const { pin } = pinWith(["alpha"]);
	await pin.offer("alpha");
	expect(pin.storeId()).toBeUndefined();

	pin.clear();
	expect(pin.pinned()).toBeUndefined();

	// A re-opened verification clarifying without a store resolves nearest again.
	await pin.offer("alpha");
	expect(pin.storeId()).toBeUndefined();
});

test("clear drops the pin (session start, step end, restored step)", async () => {
	const { pin } = pinWith(["alpha"]);
	await pin.offer("alpha", "s1");
	pin.clear();
	expect(pin.pinned()).toBeUndefined();
	expect(pin.storeId()).toBeUndefined();
});

test("the pin exposes no writer the model could reach", () => {
	// `pinned`, `storeId`, `rememberStore`, `offer`, `clear` and nothing else: the facts that can
	// move come only from offered lines of user input and from the opening line's store, and a
	// listed name matched exactly is still the only thing that can pin while un-pinned.
	const pin = createVerifyPin({ listChangeNames: async () => [] });
	expect(Object.keys(pin).sort()).toEqual(["clear", "offer", "pinned", "rememberStore", "storeId"]);
});
