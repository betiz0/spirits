import { expect, test } from "bun:test";
import { classifyManagedPiArgs } from "../src/managed-pi/classify.ts";
import { classifyUpdateArgs } from "../src/update/classify.ts";

test("classifies managed-pi install update and launch", () => {
	expect(classifyManagedPiArgs(["managed-pi", "install"])).toEqual({ kind: "install" });
	expect(classifyManagedPiArgs(["managed-pi", "install", "--version", "1.5.0"])).toEqual({
		kind: "install",
		version: "1.5.0",
	});
	expect(classifyManagedPiArgs(["managed-pi", "update"])).toEqual({ kind: "update" });
	expect(classifyManagedPiArgs(["managed-pi", "repair"])).toEqual({ kind: "repair" });
	expect(classifyManagedPiArgs(["managed-pi"])).toEqual({ kind: "launch", args: [] });
	expect(classifyManagedPiArgs(["managed-pi", "--", "--help"])).toEqual({ kind: "launch", args: ["--help"] });
	expect(classifyManagedPiArgs(["managed-pi", "--version"])).toEqual({ kind: "launch", args: ["--version"] });
	expect(classifyManagedPiArgs(["managed-pi", "--help"])).toEqual({ kind: "launch", args: ["--help"] });
});

test("keeps the existing update classification", () => {
	expect(classifyUpdateArgs(["update"]).target).toBe("self");
	expect(classifyUpdateArgs(["update", "--extensions"]).target).toBe("pass-through");
	expect(classifyManagedPiArgs(["update"])).toEqual({ kind: "none" });
});

test("keeps normal arguments unchanged", () => {
	expect(classifyManagedPiArgs([])).toEqual({ kind: "none" });
	expect(classifyManagedPiArgs(["--help"])).toEqual({ kind: "none" });
	expect(classifyManagedPiArgs(["managed-pi", "help"])).toEqual({ kind: "help" });
	expect(classifyManagedPiArgs(["managed-pi", "update", "extra"]).kind).toBe("invalid");
});
