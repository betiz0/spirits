/**
 * The `tsrepl` tool definition and registration.
 *
 * The tool owns one `Repl` instance, so its vm context and values persist for the
 * session. `exposure: "direct"` declares it to the model; `executionMode: "sequential"`
 * keeps tool calls from interleaving (the REPL also serializes internally).
 */

import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BuiltTool } from "./types/host.ts";
import { BASH_PIPE_ALLOW_FILTERS, TSREPL_CELL_ENTRY_TYPE } from "./constants.ts";
import { MISSING_GLOBALS } from "./repl/context.ts";
import { DEFAULT_SYNC_WATCHDOG, MAX_TIMEOUT, MIN_TIMEOUT, Repl } from "./repl/cell.ts";
import { OUTPUT_LIMIT } from "./repl/format.ts";
import type { CellMetrics } from "./repl/metrics.ts";
import type { ResultDetails } from "./repl/format.ts";
import { createBuiltinHostFns } from "./repl/hostfns.ts";
import { HostFnRegistry, type HostFnEntry } from "./repl/registry.ts";

export const TSREPL_DESCRIPTION = [
	"永続 TypeScript REPL のセルを実行します。",
	"- セルをまたいで残るのは `globalThis` への代入(`globalThis.x = ...` または宣言なしの `x = ...`)だけです。`const` / `let` / `function` / `class` はセル内に閉じます。",
	"- 値は `return <式>` または `out(<式>)` で返します。文字列の出力には `print(...)` を使ってください(`console` は提供していません)。",
	'- `await use("node:fs")` / `await use("bun:ffi")` の組込と、cwd 相対の `await use("./m.ts")` を import できます。`use()` は Promise を返すので `await` が要ります。それ以外は拒否されます。',
	// The names come from the same list the runtime error suggests from, so the description and the
	// proposal cannot disagree about what a cell does not have.
	`- セルに無いもの: ${MISSING_GLOBALS.map((entry) => `\`${entry.name}\``).join(" / ")}。代わりはそれぞれ \`await use("node:...")\` で、実行時エラーの提案にも同じ文が出ます。`,
	"- `tool(name, args)` で他のツールを呼べます(`tsrepl` 自身は呼べません)。",
	"- 実行時エラーの行番号と抜粋は、TypeScript を JavaScript へ変換した後のコード基準です。",
	"- `tool(name, args)` の結果は、非ゼロ終了などのエラー扱いでも、そのツールが `outputSchema` を宣言していれば構造化結果として返ります。bash なら `exit_code` を確認してください。例外になるのは構造化結果の無い失敗だけです。",
	`- 結果テキストの上限は ${OUTPUT_LIMIT} 文字で、超えると先頭と末尾を残します。切り捨てたときは全文が一時ファイルに保存され、結果にそのパスが出ます(大きい出力は \`return\` 前に加工するか \`full_output_path\` を読んでください)。`,
	"- 値を返して成功したセルの値は、次のセルで `_` として読めます。エラーになったセルは `_` を変えません。",
	`- timeout は既定なし(無制限)で、指定時は [${MIN_TIMEOUT}, ${MAX_TIMEOUT}] にクランプされます。最初の \`await\` より前の同期実行には常に同期実行の watchdog(既定 ${DEFAULT_SYNC_WATCHDOG}ms、timeout 指定時はその値との小さい方)が掛かります。打ち切り後はコンテキストが不整合になり得るため、必要なら \`reset: true\` を使ってください。`,
	"- 既知の制約: `await` の後に始まる同期ループは中断できず、プロセス全体が応答しなくなります。`reset` では回復できません。",
].join("\n");

/** One-line entry in the system prompt's tool list. pi omits a custom tool without it. */
export const TSREPL_PROMPT_SNIPPET =
	"永続 TypeScript REPL。出力をコードで扱う処理と使い捨てのコードに使う";

