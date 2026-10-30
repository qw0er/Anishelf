import { expect, test } from "vitest";
import { IdentificationApplication } from "../../../../src/modules/anime/identification/application/identification.js";
import { AnitomyIdentificationParser } from "../../../../src/modules/anime/identification/infrastructure/parser.js";
import { createIdentificationMetadata } from "../../../../src/modules/anime/integration/identification-metadata.js";
import { airedEpisodeCount } from "../../../../src/modules/anime/metadata/public.js";
import { createHttpApp } from "../../../support/http.js";

import {
	createProvider,
	failure,
	logger,
	media,
	noSignal,
	reference,
	setup,
	setupTestLifecycle,
	transport,
} from "./support/metadata-fixture.js";

setupTestLifecycle();

test("AniList search/details normalize multilingual titles, unknowns and calendar season", async () => {
	const { application, fetcher } = await setup();
	const search = await application.search({ query: "Frieren" });
	expect(search.data.items[0]).toMatchObject({
		reference,
		year: 2023,
		airingSeason: "FALL",
		episodeCount: 28,
	});
	expect(search.data.items[0]?.titles.map((title) => title.language)).toEqual([
		null,
		"en",
		null,
		null,
	]);
	const detail = await application.get(reference);
	expect(detail.data).toMatchObject({
		description: "Story",
		country: "JP",
		source: "MANGA",
		episodeCatalog: "unavailable",
		bannerUrl: null,
	});
	expect(detail.data.tags).toEqual([
		{ name: "Magic", rank: 80, spoiler: true },
	]);
	expect(detail.data.unavailableFields).toContain("bannerImage");
	expect(detail.data.startDate?.day).toBeNull();
	expect(fetcher).toHaveBeenCalledTimes(2);
	for (const [, init] of fetcher.mock.calls) {
		expect(init?.headers).not.toHaveProperty("Authorization");
		expect(JSON.parse(String(init?.body)).query).toContain("type: ANIME");
	}
});

test("details expose the next scheduled episode for aired progress", async () => {
	const fetcher = transport();
	fetcher.mockImplementationOnce(async () =>
		Response.json({
			data: {
				Media: {
					...media(),
					status: "RELEASING",
					episodes: 12,
					nextAiringEpisode: { episode: 8, airingAt: 1700000000 },
				},
			},
		}),
	);
	const { application } = await setup(fetcher);
	const detail = (await application.get(reference)).data;
	expect(detail.nextAiringEpisode).toEqual({
		episode: 8,
		airingAt: 1700000000,
	});
});

test("provider validation rejects partial, malformed and wrong-identity responses", async () => {
	const fetcher = transport();
	const provider = createProvider({
		fetch: fetcher,
		intervalMs: 0,
		attempts: 1,
	});
	for (const body of [
		{ data: { Media: { id: 154587 } } },
		{ data: { Media: media(1) } },
		{ data: { Media: { ...media(), type: "MANGA" } } },
		{ errors: [{}], data: { Media: media() } },
	]) {
		fetcher.mockImplementationOnce(async () => Response.json(body));
		await failure(provider.get(reference, noSignal()), "invalid-response");
	}
	fetcher.mockImplementationOnce(async () => new Response("bad-json"));
	await failure(provider.get(reference, noSignal()), "invalid-response");
	fetcher.mockImplementationOnce(async () => Response.json({}));
	await failure(provider.get(reference, noSignal()), "invalid-response");
	fetcher.mockImplementationOnce(async () =>
		Response.json({ data: { Media: null } }),
	);
	await failure(provider.get(reference, noSignal()), "not-found");
});

test("queried null lists are explicit unknowns rather than invalid or invented data", async () => {
	const fetcher = transport();
	fetcher.mockImplementationOnce(async () =>
		Response.json({
			data: {
				Media: {
					...media(),
					genres: null,
					synonyms: null,
					tags: null,
					studios: null,
					streamingEpisodes: null,
					episodes: null,
				},
			},
		}),
	);
	const { application } = await setup(fetcher);
	const details = (await application.get(reference)).data;
	expect(details.unavailableFields).toEqual(
		expect.arrayContaining([
			"genres",
			"synonyms",
			"tags",
			"studios",
			"streamingEpisodes",
			"episodes",
		]),
	);
	expect(details.episodeCount).toBeNull();
});

test("relations and airing keep pagination and do not infer episode catalogs", async () => {
	const { application } = await setup();
	const relations = await application.relations(reference, 1, 1);
	expect(relations.data).toMatchObject({
		page: 1,
		perPage: 1,
		hasNextPage: false,
	});
	expect(relations.data.items.map((item) => item.work.reference.id)).toEqual([
		"200",
	]);
	const airing = await application.airing(reference, 2, 10);
	expect(airing.data).toEqual({
		page: 2,
		perPage: 10,
		hasNextPage: false,
		items: [{ id: "100", episode: 1, airingAt: 1700000000 }],
	});
});

