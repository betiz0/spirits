import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { type Api, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai/compat";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { THINKING_LEVEL_OPTIONS } from "../../core/defaults.ts";
import { findExactModelReferenceMatch } from "../../core/model-resolver.ts";

export interface ModelCommandArgs {
	searchTerm?: string;
	thinkingLevel?: ThinkingLevel;
}

/**
 * Split `/model` arguments into a model search term and an optional thinking level.
 * Only a trailing word that names a thinking level (case-insensitive) is treated as
 * the level; everything before it stays the search term. This keeps multi-word
 * searches like `/model claude sonnet` working while allowing `/model <provider/model> <level>`.
 */
export function parseModelCommandArgs(args: string): ModelCommandArgs {
	const trimmed = args.trim();
	if (!trimmed) {
		return {};
	}

	const words = trimmed.split(/\s+/);
	const lastWord = words[words.length - 1];
	const thinkingLevel = THINKING_LEVEL_OPTIONS.find((option) => option.toLowerCase() === lastWord.toLowerCase());

	if (words.length >= 2 && thinkingLevel) {
		return {
			searchTerm: words.slice(0, -1).join(" "),
			thinkingLevel,
		};
	}

	return { searchTerm: trimmed };
}

/**
 * Build second-argument thinking level completions for `/model` when the first word
 * exactly matches an available model. Returns null when the first word is not an exact
 * match (or there is no word separator yet) so the caller can fall back to fuzzy model
 * completion. Completion values keep the model reference so confirming replaces only
 * the second word.
 */
export function getThinkingLevelArgumentCompletions(
	args: string,
	availableModels: readonly Model<Api>[],
): AutocompleteItem[] | null {
	// Search the raw input so a trailing word separator is preserved.
	const lastSpaceIndex = args.lastIndexOf(" ");
	if (lastSpaceIndex === -1) {
		return null;
	}

	const firstWord = args.slice(0, lastSpaceIndex);
	const lastWord = args.slice(lastSpaceIndex + 1);
	const model = findExactModelReferenceMatch(firstWord, [...availableModels]);
	if (!model) {
		return null;
	}

	const supportedLevels = getSupportedThinkingLevels(model) as ThinkingLevel[];
	const matches = supportedLevels.filter((level) => level.toLowerCase().startsWith(lastWord.toLowerCase()));
	if (matches.length === 0) {
		return null;
	}

	return matches.map((level) => ({
		value: `${firstWord} ${level}`,
		label: level,
	}));
}
