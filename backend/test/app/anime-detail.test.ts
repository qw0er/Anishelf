import pino from "pino";
import { expect, test, vi } from "vitest";
import { registerAnimeDetailRoutes } from "../../src/app/anime-detail.js";
import { createHttpApp } from "../../src/app/bootstrap/http.js";
import { MetadataError } from "../../src/modules/anime/metadata/public.js";
import { AnimeQueries } from "../../src/modules/anime/queries.js";
import type { TrackingListSnapshot } from "../../src/modules/anime/tracking/public.js";
import { DomainError } from "../../src/shared/errors.js";
import { workKey } from "../../src/shared/external-reference.js";
import { fixtureAssociations } from "../support/metadata-associations.js";

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
	const status = vi.fn(() => ({
		generation: "generation",
		provider: tracking().provider,
		account: { id: "account", name: "Fixture" },
		state: "connected" as const,
		connectivity: "available" as const,
		checkedAt: 1,
	}));
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
		{ list, status },
		logger,
		fixtureAssociations(),
	);
	return { queries, list, status, get, findLocalWork, getLocalWorkDetail };
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
					{ queries: f.queries, tracking: { status: f.status, list: f.list } },
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
			displayTitle: "Cached title",
			local: null,
			metadata: null,
			metadataError: { code: "unavailable" },
		});
		expect(discovery.get).not.toHaveBeenCalled();
		expect(downloads.summary).not.toHaveBeenCalled();
		expect(response.json()).not.toHaveProperty("viewing");
		const status = await app.inject({
			url: `/api/anime/status/${encodeURIComponent(key)}`,
			headers: { host: "127.0.0.1" },
		});
		expect(status.statusCode).toBe(200);
		expect(status.headers["cache-control"]).toBe("no-store");
		expect(status.json()).toMatchObject({
			viewing: { entry: { progress: 4 } },
			subscription: { subscription: null },
			downloads: { total: 3, active: 2, attention: 1 },
		});
		expect(status.json().downloads).not.toHaveProperty("items");
		expect(discovery.get).toHaveBeenCalledExactlyOnceWith(key, 1, false);
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
test("an account change during an asynchronous read rejects the old aggregate", async () => {
	const f = fixture();
	f.status.mockReturnValue({ ...f.status(), generation: "new-generation" });
	await expect(f.queries.detail({ key })).rejects.toMatchObject({
		code: "TRACKING_CONFLICT",
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
