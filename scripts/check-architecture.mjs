import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The Web workspace retains the JavaScript compiler API; root TypeScript uses the native compiler.
const ts = createRequire(new URL("../web/package.json", import.meta.url))(
	"typescript",
);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const slash = (path) => path.replaceAll("\\", "/");
const moduleOf = (path) => path.match(/^backend\/src\/modules\/([^/]+)\//)?.[1];
const featureOf = (path) => path.match(/^web\/src\/features\/([^/]+)\//)?.[1];

/** Applied to resolved paths, so relative spelling and aliases cannot evade rules. */
export function boundaryViolation(from, to, specifier = to) {
	if (
		from.startsWith("web/") &&
		specifier.startsWith("@anishelf/backend") &&
		![
			"@anishelf/backend/contracts/http",
			"@anishelf/backend/contracts/subtitles",
			"@anishelf/backend/contracts/defaults",
		].includes(specifier)
	)
		return "Web may import only explicit browser-safe package exports";
	if (
		from.startsWith("backend/src/contracts/") &&
		specifier.startsWith("node:")
	)
		return "Browser contracts cannot import Node.js built-ins";
	if (
		from.includes("/http/") &&
		from.startsWith("backend/src/modules/") &&
		(to.startsWith("backend/src/platform/") ||
			[
				"node:fs",
				"node:fs/promises",
				"node:child_process",
				"better-sqlite3",
			].includes(specifier) ||
			specifier.startsWith("drizzle-orm"))
	)
		return "HTTP must not access infrastructure directly";
	const owner = moduleOf(from);
	const dependency = moduleOf(to);
	if (
		from.startsWith("web/") &&
		to.startsWith("backend/src/") &&
		!to.startsWith("backend/src/contracts/")
	)
		return "Web may import only browser-safe backend contracts";
	if (
		from.startsWith("backend/src/contracts/") &&
		to.startsWith("backend/src/") &&
		!to.startsWith("backend/src/contracts/")
	)
		return "Browser contracts must not depend on backend implementations";
	if (
		dependency &&
		owner !== dependency &&
		!from.startsWith("backend/src/bootstrap/") &&
		!to.endsWith(`/modules/${dependency}/public.ts`)
	)
		return "Cross-module imports must use public.ts";
	if (owner && to.startsWith("backend/src/bootstrap/"))
		return "Business modules must not import bootstrap";
	if (
		owner &&
		from.includes("/http/") &&
		dependency &&
		!(owner === dependency && to.includes("/application/"))
	)
		return "HTTP business calls must enter the owning Application";
	if (
		owner &&
		from.includes("/application/") &&
		(to.includes("/http/") ||
			to.startsWith("backend/src/transport/") ||
			specifier === "fastify" ||
			specifier.startsWith("@fastify/"))
	)
		return "Application must be independent of HTTP";
	if (
		owner &&
		from.includes("/domain/") &&
		((owner === dependency &&
			/\/(application|infrastructure|http)\//.test(to)) ||
			to.startsWith("backend/src/platform/") ||
			to.startsWith("backend/src/transport/") ||
			specifier === "fastify" ||
			specifier.startsWith("@fastify/") ||
			specifier.startsWith("drizzle-orm") ||
			specifier === "better-sqlite3")
	)
		return "Domain must not depend on application or concrete adapters";
	if (
		owner &&
		from.includes("/infrastructure/") &&
		(to.includes("/http/") ||
			(owner === dependency && to.includes("/application/")) ||
			to.startsWith("backend/src/transport/"))
	)
		return "Infrastructure must not depend on application or HTTP";
	if (
		from.startsWith("backend/src/transport/") &&
		dependency &&
		specifier &&
		!to.endsWith("/public.ts")
	)
		return "Shared transport helpers may use public business types only";
	const feature = featureOf(from),
		target = featureOf(to);
	if (
		feature &&
		target &&
		feature !== target &&
		!to.endsWith(`/features/${target}/public.ts`)
	)
		return "Cross-feature imports must use public.ts";
	return null;
}

export function findCycles(edges) {
	const graph = new Map();
	for (const [from, to] of edges) {
		if (!graph.has(from)) graph.set(from, new Set());
		graph.get(from).add(to);
	}
	const visited = new Set(),
		active = new Set(),
		stack = [],
		cycles = [];
	function visit(node) {
		if (active.has(node)) {
			cycles.push([...stack.slice(stack.indexOf(node)), node]);
			return;
		}
		if (visited.has(node)) return;
		active.add(node);
		stack.push(node);
		for (const next of graph.get(node) ?? []) visit(next);
		stack.pop();
		active.delete(node);
		visited.add(node);
	}
	for (const node of graph.keys()) visit(node);
	return cycles;
}

function files(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory()
			? files(path)
			: /\.tsx?$/.test(path)
				? [path]
				: [];
	});
}
export function importSpecifiers(source, name = "fixture.ts") {
	const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
	const imports = [];
	function visit(node) {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		)
			imports.push(node.moduleSpecifier.text);
		if (
			ts.isImportTypeNode(node) &&
			ts.isLiteralTypeNode(node.argument) &&
			ts.isStringLiteral(node.argument.literal)
		)
			imports.push(node.argument.literal.text);
		if (
			ts.isCallExpression(node) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(node.expression) &&
					node.expression.text === "require")) &&
			node.arguments[0] &&
			ts.isStringLiteral(node.arguments[0])
		)
			imports.push(node.arguments[0].text);
		ts.forEachChild(node, visit);
	}
	visit(ast);
	return imports;
}

export function checkArchitecture() {
	const errors = [],
		moduleEdges = [],
		featureEdges = [];
	const configurations = new Map(
		["backend/tsconfig.json", "web/tsconfig.app.json"].map((name) => {
			const path = resolve(root, name);
			const config = ts.readConfigFile(path, ts.sys.readFile);
			if (config.error) throw new Error(`Cannot read ${name}`);
			const parsed = ts.parseJsonConfigFileContent(
				config.config,
				ts.sys,
				dirname(path),
			);
			return [name.split("/")[0], parsed.options];
		}),
	);

	const paths = [
		...files(resolve(root, "backend/src")),
		...files(resolve(root, "web/src")),
	];
	for (const path of paths) {
		const from = slash(relative(root, path));
		const options = configurations.get(from.split("/")[0]);
		for (const specifier of importSpecifiers(
			readFileSync(path, "utf8"),
			path,
		)) {
			const resolved = ts.resolveModuleName(specifier, path, options, ts.sys)
				.resolvedModule?.resolvedFileName;
			const to = resolved ? slash(relative(root, resolved)) : specifier;
			const violation = boundaryViolation(from, to, specifier);
			if (violation) errors.push(`${from} -> ${specifier}: ${violation}`);
			const owner = moduleOf(from),
				dependency = moduleOf(to);
			if (owner && dependency && owner !== dependency)
				moduleEdges.push([owner, dependency]);
			const feature = featureOf(from),
				target = featureOf(to);
			if (feature && target && feature !== target)
				featureEdges.push([feature, target]);
		}
	}
	for (const cycle of findCycles(moduleEdges))
		errors.push(`Business module cycle: ${cycle.join(" -> ")}`);
	for (const cycle of findCycles(featureEdges))
		errors.push(`Frontend feature cycle: ${cycle.join(" -> ")}`);
	return { errors, count: paths.length };
}
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const { errors, count } = checkArchitecture();
	if (errors.length) {
		process.stderr.write(`${errors.join("\n")}\n`);
		process.exitCode = 1;
	} else
		process.stdout.write(
			`Architecture boundaries passed (${count} source files).\n`,
		);
}
