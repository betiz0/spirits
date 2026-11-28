/**
 * The `spirits_verify_report_save` tool: the one write path a verification report has.
 *
 * The model passes the final report body and nothing else. Where it goes is decided above the tool:
 * the running verification step says which series (`verify` / `d-verify`) the name takes, and the
 * pinned change says which directory (design Decisions 1 and 12 of the report-saving change). The
 * execution-time guard is what makes "registered ≠ allowed" hold: the active set can also gain this
 * tool through an explicit `--tools` / `defaultTools` selection or a restored session, and a save
 * outside a running verification is then still refused before anything is written.
 */

import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
	TOOL_NAME_VERIFY_REPORT_SAVE,
	VERIFY_REPORT_NOT_VERIFYING_REASON,
	VERIFY_REPORT_UNPINNED_REASON,
} from "../constants.ts";
import type { SaveReportResult } from "./save.ts";

/** One-line entry in the system prompt's tool list. pi omits a custom tool without it. */
const PROMPT_SNIPPET = "検証の最終レポートを対象変更ディレクトリへ連番の新規ファイルとして保存する";

/** Guideline bullets shown while the tool is active, which is only during a verification step. */
const PROMPT_GUIDELINES: readonly string[] = [
	"検証を完了したら、チャットに出力したレポート本文をそのまま spirits_verify_report_save に渡す。渡していない検証は未完了",
	"保存先とファイル名は spirits が決める(検証対象と実行中の検証種別から)。パス・ファイル名・変更名のパラメータは無い",
	"検証が実際に完了していないなら保存せず、その旨を答える。レポートを捏造しない",
];

const parameters = Type.Object({
	body: Type.String({
		description: "検証レポートの全文。出力した本文をそのまま渡す(先頭の markdown 見出しから最後の行まで)",
	}),
});

export type VerifyReportParameters = typeof parameters;

/** What the tool asks the layer around it: the running step, the pinned change, and the save. */
export interface VerifyReportToolDeps {
	/** The report series the running step maps to; undefined when no verifying step is open. */
	activePrefix(): string | undefined;
	/** The change the verification pinned, or undefined while it is still un-pinned. */
	pinned(): string | undefined;
	/** The store the opening line named with `--store`, if any (design Decision 3). */
	storeId(): string | undefined;
	/** Resolve, number, and create the file. */
	save(body: string, changeName: string, prefix: string, storeId?: string): Promise<SaveReportResult>;
	/** Note that this verification's report is on disk, which ends the nudge obligation. */
	onSaved(): void;
}

/** Build the tool definition. Kept apart from registration so the test drives `execute` directly. */
export function createVerifyReportSaveTool(deps: VerifyReportToolDeps) {
	return defineTool({
		name: TOOL_NAME_VERIFY_REPORT_SAVE,
		label: "Verify report save",
		description:
			"検証ステップの最終レポートを、検証対象の変更ディレクトリへ連番の新規ファイルとして保存する。" +
			"引数はレポート本文だけ。保存先・ファイル名・対象変更は spirits が決める(実行中の検証ステップと、ユーザー入力から固定された検証対象)。" +
			"既存ファイルは上書きしない。検証が未完了なら保存せず、その旨を答えること。",
		promptSnippet: PROMPT_SNIPPET,
		promptGuidelines: [...PROMPT_GUIDELINES],
		parameters,
		exposure: "direct",
		// Registered on every load, declared to the model only while a verification step is open
		// (`verify/register.ts` adds it to the active set and takes it back).
		defaultActive: false,
		async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
			const prefix = deps.activePrefix();
			if (prefix === undefined) return refuse(VERIFY_REPORT_NOT_VERIFYING_REASON);
			const changeName = deps.pinned();
			if (changeName === undefined) return refuse(VERIFY_REPORT_UNPINNED_REASON);
			const result = await deps.save(params.body, changeName, prefix, deps.storeId());
			if (result.kind === "error") return refuse(result.reason);
			deps.onSaved();
			return {
				content: [{ type: "text", text: `saved: ${result.path}` }],
				details: { path: result.path, changeName, prefix },
			};
		},
	});
}

/** The one result shape every refusal takes. */
function refuse(reason: string): AgentToolResult<unknown> {
	return { content: [{ type: "text", text: reason }], details: { reason }, isError: true };
}
