import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import pino from "pino";
import { expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../../../../src/app/bootstrap/database.js";
import type { ReviewItem } from "../../../../src/modules/anime/anime-catalog/public.js";
import {
	BangumiClient,
	BangumiError,
} from "../../../../src/modules/anime/external-works/bangumi/public.js";
import { TrackingViewingCommands } from "../../../../src/modules/anime/external-works/tracking/application/viewing.js";
import { createTrackingModule } from "../../../../src/modules/anime/external-works/tracking/create.js";
import {
	BangumiTrackingProvider,
	bangumiTracking,
} from "../../../../src/modules/anime/external-works/tracking/infrastructure/bangumi-provider.js";
import { aniListTracking } from "../../../../src/modules/anime/external-works/tracking/infrastructure/provider-mapping.js";
import { fixtureIdentities } from "../../../support/metadata-identities.js";

const mediaId = "bangumi:anime:42";
const account = { id: 7, nickname: "Bangumi viewer", username: "viewer" };
const episodes = [101, 102, 103, 104].map((id, index) => ({
	id,
	ep: index + 1,
	type: 0 as const,
}));
const lease = {
	accountId: "bangumi:7",
	generation: "test",
	credential: "bangumi-token",
	signal: new AbortController().signal,
};
function collection(id: number, progress: number, type: 1 | 2 | 3 | 4 | 5 = 3) {
	return {
		subject_id: id,
		subject_type: 2 as const,
		type,
		ep_status: progress,
		updated_at: "2026-09-07T02:03:04Z",
		subject: { id, name: "Original title", name_cn: "Chinese title", eps: 4 },
	};
}

function fixture(initial: number[]) {
	const watched = new Set(initial);
	let status: 1 | 2 | 3 | 4 | 5 = 3;
	const client = {
		viewer: vi.fn(async () => account),
		collections: vi.fn(async () => [collection(42, watched.size, status)]),
		collection: vi.fn(async () => collection(42, watched.size, status)),
		episodes: vi.fn(async () => episodes),
		episodeCollections: vi.fn(async () =>
			episodes
				.filter(({ id }) => watched.has(id))
				.map((episode) => ({ episode, type: 2 as const })),
		),
		writeCollection: vi.fn(async (_id: number, value: typeof status) => {
			status = value;
		}),
		writeEpisodes: vi.fn(async (_id: number, ids: number[], type: 0 | 2) => {
			for (const id of ids) {
				if (type === 2) watched.add(id);
				else watched.delete(id);
			}
		}),
	};
	return { client, watched, provider: new BangumiTrackingProvider(client) };
}

test("Bangumi authenticates and paginates animation collections, including private entries", async () => {
	vi.useFakeTimers();
	const fetch = vi.fn<typeof globalThis.fetch>(async (request) => {
		assert(request instanceof Request);
		expect(request.headers.get("authorization")).toBe("Bearer bangumi-token");
		const url = new URL(request.url);
		if (url.pathname === "/v0/me") return Response.json(account);
		expect(url.pathname).toBe("/v0/users/viewer/collections");
		expect(url.searchParams.get("subject_type")).toBe("2");
		const offset = Number(url.searchParams.get("offset"));
		return Response.json({
			total: 2,
			limit: 1,
			offset,
			data: [
				{
					...collection(42 + offset, offset, offset === 0 ? 3 : 4),
					private: offset === 1,
				},
			],
		});
	});
	const client = new BangumiClient({ logger: pino({ enabled: false }), fetch });
	try {
		const provider = new BangumiTrackingProvider(client);
		const reading = provider.read(lease, lease.signal);
		await vi.advanceTimersByTimeAsync(3100);
		expect(await reading).toMatchObject([
			{ mediaId, progress: 0, status: "watching" },
			{ mediaId: "bangumi:anime:43", progress: 1, status: "paused" },
		]);
		expect(fetch).toHaveBeenCalledTimes(3);
	} finally {
		client.close();
		vi.useRealTimers();
	}
});

test("Bangumi propagates rate limits and signals an invalid token for account reconnect", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response(null, { status: 401 }))
		.mockResolvedValueOnce(
			new Response(null, { status: 429, headers: { "Retry-After": "180" } }),
		);
	const client = new BangumiClient({ logger: pino({ enabled: false }), fetch });
	try {
		const provider = new BangumiTrackingProvider(client);
		await expect(
			provider.viewer(lease.credential, lease.signal),
		).rejects.toMatchObject({ code: "TRACKING_AUTHORIZATION_REQUIRED" });
		await expect(provider.read(lease, lease.signal)).rejects.toMatchObject({
			code: "rate-limited",
			retryAt: expect.any(Number),
		});
		await expect(provider.read(lease, lease.signal)).rejects.toMatchObject({
			code: "rate-limited",
		});
		expect(fetch).toHaveBeenCalledTimes(2);
	} finally {
		client.close();
	}
});

