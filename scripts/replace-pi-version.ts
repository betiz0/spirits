/**
 * Pure replacement of pi's `VERSION` declaration for the single-file binary build.
 *
 * The compiled executable has no sibling `package.json`, so pi would otherwise read `VERSION` as
 * `0.0.0`. The build rewrites the declaration to a literal before bundling. Missing the
 * declaration must fail the build instead of shipping `0.0.0`.
 */

/** Exact declaration in `packages/coding-agent/src/config.ts`. */
const VERSION_DECLARATION = 'export const VERSION: string = pkg.version || "0.0.0";';

/**
 * Rewrite the pi `VERSION` declaration in `configSource` to the literal `piVersion`.
 *
 * Throws when the declaration is absent, so a pi update that changes `config.ts` is caught at
 * build time.
 */
export function replacePiVersion(configSource: string, piVersion: string): string {
	if (!configSource.includes(VERSION_DECLARATION)) {
		throw new Error(
			`pi VERSION declaration not found. Update VERSION_DECLARATION in scripts/replace-pi-version.ts: ${VERSION_DECLARATION}`,
		);
	}
	return configSource.replace(VERSION_DECLARATION, `export const VERSION: string = ${JSON.stringify(piVersion)};`);
}
