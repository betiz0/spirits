/**
 * Probe helpers for real tsrepl execution.
 *
 * The probe captures the registered tool definition and calls its `execute` directly. That proves
 * the cell runtime, not Pi's permission and hook path; results carry that limitation explicitly.
 */

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createTsreplTool } from "../../packages/spirits/src/tools.ts";
import { makeToolContext } from "../../packages/spirits/test/support.ts";

/** A captured tool registration. */
export interface CapturedTool {
	name: string;
	definition: ToolDefinition;
}

/** Wrap `pi.registerTool` and record every registration. */
export function captureRegisteredTools(pi: ExtensionAPI): CapturedTool[] {
	const captured: CapturedTool[] = [];
	const original = pi.registerTool.bind(pi);
	pi.registerTool = ((definition: ToolDefinition) => {
		captured.push({ name: definition.name, definition });
		return original(definition);
	}) as typeof pi.registerTool;
	return captured;
}

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
