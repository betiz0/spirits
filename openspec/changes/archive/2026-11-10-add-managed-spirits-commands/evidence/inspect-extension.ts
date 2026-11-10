/**
 * Read-only inspector used by the two-route data probe. It reports what the host resolved from the
 * shared agent dir, so the same file works under the fork and under official pi: it touches no
 * product code, only extension APIs and the file the host itself reads.
 */

import { writeFileSync } from "node:fs";

const DUMP_ENV = "ADC_DUMP";
const TRACKED = ["defaultProvider", "defaultModel", "defaultThinkingLevel", "models"];

export default function inspect(pi: any): void {
	pi.registerCommand("adc-inspect", {
		description: "Dump what this host resolved from the shared agent dir",
		handler: async (_args: string, ctx: any) => {
			const settings = (pi.getSettings() ?? {}) as Record<string, unknown>;
			const known: Record<string, unknown> = {};
			const unknown: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(settings)) {
				if (TRACKED.includes(key)) known[key] = value;
				else unknown[key] = value;
			}
			const entries = (ctx.sessionManager.getEntries() ?? []) as Array<{ type?: string; customType?: string; data?: any }>;
			const roleOf = (customType: string): string[] =>
				entries.filter((entry) => entry.customType === customType).map((entry) => String(entry.data?.role ?? "?"));
			const payload = {
				agentDir: process.env.SPIRITS_CODING_AGENT_DIR ?? "",
				home: require("node:os").homedir() as string,
				sessionId: ctx.sessionManager.getSessionId() as string | undefined,
				known,
				unknownKeys: unknown,
				commands: (pi.getCommands() ?? []).map((command: { name: string }) => command.name) as string[],
				currentModel: ctx.model ? `${String(ctx.model.provider)}/${String(ctx.model.id)}` : undefined,
				level: pi.getThinkingLevel?.() as string | undefined,
				customTypes: [...new Set(entries.map((entry) => String(entry.customType ?? entry.type ?? "message")))] as string[],
				spiritsRoleEntries: roleOf("spirits_role"),
				piStateRoles: roleOf("pi.virtual-model-state"),
			};
			const path = process.env[DUMP_ENV];
			if (path) writeFileSync(path, `${JSON.stringify(payload, null, "\t")}\n`);
		},
	});
}
