import { expect, test, vi } from "vitest";
import type { ReviewItem } from "../src/modules/anime/anime-catalog/public.js";
import { TrackingCompletions } from "../src/modules/anime/tracking/application/completion.js";
import type {
	TrackingListEntry,
	TrackingListSnapshot,
} from "../src/modules/anime/tracking/domain/list.js";
import type { TrackingStatus } from "../src/modules/anime/tracking/domain/model.js";
import type {
	TrackingOperation,
	TrackingUpdate,
} from "../src/modules/anime/tracking/domain/operation.js";

function fixture(number = "4") {
	const review: ReviewItem = {
		id: "review",
		sourceId: "source",
		rootId: "root",
		fileId: "file",
		relativePath: "Episode.mkv",
		sourceVersion: "v1",
		available: true,
		revision: 1,
		decision: "confirmed",
		reason: null,
		evidence: {
			parser: "fixture",
			parserVersion: "1",
			normalizationVersion: "1",
			contextFingerprint: "context",
			originalName: "Episode.mkv",
			relativePath: "Episode.mkv",
			inputs: [],
			titles: [],
			years: [],
			seasons: [],
			parts: [],
			rawEpisodes: [number],
			numbering: "single",
			contentKind: "regular",
		},
		proposals: [],
		metadataStatus: "searched",
		unresolved: [],
		associations: [
			{
				workId: "work",
				workTitle: "Anime",
				reference: { provider: "anilist", id: "9", mediaType: "anime" },
				episodeId: "episode",
				kind: "regular",
				number,
				label: `Episode ${number}`,
			},
		],
	};
	const status: TrackingStatus = {
		account: { id: 7, name: "Fixture" },
		generation: "generation",
		state: "connected",
		clientId: "client",
		authorizationUrl: "https://example.test",
		connectivity: "available",
		checkedAt: null,
	};
	const entry: TrackingListEntry = {
		id: 10,
		mediaId: 9,
		progress: 3,
		status: "CURRENT",
		updatedAt: 100,
		titles: ["Anime"],
		format: "TV",
		year: 2026,
		episodeCount: 12,
		coverUrl: null,
	};
	const snapshot: TrackingListSnapshot = {
		accountId: 7,
		generation: "generation",
		state: "connected",
		fetchedAt: 100,
		stale: false,
		refreshing: false,
		error: null,
		entries: [entry],
	};
	const operations: TrackingOperation[] = [];
	const update = vi.fn(
		(mediaId: number, input: TrackingUpdate): TrackingOperation => {
			const operation: TrackingOperation = {
				id: "op",
				accountId: 7,
				mediaId,
				revision: 1,
				baseline: input.baseline,
				desired: input.desired,
				state: "pending",
				remote: input.baseline,
				attempt: null,
				attempts: 0,
				retryAt: null,
				error: null,
				updatedAt: 2000,
				completion: input.completion ?? false,
			};
			operations.splice(0, operations.length, operation);
			return operation;
		},
	);
	const fileReviews = vi.fn(async () => [review]);
	const service = new TrackingCompletions(
		{ fileReviews },
		{
			status: () => status,
			list: () => snapshot,
			operations: () => operations,
			update,
		},
	);
	const capture = async () => {
		const context = await service.capture("file", "v1");
		if (!context) throw new Error("No target");
		return context;
	};
	return {
		review,
		status,
		entry,
		snapshot,
		operations,
		update,
		fileReviews,
		service,
		capture,
	};
}

test("admits only absolute contiguous progress, deduplicates repeated and alternate version completions", async () => {
	const f = fixture();
	const context = await f.capture();
	expect(await f.service.submit(context, 1000, null)).toMatchObject({
		state: "queued",
	});
	expect(f.update).toHaveBeenCalledWith(
		9,
		expect.objectContaining({
			baseline: { id: 10, progress: 3, status: "CURRENT", updatedAt: 100 },
			desired: { progress: 4 },
			completion: true,
		}),
	);
	expect(await f.service.submit(context, 1000, null)).toMatchObject({
		state: "skipped",
		reason: "already-tracked",
	});
	f.review.sourceVersion = "v2";
	const alternate = await f.service.capture("file", "v2");
	expect(await f.service.submit(alternate ?? "", 1000, null)).toMatchObject({
		state: "skipped",
		reason: "already-tracked",
	});
	expect(f.update).toHaveBeenCalledTimes(1);
});

