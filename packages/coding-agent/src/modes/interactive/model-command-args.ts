import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { type Api, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai/compat";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { THINKING_LEVEL_OPTIONS } from "../../core/defaults.ts";
import { findExactModelReferenceMatch } from "../../core/model-resolver.ts";

export interface ModelCommandArgs {
	searchTerm?: string;
	thinkingLevel?: ThinkingLevel;
	/** Role taken from the last argument, in the registered vocabulary's spelling. */
	role?: string;
}

/**
 * The registered name a trailing word matches, case-insensitively. Requires two or more words so a
 * single word stays the model search term: `/model normal` searches for a model named `normal`.
 */
function matchTrailingWord<TName extends string>(words: readonly string[], names: readonly TName[]): TName | undefined {
	if (words.length < 2) {
		return undefined;
	}
	const trailing = words[words.length - 1].toLowerCase();
	return names.find((name) => name.toLowerCase() === trailing);
}

/**
 * Split `/model` arguments into a model search term, an optional thinking level, and an optional
 * role. Words are taken from the end in that order, so a level and a role together are written
 * `/model <term> <level> <role>`. Only a trailing word that names a role or a thinking level is
 * taken, and the two vocabularies never overlap. Everything left over is the search term, which keeps
 * multi-word searches like `/model claude sonnet` working, and an unknown trailing word such as
 * `invalidrole` is a search word rather than an error.
 *
 * Role names come from the extension that registered them (`pi.registerModelRoles()`); with no
 * vocabulary no role is taken. pi compares them and hands the registered spelling along, and never
 * interprets what a role means.
 */
export function parseModelCommandArgs(args: string, roles: readonly string[] = []): ModelCommandArgs {
	const trimmed = args.trim();
	if (!trimmed) {
		return {};
	}

	const words = trimmed.split(/\s+/);
	const role = matchTrailingWord(words, roles);
	const withoutRole = role ? words.slice(0, -1) : words;
	const thinkingLevel = matchTrailingWord(withoutRole, THINKING_LEVEL_OPTIONS);
	const searchTerm = (thinkingLevel ? withoutRole.slice(0, -1) : withoutRole).join(" ");

	return {
		searchTerm,
		...(thinkingLevel ? { thinkingLevel } : {}),
		...(role ? { role } : {}),
	};
}

/**
 * Build second-argument completions for `/model` when the first word exactly matches an available
 * model: the thinking levels that model supports, plus the role names an extension registered.
 * Returns null when the first word is not an exact match (or there is no word separator yet) so the
 * caller can fall back to fuzzy model completion. Completion values keep the model reference so
 * confirming replaces only the second word.
 */
export function getThinkingLevelArgumentCompletions(
	args: string,
	availableModels: readonly Model<Api>[],
	roles: readonly string[] = [],
): AutocompleteItem[] | null {
	// Search the raw input so a trailing word separator is preserved.
	const lastSpaceIndex = args.lastIndexOf(" ");
	if (lastSpaceIndex === -1) {
		return null;
	}

	const firstWord = args.slice(0, lastSpaceIndex);
	const lastWord = args.slice(lastSpaceIndex + 1).toLowerCase();
	const model = findExactModelReferenceMatch(firstWord, [...availableModels]);
	if (!model) {
		return null;
	}

	const supportedLevels = getSupportedThinkingLevels(model) as ThinkingLevel[];
	const matches: readonly string[] = [
		...supportedLevels.filter((level) => level.toLowerCase().startsWith(lastWord)),
		...roles.filter((role) => role.toLowerCase().startsWith(lastWord)),
	];
	if (matches.length === 0) {
		return null;
	}

	return matches.map((name) => ({
		value: `${firstWord} ${name}`,
		label: name,
	}));
}
