import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { parseCorpusCommand } from "../../../support/anime-corpus.js";
import { identificationAuditFailed } from "../../../support/anime-identification-corpus.js";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const temporary: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
function command(script: string, args: string[]) {
	const result = spawnSync(
		process.execPath,
		["--import", "tsx", join(root, "scripts", "manual-tests", script), ...args],
		{ cwd: root, encoding: "utf8", timeout: 15000 },
	);
	if (result.error) throw result.error;
	return result;
}

test("the corpus summary is a data inventory with reported resource counts", () => {
	const result = command("anime-corpus.mts", ["summary"]);
	expect(result.status).toBe(0);
	expect(JSON.parse(result.stdout)).toMatchObject({
		event: "anime_corpus.summary",
		works: 20,
		cases: 407,
		files: 369,
		scenarios: 15,
		reported: { files: 10 },
	});
	expect(result.stderr).toContain("anime_corpus.completed");
});

test.each([
	["match"],
	["evaluate", "predictions.json"],
	["summary", "extra"],
	["generate"],
	["generate", "a", "b"],
])("the data tool rejects obsolete or malformed arguments: %j", (...args) => {
	expect(parseCorpusCommand(args)).toBeUndefined();
});

test("the data command reports usage and exits with status 2", () => {
	const result = command("anime-corpus.mts", ["summary", "extra"]);
	expect(result.status).toBe(2);
	expect(result.stdout).toBe("");
	expect(result.stderr).toContain("anime_corpus.command_rejected");
});

test("the integration command rejects data-management arguments", () => {
	const result = command("anime-identification-corpus.mts", [
		"generate",
		"unused",
	]);
	expect(result.status).toBe(2);
	expect(result.stdout).toBe("");
	expect(result.stderr).toContain("anime_identification.command_rejected");
});

test("directory generation retains all resources and refuses to overwrite an existing collection", async () => {
	const parent = await mkdtemp(join(tmpdir(), "anishelf-corpus-command-"));
	temporary.push(parent);
	const destination = join(parent, "generated");
	const created = command("anime-corpus.mts", ["generate", destination]);
	expect(created.status).toBe(0);
	expect(JSON.parse(created.stdout)).toMatchObject({
		event: "anime_corpus.generated",
		files: 429,
		destination,
	});
	const manifestPath = join(destination, "fixture-manifest.json");
	const manifestBytes = await readFile(manifestPath, "utf8");
	const manifest = JSON.parse(manifestBytes);
	expect(manifest.playable).toBe(false);
	expect(manifest.resources).toHaveLength(429);
	const placeholderPath = join(destination, manifest.resources[0].path);
	await writeFile(placeholderPath, "Keep existing user content.");
	const rejected = command("anime-corpus.mts", ["generate", destination]);
	expect(rejected.status).toBe(1);
	expect(rejected.stderr).toContain("anime_corpus.failed");
	expect(await readFile(manifestPath, "utf8")).toBe(manifestBytes);
	expect(await readFile(placeholderPath, "utf8")).toBe(
		"Keep existing user content.",
	);
}, 20000);

test("the integration gate fails unsafe admissions, wrong comparable mappings and reported regressions", () => {
	const safe = {
		summary: {
			unsafeAdmissions: [] as string[],
			episodeMismatches: [] as string[],
			missedMatches: ["unresolved"],
		},
		reported: { total: 10, passed: 10 },
	};
	expect(identificationAuditFailed(safe)).toBe(false);
	expect(
		identificationAuditFailed({
			...safe,
			summary: { ...safe.summary, unsafeAdmissions: ["wrong-work"] },
		}),
	).toBe(true);
	expect(
		identificationAuditFailed({
			...safe,
			summary: { ...safe.summary, episodeMismatches: ["wrong-episode"] },
		}),
	).toBe(true);
	expect(
		identificationAuditFailed({ ...safe, reported: { total: 10, passed: 9 } }),
	).toBe(true);
});
