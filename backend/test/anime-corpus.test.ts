import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test } from "vitest";
import { LibraryScanner } from "../src/modules/resources/library/infrastructure/scanner.js";
import { ResourceAccess } from "../src/modules/resources/resource-access/infrastructure/access.js";
import { getVideoMimeType } from "../src/modules/resources/resource-access/public.js";
import {
	type AnimePredictions,
	corpusDirectory,
	evaluateCorpus,
	fixtureBasename,
	loadCorpus,
	materializeCorpus,
	summarizeCorpus,
	validateCorpus,
	validateNyaaCapture,
	validateResourcePath,
} from "./support/anime-corpus.js";
import { evaluateMatchingCorpus } from "./support/anime-matching-corpus.js";

const temporary: string[] = [];
test("production matching rejects unsafe corpus admissions and exposes numbering differences", async () => {
	const report = await evaluateMatchingCorpus();
	expect(report.summary.unsafeAdmissions).toEqual([]);
	expect(report.summary.episodeMismatches).toEqual([]);
	const dual = report.rows.find((row) => row.id === "nyaa-2106580-file-001");
	expect(dual?.rawEpisodes).toEqual(["29", "01"]);
	expect(dual?.targets).toEqual(["1"]);
	expect(dual?.selectedNumberingDiffers).toBe(true);
	expect(dual?.episodeComparison).toBe("matched");
	expect(dual?.episodeComparisonBasis).toBe("frozen-season-local-label");
}, 20000);
afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
async function workspace() {
	const path = await mkdtemp(join(tmpdir(), "anishelf-anime-corpus-"));
	temporary.push(path);
	return path;
}

test("captured corpus has authentic names, provider-backed answers and required boundaries", async () => {
	const corpus = await loadCorpus();
	const summary = summarizeCorpus(corpus);
	expect(summary.works).toBe(20);
	expect(summary.provenance["torrent-file"]).toBeGreaterThanOrEqual(100);
	expect(summary.scenarios).toBe(15);
	expect(summary.tags).toEqual(
		expect.arrayContaining([
			"directory-only",
			"mixed-work",
			"multiple-versions",
			"special",
			"continuous-numbering",
			"multi-episode",
			"season-ambiguity",
			"episode-zero",
		]),
	);
	for (const work of corpus.works) {
		const snapshot = JSON.parse(
			await readFile(join(corpusDirectory, work.snapshot), "utf8"),
		);
		const normalize = (value: string) =>
			value.replaceAll(/\s/g, "").toLowerCase();
		expect(normalize(snapshot.bangumi.name)).toBe(
			normalize(snapshot.anilist.titles.native),
		);
		expect(Number(snapshot.bangumi.date.slice(0, 4))).toBe(
			snapshot.anilist.startDate.year,
		);
		expect(snapshot.bangumi.platform === "剧场版" ? "MOVIE" : "TV").toBe(
			snapshot.anilist.format,
		);
	}
});

test.each([
	"../escape.mkv",
	"/absolute.mkv",
	"a/../b.mkv",
	"a//b.mkv",
	"a\\b.mkv",
	"C:/escape.mkv",
	"a\u0000.mkv",
])("rejects unsafe generated resource path %j", (path) => {
	expect(() => validateResourcePath(path)).toThrow("Unsafe fixture path");
});

test("rejects broken references and normalization-equivalent scenario paths", async () => {
	const corpus = await loadCorpus();
	const unknown = structuredClone(corpus);
	const unknownCase = unknown.cases[0];
	assert.ok(unknownCase);
	unknownCase.provenance.sourceId = "missing-source";
	expect(() => validateCorpus(unknown)).toThrow("Unknown source");
	const duplicate = structuredClone(corpus);
	const scenario = duplicate.scenarios[0];
	assert.ok(scenario);
	const firstResource = scenario.resources[0];
	const secondResource = scenario.resources[1];
	assert.ok(firstResource && secondResource);
	firstResource.relativePath = "é.mkv";
	secondResource.relativePath = "e\u0301.mkv";
	expect(() => validateCorpus(duplicate)).toThrow("Duplicate path");
});

