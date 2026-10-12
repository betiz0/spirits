import { expect, test } from "bun:test";
import { classifyUpdateArgs, type UpdateTargetKind } from "../src/update/classify.ts";

interface TableCase {
	name: string;
	argv: string[];
	target: UpdateTargetKind;
	force?: boolean;
	trustFlag?: string;
}

const selfCases: TableCase[] = [
	{ name: "bare update", argv: ["update"], target: "self" },
	{ name: "update self", argv: ["update", "self"], target: "self" },
	{ name: "update pi", argv: ["update", "pi"], target: "self" },
	{ name: "update --self", argv: ["update", "--self"], target: "self" },
	{ name: "update --force", argv: ["update", "--force"], target: "self", force: true },
	{ name: "update -a", argv: ["update", "-a"], target: "self", trustFlag: "-a" },
	{ name: "update -na", argv: ["update", "-na"], target: "self", trustFlag: "-na" },
	{ name: "update self --self", argv: ["update", "self", "--self"], target: "self" },
];

const allCases: TableCase[] = [
	{ name: "update --all", argv: ["update", "--all"], target: "all" },
	{ name: "update --self --extensions", argv: ["update", "--self", "--extensions"], target: "all" },
	{ name: "update self --extensions", argv: ["update", "self", "--extensions"], target: "all" },
	{ name: "update pi --extensions", argv: ["update", "pi", "--extensions"], target: "all" },
	{ name: "update --all --force", argv: ["update", "--all", "--force"], target: "all", force: true },
	{ name: "update --all -a", argv: ["update", "--all", "-a"], target: "all", trustFlag: "-a" },
	{ name: "update --all --no-approve", argv: ["update", "--all", "--no-approve"], target: "all", trustFlag: "--no-approve" },
];

const passThroughCases: TableCase[] = [
	{ name: "update --extensions", argv: ["update", "--extensions"], target: "pass-through" },
	{ name: "update --models", argv: ["update", "--models"], target: "pass-through" },
	{ name: "update --extension <source>", argv: ["update", "--extension", "npm:@foo/bar"], target: "pass-through" },
	{ name: "update <source>", argv: ["update", "npm:@foo/bar"], target: "pass-through" },
	{ name: "update --help", argv: ["update", "--help"], target: "pass-through" },
	{ name: "update self -h", argv: ["update", "self", "-h"], target: "pass-through" },
	{ name: "update --all --self", argv: ["update", "--all", "--self"], target: "pass-through" },
	{ name: "update --self --models", argv: ["update", "--self", "--models"], target: "pass-through" },
	{ name: "update self extra", argv: ["update", "self", "extra"], target: "pass-through" },
	{ name: "update --self --unknown", argv: ["update", "--self", "--unknown"], target: "pass-through" },
	{ name: "update --extension (missing value)", argv: ["update", "--extension"], target: "pass-through" },
	{ name: "update --offline", argv: ["update", "--offline"], target: "pass-through" },
	{ name: "update -l", argv: ["update", "-l"], target: "pass-through" },
	{ name: "update --extension twice", argv: ["update", "--extension", "a", "--extension", "b"], target: "pass-through" },
];

test("classifies self invocations", () => {
	for (const entry of selfCases) {
		const result = classifyUpdateArgs(entry.argv);
		expect({ name: entry.name, ...result }).toEqual({
			name: entry.name,
			target: entry.target,
			force: entry.force ?? false,
			trustFlag: entry.trustFlag,
		});
	}
});

test("classifies all invocations", () => {
	for (const entry of allCases) {
		const result = classifyUpdateArgs(entry.argv);
		expect({ name: entry.name, ...result }).toEqual({
			name: entry.name,
			target: entry.target,
			force: entry.force ?? false,
			trustFlag: entry.trustFlag,
		});
	}
});

test("passes through pi-handled and invalid invocations", () => {
	for (const entry of passThroughCases) {
		const result = classifyUpdateArgs(entry.argv);
		expect({ name: entry.name, target: result.target }).toEqual({ name: entry.name, target: "pass-through" });
	}
});

test("passes through non-update commands", () => {
	expect(classifyUpdateArgs(["install", "self"]).target).toBe("pass-through");
	expect(classifyUpdateArgs([]).target).toBe("pass-through");
});

test("keeps the last trust override", () => {
	expect(classifyUpdateArgs(["update", "--all", "-a", "-na"]).trustFlag).toBe("-na");
	expect(classifyUpdateArgs(["update", "--all", "-na", "-a"]).trustFlag).toBe("-a");
});
