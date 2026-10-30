import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../../../../src/app/bootstrap/database.js";
import type { ReviewItem } from "../../../../src/modules/anime/anime-catalog/public.js";
import { TrackingUpdates } from "../../../../src/modules/anime/tracking/application/updates.js";
import { TrackingViewingCommands } from "../../../../src/modules/anime/tracking/application/viewing.js";
import type { TrackingStatus } from "../../../../src/modules/anime/tracking/domain/model.js";
import type { TrackingRemoteState } from "../../../../src/modules/anime/tracking/domain/operation.js";
import { aniListTracking } from "../../../../src/modules/anime/tracking/infrastructure/provider-mapping.js";
import type { TrackingEpisodeCommand } from "../../../../src/modules/anime/tracking/public.js";
import { fixtureAssociations } from "../../../support/metadata-associations.js";

const dispose: (() => unknown)[] = [];
afterEach(async () => {
	for (const fn of dispose.splice(0).reverse()) await fn();
});
async function fixture(number = "4") {
	const database = ApplicationDatabase.openMemory();
	dispose.push(() => database.close());
	const review = {
		id: "review",
		available: true,
		decision: "confirmed",
		sourceVersion: "v1",
		revision: 1,
		associations: [
			{
				reference: { id: "9" },
				kind: "regular",
				number,
				episodeId: "ep",
			},
		],
	} as ReviewItem;
	const status: TrackingStatus = {
		account: { id: "anilist:7", name: "Fixture" },
		generation: randomUUID(),
		state: "connected",
		provider: aniListTracking,
		connectivity: "available",
		checkedAt: null,
	};
	let remote: TrackingRemoteState | null = {
		id: "anilist:10",
		progress: 3,
		status: "watching",
		updatedAt: 100,
	};
	let now = 1000;
	const save = vi.fn(
		async (
			_lease: unknown,
			_media: unknown,
			_id: unknown,
			desired: Partial<TrackingRemoteState>,
		) =>
			(remote = {
				...(remote ?? {
					id: "anilist:10",
					progress: 0,
					status: "watching",
					updatedAt: 0,
				}),
				...desired,
				updatedAt: now,
			}),
	);
	const get = vi.fn(async () => remote);
	const updates = new TrackingUpdates({
		store: database.trackingOperations,
		access: {
			status: () => status,
			assertCurrent: (g) => {
				if (g !== status.generation) throw Error("stale");
			},
			acquire: async () => ({
				accountId: status.account?.id ?? "",
				generation: status.generation,
				credential: "secret",
				signal: new AbortController().signal,
			}),
			authorizationFailed: () => {
				status.state = "authorization-required";
			},
		},
		provider: { get, save },
		confirmed: () => {},
		now: () => now,
	});
	dispose.push(() => updates.close());
	const service = new TrackingViewingCommands(
		{ fileReviews: async () => [review] },
		{
			status: () => status,
			list: () => ({
				provider: aniListTracking,
				accountId: "anilist:7",
				generation: status.generation,
				state: status.state,
				fetchedAt: now,
				stale: false,
				refreshing: false,
				error: null,
				entries: remote
					? [
							{
								...remote,
								mediaId: "anilist:anime:9",
								titles: ["Fixture"],
								format: "TV",
								year: 2026,
								episodeCount: 12,
								coverUrl: null,
							},
						]
					: [],
			}),
			operations: (g) => updates.operations(g),
			update: (id, input) => updates.update(id, input),
			manualVersion: (id, g) => updates.manualVersion(id, g),
			replayCommand: (id, g) => updates.replayCommand(id, g),
		},
		undefined,
		undefined,
		fixtureAssociations("anilist"),
	);
	const current = () => updates.operations(status.generation)[0];
	const required = () => {
		const operation = current();
		if (!operation) throw Error("Missing operation");
		return operation;
	};
	const command = (
		overrides: Partial<TrackingEpisodeCommand> = {},
	): TrackingEpisodeCommand => ({
		commandId: randomUUID(),
		generation: status.generation,
		revision: current()?.revision ?? null,
		fileId: "file",
		mappingRevision: 1,
		sourceVersion: "v1",
		action: "mark",
		...overrides,
	});
	const capture = async () => {
		const context = await service.capture("file", "v1");
		if (!context) throw Error("No target");
		return context;
	};
	return {
		database,
		review,
		status,
		service,
		updates,
		save,
		get,
		current: required,
		command,
		capture,
		setRemote: (next: TrackingRemoteState | null) => {
			remote = next;
		},
		advance: () => {
			now += 100000;
		},
	};
}
test("automatic next episode and player manual marks share absolute intent and submission results", async () => {
	const f = await fixture();
	expect(await f.service.submit(await f.capture(), randomUUID())).toMatchObject(
		{ state: "accepted" },
	);
	expect(f.current()).toMatchObject({
		origin: "automatic",
		desired: { progress: 4 },
		state: "pending",
	});
	await f.updates.flush();
	expect(f.current().state).toBe("succeeded");
	expect(f.save).toHaveBeenCalledTimes(1);
	expect(await f.service.submit(await f.capture(), randomUUID())).toMatchObject(
		{ state: "ignored", reason: "already-tracked" },
	);
});
test("first manual mark requires skipped-episode confirmation instead of bypassing it", async () => {
	const f = await fixture("7");
	const operation = await f.service.mark(f.command());
	expect(operation).toMatchObject({
		state: "decision-required",
		decisionReason: "skipped-episodes",
		origin: "manual-player",
	});
	await f.updates.flush();
	expect(f.save).not.toHaveBeenCalled();
	await f.service.mark(f.command({ confirmSkipped: true }));
	await f.updates.flush();
	expect(f.current()).toMatchObject({
		state: "succeeded",
		remote: { progress: 7 },
	});
});
test("keeping progress then marking again creates a new usable decision", async () => {
	const f = await fixture("7");
	await f.service.mark(f.command());
	await f.service.mark(f.command({ action: "keep" }));
	expect(f.current().state).toBe("cancelled");
	const next = await f.service.mark(f.command());
	expect(next).toMatchObject({
		state: "decision-required",
		decisionReason: "skipped-episodes",
	});
	await f.service.mark(f.command({ confirmSkipped: true }));
	await f.updates.flush();
	expect(f.current().remote?.progress).toBe(7);
});
test("cancelled automatic desired progress is not counted as remotely tracked", async () => {
	const f = await fixture("7");
	await f.service.submit(await f.capture(), randomUUID());
	const op = f.current();
	f.database.trackingOperations.save({ ...op, state: "cancelled" });
	expect(await f.service.submit(await f.capture(), randomUUID())).toMatchObject(
		{ state: "accepted" },
	);
	expect(f.current().state).toBe("decision-required");
});
test("missing entries require an explicit initial status, while existing statuses are preserved", async () => {
	const f = await fixture("1");
	f.setRemote(null);
	await f.service.submit(await f.capture(), randomUUID());
	expect(f.current().decisionReason).toBe("initial-status-required");
	await f.service.mark(
		f.command({ confirmSkipped: true, initialStatus: "planned" }),
	);
	await f.updates.flush();
	expect(f.current().remote).toMatchObject({ progress: 1, status: "planned" });
	const association = f.review.associations[0];
	if (!association) throw Error("Missing association");
	association.number = "2";
	await f.service.mark(f.command({ initialStatus: "completed" }));
	await f.updates.flush();
	expect(f.current().remote).toMatchObject({ progress: 2, status: "planned" });
});
test("newer manual corrections fence old observations even after worker updates and pruning", async () => {
	const f = await fixture();
	const old = await f.capture();
	const op = f.updates.update("anilist:anime:9", {
		generation: f.status.generation,
		revision: null,
		baseline: {
			id: "anilist:10",
			progress: 3,
			status: "watching",
			updatedAt: 100,
		},
		desired: { progress: 1 },
	});
	f.advance();
	await f.updates.flush();
	expect(f.current().intentAt).toBe(1000);
	expect(f.current().updatedAt).toBeGreaterThan(1000);
	expect(await f.service.submit(old, randomUUID())).toMatchObject({
		state: "ignored",
		reason: "manual-change",
	});
	f.database.trackingOperations.remove(op.id);
	expect(await f.service.submit(old, randomUUID())).toMatchObject({
		state: "ignored",
		reason: "manual-change",
	});
	expect(await f.service.submit(await f.capture(), randomUUID())).toMatchObject(
		{ state: "accepted" },
	);
});
test("a manual command predating session capture is not made newer by worker completion", async () => {
	const f = await fixture();
	f.updates.update("anilist:anime:9", {
		generation: f.status.generation,
		revision: null,
		baseline: {
			id: "anilist:10",
			progress: 3,
			status: "watching",
			updatedAt: 100,
		},
		desired: { progress: 2 },
	});
	const captured = await f.capture();
	f.advance();
	await f.updates.flush();
	expect(await f.service.submit(captured, randomUUID())).toMatchObject({
		state: "accepted",
	});
});
test("player commands are idempotent across lost acknowledgements and a replay does not bump manual version", async () => {
	const f = await fixture();
	const input = f.command();
	const first = await f.service.mark(input);
	await f.updates.flush();
	const version = f.updates.manualVersion(
		"anilist:anime:9",
		f.status.generation,
	);
	expect((await f.service.mark(input)).id).toBe(first.id);
	expect(f.updates.manualVersion("anilist:anime:9", f.status.generation)).toBe(
		version,
	);
	expect(f.save).toHaveBeenCalledTimes(1);
});
test("mapping revisions and accounts are revalidated before automatic admission and manual confirmation", async () => {
	const f = await fixture("7");
	const captured = await f.capture();
	await f.service.mark(f.command());
	f.review.revision++;
	expect(await f.service.submit(captured, randomUUID())).toMatchObject({
		state: "ignored",
		reason: "mapping-changed",
	});
	await expect(
		f.service.mark(f.command({ confirmSkipped: true })),
	).rejects.toMatchObject({ code: "TRACKING_CONFLICT" });
	f.status.account = { id: "anilist:8", name: "Other" };
	expect(await f.service.submit(captured, randomUUID())).toMatchObject({
		state: "ignored",
		reason: "account-changed",
	});
});
test("same-account reconnect uses the current generation and unsupported mappings stay manual", async () => {
	const f = await fixture();
	const captured = await f.capture();
	f.status.generation = randomUUID();
	expect(await f.service.submit(captured, randomUUID())).toMatchObject({
		state: "accepted",
	});
	const association = f.review.associations[0];
	if (!association) throw Error("Missing association");
	association.kind = "special";
	expect(await f.service.capture("file", "v1")).toBeNull();
});