test("generated authentic paths pass the actual scanner, preserve bytes and rescan without duplicates", async () => {
	const corpus = await loadCorpus();
	const root = join(await workspace(), "resources");
	const generated = await materializeCorpus(corpus, root);
	const manifest = JSON.parse(
		await readFile(join(root, "fixture-manifest.json"), "utf8"),
	);
	const resources = await ResourceAccess.create({ resourceRoot: root });
	const scanner = new LibraryScanner(pino({ enabled: false }));
	const supported = manifest.resources.filter(
		(entry: { path: string }) => getVideoMimeType(entry.path) !== null,
	);
	expect(manifest.resources).toHaveLength(generated.files);
	expect(manifest.resources.length - supported.length).toBe(3);
	for (let iteration = 0; iteration < 2; iteration++) {
		const progress = {
			id: "corpus",
			visitedCount: 0,
			matchedCount: 0,
			warnings: { count: 0, messages: [] },
		};
		const entries = await scanner.scan(
			resources,
			"Anime fixtures",
			progress,
			new AbortController().signal,
		);
		const files = entries?.filter((entry) => entry.kind === "file") ?? [];
		expect(files.map((entry) => entry.relativePath).sort()).toEqual(
			supported.map((entry: { path: string }) => entry.path).sort(),
		);
		expect(files).toHaveLength(supported.length);
		expect(progress.warnings.count).toBe(0);
	}
	const first = corpus.cases[0];
	assert.ok(first);
	if (first.input.kind !== "file") throw new Error("Expected file fixture");
	const firstPath = manifest.resources.find(
		(entry: { id: string; path: string }) => entry.id === first.id,
	)?.path;
	assert.ok(firstPath);
	expect(firstPath).toBe(`cases/case-0001/${first.input.relativePath}`);
	expect(await readFile(join(root, firstPath), "utf8")).toBe(
		`Anishelf identification placeholder: ${first.id}\n`,
	);
	expect(fixtureBasename(first)).toBe(
		"Sousou no Frieren 2023 S01E01-[1080p][BDRIP][x265.OPUS].mkv",
	);
});

test("generation refuses existing directories without touching their contents", async () => {
	const corpus = await loadCorpus();
	const root = await workspace();
	const sentinel = join(root, "existing.txt");
	await writeFile(sentinel, "keep");
	await expect(materializeCorpus(corpus, root)).rejects.toMatchObject({
		code: "EEXIST",
	});
	expect(await readFile(sentinel, "utf8")).toBe("keep");
});

test("an empty evaluation reports missing cases instead of a false success", async () => {
	const corpus = await loadCorpus();
	const report = evaluateCorpus(corpus, {
		corpusVersion: corpus.version,
		parserVersion: "not-run",
		matcherVersion: "not-run",
		results: [],
	});
	expect(report.passed).toBe(0);
	expect(report.missing).toBe(corpus.cases.length);
});

test("evaluation separates parse failures from unsafe work and episode confirmations", async () => {
	const corpus = await loadCorpus();
	const result = (id: string) => {
		const entry = corpus.cases.find((entry) => entry.id === id);
		if (!entry) throw new Error("Missing fixture");
		return { id, ...structuredClone(entry.expected) };
	};
	const wrongWork = result("directory-only-cn");
	wrongWork.workId = "bocchi";
	const wrongEpisode = result("directory-only-jp");
	wrongEpisode.episodes = [1];
	const wrongParse = result("year-resolution");
	wrongParse.parsed.rawEpisodes = [2023];
	const forced = result("season-conflict");
	forced.decision = "match";
	forced.workId = "frieren";
	forced.episodes = [1];
	const predictions: AnimePredictions = {
		corpusVersion: corpus.version,
		parserVersion: "adapter-test",
		matcherVersion: "adapter-test",
		results: [wrongWork, wrongEpisode, wrongParse, forced],
	};
	const report = evaluateCorpus(corpus, predictions);
	expect(report.unsafeConfirmations).toBe(3);
	expect(report.rows.find((row) => row.id === wrongParse.id)?.failures).toEqual(
		["parsed.rawEpisodes"],
	);
	expect(report.rows.find((row) => row.id === forced.id)?.failures).toEqual([
		"decision",
		"workId",
		"episodes",
	]);
});

