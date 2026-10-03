import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/bootstrap/database.js";
import { createLibraryModule } from "../src/bootstrap/library.js";
import type { PersistentSettings } from "../src/modules/configuration/domain/model.js";
import { builtinPolicy } from "../src/modules/configuration/domain/policy.js";
import type { LibraryApplication } from "../src/modules/library/application/library.js";
import { createResourceId } from "../src/modules/library/domain/model.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";
import { PlaybackApplication } from "../src/modules/playback/application/playback.js";
import { ResourceAccess } from "../src/modules/resource-access/infrastructure/access.js";

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
		policy: library.policy.playback,
		repository: database.playback,
		logger,
		now: () => now,
	});
	await library.startScan();
	await library.waitForCompletion();
});
afterEach(async () => {
	playback.close();
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
		generation: session.generation,
		sourceVersion: session.sourceVersion,
		sequence,
		positionMs: 40000,
		durationMs: 100000,
	};
}

test("opens direct playback, resumes history, and invalidates superseded tokens", async () => {
	const session = await playback.open(fileId);
	expect(session.plan).toEqual({
		mode: "direct",
		playbackUrl: `/api/media/${fileId}`,
	});
	expect(JSON.stringify(session)).not.toContain(root);
	expect(session.progress.lastViewedAtMs).toBeNull();
	await playback.save(update(session));
	const reopened = await playback.open(fileId);
	expect(reopened.progress.positionMs).toBe(40000);
	await expect(playback.save(update(session, 2))).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
	expect((await playback.continueWatching()).items[0]?.file.id).toBe(fileId);
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
	expect((await playback.continueWatching()).items).toEqual([]);
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
	await library.updateSettings({ resourceRoot: other });
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
	await library.updateSettings({ resourceRoot: root });
	try {
		expect(await playback.continueWatching()).toEqual({
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
	expect((await playback.continueWatching()).items).toHaveLength(1);
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
			continueWatchingLimit: 1,
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
