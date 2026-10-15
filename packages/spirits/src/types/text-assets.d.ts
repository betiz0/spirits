/**
 * Ambient declarations for Bun text-asset imports.
 *
 * The bundled skill Markdown is imported with `with { type: "text" }` and inlined as a
 * string by `Bun.build`; TypeScript needs a module declaration for the `.md` specifier.
 */

declare module "*.md" {
	const content: string;
	export default content;
}
