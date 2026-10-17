import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "anitomy-ng";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { createIdentificationModule } from "../src/modules/anime/composition/identification.js";
import { IdentificationApplication } from "../src/modules/anime/identification/application/identification.js";
import { proposeMapping } from "../src/modules/anime/identification/domain/mapping.js";
import { AnitomyIdentificationParser } from "../src/modules/anime/identification/infrastructure/parser.js";
import type {
	IdentificationApi,
	IdentificationMetadata,
	WorkCandidate,
} from "../src/modules/anime/identification/public.js";
import { AutomaticIdentificationCoordinator } from "../src/modules/anime/workflows/automatic-identification.js";
import { LibraryIndex } from "../src/modules/resources/library/infrastructure/index.js";
import { resourceRootId } from "../src/modules/resources/resource-access/domain/identity.js";
import type { SourceIdentity } from "../src/modules/resources/resource-access/public.js";
import { settingsStore } from "./settings-store.js";
import { loadCorpus } from "./support/anime-corpus.js";
import { createHttpApp } from "./support/http.js";
import { createLibraryModule } from "./support/library.js";

const parser = new AnitomyIdentificationParser();
const logger = pino({ enabled: false });
const work: WorkCandidate = {
	snapshotId: "snapshot-1",
	reference: { provider: "anilist", mediaType: "anime", id: "1" },
	titles: ["Frieren", "葬送のフリーレン", "葬送的芙莉莲"],
	year: 2023,
	format: "TV",
	episodeCount: 28,
	season: null,
	part: null,
};
const movie: WorkCandidate = {
	...work,
	titles: ["Your Name"],
	reference: { ...work.reference, id: "2" },
	format: "MOVIE",
	episodeCount: 1,
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const close of cleanups.splice(0).reverse()) await close();
});
function source(relativePath: string): SourceIdentity {
	return {
		scopeId: "/media",
		fileId: relativePath,
		relativePath,
		sourceVersion: "v1",
	};
}
async function fixture(paths = ["Frieren - 01.mkv"]) {
	const base = await mkdtemp(join(tmpdir(), "anishelf-identification-"));
	const requestedRoot = join(base, "media");
	await mkdir(requestedRoot);
	const root = await realpath(requestedRoot);
	for (const path of paths) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), "original placeholder");
	}
	const library = createLibraryModule({
		configuration: settingsStore(root),
		index: new LibraryIndex(),
		logger,
	});
	cleanups.push(async () => {
		await library.close();
		await rm(base, { recursive: true, force: true });
	});
	return { library, root, base };
}
function coordinator(
	f: Awaited<ReturnType<typeof fixture>>,
	identification: IdentificationApi = new IdentificationApplication({ parser }),
) {
	const automatic = new AutomaticIdentificationCoordinator({
		library: f.library,
		sources: f.library.sources,
		identification,
		logger,
	});
	automatic.start();
	cleanups.push(() => automatic.close());
	return automatic;
}
async function scan(
	f: Awaited<ReturnType<typeof fixture>>,
	automatic: AutomaticIdentificationCoordinator,
) {
	await f.library.startScan();
	await f.library.waitForCompletion();
	await automatic.waitForCompletion();
}

test("local identification works without Metadata, a database, HTTP or a task", async () => {
	const engine = new IdentificationApplication({ parser });
	const inputs = [
		source("Frieren (01-12) [Batch]/05.mkv"),
		source("Frieren (01-12) [Batch]/06.mkv"),
	];
	const results = await engine.identify(inputs);
	expect(results.map((result) => result.status)).toEqual(["parsed", "parsed"]);
	expect(results.map((result) => result.metadataStatus)).toEqual([
		"not-configured",
		"not-configured",
	]);
	expect(results.map((result) => result.evidence.rawEpisodes)).toEqual([
		["05"],
		["06"],
	]);
	expect(results[0]?.evidence.titles).toContain("Frieren");
	expect(results[0]?.proposals).toEqual([]);
	expect(results[0]?.evidence.inputs.map((input) => input.mode)).toEqual([
		"basename",
		"ancestor",
		"path",
		"together",
	]);
	const second = await engine.identify(inputs);
	expect(second).toEqual(results);
	if (results[0]) results[0].evidence.titles.push("user-edited copy");
	expect((await engine.identify(inputs))[0]?.evidence.titles).not.toContain(
		"user-edited copy",
	);
});