/**
 * Guideline bullets pi appends to the system prompt's rules while tsrepl is active.
 *
 * Four bullets, one per destination, split by who reads the output: a file goes to read / edit / write,
 * a single start whose output is read as-is stays bash, anything that extracts, aggregates, branches,
 * repeats, or waits is a cell, and Python is not an destination at all. Reading the measured blocks is
 * what moved the split from three bullets to four: the misses happened at the choice before the block,
 * and the missing bullet was the one that points at read / edit / write.
 *
 * The permitted filters of the bash bullet are the same list the guard lets through a short pipe, so
 * the rule the model reads and the verdict it meets are built from one source. pi's own "Use bash for
 * file operations like ls, rg, find" stays in place above these.
 */
export const TSREPL_PROMPT_GUIDELINES: readonly string[] = [
	"ファイルを読むときは read、作成・書き換えるときは edit / write を使う。sed -i、ヒアドキュメント、スクリプトでファイルを書き換えない",
	`bash は 1 回の起動で終わり出力を自分で読むコマンドに使う(&& での連結、${BASH_PIPE_ALLOW_FILTERS.join(" / ")} だけで絞り込むパイプ、sed -n の範囲表示、複数のファイルを引数で渡す形を含む)`,
	"出力をコードで扱う処理(値の抽出・集計・分岐・繰り返し・待機)と使い捨てのコードは tsrepl で TypeScript として書く。bash にシェルの制御構文、awk / jq / xargs、node -e などのインラインコードを書かない。process や Bun が必要で tsrepl に書けないときだけ、一時ディレクトリの .ts を bun で実行してよい",
	"python(python3、pip、uv、pytest を含む)は、対象プロジェクトの実行も含めて一切実行しない。JSON の読み取りと集計は tsrepl、ファイルの書き換えは edit を使う",
];

const parameters = Type.Object({
	code: Type.String({ description: "実行する TypeScript セル" }),
	timeout: Type.Optional(
		Type.Number({
			description: `セル実行の打ち切り(ms)。既定なし、[${MIN_TIMEOUT}, ${MAX_TIMEOUT}] にクランプ。同期実行には ${DEFAULT_SYNC_WATCHDOG}ms の watchdog`,
		}),
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
	/**
	 * Replace the guideline bullets this tool contributes to the system prompt. The `rlm` child
	 * session passes an empty list: a child has no bash, so the bash half of the rule is unusable
	 * there. Drop this override when children get bash.
	 */
	promptGuidelines?: readonly string[];
	/**
	 * Session sink for the per-cell `tsrepl_cell` log. The root session passes it; the `rlm` child
	 * does not (its work is already covered by the root's `rlm_usage`).
	 */
	pi?: Pick<ExtensionAPI, "appendEntry">;
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

export function createTsreplTool(options: CreateTsreplToolOptions = {}): BuiltTool<TsreplParameters, TsreplDetails> {
	const registry = new HostFnRegistry(createBuiltinHostFns());
	for (const entry of options.hostFns ?? []) {
		registry.register(entry);
	}
	const repl = new Repl(registry);
	const devLog = createDevLogger(options.dev);

	// Built through `defineTool()` so the definition keeps its concrete schema here and still travels as
	// one of the host's erased lists, which is where a child session takes it.
	return defineTool({
		name: "tsrepl",
		label: "TypeScript REPL",
		description: buildToolDescription(options.hostFns),
		promptSnippet: TSREPL_PROMPT_SNIPPET,
		promptGuidelines: [...(options.promptGuidelines ?? TSREPL_PROMPT_GUIDELINES)],
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
			// One entry per cell. A failed record never changes the cell result.
			try {
				options.pi?.appendEntry(TSREPL_CELL_ENTRY_TYPE, entryData(result.metrics));
			} catch {
				// The log is measurement, not part of the cell contract.
			}
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
	});
}

/** Copy the measurement into entry data, so later mutation of the cell cannot rewrite the log. */
function entryData(metrics: CellMetrics): CellMetrics {
	return { ...metrics, toolCalls: metrics.toolCalls.map((call) => ({ ...call })) };
}

/** Register the tsrepl tool on a pi extension. */
export function registerTsrepl(pi: ExtensionAPI, options: CreateTsreplToolOptions = {}): void {
	pi.registerTool(createTsreplTool({ ...options, pi }));
}