test("HTTP player commands serialize the real admission and final operation with a minimal remote baseline", async () => {
	const { createHttpApp } = await import(
		"../../../../src/app/bootstrap/http.js"
	);

	const { registerTrackingUpdateRoutes } = await import(
		"../../../../src/modules/anime/tracking/http/updates.js"
	);
	const { default: pino } = await import("pino");
	const f = await fixture("7");
	const http = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger: pino({ enabled: false }),
		registrations: [
			(scope) => registerTrackingUpdateRoutes(scope, f.updates, f.service),
		],
		closeDependencies: async () => {},
	});
	dispose.push(() => http.close());
	const headers = { host: "127.0.0.1:3000" };
	const input = f.command();
	const first = await http.inject({
		url: "/api/tracking/episode-commands",
		method: "POST",
		headers,
		payload: input,
	});
	expect(first.statusCode, first.body).toBe(200);
	expect(first.json()).toMatchObject({
		state: "decision-required",
		decisionReason: "skipped-episodes",
	});
	expect(Object.keys(first.json().baseline).sort()).toEqual([
		"id",
		"progress",
		"status",
		"updatedAt",
	]);
	const repeat = await http.inject({
		url: "/api/tracking/episode-commands",
		method: "POST",
		headers,
		payload: input,
	});
	expect(repeat.statusCode).toBe(200);
	expect(repeat.json().revision).toBe(first.json().revision);
	const confirm = await http.inject({
		url: "/api/tracking/episode-commands",
		method: "POST",
		headers,
		payload: f.command({ confirmSkipped: true }),
	});
	expect(confirm.statusCode, confirm.body).toBe(200);
	await f.updates.flush();
	const result = await http.inject({
		url: `/api/tracking/operations?generation=${f.status.generation}`,
		headers,
	});
	expect(result.statusCode, result.body).toBe(200);
	expect(result.json()[0]).toMatchObject({
		state: "succeeded",
		remote: { progress: 7 },
	});
	const invalid = await http.inject({
		url: "/api/tracking/episode-commands",
		method: "POST",
		headers,
		payload: { ...f.command(), origin: "automatic" },
	});
	expect(invalid.statusCode).toBe(400);
});

