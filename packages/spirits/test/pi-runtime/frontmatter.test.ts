/**
 * Minimal runtime-resolution check for pi's public API.
 *
 * This directory has its own `tsconfig.json` that extends the repo root, so Bun resolves
 * `@earendil-works/pi-coding-agent` to the pi sources at run time (the same scheme as
 * `src/rlm/` and `src/harness/`). The type check uses the local mirror in
 * `src/types/pi-coding-agent.d.ts` instead.
 */

import { expect, test } from "bun:test";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

test("pi frontmatter parser resolves at runtime", () => {
	const parsed = parseFrontmatter<{ name: string }>("---\nname: demo\n---\n\nbody text\n");
	expect(parsed.frontmatter.name).toBe("demo");
	expect(parsed.body).toBe("body text");
});
