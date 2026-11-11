/**
 * The reason a blocked bash call reports.
 *
 * Three things and nothing else: the category ids, one line of tsrepl per category that the command
 * should have been, and the fact that the operator — not the model — can switch the mode off through
 * `SPIRITS_ACTION_GUARD`. The command text never comes back: the model just wrote it, and the reason
 * is copied into the transcript.
 */

import { ENV_ACTION_GUARD, GUARD_CATEGORY_GUIDANCE, type GuardCategoryId } from "../constants.ts";

/** How the guard is turned off, stated once at the end of every reason. */
const MODE_NOTE = `このガードは利用者が環境変数 ${ENV_ACTION_GUARD}=warn(記録だけ)または off で切り替えます。`;

/** The shortest form of a bash call from inside a cell, named so the example reads as reachable. */
const CELL_NOTE = "同じ処理は tsrepl のセルに書いてください(bash を呼ぶ最短形は `sh(command)`)。";

/**
 * Build the block reason for the categories one command hit.
 *
 * Takes only the category ids, so there is no path by which command text reaches the model through
 * this function.
 */
export function blockReason(categories: readonly GuardCategoryId[]): string {
	const lines = categories.map((id) => {
		const guidance = GUARD_CATEGORY_GUIDANCE[id];
		return `- ${id}: ${guidance.description} 書き換え例: ${guidance.example}`;
	});
	return [`bash ガード: このコマンドは実行しません（該当分類 ${categories.join(", ")}）。`, ...lines, CELL_NOTE, MODE_NOTE].join(
		"\n",
	);
}
