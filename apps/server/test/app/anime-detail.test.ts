import { workKey } from "@anishelf/contracts/references";
import pino from "pino";
import { expect, test, vi } from "vitest";
import { registerAnimeDetailRoutes } from "../../src/app/anime-detail.js";
import { createHttpApp } from "../../src/app/bootstrap/http.js";
import { AnimeLibraryQueries } from "../../src/modules/anime/anime-library/application/library.js";
import { MetadataError } from "../../src/modules/anime/external-works/metadata/public.js";
import type { TrackingListSnapshot } from "../../src/modules/anime/external-works/tracking/public.js";
import { AnimeQueries } from "../../src/modules/anime/queries.js";
import { DomainError } from "../../src/shared/errors.js";
import {
	fixture as catalogFixture,
	confirm,
	setupTestLifecycle,
} from "../modules/anime/catalog/support/anime-catalog-fixture.js";
import { fixtureIdentities } from "../support/metadata-identities.js";

setupTestLifecycle();

const logger = pino({ enabled: false });
const reference = {
	provider: "fixture",
	mediaType: "anime",
	id: "作品/:1",
} as const;
const key = workKey(reference);
function tracking(): TrackingListSnapshot {
	return {
		provider: {
			key: "fixture",
			name: "Fixture",
			authorization: { kind: "credential", label: "Token", url: null },
			capabilities: {
				progress: "cumulative-episodes",
				maximumProgress: 2147483647,
				statuses: ["watching"],
			},
		},
		accountId: "account",
		generation: "generation",
		state: "connected",
		fetchedAt: 1,
		stale: false,
		refreshing: false,
		error: null,
		entries: [
			{
				id: "entry",
				mediaId: key,
				titles: ["Cached title"],
				format: "TV",
				year: 2026,
				episodeCount: 12,
				coverUrl: null,
				status: "watching",
				progress: 4,
				updatedAt: 1,
			},
		],
	};
}
function fixture() {
	const list = vi.fn(() => tracking());
	const get = vi.fn(async () => {
		throw new MetadataError({
			code: "unavailable",
			message: "Provider unavailable",
			retryAt: 100,
		});
	});
	const findLocalWork = vi.fn(async () => null);
	const getLocalWorkDetail = vi.fn();
	const queries = new AnimeQueries(
		{ findLocalWork, getLocalWorkDetail },
		{ get },
		logger,
		fixtureIdentities(),
	);
	return { queries, list, get, findLocalWork, getLocalWorkDetail };
}
test("detail and lightweight status remain independent during a metadata outage", async () => {
	const f = fixture();
	const subscription = {
		subscription: null,
		candidates: [],
		total: 0,
		page: 1,
	};
	const discovery = { get: vi.fn(() => subscription) };
	const downloads = {
		summary: vi.fn(() => ({
			authorized: true,
			destination: "Anime [fixture-1]",
			items: [],
			total: 3,
			active: 2,
			attention: 1,
			managedCandidateIds: [],
			page: 1,
		})),
	};
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 80 },
		closeDependencies: async () => {},
		logger,
		registrations: [
			(app) =>
				registerAnimeDetailRoutes(
					app,
					{ queries: f.queries, tracking: { list: f.list } },
					{ subscriptions: discovery, downloads },
					logger,
				),
		],
	});
	try {
		const response = await app.inject({
			method: "GET",
			headers: { host: "127.0.0.1" },
			url: `/api/anime/details/works/${encodeURIComponent(key)}`,
		});
		expect(response.statusCode).toBe(200);
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(response.json()).toMatchObject({
			reference,
			displayTitle: key,
			local: null,
			metadata: null,
			metadataError: { code: "unavailable" },
		});
		expect(discovery.get).not.toHaveBeenCalled();
		expect(f.list).not.toHaveBeenCalled();
		expect(downloads.summary).not.toHaveBeenCalled();
		expect(response.json()).not.toHaveProperty("viewing");
		const status = await app.inject({
			url: `/api/anime/status/${encodeURIComponent(key)}`,
			headers: { host: "127.0.0.1" },
		});
		expect(status.statusCode).toBe(200);
		expect(status.headers["cache-control"]).toBe("no-store");
		expect(status.json()).toMatchObject({
			viewing: { entry: { progress: 4, titles: ["Cached title"] } },
			subscription: { subscription: null },
			downloads: { total: 3, active: 2, attention: 1 },
		});
		expect(status.json().downloads).not.toHaveProperty("items");
		expect(discovery.get).toHaveBeenCalledExactlyOnceWith(key, {
			includeDiagnostics: false,
		});
		const invalid = await app.inject({
			url: "/api/anime/status/malformed",
			headers: { host: "127.0.0.1" },
		});
		expect(invalid.statusCode).toBe(400);
		expect(downloads.summary).toHaveBeenCalledExactlyOnceWith(key);
		expect(f.getLocalWorkDetail).not.toHaveBeenCalled();
		expect(f.get).toHaveBeenCalledTimes(1);
	} finally {
		await app.close();
	}
});
test("the signed-out wall lists only confirmed works and both detail links read their metadata", async () => {
	const f = await catalogFixture();
	const { workId } = await confirm(f);
	const metadata = f.publicMetadata;
	const cachedOnly = await metadata.get(metadata.resolveReference("2"));
	const list = vi.fn(() => {
		throw new Error("Unexpected tracking read");
	});
	const library = new AnimeLibraryQueries({
		catalog: f.catalog,
		identities: metadata.identities,
		logger,
		lists: { list, refreshList: vi.fn() },
	});
	const wall = await library.list({ scope: "all", includeTracking: false });
	expect(wall.items.map((card) => card.localWorkId)).toEqual([workId]);
	expect(wall.items[0]).toMatchObject({
		displayTitle: "葬送のフリーレン",
		availableEpisodes: 1,
		viewing: null,
	});
	expect(list).not.toHaveBeenCalled();
	const queries = new AnimeQueries(
		f.catalog,
		metadata,
		logger,
		metadata.identities,
	);
	const local = await queries.detail({ localWorkId: workId });
	expect(local).toMatchObject({
		displayTitle: "葬送のフリーレン",
		metadata: { data: { description: "Original provider text" } },
		local: { work: { id: workId, availableEpisodes: 1 } },
	});
	expect(
		(await queries.detail({ key: workKey(local.reference) })).local?.work.id,
	).toBe(workId);
	await expect(
		queries.detail({ key: workKey({ ...local.reference, id: "2" }) }),
	).resolves.toMatchObject({
		metadata: { snapshotId: cachedOnly.snapshotId },
		local: null,
	});
});
test("remote detail remains usable without configured local roots and rejects malformed identities", async () => {
	const f = fixture();
	f.findLocalWork.mockRejectedValue(
		new DomainError("RESOURCE_ROOT_NOT_CONFIGURED", "No roots."),
	);
	expect((await f.queries.detail({ key })).local).toBeNull();
	await expect(f.queries.detail({ key: "malformed" })).rejects.toMatchObject({
		code: "INVALID_REQUEST",
	});
});
