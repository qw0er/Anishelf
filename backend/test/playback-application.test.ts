import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { builtinPolicy } from "../src/app/policy.js";
import { PlaybackApplication } from "../src/modules/playback/progress/application/playback.js";
import type { LibraryApplication } from "../src/modules/resources/library/application/library.js";
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
let fileId: string;
const logger = pino({ enabled: false });
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "anishelf-playback-"));
	root = join(directory, "media");
	await mkdir(root);
	await writeFile(join(root, "episode.mp4"), "source");
	database = ApplicationDatabase.open(join(directory, "data"));
	let settings: PersistentSettings = { resourceRoots: [root] };
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
	fileId = library
		.getDirectory("root")
		.children.find((entry) => entry.kind === "file")?.id as string;
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
	await library.updateResourceSettings({ resourceRoots: [other] });
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
	await library.updateResourceSettings({ resourceRoots: [root] });
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

async function observing() {
	await playback.close();
	const submit = vi.fn(async () => ({
		state: "accepted" as const,
		reason: "operation-recorded",
		operationId: "operation",
		revision: 1,
	}));
	playback = new PlaybackApplication({
		sources: library.sources,
		repository: database.playback,
		logger,
		now: () => now,
		completionObserver: { capture: async () => "target", submit },
	});
	return submit;
}
test("reaching 90 percent after 30 seconds creates one durable observation, without coverage or probing", async () => {
	const submit = await observing();
	const session = await playback.open(fileId);
	now += 30000;
	await playback.save({
		...update(session),
		positionMs: 90000,
		normalPlayedMs: 30000,
	});
	await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
	expect(database.playback.completions()[0]?.outcome).toMatchObject({
		state: "accepted",
		operationId: "operation",
	});
	await playback.save({
		...update(session, 2),
		positionMs: 95000,
		normalPlayedMs: 30000,
	});
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(submit).toHaveBeenCalledTimes(1);
	expect(database.playback.completions()).toHaveLength(1);
});
test("resume and seeking alone are insufficient; rejected telemetry still saves position", async () => {
	const submit = await observing();
	const session = await playback.open(fileId);
	await playback.save({
		...update(session),
		positionMs: 95000,
		normalPlayedMs: 30000,
	});
	now += 30000;
	await playback.save({
		...update(session, 2),
		positionMs: 95000,
		normalPlayedMs: 1000,
	});
	await playback.save({
		...update(session, 3),
		positionMs: 89999,
		normalPlayedMs: 30000,
	});
	expect(submit).not.toHaveBeenCalled();
	expect(database.playback.completions()).toEqual([]);
	expect(
		database.playback.get(
			database.playback.registerSource(
				(await library.sources.resolveSource(fileId)).identity,
			).id,
		)?.positionMs,
	).toBe(89999);
});
test("natural end supports unknown duration after normal playback, and a new session needs new normal time", async () => {
	const submit = await observing();
	const session = await playback.open(fileId);
	now += 30000;
	await playback.save({
		...update(session),
		durationMs: null,
		positionMs: 50000,
		normalPlayedMs: 30000,
		naturalEnd: true,
	});
	await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
	const reopened = await playback.open(fileId);
	await playback.save({
		...update(reopened),
		positionMs: 100000,
		normalPlayedMs: 30000,
		naturalEnd: true,
	});
	expect(database.playback.completions()).toHaveLength(1);
	now += 30000;
	await playback.save({
		...update(reopened, 2),
		positionMs: 100000,
		normalPlayedMs: 30000,
		naturalEnd: true,
	});
	await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
});
test("stale sequences cannot add observations and admission failure recovers after restart", async () => {
	const submit = await observing();
	const session = await playback.open(fileId);
	await playback.save(update(session, 2));
	now += 30000;
	await expect(
		playback.save({
			...update(session),
			positionMs: 90000,
			normalPlayedMs: 30000,
		}),
	).rejects.toMatchObject({ code: "PLAYBACK_CONFLICT" });
	expect(database.playback.completions()).toEqual([]);
	submit.mockRejectedValueOnce(new Error("offline"));
	await playback.save({
		...update(session, 3),
		positionMs: 90000,
		normalPlayedMs: 30000,
	});
	await vi.waitFor(() =>
		expect(database.playback.completions()[0]?.outcome.state).toBe(
			"unavailable",
		),
	);
	const id = database.playback.completions()[0]?.id;
	await playback.close();
	database.close();
	database = ApplicationDatabase.open(join(directory, "data"));
	playback = new PlaybackApplication({
		sources: library.sources,
		repository: database.playback,
		logger,
		now: () => now,
		completionObserver: { capture: async () => "target", submit },
	});
	await vi.waitFor(() =>
		expect(database.playback.completions()[0]?.outcome.state).toBe("accepted"),
	);
	expect(submit).toHaveBeenLastCalledWith("target", id);
});
