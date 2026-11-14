import { expect, test } from "bun:test";
import { classifyUpdateArgs } from "../src/update/classify.ts";

const selfUpdateCases: Array<{ name: string; argv: string[]; force?: boolean }> = [
	{ name: "bare update", argv: ["update"] },
	{ name: "update self", argv: ["update", "self"] },
	{ name: "update pi", argv: ["update", "pi"] },
	{ name: "update --self", argv: ["update", "--self"] },
	{ name: "update self --self", argv: ["update", "self", "--self"] },
	{ name: "update --force", argv: ["update", "--force"], force: true },
	{ name: "update self --force", argv: ["update", "self", "--force"], force: true },
	{ name: "update --self --force", argv: ["update", "--self", "--force"], force: true },
	{ name: "update -a", argv: ["update", "-a"] },
	{ name: "update --approve", argv: ["update", "--approve"] },
	{ name: "update -na", argv: ["update", "-na"] },
	{ name: "update --no-approve", argv: ["update", "--no-approve"] },
	{ name: "update self --force -a", argv: ["update", "self", "--force", "-a"], force: true },
];

// Every one of these is a host argument or a mistake: the launcher must refuse instead of launching
// the host or pretending the update handled it.
const refusalCases: Array<{ name: string; argv: string[] }> = [
	{ name: "update --extensions", argv: ["update", "--extensions"] },
	{ name: "update --all", argv: ["update", "--all"] },
	{ name: "update --models", argv: ["update", "--models"] },
	{ name: "update --extension <source>", argv: ["update", "--extension", "npm:@foo/bar"] },
	{ name: "update --extension (missing value)", argv: ["update", "--extension"] },
	{ name: "update <source>", argv: ["update", "npm:@foo/bar"] },
	{ name: "update self extra", argv: ["update", "self", "extra"] },
	{ name: "update self pi", argv: ["update", "self", "pi"] },
	{ name: "update -h", argv: ["update", "-h"] },
	{ name: "update --help", argv: ["update", "--help"] },
	{ name: "update --unknown", argv: ["update", "--unknown"] },
	{ name: "update --offline", argv: ["update", "--offline"] },
	{ name: "update -l", argv: ["update", "-l"] },
	{ name: "update self --extensions", argv: ["update", "self", "--extensions"] },
	{ name: "update --all --self", argv: ["update", "--all", "--self"] },
	{ name: "update --self --unknown", argv: ["update", "--self", "--unknown"] },
	{ name: "update --force --extensions", argv: ["update", "--force", "--extensions"] },
	{ name: "update self -a --models", argv: ["update", "self", "-a", "--models"] },
];

test("classifies the self-update forms", () => {
	for (const entry of selfUpdateCases) {
		expect(classifyUpdateArgs(entry.argv)).toEqual({
			kind: "self-update",
			force: entry.force ?? false,
		});
	}
});

test("refuses every other update invocation", () => {
	for (const entry of refusalCases) {
		expect(classifyUpdateArgs(entry.argv)).toEqual({ kind: "refusal", args: entry.argv.slice(1) });
	}
});

test("leaves non-update commands to the launcher", () => {
	expect(classifyUpdateArgs([])).toEqual({ kind: "not-update" });
	expect(classifyUpdateArgs(["install", "self"])).toEqual({ kind: "not-update" });
	// Behind the separator the caller addresses the host, so the launcher does not classify at all.
	expect(classifyUpdateArgs(["--", "update", "--extensions"])).toEqual({ kind: "not-update" });
});