test("evaluation rejects stale, duplicate and unknown prediction IDs", async () => {
	const corpus = await loadCorpus();
	const first = corpus.cases[0];
	assert.ok(first);
	const entry = { id: first.id, ...first.expected };
	const predictions = {
		corpusVersion: corpus.version,
		parserVersion: "adapter-test",
		matcherVersion: "adapter-test",
		results: [entry],
	};
	expect(() =>
		evaluateCorpus(corpus, { ...predictions, corpusVersion: "older" }),
	).toThrow("different corpus version");
	expect(() =>
		evaluateCorpus(corpus, { ...predictions, results: [entry, entry] }),
	).toThrow("Duplicate prediction ID");
	expect(() =>
		evaluateCorpus(corpus, {
			...predictions,
			results: [{ ...entry, id: "not-a-case" }],
		}),
	).toThrow("unknown case IDs");
});

test("Nyaa provenance keeps authentic batch paths, title mistakes and subtitle-only inventories", async () => {
	const corpus = await loadCorpus();
	const capture = JSON.parse(
		await readFile(join(corpusDirectory, "nyaa/releases.json"), "utf8"),
	);
	const nyaaSources = corpus.sources.filter((source) => source.site === "nyaa");
	expect(nyaaSources).toHaveLength(33);
	const sourceIds = new Set(nyaaSources.map((source) => source.id));
	const cases = corpus.cases.filter((entry) =>
		sourceIds.has(entry.provenance.sourceId ?? ""),
	);
	expect(cases).toHaveLength(268);
	expect(cases.filter((entry) => entry.input.kind === "file")).toHaveLength(
		235,
	);
	const get = (id: string) => {
		const entry = cases.find((entry) => entry.id === id);
		assert.ok(entry);
		return entry;
	};
	expect(get("nyaa-2115493-file-001").expected).toMatchObject({
		workId: "frieren-2",
		episodes: [29],
		parsed: { rawEpisodes: [1], revision: 2 },
	});
	expect(get("nyaa-2106580-file-001").expected).toMatchObject({
		workId: "frieren-2",
		episodes: [29],
		parsed: { rawEpisodes: [29] },
	});
	expect(get("nyaa-2108704-title").input).toMatchObject({
		kind: "release-title",
		text: expect.stringContaining("第39-38话"),
	});
	expect(get("nyaa-2108704-title").expected.decision).toBe("review");
	expect(get("nyaa-2108704-file-001").expected).toMatchObject({
		decision: "match",
		workId: "frieren-2",
		episodes: [29],
	});
	expect(get("nyaa-1869969-file-027").expected).toMatchObject({
		workId: "spy-2",
		episodes: [26],
		parsed: { rawEpisodes: [1] },
	});
	expect(get("nyaa-1869969-file-014").expected.decision).toBe("review");
	expect(get("nyaa-1869969-file-001").expected.decision).toBe("review");
	expect(get("nyaa-2052866-file-024").expected.decision).toBe("review");
	expect(get("nyaa-2170413-file-001").expected.parsed.rawEpisodes).toEqual([
		1, 2,
	]);
	expect(get("nyaa-2080114-title").expected.decision).toBe("ignore");
	const subtitles = capture.releases.find(
		(release: { sourceId: string }) => release.sourceId === "nyaa-2080114",
	);
	expect(subtitles.metadata.videoCount).toBe(0);
	expect(subtitles.metadata.subtitleCount).toBe(4);
});

