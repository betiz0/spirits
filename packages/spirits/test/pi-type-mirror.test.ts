/**
 * The type mirror check itself.
 *
 * `scripts/check-pi-type-mirror.ts` compares `packages/spirits/src/types/*.d.ts` with the `.d.ts` files
 * of the pinned host artifact. Its own behaviour is pinned here with a fixture host, because a check
 * that only ever runs against a downloaded artifact tells you nothing when it stops working.
 *
 * The fixture is a package in the shape the real one has: a manifest that publishes one type entry, an
 * entry that re-exports through the runtime specifier (`./types.js`), and the declarations in the file
 * next to it.
 */

import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkTypeMirror, compareMirrorDeclarations, readHostDeclarations, readMirrorDeclarations, SPIRITS_LOCAL_NAMES } from "../../../scripts/check-pi-type-mirror.ts";

/** Write a fixture host whose published surface is `types.ts`, renamed as the case asks. */
async function fixture(options: {
	types: string;
	mirror: string;
	entry?: string;
}): Promise<{ dir: string; hostRoot: string; mirrorPath: string }> {
	const dir = await mkdtemp(join(tmpdir(), "spirits-type-mirror-"));
	const hostRoot = join(dir, "host");
	await mkdir(join(hostRoot, "dist"), { recursive: true });
	await writeFile(
		join(hostRoot, "package.json"),
		JSON.stringify({
			name: "fixture-host",
			version: "9.9.9",
			types: "./dist/index.d.ts",
			exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
		}),
	);
	await writeFile(
		join(hostRoot, "dist", "index.d.ts"),
		options.entry ?? 'export * from "./types.js";\nexport type { Level } from "./types.js";\n',
	);
	await writeFile(join(hostRoot, "dist", "types.d.ts"), options.types);
	const mirrorPath = join(dir, "mirror.d.ts");
	await writeFile(mirrorPath, options.mirror);
	return { dir, hostRoot, mirrorPath };
}

const HOST_TYPES = `
export interface Named {
	name: string;
}
export interface Widget extends Named {
	count: number;
	kind: "a" | "b";
	owner: Person;
}
export interface Person {
	id: string;
}
export type Level = "low" | "high";
export declare function makeWidget(input: Level): Widget;
`;

test("a mirror that narrows the host passes", async () => {
	const fixtureDir = await fixture({
		types: HOST_TYPES,
		// The mirror lists the members it reads, in its own order, with the union branches reordered
		// and the object separator chosen differently from the host.
		mirror: `
export interface Named {
	name: string;
}
export interface Widget {
	kind: "b" | "a";
	name: string;
	count: number;
	owner: Person;
}
export interface Person {
	id: string;
}
export type Level = "high" | "low";
`,
	});
	try {
		const issues = checkTypeMirror({ artifactRoots: [fixtureDir.hostRoot], mirrors: [fixtureDir.mirrorPath] });
		expect(issues).toEqual([]);
	} finally {
		await rm(fixtureDir.dir, { recursive: true, force: true });
	}
});

test("a renamed export is reported", async () => {
	const fixtureDir = await fixture({
		// The host renamed the declaration the mirror still spells `Widget`.
		types: HOST_TYPES.replace("export interface Widget extends Named", "export interface Gadget extends Named"),
		mirror: `
export interface Widget {
	count: number;
}
`,
	});
	try {
		const issues = checkTypeMirror({ artifactRoots: [fixtureDir.hostRoot], mirrors: [fixtureDir.mirrorPath] });
		expect(issues.map((issue) => [issue.kind, issue.name])).toEqual([["missing-export", "Widget"]]);
	} finally {
		await rm(fixtureDir.dir, { recursive: true, force: true });
	}
});

test("a renamed member is reported", async () => {
	const fixtureDir = await fixture({
		types: HOST_TYPES.replace("count: number;", "quantity: number;"),
		mirror: `
export interface Widget {
	count: number;
	kind: "a" | "b";
}
`,
	});
	try {
		const issues = checkTypeMirror({ artifactRoots: [fixtureDir.hostRoot], mirrors: [fixtureDir.mirrorPath] });
		expect(issues.map((issue) => [issue.kind, issue.name, issue.member])).toEqual([
			["missing-member", "Widget", "count"],
		]);
	} finally {
		await rm(fixtureDir.dir, { recursive: true, force: true });
	}
});

test("a member type the host spelled differently is reported", async () => {
	const fixtureDir = await fixture({
		types: HOST_TYPES.replace('kind: "a" | "b";', 'kind: "a" | "c";'),
		mirror: `
export interface Widget {
	kind: "a" | "b";
}
`,
	});
	try {
		const issues = checkTypeMirror({ artifactRoots: [fixtureDir.hostRoot], mirrors: [fixtureDir.mirrorPath] });
		expect(issues.map((issue) => issue.kind)).toEqual(["type-mismatch"]);
	} finally {
		await rm(fixtureDir.dir, { recursive: true, force: true });
	}
});

test("a name no entry point publishes is still checked for members", async () => {
	const fixtureDir = await fixture({
		// `Internal` is declared but not re-exported, which is how `ReadonlySessionManager` and the other
		// internal shapes the mirror stands in for look in the artifact.
		types: `${HOST_TYPES}\nexport interface Internal {\n\tread(): string;\n}\n`,
		entry: 'export type { Widget } from "./types.js";\n',
		mirror: `
export interface Internal {
	write(): string;
}
`,
	});
	try {
		const issues = checkTypeMirror({ artifactRoots: [fixtureDir.hostRoot], mirrors: [fixtureDir.mirrorPath] });
		expect(issues.map((issue) => [issue.kind, issue.name, issue.member])).toEqual([
			["missing-member", "Internal", "write"],
		]);
	} finally {
		await rm(fixtureDir.dir, { recursive: true, force: true });
	}
});

test("a spirits-local name is exempt while the host has no such declaration", async () => {
	const fixtureDir = await fixture({
		types: HOST_TYPES,
		mirror: `
export interface ${Object.keys(SPIRITS_LOCAL_NAMES)[0]} {
	provider: string;
}
`,
	});
	try {
		const issues = checkTypeMirror({ artifactRoots: [fixtureDir.hostRoot], mirrors: [fixtureDir.mirrorPath] });
		expect(issues).toEqual([]);
	} finally {
		await rm(fixtureDir.dir, { recursive: true, force: true });
	}
});

test("a spirits-local name the host now declares is reported as stale", async () => {
	const local = Object.keys(SPIRITS_LOCAL_NAMES)[0]!;
	const fixtureDir = await fixture({
		types: `${HOST_TYPES}\nexport interface ${local} {\n\tprovider: string;\n}\n`,
		mirror: `
export interface Widget {
	count: number;
}
`,
	});
	try {
		const issues = checkTypeMirror({ artifactRoots: [fixtureDir.hostRoot], mirrors: [fixtureDir.mirrorPath] });
		expect(issues.map((issue) => [issue.kind, issue.name])).toEqual([["stale-local-name", local]]);
	} finally {
		await rm(fixtureDir.dir, { recursive: true, force: true });
	}
});

test("a host without a published type entry cannot be read", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-type-mirror-"));
	try {
		expect(() => readHostDeclarations(dir)).toThrow(/no published .d.ts entry/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a mirror with no host to compare against reports nothing", () => {
	const mirror = new Map(readMirrorDeclarations(join(import.meta.dir, "..", "src", "types", "pi-tui.d.ts")));
	expect(compareMirrorDeclarations(mirror, undefined)).toEqual([]);
});