test("extraction preserves parser fields without filename corrections", async () => {
	const engine = new IdentificationApplication({ parser });
	const name = "[Group] 葬送のフリーレン - 01v2 [1080p][CHS][ABCDEF12].mkv";
	const [release] = await engine.identify([source(name)]);
	expect(release?.evidence.inputs[0]?.elements).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ kind: "release_version", value: "2" }),
			expect.objectContaining({ kind: "file_checksum", value: "ABCDEF12" }),
		]),
	);
	for (const name of [
		"Show - 12.5v2.mkv",
		"Show - 23β.mkv",
		"Show - 03-01.mkv",
		"Show - 01-03.mkv",
	]) {
		const evidence = (await engine.identify([source(name)]))[0]?.evidence;
		const elements = parse(name);
		expect(evidence?.inputs[0]?.elements).toEqual(elements);
		expect(evidence?.rawEpisodes).toEqual(
			elements
				.filter((element) => element.kind === "episode")
				.map((element) => element.value),
		);
	}
});

test("multiple parser episode tokens require review and movies remain proposals", async () => {
	const names = [
		"Show - 12.5.mkv",
		"Show SP01.mkv",
		"Show NCOP.mkv",
		"Show - 01-999.mkv",
	];
	for (const name of names) {
		const evidence = parser.extract([name])[0];
		if (!evidence) throw new Error("Missing extraction");
		expect(proposeMapping(evidence, work).targets, name).toEqual([]);
		expect(
			proposeMapping(evidence, work).unresolved.length,
			name,
		).toBeGreaterThan(0);
	}
	const range = parser.extract(["Frieren - 01-03.mkv"])[0];
	const film = parser.extract(["Your Name.mkv"])[0];
	if (!range || !film) throw new Error("Missing extraction");
	expect(
		proposeMapping(range, work).targets.map((target) => target.number),
	).toEqual(["1", "2", "3"]);
	expect(range.numbering).toBe("range");
	expect(proposeMapping(film, movie).targets).toEqual([
		{ kind: "movie", number: "whole" },
	]);
});

test("reserved Metadata integration ranks proposals automatically without manual selection", async () => {
	const search = vi.fn<IdentificationMetadata["search"]>(async () => [
		movie,
		{ ...work, reference: { ...work.reference, id: "3" }, year: 2025 },
		work,
		work,
	]);
	const engine = new IdentificationApplication({
		parser,
		metadata: { search },
	});
	const results = await engine.identify([
		source("葬送的芙莉莲 (2023) - 01.mkv"),
		source("葬送的芙莉莲 (2023) - 02.mkv"),
	]);
	expect(search).toHaveBeenCalledTimes(1);
	expect(search.mock.calls[0]?.[0]).not.toContain("/media");
	expect(results[0]?.status).toBe("proposed");
	expect(results[0]?.metadataStatus).toBe("searched");
	expect(results[0]?.proposals).toHaveLength(3);
	expect(results[0]?.proposals[0]?.candidate.work.reference).toEqual(
		work.reference,
	);
	expect(results[0]?.proposals[0]?.mapping.targets).toEqual([
		{ kind: "regular", number: "1" },
	]);
	expect(
		results[0]?.proposals.find(
			(proposal) => proposal.candidate.work.reference.id === "3",
		)?.candidate.conflicts,
	).toContain("Release year differs.");
});

test("provider failures retain local extraction and an empty search is distinguishable", async () => {
	const failing = new IdentificationApplication({
		parser,
		metadata: {
			search: async () => {
				throw new Error("provider outage");
			},
		},
	});
	const [failed] = await failing.identify([source("Frieren - 01.mkv")]);
	expect(failed).toMatchObject({
		status: "unresolved",
		metadataStatus: "failed",
		evidence: { rawEpisodes: ["01"] },
	});
	const empty = new IdentificationApplication({
		parser,
		metadata: { search: async () => [] },
	});
	expect((await empty.identify([source("Frieren - 01.mkv")]))[0]).toMatchObject(
		{ status: "unresolved", metadataStatus: "searched" },
	);
});

test("callers own cancellation, including uncooperative Metadata requests", async () => {
	let entered!: () => void;
	const gate = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const engine = new IdentificationApplication({
		parser,
		metadata: {
			search: async () => {
				entered();
				return new Promise(() => {});
			},
		},
	});
	const controller = new AbortController();
	const pending = engine.identify(
		[source("Frieren - 01.mkv")],
		controller.signal,
	);
	const rejected = expect(pending).rejects.toBeDefined();
	await gate;
	controller.abort();
	await rejected;
	await expect(
		engine.identify([source("Frieren - 01.mkv")], controller.signal),
	).rejects.toBeDefined();
});

