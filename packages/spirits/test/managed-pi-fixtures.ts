import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOverlayPackageJson, sha256Hex } from "../src/managed-pi/overlay.ts";
import { firstSupportedManifest, type ManagedManifest } from "../src/managed-pi/manifest.ts";

export const OFFICIAL_PACKAGE = `${JSON.stringify(
	{
		name: "@earendil-works/pi-coding-agent",
		version: "1.5.0",
		type: "module",
		piConfig: { configDir: ".pi" },
		bin: { pi: "dist/bundle/cli.js" },
	},
	null,
	"\t",
)}\n`;

export const PI_SCRIPT = "#!/bin/sh\necho managed-pi \"$@\"\n";

export interface ManagedFixture {
	root: string;
	work: string;
	manifest: ManagedManifest;
	server: ReturnType<typeof Bun.serve>;
	baseUrl: string;
}

export async function makeManagedFixture(
	options: { setId?: string; extensionBody?: string; piScript?: string } = {},
): Promise<ManagedFixture> {
	const work = await mkdtemp(join(tmpdir(), "spirits-managed-fixture-"));
	const source = join(work, "source", "pi");
	await mkdir(source, { recursive: true });
	await writeFile(join(source, "package.json"), OFFICIAL_PACKAGE);
	await writeFile(join(source, "pi"), options.piScript ?? PI_SCRIPT);
	await chmod(join(source, "pi"), 0o755);
	const archive = join(work, "pi.tar.gz");
	const tar = Bun.spawnSync({ cmd: ["tar", "-czf", archive, "-C", join(work, "source"), "."] });
	if (tar.exitCode !== 0) throw new Error(tar.stderr.toString());
	const archiveBytes = new Uint8Array(await Bun.file(archive).arrayBuffer());
	const extensionBody = options.extensionBody ?? "export default function () {}\n";
	const overlay = createOverlayPackageJson(OFFICIAL_PACKAGE);
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			if (path === "/pi.tar.gz") return new Response(archiveBytes);
			if (path === "/spirits-extension.js") return new Response(extensionBody);
			return new Response("not found", { status: 404 });
		},
	});
	const baseUrl = `http://127.0.0.1:${server.port}`;
	const base = firstSupportedManifest({
		version: "0.1.0",
		url: `${baseUrl}/spirits-extension.js`,
		sha256: sha256Hex(extensionBody),
	});
	const manifest: ManagedManifest = {
		...base,
		setId: options.setId ?? `pi-${base.pi.version}`,
		pi: {
			...base.pi,
			artifact: { ...base.pi.artifact, url: `${baseUrl}/pi.tar.gz`, sha256: sha256Hex(archiveBytes) },
		},
		overlay: { ...base.overlay, sha256: overlay.sha256 },
	};
	const root = join(work, "managed-pi");
	return { root, work, manifest, server, baseUrl };
}

export async function cleanupManagedFixture(fixture: ManagedFixture): Promise<void> {
	fixture.server.stop(true);
	await rm(fixture.work, { recursive: true, force: true });
}

/** True when the path exists as a directory. Used to pin the absence of an agent dir. */
export async function directoryExists(path: string): Promise<boolean> {
	try {
		return (await lstat(path)).isDirectory();
	} catch {
		return false;
	}
}

/** A tiny RPC-speaking stand-in for the official Pi executable. */
export const FAKE_RPC_PI_SCRIPT = `#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const packageDir = process.env.PI_PACKAGE_DIR ?? "";
function packageIdentity() {
	try {
		const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
		return { name: pkg.piConfig?.name, version: pkg.version };
	} catch {
		return { name: undefined, version: undefined };
	}
}
function writeJson(path, value) {
	if (!path) return;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value, null, "\\t") + "\\n");
}
if (args.includes("--version")) {
	const identity = packageIdentity();
	console.log(identity.version ?? "0.0.0");
	process.exit(0);
}
if (args.includes("--help")) {
	console.log("fake managed pi help");
	process.exit(0);
}
const statePath = process.env.MANAGED_PI_COMPAT_PROBE_STATE;
const resultPath = process.env.MANAGED_PI_COMPAT_PROBE_RESULT;
function respond(id, command, data) {
	process.stdout.write(JSON.stringify({ type: "response", id, command, success: true, data }) + "\\n");
}
function respondError(id, command, error) {
	process.stdout.write(JSON.stringify({ type: "response", id, command, success: false, error }) + "\\n");
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	for (;;) {
		const newline = buffer.indexOf("\\n");
		if (newline === -1) break;
		const line = buffer.slice(0, newline).trim();
		buffer = buffer.slice(newline + 1);
		if (!line) continue;
		const request = JSON.parse(line);
		if (request.type === "get_state") {
			const identity = packageIdentity();
			writeJson(statePath, {
				sessionStarted: true,
				tools: ["tsrepl", "manage_todos"],
				captured: ["tsrepl"],
				hostVersion: identity.version,
				appName: identity.name,
				packageDir: process.env.PI_PACKAGE_DIR,
				agentDir: process.env.SPIRITS_CODING_AGENT_DIR,
				oldAgentDir: process.env.PI_CODING_AGENT_DIR,
				apiKey: process.env.ANTHROPIC_API_KEY,
				proxy: process.env.HTTPS_PROXY,
			});
			respond(request.id, "get_state", { sessionId: "fake-session", thinkingLevel: "off", isStreaming: false, isCompacting: false, steeringMode: "all", followUpMode: "one-at-a-time", autoCompactionEnabled: true, messageCount: 0, pendingMessageCount: 0 });
		} else if (request.type === "get_commands") {
			respond(request.id, "get_commands", { commands: [{ name: "model" }, { name: "clear" }] });
		} else if (request.type === "set_model") {
			if (request.provider === "spirits" && request.modelId === "auto") {
				respondError(request.id, "set_model", "virtual model unavailable in the fixture");
			} else {
				respond(request.id, "set_model", { provider: request.provider, id: request.modelId });
			}
		} else if (request.type === "prompt") {
			const message = String(request.message ?? "");
			if (message.startsWith("/compat-probe")) {
				const code = message.slice("/compat-probe".length).trim();
				let text = "[value]\\n2";
				let isError = false;
				const rlmUsage = [];
				if (code.includes("node:vm")) text = "[value]\\n3";
				if (code.includes("throw")) { text = "cell boom"; isError = true; }
				if (code.includes("rlm(")) { text = "answer"; rlmUsage.push({ type: "custom", customType: "rlm_usage" }); }
				writeJson(resultPath, { text, isError, bypassedPiHooks: true, rlmUsage });
				respond(request.id, "prompt", { disposition: "handled" });
			} else {
				respond(request.id, "prompt", { disposition: "started" });
				process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolCallId: "fake-tool", toolName: "tsrepl", args: { code: "return 1 + 1" } }) + "\\n");
				process.stdout.write(JSON.stringify({ type: "tool_execution_end", toolCallId: "fake-tool", toolName: "tsrepl", result: { content: [] }, isError: false }) + "\\n");
				process.stdout.write(JSON.stringify({ type: "agent_settled", aborted: false }) + "\\n");
			}
		} else {
			respondError(request.id, String(request.type), "unsupported fixture command");
		}
	}
});
`;