test("editing status does not silently accept an unconfirmed automatic progress suggestion", async () => {
	const f = await fixture("7");
	await f.service.submit(await f.capture(), randomUUID());
	const op = f.current();
	f.updates.update("anilist:anime:9", {
		generation: f.status.generation,
		revision: op.revision,
		baseline: op.baseline,
		desired: { status: "paused" },
	});
	await f.updates.flush();
	expect(f.current().remote).toMatchObject({ progress: 3, status: "paused" });
});

test("concurrent duplicate player commands admit once and stale UI mapping revisions cannot retarget a mark", async () => {
	const f = await fixture();
	const input = f.command();
	const [first, second] = await Promise.all([
		f.service.mark(input),
		f.service.mark(input),
	]);
	expect(second.id).toBe(first.id);
	expect(second.revision).toBe(first.revision);
	expect(f.updates.manualVersion("anilist:anime:9", f.status.generation)).toBe(
		1,
	);
	await f.updates.flush();
	f.review.revision++;
	await expect(f.service.mark(f.command())).rejects.toMatchObject({
		code: "TRACKING_CONFLICT",
	});
});

test("a fresh completion uses current remote progress after an earlier successful value was corrected on AniList", async () => {
	const f = await fixture();
	await f.service.submit(await f.capture(), randomUUID());
	await f.updates.flush();
	expect(f.current().state).toBe("succeeded");
	f.advance();
	f.setRemote({
		id: "anilist:10",
		progress: 3,
		status: "watching",
		updatedAt: 200,
	});
	const observed = await f.service.submit(await f.capture(), randomUUID());
	expect(observed).toMatchObject({
		state: "accepted",
		reason: "operation-recorded",
	});
	await f.updates.flush();
	expect(f.current().remote?.progress).toBe(4);
	expect(f.save).toHaveBeenCalledTimes(2);
});

test.each(["automatic", "manual"])(
	"%s progress-only updates preserve the current rewatch pass",
	async (origin) => {
		const f = await fixture();
		f.setRemote({
			id: "anilist:10",
			progress: 3,
			status: "rewatching",
			updatedAt: 100,
		});
		if (origin === "automatic")
			await f.service.submit(await f.capture(), randomUUID());
		else await f.service.mark(f.command());
		expect(f.current().desired).toEqual({ progress: 4 });
		await f.updates.flush();
		expect(f.current()).toMatchObject({
			state: "succeeded",
			remote: { status: "rewatching", progress: 4 },
		});
	},
);
