/**
 * Repository scan (design decisions 5, 9, 10, 11).
 *
 * The scan target is the `rootFiles` of the root `tsconfig.json` and
 * `packages/spirits/tsconfig.json` (when present), minus `.d.ts` and `.json` files.
 * The TypeScript analyzer is the async API (`typescript/unstable/async`), which works
 * on Bun 1.4.2 where the sync API fails.
 *
 * The scan extracts, per file: the dependency edges (classified as value or type per
 * decision 11) and the duplication-measurement nodes (decision 7). It does not resolve
 * specifiers; resolution happens in the check so that edge classification can be
 * tested without it.
 */
import { existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { API } from "typescript/unstable/async";
import { SyntaxKind } from "typescript/unstable/ast";
import type { Node, SourceFile } from "typescript/unstable/ast";
import {
	isArrowFunction,
	isCallExpression,
	isExportDeclaration,
	isFunctionDeclaration,
	isFunctionExpression,
	isImportDeclaration,
	isImportTypeNode,
	isLiteralTypeNode,
	isMethodDeclaration,
	isNoSubstitutionTemplateLiteral,
	isStringLiteral,
	isVariableDeclaration,
} from "typescript/unstable/ast/is";

export interface Edge {
	/** Absolute path of the importing file. */
	from: string;
	/** The module specifier as written. */
	specifier: string;
	/** Value or type dependency (decision 11). */
	type: "value" | "type";
}

export interface DupNode {
	/** Absolute path of the containing file. */
	file: string;
	/** 1-based line where the node starts. */
	line: number;
	/** Whitespace-normalized body text. */
	text: string;
}

export interface ScanResult {
	/** All scanned files, absolute paths, sorted. */
	files: string[];
	edges: Edge[];
	dupNodes: DupNode[];
	/** The root tsconfig's `paths`, for internal specifier resolution. */
	rootPaths: Record<string, readonly string[]> | undefined;
	/** Set when the scan itself failed (analyzer startup, unusable tsconfig, zero files). */
	error?: string;
}

/** Minimal structural view of the TS async API used by the scan. */
export interface AnalyzerProject {
	readonly rootFiles: readonly string[];
	readonly compilerOptions: { paths?: Record<string, readonly string[]> };
	readonly program: {
		getSourceFile(file: string): Promise<SourceFile | undefined>;
		getConfigFileParsingDiagnostics(): Promise<readonly { category: number; text?: string }[]>;
	};
}

export interface AnalyzerSnapshot {
	getProject(configFileName: string): AnalyzerProject | undefined;
}

export interface Analyzer {
	updateSnapshot(params: { openProjects: string[] }): Promise<AnalyzerSnapshot>;
	close(): Promise<void>;
}

/**
 * The analyzer launch function is injectable so tests can reproduce an analyzer
 * startup failure (decision 13).
 */
export type LaunchAnalyzer = (options?: { cwd?: string }) => Promise<Analyzer>;

export const defaultLaunch: LaunchAnalyzer = async (options) => {
	const api = new API({ cwd: options?.cwd });
	return {
		updateSnapshot: (params) => api.updateSnapshot(params),
		close: () => api.close(),
	};
};

function specifierText(node: Node | undefined): string | undefined {
	if (node && (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node))) return node.text;
	return undefined;
}

/** The analyzer's own "no inputs" diagnostic: a tsconfig that matched no files is a
 * zero-file scan, not an unusable config. */
function isNoInputsDiagnostic(diagnostic: { code?: number; text?: string }): boolean {
	return diagnostic.code === 18003 || (diagnostic.text ?? "").startsWith("No inputs were found");
}

/**
 * `import type` is marked on the import clause; the runtime objects carry the flag even
 * though the generated type declarations do not.
 */
function importClauseIsTypeOnly(clause: Node | undefined): boolean {
	if (!clause) return false;
	const record = clause as { isTypeOnly?: unknown; namedBindings?: { isTypeOnly?: unknown } | undefined };
	return record.isTypeOnly === true || record.namedBindings?.isTypeOnly === true;
}

/**
 * Scan the repository at `repoRoot`. Opens the root tsconfig and (when present)
 * `packages/spirits/tsconfig.json` in one analyzer session, then walks every file.
 */
