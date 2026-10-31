import { readFileSync, writeFileSync } from "node:fs";

const [tag, output] = process.argv.slice(2);

try {
	if (!tag || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag) || !output) {
		throw new Error(
			"Usage: node scripts/release-notes.mjs v<version> <output-file>",
		);
	}
	const version = tag.slice(1);
	const sections = readFileSync("CHANGELOG.md", "utf8").split(/(?=^## )/m);
	const matching = sections.filter((section) => {
		const heading = section.split("\n", 1)[0].trimEnd();
		return heading === `## ${version}` || heading.startsWith(`## ${version} `);
	});
	if (matching.length !== 1) {
		throw new Error(`Expected exactly one changelog section for ${version}`);
	}
	const [, ...lines] = matching[0].split(/\r?\n/);
	const notes = lines.join("\n").trim();
	if (!notes || !/\S/.test(notes.replace(/^### .*$/gm, ""))) {
		throw new Error(`Changelog section for ${version} is empty`);
	}
	writeFileSync(output, `${notes}\n`);
	console.log(`Prepared release notes for ${tag} from CHANGELOG.md`);
} catch (error) {
	console.error(`Release notes error: ${error.message}`);
	process.exitCode = 1;
}
