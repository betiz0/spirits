/**
 * The scripted turns both hosts run, and the fake provider's reply rules.
 *
 * Both hosts execute the same cells and the same tool calls, so a difference in the resulting files
 * comes from the host and not from the script. Every cell writes a run-unique marker into the data
 * it stores, which is what makes a cross-host read observable: the marker has to show up in the
 * other host's own reads (session entries, the memory file, the rendered system prompt).
 */

import type { FakeReply, FakeToolCall } from "../managed-pi-compat/fake-provider.ts";

/** Prompt texts that select a scripted reply. One per phase. */
export const PROMPTS = {
	write: "adc-phase-write",
	rlm: "adc-phase-rlm",
	route: "adc-phase-route",
	read: "adc-phase-read",
} as const;

/** Marker embedded in every value the script stores. */
export function makeMarker(): string {
	return `ADC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function tsreplCall(code: string): FakeReply {
	const toolCall: FakeToolCall = { name: "tsrepl", arguments: { code } };
	return { kind: "tool-call", toolCall };
}

/** Store one value of every spirits-owned artifact through the product's own tools. */
export function writeCell(marker: string): string {
	return [
		`const noteResult = await note("adc memory line ${marker}");`,
		`const goalResult = await goal("adc goal ${marker}");`,
		`const todoResult = await tool("manage_todos", { updates: [{ op: "add", text: "adc todo ${marker}" }] });`,
		`const skillResult = await tool("spirits_skill_save", { name: "adc-probe-skill", description: "compat probe skill ${marker}", body: "# adc-probe-skill\\n\\nmarker ${marker}\\n" });`,
		`const promptResult = await tool("spirits_prompt_set", { content: "adc code-mode override ${marker}\\n" });`,
		`return { note: String(noteResult).slice(0, 120), goal: String(goalResult).slice(0, 120), todos: JSON.stringify(todoResult).slice(0, 200), skill: JSON.stringify(skillResult).slice(0, 160), prompt: JSON.stringify(promptResult).slice(0, 160) };`,
	].join("\n");
}

/** Read the spirits-owned artifacts back through the product's own read paths. */
export function readCell(marker: string): string {
	return [
		`const goalValue = await goal();`,
		`const skills = await tool("spirits_skill_list", {});`,
		`return { goal: String(goalValue).slice(0, 240), skills: JSON.stringify(skills).slice(0, 400), marker: "${marker}" };`,
	].join("\n");
}

/** Start one rlm child so the run leaves an `rlm_usage` entry behind. */
export function rlmCell(marker: string): string {
	return `return await rlm("adc child ${marker} answer with one word")`;
}

/** A minimal cell for the routing phase: the request itself is what writes the routing entry. */
export function routeCell(): string {
	return "return 1 + 1";
}

/** The text of the last user message, which is what selects the reply. */
function lastUserText(body: unknown): string {
	const record = (body ?? {}) as { messages?: Array<{ role?: string; content?: unknown }> };
	const messages = record.messages ?? [];
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== "user") continue;
		if (typeof message.content === "string") return message.content;
		if (Array.isArray(message.content)) {
			return message.content
				.map((part) => {
					if (typeof part === "string") return part;
					const text = (part as { text?: unknown }).text;
					return typeof text === "string" ? text : "";
				})
				.join(" ");
		}
		return "";
	}
	return "";
}

/**
 * Decide the reply for one provider request.
 *
 * Order matters: a request that carries a tool result must be answered with text, otherwise the
 * scripted tool call repeats forever. The rlm child request is recognized by the marker in its own
 * prompt, before the phase prompts, because the parent's follow-up request also contains the marker
 * inside its tool result.
 */
export function decideReply(body: unknown, marker: string): FakeReply {
	const record = (body ?? {}) as { messages?: Array<{ role?: string; content?: unknown }> };
	const messages = record.messages ?? [];
	// Only the newest message decides whether the turn is continuing from a tool result: older tool
	// results stay in the history of every later request.
	const newest = messages[messages.length - 1];
	if (newest?.role === "tool" || newest?.role === "toolResult") return { kind: "text", text: "adc done" };
	// Phase prompts accumulate in the history, so the reply is chosen from the newest user message.
	const prompt = lastUserText(body);
	if (prompt.includes(`adc child ${marker}`)) return { kind: "text", text: `adc child answer ${marker}` };
	if (prompt.includes(PROMPTS.write)) return tsreplCall(writeCell(marker));
	if (prompt.includes(PROMPTS.rlm)) return tsreplCall(rlmCell(marker));
	if (prompt.includes(PROMPTS.route)) return tsreplCall(routeCell());
	if (prompt.includes(PROMPTS.read)) return tsreplCall(readCell(marker));
	if (prompt.startsWith("/adc-")) return { kind: "text", text: "adc ok" };
	return { kind: "text", text: `adc unexpected request ${marker}` };
}

/** True when the fake provider saw an unexpected request (a script/host mismatch). */
export function unexpectedRequests(requests: readonly { body?: unknown }[], marker: string): number {
	return requests.filter((request) =>
		JSON.stringify(request.body ?? "").includes(`adc unexpected request ${marker}`),
	).length;
}