test("manual progress can normalize an unchanged count, advance, and clear watched marks", async () => {
	const { provider, client, watched } = fixture([101, 103]);
	const remote = await provider.get(lease, mediaId, lease.signal);
	expect(
		await provider.inspectProgress(
			lease,
			mediaId,
			remote,
			2,
			true,
			lease.signal,
		),
	).toMatchObject({ state: "confirmation-required" });
	expect(
		await provider.inspectProgress(
			lease,
			mediaId,
			remote,
			2,
			false,
			lease.signal,
		),
	).toMatchObject({ state: "write" });
	await expect(
		provider.save(lease, mediaId, "bangumi:42", { progress: 2 }, lease.signal),
	).resolves.toMatchObject({ progress: 2 });
	expect(
		client.writeEpisodes.mock.calls.map(([, ids, type]) => [ids, type]),
	).toEqual([
		[[103], 0],
		[[102], 2],
	]);
	expect([...watched]).toEqual([101, 102]);

	await provider.save(
		lease,
		mediaId,
		"bangumi:42",
		{ progress: 4 },
		lease.signal,
	);
	await provider.save(
		lease,
		mediaId,
		"bangumi:42",
		{ progress: 1 },
		lease.signal,
	);
	expect([...watched]).toEqual([101]);
	client.writeEpisodes.mockClear();
	await expect(
		provider.save(
			lease,
			mediaId,
			"bangumi:42",
			{ status: "paused" },
			lease.signal,
		),
	).resolves.toMatchObject({ status: "paused", progress: 1 });
	expect(client.writeEpisodes).not.toHaveBeenCalled();
});

test("Bangumi rejects ambiguous chapter catalogs before any write", async () => {
	const { provider, client } = fixture([101]);
	client.episodes.mockResolvedValue([
		{ id: 101, ep: 1, type: 0 },
		{ id: 102, ep: 1, type: 0 },
	]);
	await expect(
		provider.save(lease, mediaId, "bangumi:42", { progress: 2 }, lease.signal),
	).rejects.toMatchObject({ code: "invalid-request" });
	expect(client.writeCollection).not.toHaveBeenCalled();
	expect(client.writeEpisodes).not.toHaveBeenCalled();
});

