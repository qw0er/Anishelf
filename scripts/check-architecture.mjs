import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { cruise } from "dependency-cruiser";

const require = createRequire(import.meta.url);
const rules = require("../.dependency-cruiser.cjs");

async function checkArchitecture() {
	const result = await cruise(
		["backend/src", "web/src"],
		{
			...rules.options,
			baseDir: process.cwd(),
			ruleSet: rules,
			validate: true,
			outputType: "json",
		},
		{ bustTheCache: true },
	);
	const graph = JSON.parse(result.output);
	if ((graph.summary.environment.issues ?? []).length > 0)
		throw new Error(JSON.stringify(graph.summary.environment.issues));
	if (
		!graph.modules.some((module) => module.source.startsWith("backend/src/")) ||
		!graph.modules.some((module) => module.source.startsWith("web/src/"))
	)
		throw new Error(
			"Architecture scan must include both TypeScript workspaces.",
		);
	return graph;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const graph = await checkArchitecture();
	if (process.argv.includes("--json")) {
		console.log(JSON.stringify(graph.summary));
	} else {
		for (const violation of graph.summary.violations)
			console.error(
				`${violation.rule.name}: ${violation.from} -> ${violation.to}`,
			);
		console.log(
			`Checked ${graph.summary.totalCruised} modules and ${graph.summary.totalDependenciesCruised} dependencies.`,
		);
	}
	process.exitCode = graph.summary.error > 0 ? 1 : 0;
}
