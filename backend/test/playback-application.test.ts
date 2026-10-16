import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { builtinPolicy } from "../src/app/policy.js";
import { PlaybackApplication } from "../src/modules/playback/progress/application/playback.js";
import type { LibraryApplication } from "../src/modules/resources/library/application/library.js";
import { createResourceId } from "../src/modules/resources/library/domain/model.js";
import { LibraryIndex } from "../src/modules/resources/library/infrastructure/index.js";
import { ResourceAccess } from "../src/modules/resources/resource-access/infrastructure/access.js";
import type { PersistentSettings } from "../src/modules/system/configuration/domain/model.js";
import { createLibraryModule } from "./support/library.js";

let directory: string;
let root: string;
let database: ApplicationDatabase;
let library: LibraryApplication;
let playback: PlaybackApplication;
let now: number;
const fileId = createResourceId("file", "episode.mp4");
const logger = pino({ enabled: false });
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "anishelf-playback-"));
	root = join(directory, "media");
	await mkdir(root);
	await writeFile(join(root, "episode.mp4"), "source");
	database = ApplicationDatabase.open(join(directory, "data"));
	let settings: PersistentSettings = { resourceRoot: root };
	library = createLibraryModule({
		configuration: {
			get settings() {
				return settings;
			},
			async update(next) {
				settings = next;
				return settings;
			},
		},
		index: new LibraryIndex(),
		logger,
	});
	now = 1000;
	playback = new PlaybackApplication({
		sources: library.sources,
		policy: builtinPolicy.playback,
		repository: database.playback,
		logger,
		now: () => now,
	});
	await library.startScan();
	await library.waitForCompletion();
});
afterEach(async () => {
	await playback.close();
	await library.close();
	database.close();
	vi.restoreAllMocks();
	await rm(directory, { recursive: true, force: true });
});
function update(
	session: Awaited<ReturnType<PlaybackApplication["open"]>>,
	sequence = 1,
) {
	return {
		token: session.token,
		generation: session.progress.generation,
		sourceVersion: session.sourceVersion,
		sequence,
		positionMs: 40000,
		durationMs: 100000,
	};
}

test("opens direct playback, resumes history, and invalidates superseded tokens", async () => {
	const session = await playback.open(fileId);
	expect(session).not.toHaveProperty("plan");
	expect(session).not.toHaveProperty("generation");
	expect(JSON.stringify(session)).not.toContain(root);
	expect(session.progress.lastViewedAtMs).toBeNull();
	await playback.save(update(session));
	const reopened = await playback.open(fileId);
	expect(reopened.progress.positionMs).toBe(40000);
	await expect(playback.save(update(session, 2))).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
	expect(
		(await playback.history(undefined, "continue")).items[0]?.file.id,
	).toBe(fileId);
	playback.release(reopened.token);
	await expect(playback.save(update(reopened))).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
});

test("replacement content cannot inherit history or accept saves from the old source", async () => {
	const session = await playback.open(fileId);
	await playback.save(update(session));
	await writeFile(join(root, "replacement.mp4"), "new-content");
	await rename(join(root, "replacement.mp4"), join(root, "episode.mp4"));
	expect((await playback.history(undefined, "continue")).items).toEqual([]);
	await expect(playback.save(update(session, 2))).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
	const replacement = await playback.open(fileId);
	expect(replacement.progress.sourceId).not.toBe(session.progress.sourceId);
	expect(replacement.progress.positionMs).toBe(0);
	expect(database.playback.get(session.progress.sourceId)?.positionMs).toBe(
		40000,
	);
});

test("invalidates sessions across root switches and reports unknown availability until the automatic scan finishes", async () => {
	const session = await playback.open(fileId);
	await playback.save(update(session));
	const other = join(directory, "other");
	await mkdir(other);
	await library.updateResourceSettings({ resourceRoot: other });
	await library.waitForCompletion();
	const create = ResourceAccess.create;
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	vi.spyOn(ResourceAccess, "create").mockImplementationOnce(
		async (settings) => {
			await gate;
			return create(settings);
		},
	);
	await library.updateResourceSettings({ resourceRoot: root });
	try {
		expect(await playback.history(undefined, "continue")).toEqual({
			availability: "unknown",
			items: [],
		});
		await expect(playback.save(update(session, 2))).rejects.toMatchObject({
			code: "PLAYBACK_CONFLICT",
		});
	} finally {
		release();
	}
	await library.waitForCompletion();
	expect((await playback.history(undefined, "continue")).items).toHaveLength(1);
});

