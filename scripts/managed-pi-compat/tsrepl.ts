/**
 * Probe helpers for real tsrepl execution.
 *
 * The primary check drives the cell through the normal model-to-tool path. The auxiliary check
 * calls a tool definition's `execute` directly, which proves the cell runtime but bypasses Pi's
 * permission and hook path, so it is recorded separately. Official Pi gives every extension its
 * own API object, so an extension cannot reach another extension's tool definition; on that host
 * the auxiliary item stays `not-run` with a reason and never depends on capturing a registration.
 */

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createTsreplTool } from "../../packages/spirits/src/tools.ts";
import { makeToolContext } from "../../packages/spirits/test/support.ts";
import type { CompatState } from "./runner.ts";
import type { RpcRecord } from "./rpc.ts";

/** Result of one probe cell. */
export interface CellProbeResult {
	text: string;
	isError: boolean;
	details: unknown;
	bypassedPiHooks: true;
}

/** Execute a captured `tsrepl` definition with a minimal extension context. */
export async function executeCapturedTsrepl(
	tool: ToolDefinition,
	code: string,
	cwd: string,
): Promise<CellProbeResult> {
	const result = await tool.execute(
		"compat-probe",
		{ code },
		undefined,
		() => {},
		makeToolContext({ cwd }),
	);
	const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
	return { text, isError: result.isError === true, details: result.details, bypassedPiHooks: true };
}

/** Create the tool used by the default probe when no managed extension is available. */
export function createProbeTsreplTool(): ToolDefinition {
	return createTsreplTool() as unknown as ToolDefinition;
}

/**
 * Classify the one-time normal-path observation: the model issued a tool call and Pi executed it
 * through its permission and hook path. The auxiliary direct `execute` probe never satisfies this.
 */
export function classifyNormalToolPath(
	records: readonly RpcRecord[],
	toolName: string,
): { state: CompatState; detail: string; data?: { bypassedPiHooks: false } } {
	const starts = records.filter((record) => record.type === "tool_execution_start" && record.toolName === toolName);
	const ends = records.filter((record) => record.type === "tool_execution_end" && record.toolName === toolName);
	if (starts.length === 0) {
		return { state: "failed", detail: `no tool_execution_start for ${toolName} was observed` };
	}
	if (!ends.some((record) => record.isError !== true)) {
		return { state: "failed", detail: `${toolName} started but no successful tool_execution_end was observed` };
	}
	return {
		state: "confirmed",
		detail: `${toolName} ran through the normal model-to-tool path`,
		data: { bypassedPiHooks: false },
	};
}

/**
 * Judge a cell that ran through the normal model-to-tool path. A fixture host can accept the tool
 * call and answer with an empty result without evaluating the cell code; that proves nothing about
 * the product, so it is recorded as `not-run`. An official host that cannot return the expected
 * value is a failure.
 */
export function classifyCellOutcome(options: {
	value: unknown;
	expected: unknown;
	isError: boolean;
	text: string;
	fixtureHost: boolean;
}): { state: CompatState; detail: string } {
	if (options.isError) return { state: "failed", detail: options.text };
	if (options.value === options.expected) {
		return {
			state: "confirmed",
			detail: `cell returned ${JSON.stringify(options.value)} through the normal model-to-tool path`,
		};
	}
	if (options.fixtureHost && (options.value === undefined || options.text.trim() === "")) {
		return { state: "not-run", detail: "the fixture host accepted the tool call without executing cell code" };
	}
	return {
		state: "failed",
		detail: `cell returned ${JSON.stringify(options.value)}, expected ${JSON.stringify(options.expected)}`,
	};
}

/** Judge the cell-failure item with the same fixture rule. */
export function classifyCellFailure(observed: boolean, fixtureHost: boolean): { state: CompatState; detail: string } {
	if (observed) return { state: "confirmed", detail: "cell failure is separate from extension load" };
	if (fixtureHost) {
		return { state: "not-run", detail: "the fixture host did not execute the failing cell" };
	}
	return { state: "failed", detail: "the cell failure was not observed" };
}

/** What the auxiliary probe could reach on the host. */
export interface AuxiliaryObservation {
	/** True when `tsrepl` appears in the dedicated Pi's own tool inventory. */
	toolRegistered: boolean;
	/** A direct `execute` result, present only when a tool definition was reachable. */
	direct?: CellProbeResult;
}

/** Why the direct `execute` path is unreachable across extensions on a shared host. */
export const NO_REACHABLE_TOOL_DEFINITION =
	"the direct execute probe needs another extension's tool definition; Pi hands every extension its own API object, so no definition is reachable";

/**
 * Classify the auxiliary direct `execute` probe. It is optional, always bypasses the Pi permission
 * and hook path, and never satisfies the normal-path item. Without a reachable definition it stays
 * `not-run`, whether or not the tool is registered.
 */
export function classifyAuxiliaryProbe(observation: AuxiliaryObservation): {
	state: CompatState;
	detail: string;
	data: { bypassedPiHooks: true; toolRegistered: boolean };
} {
	const data = { bypassedPiHooks: true, toolRegistered: observation.toolRegistered } as const;
	const direct = observation.direct;
	if (direct === undefined) {
		return {
			state: "not-run",
			detail: observation.toolRegistered
				? `${NO_REACHABLE_TOOL_DEFINITION}; tsrepl was observed in the tool inventory`
				: `${NO_REACHABLE_TOOL_DEFINITION}; tsrepl was not in the tool inventory`,
			data,
		};
	}
	if (direct.isError) return { state: "failed", detail: direct.text, data };
	return {
		state: "confirmed",
		detail: "auxiliary direct execute; bypasses Pi permission and hooks",
		data,
	};
}

/** Parse the returned value from a simple `return` cell result. */
export function simpleReturnValue(result: CellProbeResult): unknown {
	if (result.isError) return undefined;
	const text = result.text.startsWith("[value]\n") ? result.text.slice("[value]\n".length) : result.text;
	try {
		return JSON.parse(text);
	} catch {
		return text.trim();
	}
}
