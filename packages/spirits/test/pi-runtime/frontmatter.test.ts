/**
 * Minimal runtime-resolution check for pi's public API.
 *
 * This directory carries its own `tsconfig.json`, which extends the package's, so both the
 * type check and Bun resolve `@earendil-works/pi-coding-agent` to the installed host package —
 * the same one the extension is typed against.
 */

import { expect, test } from "bun:test";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

test("pi frontmatter parser resolves at runtime", () => {
	const parsed = parseFrontmatter<{ name: string }>("---\nname: demo\n---\n\nbody text\n");
	expect(parsed.frontmatter.name).toBe("demo");
	expect(parsed.body).toBe("body text");
});