test("actual Metadata supplies Identification proposals without calendar season inference", async () => {
	const { publicMetadata } = await setup();
	const identification = new IdentificationApplication({
		parser: new AnitomyIdentificationParser(),
		metadata: createIdentificationMetadata(publicMetadata),
	});
	const results = await identification.identify([
		{
			scopeId: "/library",
			fileId: "file",
			relativePath: "Frieren - 01.mkv",
			sourceVersion: "version",
		},
	]);
	expect(results[0]).toMatchObject({
		metadataStatus: "searched",
		status: "proposed",
	});
	expect(results[0]?.proposals[0]?.candidate.work).toMatchObject({
		reference: { id: expect.any(String) },
		season: null,
		part: null,
	});
	expect(results[0]?.proposals[0]?.mapping.targets).toEqual([
		{ kind: "regular", number: "1" },
	]);
});

test("metadata projects only explicit provider-title season and part ordinals", async () => {
	const fetcher = transport();
	fetcher.mockImplementation(async (_url, init) => {
		const request = JSON.parse(String(init?.body));
		const value = media();
		value.title = {
			romaji: "Ocean Season 2 Part 1",
			english: "Ocean 2nd Season Part 1",
			native: "海洋 第二季 第一部",
		};
		value.synonyms = ["Ocean"];
		return Response.json({
			data: {
				Page: {
					pageInfo: {
						currentPage: request.variables.page,
						perPage: request.variables.perPage,
						hasNextPage: false,
					},
					media: [value],
				},
			},
		});
	});
	const { publicMetadata } = await setup(fetcher);
	const projection = createIdentificationMetadata(publicMetadata);
	const candidates = await projection.search(
		"Ocean",
		new AbortController().signal,
	);
	expect(candidates[0]).toMatchObject({
		season: "2",
		part: "1",
		ordinalSource: "provider-title",
		titleVariants: expect.arrayContaining([
			{ value: "Ocean Season 2 Part 1", kind: "primary", language: null },
			{ value: "Ocean", kind: "alias", language: null },
		]),
	});
	expect(fetcher).toHaveBeenCalledTimes(1);
});

test("SDK rejects malformed streamed GraphQL responses without Content-Length", async () => {
	const fetcher = transport();
	fetcher.mockImplementationOnce(
		async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("invalid-json"));
						controller.close();
					},
				}),
			),
	);
	const provider = createProvider({
		fetch: fetcher,
		intervalMs: 0,
		attempts: 1,
	});
	await failure(provider.get(reference, noSignal()), "invalid-response");
});

test("manual lookup delegates provider ID and URL parsing to the configured adapter without a network request", async () => {
	const { publicMetadata, fetcher } = await setup();
	const app = createHttpApp({
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
		metadata: publicMetadata,
	});
	try {
		for (const value of ["154587", "https://anilist.co/anime/154587/Frieren"]) {
			const response = await app.inject({
				url: `/api/metadata/reference?${new URLSearchParams({ value })}`,
			});
			expect(response.statusCode, response.body).toBe(200);
			expect(response.json()).toEqual(
				publicMetadata.resolveReference("154587"),
			);
		}
		expect(
			(
				await app.inject({
					url: `/api/metadata/reference?${new URLSearchParams({ value: "https://other.example/anime/154587" })}`,
				})
			).statusCode,
		).toBe(400);
		expect(fetcher).not.toHaveBeenCalled();
	} finally {
		await app.close();
	}
});

test("aired episode count uses provider status and the next scheduled episode", () => {
	const now = 1_000_000;
	expect(
		airedEpisodeCount(
			{
				status: "RELEASING",
				episodeCount: 12,
				nextAiringEpisode: { episode: 8, airingAt: now / 1000 + 60 },
			},
			now,
		),
	).toBe(7);
	expect(
		airedEpisodeCount(
			{
				status: "RELEASING",
				episodeCount: 12,
				nextAiringEpisode: { episode: 8, airingAt: now / 1000 - 60 },
			},
			now,
		),
	).toBe(8);
	expect(
		airedEpisodeCount(
			{ status: "FINISHED", episodeCount: 12, nextAiringEpisode: null },
			now,
		),
	).toBe(12);
	expect(
		airedEpisodeCount(
			{ status: "NOT_YET_RELEASED", episodeCount: 12, nextAiringEpisode: null },
			now,
		),
	).toBe(0);
	expect(
		airedEpisodeCount(
			{ status: "HIATUS", episodeCount: 12, nextAiringEpisode: null },
			now,
		),
	).toBeNull();
});
