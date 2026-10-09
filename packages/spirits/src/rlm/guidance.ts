/**
 * Model-facing guidance for the `rlm` host function.
 *
 * The text is returned as the `HostFnEntry.description` and composed into the tsrepl tool
 * description, so the model reads it next to the functions it calls. Numbers come from
 * `depth.ts` to keep the limits in one place.
 */

import { RLM_MAX_TOOL_CALLS } from "./depth.ts";

export interface RlmGuidanceOptions {
	/** Closing session depth (root is 0). */
	depth: number;
	/** Depth limit applied to this session. */
	maxDepth: number;
}

/** Build the `rlm` guidance for a session at `depth` with `maxDepth`. */
export function buildRlmGuidance({ depth, maxDepth }: RlmGuidanceOptions): string {
	const sections: string[] = [];

	if (depth >= 1) {
		sections.push(
			[
				"## 子エージェントとしての立場",
				"- あなたは親エージェントが `rlm` で起動した子です。",
				"- 最終アシスタントメッセージのテキストが、親へ文字列として返ります。",
			].join("\n"),
		);
	}

	if (depth >= maxDepth) {
		sections.push(
			[
				"## rlm: 子エージェントへの委譲",
				`- 深度上限（${maxDepth}）に達しているため、このセッションから \`rlm\` を呼ぶことはできません。`,
				"- 問題を分割せず、現在の層で直接処理してください。",
			].join("\n"),
		);
		return sections.join("\n\n");
	}

	sections.push(
		[
			"## rlm: 子エージェントへの委譲",
			"- `await rlm(prompt)` は子エージェントを同期的に起動し、最終回答の文字列を返します。`rlm` は最初から使えます。",
			'- 子は親の REPL 変数を見られません。必要な情報は prompt か、cwd 配下のファイルで渡してください。子のツールは `tsrepl` だけで、ファイル操作は `use("node:fs")` で行います。',
			"- 結果が長い場合は、子にファイルへ書かせ、パスだけを返させてください。",
			"- 文脈量の多い調査や独立した実装は委譲し、単発で既知の検索・編集・コマンドは自分で実行してください。",
			"- 呼び出しは直列に実行され（Promise.all でも 1 つずつ）、待ち時間は合計されます。セルの timeout が子の実行時間にも適用されるため、`timeout` を大きく指定してください（最大 120000ms）。",
			`- 再帰の深度上限は ${maxDepth}、現在の深度は ${depth} です。上限に達した層で呼ぶと例外になるので、その層で直接処理してください。\`rlm(prompt, { maxDepth })\` の \`maxDepth\` はルートからの絶対深度で、子孫の上限を下げられます（上げることはできません）。`,
			`- 子のツール呼び出しが ${RLM_MAX_TOOL_CALLS} 回を超えると打ち切られ、途中結果が返ります。`,
		].join("\n"),
	);

	return sections.join("\n\n");
}
