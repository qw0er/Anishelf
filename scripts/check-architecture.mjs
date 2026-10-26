import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise } from "dependency-cruiser";

const require = createRequire(import.meta.url);
const rules = require("../.dependency-cruiser.cjs");

export async function checkArchitecture(baseDir = process.cwd()) {
	for (const relative of [
		"backend/src/modules/anime",
		"web/src/features/anime",
	]) {
		const directory = join(baseDir, relative);
		let files;
		try {
			files = await readdir(directory, { recursive: true });
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw error;
		}
		for (const file of files) {
			if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
			if (
				relative.startsWith("backend") &&
				!/^(?:tracking|metadata|anime-library|anime-catalog|identification)\/(?:application\/|domain\/|(?:ports|public|policy|defaults)\.ts$)/.test(
					file,
				)
			)
				continue;
			if (
				/\b(?:AniList|anilist)\b/.test(
					await readFile(join(directory, file), "utf8"),
				)
			)
				throw new Error(
					`provider-independent-business: ${relative}/${file} contains AniList-specific code`,
				);
		}
	}

	const result = await cruise(
		["backend/src", "web/src"],
		{
			...rules.options,
			baseDir,
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