test("failed history reads never open a generation; invalid times and persistence failures are typed", async () => {
	const read = vi.spyOn(database.playback, "get").mockImplementation(() => {
		throw new Error("disk read failed");
	});
	const generation = vi.spyOn(database.playback, "openGeneration");
	await expect(playback.open(fileId)).rejects.toMatchObject({
		code: "PLAYBACK_PERSISTENCE_FAILED",
	});
	expect(generation).not.toHaveBeenCalled();
	read.mockRestore();
	const session = await playback.open(fileId);
	await expect(
		playback.save({ ...update(session), positionMs: Number.NaN }),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	vi.spyOn(database.playback, "save").mockImplementation(() => {
		throw new Error("disk full");
	});
	await expect(playback.save(update(session))).rejects.toMatchObject({
		code: "PLAYBACK_PERSISTENCE_FAILED",
	});
	expect(database.playback.get(session.progress.sourceId)?.positionMs).toBe(0);
});

test("expires idle sessions and handles unavailable persistence", async () => {
	const session = await playback.open(fileId);
	now += 30 * 60 * 1000;
	await expect(playback.save(update(session))).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
	const unavailable = new PlaybackApplication({
		sources: library.sources,
		logger,
	});
	await expect(unavailable.open(fileId)).rejects.toMatchObject({
		code: "PLAYBACK_UNAVAILABLE",
	});
});

test("injected session and list policies govern capacity, expiry and limits", async () => {
	const scoped = new PlaybackApplication({
		sources: library.sources,
		repository: database.playback,
		logger,
		now: () => now,
		policy: {
			...builtinPolicy.playback,
			sessionIdleMs: 10,
			maximumSessions: 1,
			maximumListLimit: 2,
			historyLimit: 2,
			candidateBatchSize: 1,
		},
	});
	try {
		const first = await scoped.open(fileId);
		await expect(scoped.open(fileId)).rejects.toMatchObject({
			code: "PLAYBACK_UNAVAILABLE",
		});
		now += 10;
		await expect(scoped.save(update(first))).rejects.toMatchObject({
			code: "PLAYBACK_CONFLICT",
		});
		expect((await scoped.open(fileId)).token).not.toBe(first.token);
		await expect(scoped.history(3)).rejects.toMatchObject({
			code: "INVALID_REQUEST",
		});
	} finally {
		scoped.close();
	}
});

test("persists union coverage across sessions, excludes seeks and never counts stale evidence", async () => {
	await playback.close();
	playback = new PlaybackApplication({
		sources: library.sources,
		repository: database.playback,
		logger,
		now: () => now,
		sourceDuration: async () => 100000,
	});
	let session = await playback.open(fileId);
	const save = async (
		sequence: number,
		startMs: number,
		endMs: number,
		elapsedMs: number,
	) =>
		playback.save({
			...update(session, sequence),
			positionMs: endMs,
			intervals: [{ startMs, endMs, elapsedMs, rate: 1 }],
		});
	now += 40000;
	await save(1, 0, 40000, 40000);
	const sourceId = database.playback.registerSource(
		(await library.sources.resolveSource(fileId)).identity,
	).id;
	expect(database.playback.coverage(sourceId, 100000)).toEqual([[0, 40000]]);
	// Jumping to the ending cannot contribute the skipped middle.
	now += 1000;
	await save(2, 40000, 99000, 1000);
	expect(database.playback.coverage(sourceId, 100000)).toEqual([[0, 40000]]);
	const old = session;
	session = await playback.open(fileId);
	now += 50000;
	await save(1, 30000, 80000, 50000);
	expect(database.playback.coverage(sourceId, 100000)).toEqual([[0, 80000]]);
	await expect(
		playback.save({
			...update(old, 3),
			intervals: [{ startMs: 80000, endMs: 100000, elapsedMs: 20000, rate: 1 }],
		}),
	).rejects.toMatchObject({ code: "PLAYBACK_CONFLICT" });
	expect(database.playback.coverage(sourceId, 100000)).toEqual([[0, 80000]]);
});

test("validates source duration and server elapsed budget independently of position saves", async () => {
	await playback.close();
	playback = new PlaybackApplication({
		sources: library.sources,
		repository: database.playback,
		logger,
		now: () => now,
		sourceDuration: async () => 100000,
	});
	const session = await playback.open(fileId);
	const sourceId = database.playback.registerSource(
		(await library.sources.resolveSource(fileId)).identity,
	).id;
	await playback.save({
		...update(session),
		intervals: [{ startMs: 0, endMs: 85000, elapsedMs: 85000, rate: 1 }],
	});
	expect(database.playback.coverage(sourceId, 100000)).toEqual([]);
	now += 10000;
	await playback.save({
		...update(session, 2),
		durationMs: 10000,
		positionMs: 9000,
		intervals: [{ startMs: 0, endMs: 9000, elapsedMs: 9000, rate: 1 }],
	});
	expect(database.playback.coverage(sourceId, 100000)).toEqual([]);
	expect(database.playback.get(sourceId)?.positionMs).toBe(9000);
	now += 10000;
	await playback.save({
		...update(session, 3),
		intervals: [{ startMs: 0, endMs: 10000, elapsedMs: 10000, rate: 1 }],
	});
	expect(database.playback.coverage(sourceId, 100000)).toEqual([[0, 10000]]);
});

test("atomically records 85-percent completion, retries admission after restart and deduplicates replay", async () => {
	await playback.close();
	const context = "account-and-mapping";
	const observer = {
		capture: vi.fn(async () => context),
		submit: vi.fn(async () => ({
			state: "queued" as const,
			reason: "submission-queued",
		})),
	};
	observer.submit.mockRejectedValueOnce(new Error("offline"));
	const construct = () =>
		new PlaybackApplication({
			sources: library.sources,
			repository: database.playback,
			logger,
			now: () => now,
			sourceDuration: async () => 100000,
			completionObserver: observer,
		});
	playback = construct();
	let session = await playback.open(fileId);
	expect(session.completionEnabled).toBe(true);
	now += 84000;
	await playback.save({
		...update(session),
		positionMs: 84000,
		intervals: [{ startMs: 0, endMs: 84000, elapsedMs: 84000, rate: 1 }],
	});
	expect(database.playback.completions()).toEqual([]);
	now += 1000;
	await playback.save({
		...update(session, 2),
		positionMs: 85000,
		intervals: [{ startMs: 84000, endMs: 85000, elapsedMs: 1000, rate: 1 }],
	});
	await vi.waitFor(() =>
		expect(database.playback.completions()[0]?.outcome.state).toBe(
			"unavailable",
		),
	);
	await playback.close();
	database.close();
	database = ApplicationDatabase.open(join(directory, "data"));
	playback = construct();
	await vi.waitFor(() =>
		expect(database.playback.completions()[0]?.outcome.state).toBe("queued"),
	);
	expect(observer.submit).toHaveBeenCalledTimes(2);
	session = await playback.open(fileId);
	now += 100000;
	await playback.save({
		...update(session),
		positionMs: 100000,
		intervals: [{ startMs: 0, endMs: 100000, elapsedMs: 100000, rate: 1 }],
	});
	expect(database.playback.completions()).toHaveLength(1);
	expect((await playback.completion(session.token))?.state).toBe("queued");
	expect(observer.submit).toHaveBeenCalledTimes(2);
});

test("requires explicit skipped-episode decision and persists it before admission", async () => {
	await playback.close();
	const observer = {
		capture: async () => "decision-target",
		submit: vi.fn(
			async (
				_context: string,
				_at: number,
				decision: { advance: boolean } | null,
			) =>
				decision
					? { state: "queued" as const, reason: "submission-queued" }
					: {
							state: "decision-required" as const,
							reason: "skipped-episodes",
							episode: 4,
							mediaId: 9,
						},
		),
	};
	playback = new PlaybackApplication({
		sources: library.sources,
		repository: database.playback,
		logger,
		now: () => now,
		sourceDuration: async () => 100000,
		completionObserver: observer,
	});
	const session = await playback.open(fileId);
	now += 85000;
	await playback.save({
		...update(session),
		positionMs: 85000,
		intervals: [{ startMs: 0, endMs: 85000, elapsedMs: 85000, rate: 1 }],
	});
	await vi.waitFor(() =>
		expect(database.playback.completions()[0]?.outcome.state).toBe(
			"decision-required",
		),
	);
	await playback.decideCompletion(session.token, { advance: true });
	expect(database.playback.completions()[0]?.decision).toEqual({
		advance: true,
	});
	expect((await playback.completion(session.token))?.state).toBe("queued");
});
