import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { IdentificationApplication } from "../../../../src/modules/anime/identification/application/identification.js";
import { AnitomyIdentificationParser } from "../../../../src/modules/anime/identification/infrastructure/parser.js";
import { resourceRootId } from "../../../../src/modules/resources/resource-access/domain/identity.js";
import { createHttpApp } from "../../../support/http.js";

import {
	cleanups,
	confirm,
	details,
	fixture,
	logger,
	project,
	required,
	rows,
	setupTestLifecycle,
} from "./support/anime-catalog-fixture.js";

setupTestLifecycle();

test("multiple versions count once and one source can map to multiple explicit episodes", async () => {
	const f = await fixture(["Anime v1 - 01.mkv", "Anime v2 - 01.mkv"]);
	const selected = await rows(f);
	const first = selected[0];
	if (!first) throw new Error("Missing review");
	first.targets.push({ kind: "regular", number: "2" });
	const result = await confirm(f, Promise.resolve(selected));
	const detail = await f.catalog.getLocalWorkDetail(result.workId);
	expect(detail.work.availableEpisodes).toBe(2);
	expect(detail.episodes[0]?.versions).toHaveLength(2);
	expect(detail.episodes[1]?.versions).toHaveLength(1);
});

test("offset previews preserve release numbering and reject invalid or implicit special targets", async () => {
	const f = await fixture(["Anime - 29.mkv"]);
	const selected = await rows(f, ["29"]);
	required(selected[0]).offset = -24;
	const preview = await f.catalog.preview({
		reference: project(f),
		rows: selected,
	});
	expect(preview.rows[0]).toMatchObject({
		rawNumbers: ["29"],
		targets: [{ kind: "regular", number: "5" }],
		offset: -24,
	});
	expect((await f.catalog.reviews()).items[0]?.decision).toBe("pending");
	await expect(
		f.catalog.preview({ reference: project(f), rows: await rows(f, ["29"]) }),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	const invalid = await rows(f);
	required(invalid[0]).targets = [{ kind: "special", number: "12.5" }];
	await expect(
		f.catalog.preview({ reference: project(f), rows: invalid }),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	required(required(invalid[0]).targets[0]).label = "Special 12.5";
	await confirm(f, Promise.resolve(invalid));
	expect((await f.catalog.list()).items[0]?.availableEpisodes).toBe(1);
});

test("corroborated automatic offsets persist once and special zero still needs manual confirmation", async () => {
	const f = await fixture(
		[
			"Ocean Season 2/Ocean - 13 (S02E01).mkv",
			"Ocean Season 2/Ocean - 14 (S02E02).mkv",
			"Ocean Season 2/Ocean - 15.mkv",
			"Ocean Season 2/Ocean - 00.mkv",
		],
		undefined,
		true,
	);
	f.setData({
		...details(),
		titles: [{ value: "Ocean Season 2", kind: "romaji", language: null }],
	});
	const items = (await f.catalog.reviews()).items;
	const engine = new IdentificationApplication({
		parser: new AnitomyIdentificationParser(),
		metadata: {
			search: async () => [
				{
					reference: project(f),
					snapshotId: "test-search",
					titles: ["Ocean Season 2"],
					year: null,
					format: "TV",
					episodeCount: 12,
					season: "2",
					part: null,
				},
			],
		},
	});
	const results = await engine.identify(
		items.map((item) => ({
			scopeId: resourceRootId(f.root),
			relativePath: item.relativePath,
			fileId: item.fileId,
			sourceVersion: item.sourceVersion,
		})),
	);
	await f.catalog.publish(results, [resourceRootId(f.root)]);
	let reviews = (await f.catalog.reviews()).items;
	const converted = required(
		reviews.find((item) => item.evidence.originalName === "Ocean - 15.mkv"),
	);
	expect(converted.associations[0]?.number).toBe("3");
	expect(converted.evidence.rawEpisodes).toEqual(["15"]);
	expect(converted.proposals[0]?.mapping.numbering?.offset).toBe(-12);
	const zero = required(
		reviews.find((item) => item.evidence.originalName === "Ocean - 00.mkv"),
	);
	expect(zero.decision).toBe("pending");
	const preview = await f.catalog.preview({
		reference: project(f),
		rows: [
			{
				reviewId: zero.id,
				revision: zero.revision,
				targets: [{ kind: "special", number: "0", label: "Prologue" }],
				reason: "Explicit special identity",
			},
		],
	});
	await f.catalog.confirm({
		previewId: preview.id,
		operationKey: "special-zero",
		replace: false,
	});
	await f.restart();
	reviews = (await f.catalog.reviews()).items;
	expect(
		reviews.find((item) => item.id === converted.id)?.associations[0]?.number,
	).toBe("3");
	expect(
		reviews.find((item) => item.id === zero.id)?.associations[0],
	).toMatchObject({ kind: "special", number: "0", label: "Prologue" });
});

test("stable episode IDs, mappings and source progress survive rescan refresh and restart", async () => {
	const f = await fixture(undefined, undefined, true);
	const result = await confirm(f);
	let detail = await f.catalog.getLocalWorkDetail(result.workId);
	const originalTitle = detail.work.displayTitle;
	const episodeId = required(detail.episodes[0]).id;
	await f.catalog.editEpisode(
		result.workId,
		episodeId,
		detail.work.revision,
		"1",
		"Custom episode title",
	);
	const review = required((await f.catalog.reviews()).items[0]);
	f.database.playback.openGeneration(review.sourceId);
	const progress = f.database.playback.get(review.sourceId);
	await f.scan();
	detail = await f.catalog.getLocalWorkDetail(result.workId);
	expect(detail.episodes[0]).toMatchObject({
		id: episodeId,
		number: "1",
		label: "Custom episode title",
	});
	f.setData({ ...details(), description: "Updated provider text" });
	await f.catalog.refresh(result.workId, detail.work.revision);
	await f.restart();
	f.get.mockRejectedValue(new Error("offline"));
	detail = await f.catalog.getLocalWorkDetail(result.workId);
	expect(detail.work.displayTitle).toBe(originalTitle);
	expect(detail.metadata.data.description).toBe("Updated provider text");
	expect(f.database.playback.get(review.sourceId)).toEqual(progress);
	expect((await f.catalog.list({ query: "Anime" })).items).toHaveLength(1);
});

test("movies and unknown counts preserve explicit targets without inventing canonical episode records", async () => {
	const f = await fixture();
	f.setData({ ...details(), format: "MOVIE", episodeCount: 1 });
	const selected = await rows(f);
	required(selected[0]).targets = [{ kind: "movie", number: "whole" }];
	const movie = await confirm(f, Promise.resolve(selected));
	expect(
		(await f.catalog.getLocalWorkDetail(movie.workId)).episodes,
	).toHaveLength(1);
	expect(
		(await f.catalog.getLocalWorkDetail(movie.workId)).episodes[0],
	).toMatchObject({
		kind: "movie",
		number: "whole",
		provenance: "confirmed",
	});
	f.setData({ ...details(), episodeCount: null });
	const regularRows = await rows(f, ["75"]);
	const preview = await f.catalog.preview({
		reference: project(f, "2"),
		rows: regularRows,
	});
	const unknown = await f.catalog.confirm({
		operationKey: "unknown-count",
		previewId: preview.id,
		replace: true,
	});
	const detail = await f.catalog.getLocalWorkDetail(unknown.workId);
	expect(detail.episodes).toHaveLength(1);
	expect(detail.episodeCountProvenance).toBe("unknown");
	expect(detail.episodes[0]?.number).toBe("75");
});

test("source playback metadata follows local edits, removal and replacement", async () => {
	const f = await fixture();
	const review = required((await f.catalog.reviews()).items[0]);
	expect((await f.catalog.source(review.fileId)).associations).toEqual([]);
	f.setData({ ...details(), episodeCount: null });
	const confirmed = await confirm(f);
	const detail = await f.catalog.getLocalWorkDetail(confirmed.workId);
	const episode = required(
		detail.episodes.find((item) => item.versions.length),
	);
	await f.catalog.editEpisode(
		detail.work.id,
		episode.id,
		detail.work.revision,
		"3",
		"Local episode",
	);
	expect(await f.catalog.source(review.fileId)).toEqual({
		sourceVersion: review.sourceVersion,
		associations: [
			{
				workId: confirmed.workId,
				workTitle: detail.work.providerTitle,
				reference: project(f),
				episodeId: episode.id,
				kind: "regular",
				number: "3",
				label: "Local episode",
			},
		],
	});
	const app = createHttpApp({
		catalog: f.catalog,
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
	});
	cleanups.push(() => app.close());
	const response = await app.inject({
		url: `/api/catalog/sources/${review.fileId}`,
	});
	expect(response.statusCode).toBe(200);
	expect(response.json()).toEqual(await f.catalog.source(review.fileId));
	expect(response.headers["cache-control"]).toBe("no-store");
	expect(response.body).not.toContain(f.root);
	const current = await f.catalog.review(review.id);
	await f.catalog.remove(current.id, current.revision, "Remove match");
	expect((await f.catalog.source(review.fileId)).associations).toEqual([]);
	await confirm(f);
	await writeFile(
		join(f.root, review.relativePath),
		"replaced source contents",
	);
	await f.scan();
	expect((await f.catalog.source(review.fileId)).associations).toEqual([]);
});