test("identification rejects duplicate or nonconfined inputs and oversized batches", async () => {
	const engine = new IdentificationApplication({ parser });
	const file = source("Frieren - 01.mkv");
	await expect(engine.identify([file, file])).rejects.toMatchObject({
		code: "INVALID_REQUEST",
	});
	for (const path of [
		"../escape.mkv",
		"/absolute.mkv",
		"dir/./file.mkv",
		"dir\\file.mkv",
	])
		await expect(engine.identify([source(path)])).rejects.toMatchObject({
			code: "INVALID_REQUEST",
		});
	await expect(
		engine.identify(
			Array.from({ length: 501 }, (_, index) => source(`${index}.mkv`)),
		),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	expect(await engine.identify([])).toEqual([]);
});

test("every corpus filename preserves independent local evidence", async () => {
	const corpus = await loadCorpus();
	const paths = corpus.cases.flatMap((entry) =>
		entry.input.kind === "file" ? [entry.input.relativePath] : [],
	);
	const results = await new IdentificationApplication({ parser }).identify(
		paths.map(source),
	);
	expect(results).toHaveLength(369);
	for (const [index, result] of results.entries()) {
		expect(result.evidence.relativePath).toBe(paths[index]);
		expect(result.evidence.inputs.map((input) => input.mode)).toEqual(
			expect.arrayContaining(["basename", "path", "together"]),
		);
		for (const input of result.evidence.inputs)
			for (const element of input.elements)
				expect(Number.isInteger(element.position)).toBe(true);
	}
});

test("completed scans trigger automatic identification and unchanged scans reuse results", async () => {
	const info = vi.spyOn(logger, "info");
	const f = await fixture(["Frieren - 01.mkv", "nested/Your Name.mkv"]);
	const engine = new IdentificationApplication({ parser });
	const identify = vi.spyOn(engine, "identify");
	const automatic = coordinator(f, engine);
	await scan(f, automatic);
	expect(automatic.getResults()).toHaveLength(2);
	expect(identify).toHaveBeenCalledTimes(2);
	await scan(f, automatic);
	expect(identify).toHaveBeenCalledTimes(2);
	expect(info).toHaveBeenCalledWith(
		expect.objectContaining({
			event: "identification.automatic_completed",
			parsed: 0,
			reused: 2,
			available: 2,
			metadataFailed: 0,
			elapsedMs: expect.any(Number),
		}),
		expect.any(String),
	);
	const summaries = info.mock.calls.filter(([record]) =>
		(record as { event?: string }).event?.startsWith(
			"identification.automatic_",
		),
	);
	expect(JSON.stringify(summaries)).not.toContain("Frieren");
	expect(JSON.stringify(summaries)).not.toContain(f.root);
	expect(
		automatic.getResults().every((result) => result.status === "parsed"),
	).toBe(true);
	expect(await readFile(join(f.root, "Frieren - 01.mkv"), "utf8")).toBe(
		"original placeholder",
	);
});

test("new files invalidate their directory context while other groups are reused", async () => {
	const f = await fixture([
		"Frieren (01-12)/05.mkv",
		"Frieren (01-12)/06.mkv",
		"other/Your Name.mkv",
	]);
	const engine = new IdentificationApplication({ parser });
	const identify = vi.spyOn(engine, "identify");
	const automatic = coordinator(f, engine);
	await scan(f, automatic);
	identify.mockClear();
	await writeFile(join(f.root, "Frieren (01-12)/07.mkv"), "new file");
	await scan(f, automatic);
	expect(identify).toHaveBeenCalledTimes(1);
	expect(identify.mock.calls[0]?.[0]).toHaveLength(3);
	expect(
		automatic
			.getResults()
			.filter((result) => result.source.relativePath.startsWith("Frieren"))
			.map((result) => result.evidence.rawEpisodes),
	).toEqual([["05"], ["06"], ["07"]]);
});

test("source replacement produces a new version and deleted files leave the projection", async () => {
	const f = await fixture();
	const engine = new IdentificationApplication({ parser });
	const identify = vi.spyOn(engine, "identify");
	const automatic = coordinator(f, engine);
	await scan(f, automatic);
	const original = automatic.getResults()[0]?.source.sourceVersion;
	await writeFile(
		join(f.root, "Frieren - 01.mkv"),
		"replaced content with a different length",
	);
	await scan(f, automatic);
	expect(identify).toHaveBeenCalledTimes(2);
	expect(automatic.getResults()[0]?.source.sourceVersion).not.toBe(original);
	await rm(join(f.root, "Frieren - 01.mkv"));
	await scan(f, automatic);
	expect(automatic.getResults()).toEqual([]);
});

test("assembly catches an already published startup scan and needs no database", async () => {
	const f = await fixture();
	await f.library.startScan();
	await f.library.waitForCompletion();
	const automatic = createIdentificationModule({
		library: f.library,
		sources: f.library.sources,
		logger,
	});
	cleanups.push(() => automatic.close());
	await automatic.waitForCompletion();
	expect(automatic.getResults()).toHaveLength(1);
	await automatic.close();
	await f.library.startScan();
	await f.library.waitForCompletion();
	expect(automatic.getResults()).toEqual([]);
});

test("a newly assembled coordinator reconstructs results from the current scan", async () => {
	const f = await fixture();
	const first = coordinator(f);
	await scan(f, first);
	const previous = first.getResults();
	await first.close();
	const second = coordinator(f);
	await second.waitForCompletion();
	expect(second.getResults()).toEqual(previous);
});

test("Library exposes bounded, revision-checked pages without internal paths", async () => {
	const f = await fixture(["01.mkv", "02.mkv"]);
	await f.library.startScan();
	await f.library.waitForCompletion();
	const revision = (await f.library.getStatus()).revision;
	const first = f.library.readFilePage(revision, 0, 1);
	expect(first.files).toHaveLength(1);
	expect(first.nextOffset).toBe(1);
	expect(first.files[0]).not.toHaveProperty("relativePath");
	expect(f.library.readFilePage(revision, 1, 1).nextOffset).toBeNull();
	await f.library.startScan();
	await f.library.waitForCompletion();
	expect(() => f.library.readFilePage(revision, 0, 1)).toThrow();
});

test("Identification no longer exposes task or correction HTTP endpoints", async () => {
	const app = createHttpApp({
		config: { host: "localhost", port: 80 },
		logger,
	});
	cleanups.push(() => app.close());
	expect((await app.inject("/api/identifications")).statusCode).toBe(404);
	expect(
		(
			await app.inject({
				method: "POST",
				url: "/api/identifications",
				payload: {},
			})
		).statusCode,
	).toBe(404);
});

test("automatic coordination processes libraries larger than one identification batch", async () => {
	const paths = Array.from(
		{ length: 501 },
		(_, index) => `Frieren - ${String(index + 1).padStart(3, "0")}.mkv`,
	);
	const f = await fixture(paths);
	const engine = new IdentificationApplication({ parser });
	const identify = vi.spyOn(engine, "identify");
	const automatic = coordinator(f, engine);
	await scan(f, automatic);
	expect(automatic.getResults()).toHaveLength(501);
	expect(identify).toHaveBeenCalledTimes(11);
	expect(identify.mock.calls.every(([sources]) => sources.length <= 50)).toBe(
		true,
	);
});

test("root switching cancels stale recognition and processes the newly published root", async () => {
	const f = await fixture();
	const requestedNextRoot = join(f.base, "next");
	await mkdir(requestedNextRoot);
	const nextRoot = await realpath(requestedNextRoot);
	await writeFile(join(nextRoot, "Your Name.mkv"), "new root placeholder");
	let entered!: () => void;
	const gate = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const engine = new IdentificationApplication({ parser });
	const identify: IdentificationApi = {
		version: engine.version,
		identify: async (sources, signal) => {
			if (sources[0]?.scopeId === resourceRootId(f.root)) {
				entered();
				await new Promise<void>((resolve) => {
					signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				signal?.throwIfAborted();
			}
			return engine.identify(sources, signal);
		},
	};
	const automatic = coordinator(f, identify);
	await f.library.startScan();
	await f.library.waitForCompletion();
	await gate;
	await f.library.updateResourceSettings({
		resourceRoots: [nextRoot],
		scanIntervalMinutes: 0,
	});
	await f.library.waitForCompletion();
	await automatic.waitForCompletion();
	const results = automatic.getResults();
	expect(results).toHaveLength(1);
	expect(results[0]?.source.scopeId).toBe(resourceRootId(nextRoot));
	expect(results[0]?.evidence.originalName).toBe("Your Name.mkv");
});

test("failed Metadata work is retried by a later scan without losing local evidence", async () => {
	const f = await fixture();
	const search = vi
		.fn<IdentificationMetadata["search"]>()
		.mockRejectedValueOnce(new Error("outage"))
		.mockResolvedValue([work]);
	const automatic = coordinator(
		f,
		new IdentificationApplication({ parser, metadata: { search } }),
	);
	await scan(f, automatic);
	expect(automatic.getResults()[0]).toMatchObject({
		metadataStatus: "failed",
		evidence: { rawEpisodes: ["01"] },
	});
	await scan(f, automatic);
	expect(automatic.getResults()[0]?.metadataStatus).toBe("searched");
	expect(search).toHaveBeenCalledTimes(2);
});