export async function scanRepository(repoRoot: string, launch: LaunchAnalyzer = defaultLaunch): Promise<ScanResult> {
	const rootConfigPath = join(repoRoot, "tsconfig.json");
	const spiritsConfigPath = join(repoRoot, "packages", "spirits", "tsconfig.json");
	const configPaths = [rootConfigPath, spiritsConfigPath].filter((path) => existsSync(path) && statSync(path).isFile());

	let analyzer: Analyzer;
	try {
		analyzer = await launch({ cwd: repoRoot });
	} catch (error) {
		return { files: [], edges: [], dupNodes: [], rootPaths: undefined, error: `SCANNER: analyzer failed to start: ${(error as Error).message}` };
	}

	try {
		const snapshot = await analyzer.updateSnapshot({ openProjects: configPaths });
		const projects = new Map<string, AnalyzerProject>();
		for (const configPath of configPaths) {
			const project = snapshot.getProject(configPath);
			if (project) projects.set(configPath, project);
		}

		for (const [configPath, project] of projects) {
			const diagnostics = await project.program.getConfigFileParsingDiagnostics();
			const errors = diagnostics.filter((diagnostic) => diagnostic.category === 1 && !isNoInputsDiagnostic(diagnostic));
			if (errors.length > 0) {
				return {
					files: [],
					edges: [],
					dupNodes: [],
					rootPaths: undefined,
					error: `SCANNER: unusable tsconfig at ${relative(repoRoot, configPath)}: ${errors[0]?.text ?? "parse error"}`,
				};
			}
		}

		const fileSet = new Set<string>();
		for (const project of projects.values()) {
			for (const file of project.rootFiles) {
				if (!file.endsWith(".d.ts") && !file.endsWith(".json")) fileSet.add(file);
			}
		}
		const files = [...fileSet].sort();
		if (files.length === 0) {
			return { files: [], edges: [], dupNodes: [], rootPaths: undefined, error: "SCANNER: no files were scanned" };
		}

		const rootPaths = projects.get(rootConfigPath)?.compilerOptions.paths;
		const edges: Edge[] = [];
		const dupNodes: DupNode[] = [];

		for (const file of files) {
			const configPath = file.includes(`${join("packages", "spirits")}`) ? spiritsConfigPath : rootConfigPath;
			const project = projects.get(configPath) ?? projects.get(rootConfigPath);
			if (!project) continue;
			const sourceFile = await project.program.getSourceFile(file);
			if (!sourceFile) continue;
			collectFromFile(file, sourceFile, edges, dupNodes);
		}

		return { files, edges, dupNodes, rootPaths };
	} catch (error) {
		return { files: [], edges: [], dupNodes: [], rootPaths: undefined, error: `SCANNER: scan failed: ${(error as Error).message}` };
	} finally {
		await analyzer.close();
	}
}

function collectFromFile(file: string, sourceFile: SourceFile, edges: Edge[], dupNodes: DupNode[]): void {
	const pushEdge = (specifier: string, type: "value" | "type") => {
		edges.push({ from: file, specifier, type });
	};

	const collectNode = (node: Node): void => {
		const text = node.getText(sourceFile);
		const normalized = text.replace(/\s+/g, " ").trim();
		if (normalized.length < 60) return;
		const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
		const endLine = sourceFile.getLineAndCharacterOfPosition(node.end).line;
		if (endLine - startLine + 1 < 10) return;
		dupNodes.push({ file, line: startLine + 1, text: normalized });
	};

	const visit = (node: Node): void => {
		if (isImportDeclaration(node)) {
			const specifier = specifierText(node.moduleSpecifier);
			if (specifier !== undefined) {
				const isType = importClauseIsTypeOnly(node.importClause);
				pushEdge(specifier, isType ? "type" : "value");
			}
		} else if (isExportDeclaration(node)) {
			const specifier = specifierText(node.moduleSpecifier);
			if (specifier !== undefined) {
				pushEdge(specifier, node.isTypeOnly ? "type" : "value");
			}
		} else if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
			const specifier = specifierText(node.arguments[0]);
			if (specifier !== undefined) pushEdge(specifier, "value");
		} else if (isImportTypeNode(node) && isLiteralTypeNode(node.argument)) {
			const specifier = specifierText(node.argument.literal);
			if (specifier !== undefined) pushEdge(specifier, "type");
		}

		if (
			isFunctionDeclaration(node) ||
			isMethodDeclaration(node) ||
			isFunctionExpression(node) ||
			isArrowFunction(node)
		) {
			const body = node.body;
			if (body) collectNode(body);
		}
		if (isVariableDeclaration(node) && node.initializer) {
			collectNode(node.initializer);
		}

		node.forEachChild(visit);
	};

	visit(sourceFile);
}
