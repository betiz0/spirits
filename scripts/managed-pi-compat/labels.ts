/** Labels that keep fake-provider and probe successes from being mistaken for real compatibility. */

/** Success label for a fake-provider transport check. */
export interface CompatibilitySuccessLabel {
	scope: "fake-provider";
	realProviderCompatibility: false;
}

/** Build the fake-provider success label. */
export function fakeProviderSuccess(): CompatibilitySuccessLabel {
	return { scope: "fake-provider", realProviderCompatibility: false };
}