test("Nyaa validation rejects altered provenance and invented file paths", async () => {
	const corpus = await loadCorpus();
	const capture = JSON.parse(
		await readFile(join(corpusDirectory, "nyaa/releases.json"), "utf8"),
	);
	const forged = structuredClone(corpus);
	const file = forged.cases.find(
		(entry) => entry.id === "nyaa-2115493-file-001",
	);
	assert.ok(file && file.input.kind === "file");
	file.input.relativePath = file.input.relativePath.replace("01v2", "99v2");
	expect(() => validateNyaaCapture(forged, capture)).toThrow(
		"Nyaa input differs from capture",
	);
	const altered = structuredClone(capture);
	altered.releases[0].metadata.sha256 = "0".repeat(64);
	expect(() => validateNyaaCapture(corpus, altered)).toThrow(
		"Nyaa capture differs from source",
	);
	const missing = structuredClone(capture);
	missing.releases.pop();
	expect(() => validateNyaaCapture(corpus, missing)).toThrow(
		"Nyaa capture source count differs",
	);
});

test("Nyaa evaluation detects wrong offsets, merged movie works and forced special matches", async () => {
	const corpus = await loadCorpus();
	const ids = [
		"nyaa-2115493-file-001",
		"nyaa-2106580-file-001",
		"nyaa-1869969-file-027",
		"nyaa-1869969-file-001",
		"nyaa-2151321-file-012",
		"nyaa-2052866-file-024",
		"nyaa-2073539-file-013",
	];
	const results = ids.map((id) => {
		const entry = corpus.cases.find((entry) => entry.id === id);
		assert.ok(entry);
		return { id, ...structuredClone(entry.expected) };
	});
	const [local, continuous, spy, movie, conflict, alternate, credit] = results;
	assert.ok(
		local && continuous && spy && movie && conflict && alternate && credit,
	);
	local.episodes = [1];
	spy.episodes = [1];
	for (const entry of [movie, conflict, alternate, credit]) {
		entry.decision = "match";
		entry.workId = "frieren";
		entry.episodes = [1];
	}
	const report = evaluateCorpus(corpus, {
		corpusVersion: corpus.version,
		parserVersion: "nyaa-reporting-test",
		matcherVersion: "nyaa-reporting-test",
		results,
	});
	expect(report.unsafeConfirmations).toBe(6);
	expect(report.rows.find((row) => row.id === continuous.id)?.passed).toBe(
		true,
	);
	expect(report.rows.find((row) => row.id === local.id)?.failures).toEqual([
		"episodes",
	]);
	expect(report.rows.find((row) => row.id === spy.id)?.failures).toEqual([
		"episodes",
	]);
	expect(report.missing).toBe(corpus.cases.length - ids.length);
});

test("candidate metrics distinguish top-one, top-five and omitted outputs", async () => {
	const corpus = await loadCorpus();
	const result = (id: string, candidateWorkIds?: string[]) => {
		const entry = corpus.cases.find((entry) => entry.id === id);
		assert.ok(entry);
		return {
			id,
			...entry.expected,
			...(candidateWorkIds ? { candidateWorkIds } : {}),
		};
	};
	const report = evaluateCorpus(corpus, {
		corpusVersion: corpus.version,
		parserVersion: "candidate-adapter-test",
		matcherVersion: "candidate-adapter-test",
		results: [
			result("directory-only-cn", ["frieren", "frieren-2"]),
			result("directory-only-jp", ["frieren-2", "frieren"]),
			result("directory-only-en"),
		],
	});
	expect(report.metrics.candidates.evaluated).toBe(2);
	expect(report.metrics.candidates.top1).toBe(1);
	expect(report.metrics.candidates.top5).toBe(2);
	expect(report.metrics.candidates.notSupplied).toBe(
		report.metrics.work.total - 2,
	);
	expect(report.missing).toBe(corpus.cases.length - 3);
});