test("skipped episodes require explicit confirmation or may keep the existing progress", async () => {
	const f = fixture("7");
	const context = await f.capture();
	expect(await f.service.submit(context, 1000, null)).toMatchObject({
		state: "decision-required",
		reason: "skipped-episodes",
		episode: 7,
	});
	expect(f.update).not.toHaveBeenCalled();
	expect(
		await f.service.submit(context, 1000, { advance: false }),
	).toMatchObject({ state: "skipped", reason: "kept-progress" });
	expect(
		await f.service.submit(context, 1000, { advance: true }),
	).toMatchObject({ state: "queued" });
	expect(f.update.mock.calls[0]?.[1].desired).toEqual({ progress: 7 });
});

test("creating an entry requires a user-selected initial status; automatic updates preserve existing status", async () => {
	const f = fixture("1");
	f.snapshot.entries = [];
	const context = await f.capture();
	expect(await f.service.submit(context, 1000, null)).toMatchObject({
		state: "decision-required",
		reason: "initial-status-required",
	});
	expect(
		await f.service.submit(context, 1000, { advance: true }),
	).toMatchObject({ state: "decision-required" });
	expect(
		await f.service.submit(context, 1000, {
			advance: true,
			initialStatus: "PLANNING",
		}),
	).toMatchObject({ state: "queued" });
	expect(f.update.mock.calls[0]?.[1].desired).toEqual({
		progress: 1,
		status: "PLANNING",
	});
});

test("newer manual backwards corrections take precedence over late completion and explicit decisions", async () => {
	const f = fixture();
	const context = await f.capture();
	const op = f.update(9, {
		generation: "generation",
		revision: null,
		baseline: { id: 10, progress: 3, status: "CURRENT", updatedAt: 100 },
		desired: { progress: 1 },
	});
	op.state = "succeeded";
	f.entry.progress = 1;
	f.update.mockClear();
	expect(
		await f.service.submit(context, 1000, { advance: true }),
	).toMatchObject({ state: "skipped", reason: "manual-change" });
	expect(f.update).not.toHaveBeenCalled();
});

test.each(["revision", "source", "association", "unavailable"])(
	"revalidates %s before admission",
	async (change) => {
		const f = fixture();
		const context = await f.capture();
		if (change === "revision") f.review.revision++;
		if (change === "source") f.review.sourceVersion = "v2";
		if (change === "association" && f.review.associations[0])
			f.review.associations[0].number = "5";
		if (change === "unavailable") f.review.available = false;
		expect(await f.service.submit(context, 1000, null)).toMatchObject({
			state: "skipped",
			reason: "mapping-changed",
		});
		expect(f.update).not.toHaveBeenCalled();
	},
);

test("isolates accounts and retains authorization/list failures for retry", async () => {
	const f = fixture();
	const context = await f.capture();
	f.status.state = "authorization-required";
	expect(await f.service.submit(context, 1000, null)).toMatchObject({
		state: "unavailable",
		reason: "reconnect-required",
	});
	f.status.state = "connected";
	f.snapshot.fetchedAt = null;
	expect(await f.service.submit(context, 1000, null)).toMatchObject({
		state: "unavailable",
		reason: "list-unavailable",
	});
	f.status.generation = "replacement";
	f.status.account = { id: 8, name: "Different account" };
	expect(await f.service.submit(context, 1000, null)).toMatchObject({
		state: "skipped",
		reason: "account-changed",
	});
	expect(f.update).not.toHaveBeenCalled();
});

test.each(["special", "fractional", "multiple", "pending"])(
	"does not infer %s targets",
	async (kind) => {
		const f = fixture();
		const association = f.review.associations[0];
		if (!association) throw new Error("Missing target");
		if (kind === "special") association.kind = "special";
		if (kind === "fractional") association.number = "4.5";
		if (kind === "multiple")
			f.review.associations.push({
				...association,
				episodeId: "another",
				number: "5",
			});
		if (kind === "pending") f.review.decision = "pending";
		expect(await f.service.capture("file", "v1")).toBeNull();
	},
);

test("same-account reconnection reconciles with the new generation rather than losing saved completion", async () => {
	const f = fixture();
	const context = await f.capture();
	f.status.generation = "reconnected";
	f.snapshot.generation = "reconnected";
	expect(await f.service.submit(context, 1000, null)).toMatchObject({
		state: "queued",
	});
	expect(f.update).toHaveBeenCalledWith(
		9,
		expect.objectContaining({
			generation: "reconnected",
			baseline: expect.objectContaining({ progress: 3 }),
			desired: { progress: 4 },
		}),
	);
});
