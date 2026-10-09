/**
 * The `tsrepl` tool definition and registration.
 *
 * The tool owns one `Repl` instance, so its vm context and values persist for the
 * session. `exposure: "direct"` declares it to the model; `executionMode: "sequential"`
 * keeps tool calls from interleaving (the REPL also serializes internally).
 */

import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Repl } from "./repl/cell.ts";
import type { ResultDetails } from "./repl/format.ts";
import { createBuiltinHostFns } from "./repl/hostfns.ts";
import { HostFnRegistry, type HostFnEntry } from "./repl/registry.ts";

export const TSREPL_DESCRIPTION = [
	"永続 TypeScript REPL のセルを実行します。",
	"- セルをまたいで残るのは `globalThis` への代入(`globalThis.x = ...` または宣言なしの `x = ...`)だけです。`const` / `let` / `function` / `class` はセル内に閉じます。",
	"- 値は `return <式>` または `out(<式>)` で返します。文字列の出力には `print(...)` を使ってください(`console` は提供していません)。",
	'- `use("node:fs")` / `use("bun:ffi")` の組込と、cwd 相対の `use("./m.ts")` を import できます。それ以外は拒否されます。',
	"- `tool(name, args)` で他のツールを呼べます(`tsrepl` 自身は呼べません)。",
	"- 実行時エラーの行番号と抜粋は、TypeScript を JavaScript へ変換した後のコード基準です。",
	"- timeout は既定 30000ms で、[500, 120000] にクランプされます。timeout 打ち切り後はコンテキストが不整合になり得るため、必要なら `reset: true` を使ってください。",
	"- 既知の制約: `await` の後に始まる同期ループは中断できず、プロセス全体が応答しなくなります。`reset` では回復できません。",
].join("\n");

const parameters = Type.Object({
	code: Type.String({ description: "実行する TypeScript セル" }),
	timeout: Type.Optional(
		Type.Number({ description: "セル実行の打ち切り(ms)。既定 30000、[500, 120000] にクランプ" }),
	),
	reset: Type.Optional(Type.Boolean({ description: "true なら実行前に永続コンテキストを再生成する" })),
	description: Type.Optional(Type.String({ description: "このセルの意図(開発時ログ用)" })),
});

export type TsreplParameters = typeof parameters;
export type TsreplDetails = ResultDetails;

export type DevLogSink = (line: string) => void;

export interface DevLogOptions {
	/** Destination for dev logs. Defaults to stderr. */
	sink?: DevLogSink;
	/** Env value gating the log. Defaults to `process.env.SPIRITS_DEV`. */
	env?: string | undefined;
}

export type DevLogger = (message: string) => void;

/** Return a logger only when `SPIRITS_DEV=1`. Exposed for tests. */
export function createDevLogger(options: DevLogOptions = {}): DevLogger | undefined {
	const env = options.env ?? process.env.SPIRITS_DEV;
	if (env !== "1") {
		return undefined;
	}
	const sink = options.sink ?? ((line: string): void => void process.stderr.write(`${line}\n`));
	return (message: string) => sink(`[spirits] ${message}`);
}

export interface CreateTsreplToolOptions {
	dev?: DevLogOptions;
	/** Additional host functions exposed to cells, registered after the built-ins. */
	hostFns?: readonly HostFnEntry[];
}

/**
 * Compose the tool description: the M1 description plus each extra host function's description,
 * separated by a blank line. Without extra host functions the result is `TSREPL_DESCRIPTION`.
 */
function buildToolDescription(hostFns: readonly HostFnEntry[] | undefined): string {
	const extras = (hostFns ?? []).map((entry) => entry.description).filter((text) => text !== "");
	if (extras.length === 0) {
		return TSREPL_DESCRIPTION;
	}
	return [TSREPL_DESCRIPTION, ...extras].join("\n\n");
}

export function createTsreplTool(options: CreateTsreplToolOptions = {}): ToolDefinition<TsreplParameters, TsreplDetails> {
	const registry = new HostFnRegistry(createBuiltinHostFns());
	for (const entry of options.hostFns ?? []) {
		registry.register(entry);
	}
	const repl = new Repl(registry);
	const devLog = createDevLogger(options.dev);

	return {
		name: "tsrepl",
		label: "TypeScript REPL",
		description: buildToolDescription(options.hostFns),
		parameters,
		exposure: "direct",
		executionMode: "sequential",
		async execute(
			_toolCallId,
			params,
			_signal,
			_onUpdate,
			ctx,
		): Promise<AgentToolResult<TsreplDetails>> {
			const started = Date.now();
			const result = await repl.run(
				{ code: params.code, timeout: params.timeout, reset: params.reset },
				ctx,
			);
			if (devLog !== undefined) {
				const kind = result.isError ? "error" : "ok";
				const label = params.description ?? "";
				devLog(`description=${JSON.stringify(label)} elapsed=${Date.now() - started}ms kind=${kind}`);
			}
			return {
				content: [{ type: "text", text: result.text }],
				details: result.details,
				isError: result.isError,
			};
		},
	};
}

/** Register the tsrepl tool on a pi extension. */
export function registerTsrepl(pi: ExtensionAPI, options: CreateTsreplToolOptions = {}): void {
	pi.registerTool(createTsreplTool(options));
}