test("confirmation switches provider across restart and recovers partial writes as conflicts", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-bangumi-tracking-"));
	let db = ApplicationDatabase.open(directory);
	const { provider, client, watched } = fixture([101, 103]);
	let oldSignal: AbortSignal | undefined;
	const build = () =>
		createTrackingModule({
			dataDir: directory,
			store: db.tracking,
			listStore: db.trackingLists,
			operationStore: db.trackingOperations,
			descriptor: aniListTracking,
			accountProvider: {
				viewer: async () => ({ id: "anilist:7", name: "AniList viewer" }),
			},
			listProvider: {
				read: async (_lease, signal) => {
					oldSignal = signal;
					return new Promise((resolve) => {
						signal.addEventListener("abort", () => resolve([]), { once: true });
					});
				},
			},
			updateProvider: {
				get: async () => null,
				save: async () => {
					throw new Error("Unexpected AniList write");
				},
			},
			additionalProviders: [
				{
					descriptor: bangumiTracking,
					accountProvider: provider,
					listProvider: provider,
					updateProvider: provider,
				},
			],
		});
	let tracking = await build();
	try {
		const ani = await tracking.preview("session", "anilist-token");
		const aniStatus = await tracking.confirm(
			"session",
			ani.candidateId,
			ani.generation,
		);
		const oldRefresh = tracking
			.refreshList(aniStatus.generation)
			.catch(() => undefined);
		await vi.waitFor(() => expect(oldSignal).toBeDefined());
		const pending = await tracking.preview(
			"session",
			lease.credential,
			"bangumi",
		);
		expect(tracking.status()).toMatchObject({
			account: aniStatus.account,
			generation: aniStatus.generation,
		});
		await expect(
			tracking.confirm(
				"different-session",
				pending.candidateId,
				pending.generation,
			),
		).rejects.toMatchObject({ code: "TRACKING_CONFLICT" });
		expect(tracking.status().provider.key).toBe("anilist");
		await tracking.confirm("session", pending.candidateId, pending.generation);
		await oldRefresh;
		expect(oldSignal?.aborted).toBe(true);
		await tracking.close();
		db.close();
		db = ApplicationDatabase.open(directory);
		tracking = await build();
		expect(tracking.status()).toMatchObject({
			provider: { key: "bangumi" },
			state: "connected",
		});
		expect(tracking.status().providers?.map(({ key }) => key)).toEqual([
			"anilist",
			"bangumi",
		]);

		const snapshot = await tracking.refreshList();
		const baseline = snapshot.entries[0];
		assert(baseline);
		const write = client.writeEpisodes.getMockImplementation();
		assert(write);
		client.writeEpisodes.mockImplementationOnce(write).mockRejectedValueOnce(
			new BangumiError({
				code: "unauthorized",
				message: "Expired",
				retryAt: null,
			}),
		);
		const command = tracking.update(mediaId, {
			generation: snapshot.generation,
			revision: null,
			baseline,
			desired: { progress: 2 },
		});
		await vi.waitFor(() =>
			expect(tracking.status().state).toBe("authorization-required"),
		);
		expect([...watched]).toEqual([101]);
		expect(tracking.operations(snapshot.generation)[0]).toMatchObject({
			id: command.id,
			state: "authorization-required",
			attempt: { episodeBaseline: expect.any(String) },
		});
		const replacement = await tracking.preview(
			"session",
			lease.credential,
			"bangumi",
		);
		const reconnected = await tracking.confirm(
			"session",
			replacement.candidateId,
			replacement.generation,
		);
		await vi.waitFor(() =>
			expect(tracking.operations(reconnected.generation)[0]).toMatchObject({
				id: command.id,
				state: "conflict",
				desired: { progress: 2 },
				remote: { progress: 1 },
			}),
		);
		expect(client.writeEpisodes).toHaveBeenCalledTimes(2);

		const reference = {
			id: "42",
			provider: "bangumi",
			mediaType: "anime" as const,
		};
		const identities = fixtureIdentities("bangumi");
		const association = {
			kind: "regular" as const,
			number: "2",
			episodeId: "episode",
			reference: identities.referenceForExternal(reference),
		};
		const review = {
			id: "review",
			revision: 1,
			available: true,
			decision: "confirmed" as const,
			sourceVersion: "v1",
			associations: [association],
		};

		const catalog = { fileReviews: async () => [review as ReviewItem] };
		const viewing = new TrackingViewingCommands(
			catalog,
			tracking,
			undefined,
			undefined,
			identities,
		);
		await expect(viewing.resolveTarget("file", "v1")).resolves.toMatchObject({
			state: "resolved",
			target: { mediaId, episode: 2 },
		});
		const conflicting = tracking.operations(reconnected.generation)[0];
		assert(conflicting);
		await tracking.resolveOperation(
			conflicting.id,
			{ generation: reconnected.generation, revision: conflicting.revision },
			true,
		);
		const captured = await viewing.capture("file", "v1");
		assert(captured);
		await expect(viewing.submit(captured, randomUUID())).resolves.toMatchObject(
			{ state: "accepted" },
		);
		await vi.waitFor(() =>
			expect(tracking.operations(reconnected.generation)[0]).toMatchObject({
				state: "succeeded",
				origin: "automatic",
			}),
		);
		expect([...watched]).toEqual([101, 102]);
		const aniListViewing = new TrackingViewingCommands(
			catalog,
			tracking,
			undefined,
			undefined,
			fixtureIdentities("anilist"),
		);
		await expect(
			aniListViewing.resolveTarget("file", "v1"),
		).resolves.toMatchObject({ state: "unsupported" });
	} finally {
		await tracking.close();
		db.close();
		await rm(directory, { recursive: true, force: true });
	}
});

test("migration preserves an AniList connection from the singleton schema", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-tracking-upgrade-"));
	try {
		const initial = ApplicationDatabase.open(directory);
		initial.tracking.save({
			account: { id: "anilist:7", name: "AniList viewer" },
			generation: "old-generation",
			credentialId: "old-credential",
			state: "connected",
			checkedAt: 123,
		});
		initial.close();
		const raw = new Database(join(directory, "anishelf.sqlite"));
		try {
			raw.exec(`
				ALTER TABLE tracking_connection DROP COLUMN provider_key;
				ALTER TABLE tracking_operations DROP COLUMN attempt_episode_baseline;
				ALTER TABLE tracking_operations DROP COLUMN attempt_automatic;
				DELETE FROM __drizzle_migrations
				WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations);
			`);
		} finally {
			raw.close();
		}
		const upgraded = ApplicationDatabase.open(directory);
		try {
			expect(upgraded.tracking.get()).toEqual({
				providerKey: "anilist",
				account: { id: "anilist:7", name: "AniList viewer" },
				generation: "old-generation",
				credentialId: "old-credential",
				state: "connected",
				checkedAt: 123,
			});
		} finally {
			upgraded.close();
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
