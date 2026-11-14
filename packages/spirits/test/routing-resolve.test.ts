import { expect, test } from "bun:test";
import { PI_VIRTUAL_MODEL_API } from "../src/constants.ts";
import type { ModelLookup } from "../src/routing/resolve.ts";
import { resolveNormalTarget, resolveStrongTarget } from "../src/routing/resolve.ts";
import type { PiModel } from "@earendil-works/pi-coding-agent";

const SONNET: PiModel = { provider: "anthropic", id: "claude-sonnet-4-5" };
const OPUS: PiModel = { provider: "anthropic", id: "claude-opus-4-7" };
const LUNA: PiModel = { provider: "openai", id: "gpt-5.6-luna" };
/** The routing model itself, which pi lists as available without any credentials. */
const AUTO: PiModel = { provider: "spirits", id: "auto", api: PI_VIRTUAL_MODEL_API };

/** Catalog whose listing and credentials are set apart, so both failure modes are reachable. */
function fakeLookup(options: { available: readonly PiModel[]; authedProviders?: readonly string[] }): ModelLookup {
	const authed = new Set(options.authedProviders ?? []);
	return {
		getAvailable: () => [...options.available],
		hasConfiguredAuth: (model) => authed.has(model.provider),
	};
}

const CATALOG = fakeLookup({ available: [SONNET, OPUS, LUNA], authedProviders: ["anthropic", "openai"] });

test("resolves the default model as normal", () => {
	const target = resolveNormalTarget({
		lookup: CATALOG,
		defaultProvider: "anthropic",
		defaultModelId: "claude-sonnet-4-5",
	});

	expect(target).toEqual({ model: SONNET, source: "default", fellFromSpec: false });
});

// spec "dual-model-routing / normal の対象": `models.normal` が既定モデルより先に来る。`provider/id` と
// 素の id の Both 形、および設定済みだが使えない場合の落ち方をここで pins する。
test("resolves the configured normal target", () => {
	expect(
		resolveNormalTarget({
			lookup: CATALOG,
			spec: { provider: "openai", modelId: "gpt-5.6-luna" },
			defaultProvider: "anthropic",
			defaultModelId: "claude-sonnet-4-5",
		}),
	).toEqual({ model: LUNA, source: "spec", fellFromSpec: false });

	// A bare id resolves against the default provider, the same way a strong target does.
	expect(
		resolveNormalTarget({
			lookup: CATALOG,
			spec: { modelId: "gpt-5.6-luna" },
			defaultProvider: "openai",
			defaultModelId: "claude-sonnet-4-5",
		}),
	).toEqual({ model: LUNA, source: "spec", fellFromSpec: false });

	// A configured target pi cannot answer with is unusable rather than absent: the default model takes
	// the request and reports that it did not come from the setting.
	expect(
		resolveNormalTarget({
			lookup: CATALOG,
			spec: { provider: "google", modelId: "gemini" },
			defaultProvider: "anthropic",
			defaultModelId: "claude-sonnet-4-5",
		}),
	).toEqual({ model: SONNET, source: "default", fellFromSpec: true });

	// The routing entry itself is never a target, so a setting that names it falls through.
	const withAuto = fakeLookup({ available: [AUTO, SONNET], authedProviders: ["anthropic", "spirits"] });
	expect(
		resolveNormalTarget({
			lookup: withAuto,
			spec: { provider: "spirits", modelId: "auto" },
			defaultProvider: "anthropic",
			defaultModelId: "claude-sonnet-4-5",
		}),
	).toEqual({ model: SONNET, source: "default", fellFromSpec: true });
});

test("falls back to the previous model when the default is unresolvable", () => {
	const target = resolveNormalTarget({
		lookup: CATALOG,
		defaultProvider: "anthropic",
		defaultModelId: "claude-haiku-4-5",
		previous: { model: LUNA },
	});

	expect(target).toEqual({ model: LUNA, source: "previous", fellFromSpec: false });
});

test("skips a virtual default and falls back to the previous model", () => {
	const catalog = fakeLookup({ available: [AUTO, SONNET], authedProviders: ["anthropic", "spirits"] });

	const target = resolveNormalTarget({
		lookup: catalog,
		defaultProvider: "spirits",
		defaultModelId: "auto",
		previous: { model: SONNET },
	});

	expect(target).toEqual({ model: SONNET, source: "previous", fellFromSpec: false });
	// Without a previous response there is nothing physical left to route to.
	expect(
		resolveNormalTarget({ lookup: catalog, defaultProvider: "spirits", defaultModelId: "auto" }),
	).toBeUndefined();
});

test("leaves normal unresolved without a default or a previous model", () => {
	expect(resolveNormalTarget({ lookup: CATALOG })).toBeUndefined();
	expect(resolveNormalTarget({ lookup: CATALOG, defaultProvider: "anthropic" })).toBeUndefined();
	expect(resolveNormalTarget({ lookup: CATALOG, defaultModelId: "claude-sonnet-4-5" })).toBeUndefined();
	// A default that is not in the catalog is as good as unset when there is no previous response.
	expect(resolveNormalTarget({ lookup: CATALOG, defaultProvider: "google", defaultModelId: "gemini" })).toBeUndefined();
});

test("resolves a bare strong id against the default provider", () => {
	expect(resolveStrongTarget({ lookup: CATALOG, spec: { modelId: "claude-opus-4-7" }, defaultProvider: "anthropic" })).toBe(
		OPUS,
	);
	expect(resolveStrongTarget({ lookup: CATALOG, spec: { provider: "openai", modelId: "gpt-5.6-luna" } })).toBe(LUNA);
	// The spec's provider wins, so the same id under another provider is not a match.
	expect(
		resolveStrongTarget({ lookup: CATALOG, spec: { provider: "openai", modelId: "claude-opus-4-7" } }),
	).toBeUndefined();
	// A bare id with no default provider has nothing to resolve against.
	expect(resolveStrongTarget({ lookup: CATALOG, spec: { modelId: "claude-opus-4-7" } })).toBeUndefined();
});

test("leaves strong unresolved when it names a virtual model", () => {
	const catalog = fakeLookup({ available: [AUTO, OPUS], authedProviders: ["anthropic", "spirits"] });

	expect(resolveStrongTarget({ lookup: catalog, spec: { provider: "spirits", modelId: "auto" } })).toBeUndefined();
	// A bare id reaches the same virtual entry through the default provider.
	expect(resolveStrongTarget({ lookup: catalog, spec: { modelId: "auto" }, defaultProvider: "spirits" })).toBeUndefined();
});

test("leaves strong unresolved when the provider has no credentials", () => {
	const noCredentials = fakeLookup({ available: [OPUS] });

	expect(resolveStrongTarget({ lookup: noCredentials, spec: { provider: "anthropic", modelId: "claude-opus-4-7" } })).toBeUndefined();
	// Not being in the catalog is unresolved even when the provider is configured.
	expect(
		resolveStrongTarget({
			lookup: fakeLookup({ available: [SONNET], authedProviders: ["anthropic"] }),
			spec: { provider: "anthropic", modelId: "claude-opus-4-7" },
		}),
	).toBeUndefined();
});
