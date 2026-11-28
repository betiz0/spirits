/**
 * The report-saving constants: the step table, the name collision, and the temporary name.
 *
 * These three hold the parts a drift would silently break: a step added to the table without a
 * step definition would number reports for a step that never opens, a temporary name matching a
 * series would make the numbering count half-written files, and a tool-name collision would let one
 * registration shadow the other.
 */

import { expect, test } from "bun:test";
import {
	STEP_DEFINITIONS,
	TOOL_NAME_PROMPT_SET,
	TOOL_NAME_SKILL_DELETE,
	TOOL_NAME_SKILL_LIST,
	TOOL_NAME_SKILL_SAVE,
	VERIFY_REPORT_NOT_VERIFYING_REASON,
	VERIFY_REPORT_PREFIXES,
	VERIFY_REPORT_TEMP_PREFIX,
	VERIFY_REPORT_UNPINNED_NOTICE,
	VERIFY_REPORT_UNPINNED_REASON,
	TOOL_NAME_VERIFY_REPORT_SAVE,
} from "../src/constants.ts";
import { reportSeriesPattern } from "../src/verify/report-name.ts";
import { MANAGE_TODOS_TOOL_NAME } from "../src/todo/tool.ts";

test("the report table names exactly the two verifying steps of the step list", () => {
	expect(Object.keys(VERIFY_REPORT_PREFIXES).sort()).toEqual(["opsx-verify", "sprt-opsx-verify-deep"]);
	for (const name of Object.keys(VERIFY_REPORT_PREFIXES)) {
		expect(STEP_DEFINITIONS.some((step) => step.name === name)).toBe(true);
	}
	expect(VERIFY_REPORT_PREFIXES["opsx-verify"]).toBe("verify");
	expect(VERIFY_REPORT_PREFIXES["sprt-opsx-verify-deep"]).toBe("d-verify");
});

test("the save tool name collides with no tool spirits registers", () => {
	const registered = [
		"tsrepl",
		MANAGE_TODOS_TOOL_NAME,
		TOOL_NAME_SKILL_SAVE,
		TOOL_NAME_SKILL_LIST,
		TOOL_NAME_SKILL_DELETE,
		TOOL_NAME_PROMPT_SET,
	];
	expect(registered).not.toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
});

// `STEP_DEFINITIONS` owns which commands open a verification (the layer check reads it there) and the
// guidance texts write those words by hand. Without this link a starter rename leaves every message
// naming a command nobody can type (d-verify3 W-3).
test("the reopening guidance names the commands the step table opens a verification with", () => {
	const openers = STEP_DEFINITIONS.filter((step) => VERIFY_REPORT_PREFIXES[step.name] !== undefined).map(
		(step) => step.starters[0],
	);
	expect(openers).toEqual(["/opsx-verify", "/skill:sprt-opsx-verify-deep"]);
	for (const guidance of [VERIFY_REPORT_NOT_VERIFYING_REASON, VERIFY_REPORT_UNPINNED_REASON, VERIFY_REPORT_UNPINNED_NOTICE]) {
		for (const opener of openers) expect(guidance).toContain(opener);
	}
});

test("the temporary prefix matches neither report series", () => {
	// A temporary file the numbering could count would hand the next save a wrong number.
	for (const prefix of Object.values(VERIFY_REPORT_PREFIXES)) {
		expect(reportSeriesPattern(prefix).test(`${VERIFY_REPORT_TEMP_PREFIX}x.tmp`)).toBe(false);
	}
});
