/**
 * Probe extension for the managed Pi compatibility runner.
 *
 * Load it before the spirits extension. It wraps `registerTool`, records the tools later
 * registered by spirits, and writes the post-`session_start` tool inventory to a file. A command
 * can run the captured `tsrepl` definition inside the managed Pi process. This bypasses Pi's
 * permission and hook path; the result records that fact explicitly.
 */

import { VERSION } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const STATE_ENV = "MANAGED_PI_COMPAT_PROBE_STATE";
const RESULT_ENV = "MANAGED_PI_COMPAT_PROBE_RESULT";

interface ProbeState {
	sessionStarted: boolean;
	tools: string[];
	captured: string[];
	hostVersion?: string;
	appName?: string;
	packageDir?: string;
	agentDir?: string;
	oldAgentDir?: string;
	apiKey?: string;
	proxy?: string;
}

function readAppName(): string | undefined {
	const packageDir = process.env.PI_PACKAGE_DIR;
	if (!packageDir) return undefined;
	try {
		const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
			piConfig?: { name?: unknown };
		};
		return typeof pkg.piConfig?.name === "string" ? pkg.piConfig.name : undefined;
	} catch {
		return undefined;
	}
}

function writeJson(path: string | undefined, value: unknown): void {
	if (!path) return;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

export default function probeExtension(pi: ExtensionAPI): void {
	const captured: Array<{ name: string; definition: ToolDefinition }> = [];
	const original = pi.registerTool.bind(pi);
	pi.registerTool = ((definition: ToolDefinition) => {
		captured.push({ name: definition.name, definition });
		return original(definition);
	}) as typeof pi.registerTool;

	pi.on("session_start", () => {
		const state: ProbeState = {
			sessionStarted: true,
			tools: pi.getAllTools().map((tool) => tool.name),
			captured: captured.map((entry) => entry.name),
			hostVersion: VERSION,
			appName: readAppName(),
			packageDir: process.env.PI_PACKAGE_DIR,
			agentDir: process.env.SPIRITS_CODING_AGENT_DIR,
			oldAgentDir: process.env.PI_CODING_AGENT_DIR,
			apiKey: process.env.ANTHROPIC_API_KEY,
			proxy: process.env.HTTPS_PROXY,
		};
		writeJson(process.env[STATE_ENV], state);
	});

	pi.registerCommand("compat-probe", {
		description: "Run one captured tsrepl cell inside the managed Pi process",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const tool = captured.find((entry) => entry.name === "tsrepl");
			if (!tool) {
				writeJson(process.env[RESULT_ENV], {
					text: "tsrepl was not captured",
					isError: true,
					bypassedPiHooks: true,
				});
				return;
			}
			const result = await tool.definition.execute(
				"compat-probe",
				{ code: args },
				undefined,
				undefined,
				{
					...ctx,
					tools: [],
					executeTool: async () => ({
						toolCall: {},
						result: { content: [], details: undefined },
						isError: false,
					}),
				} as never,
			);
			const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
			const entries = ctx.sessionManager
				.getEntries()
				.filter((entry) => entry.type === "custom" && entry.customType === "rlm_usage");
			writeJson(process.env[RESULT_ENV], {
				text,
				isError: result.isError === true,
				details: result.details,
				bypassedPiHooks: true,
				rlmUsage: entries,
			});
		},
	});
}
