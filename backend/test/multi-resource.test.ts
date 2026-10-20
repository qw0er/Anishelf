import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { MediaInspectionApplication } from "../src/modules/media/media-inspection/application.js";
import { PlaybackApplication } from "../src/modules/playback/progress/application/playback.js";
import { createResourceId } from "../src/modules/resources/library/domain/model.js";
import { LibraryIndex } from "../src/modules/resources/library/infrastructure/index.js";
import { resourceRootId } from "../src/modules/resources/resource-access/domain/identity.js";
import { ResourceAccess } from "../src/modules/resources/resource-access/infrastructure/access.js";
import { ConfigurationService } from "../src/modules/system/configuration/application/service.js";
import { parsePersistentSettings } from "../src/modules/system/configuration/infrastructure/persistent.js";
import { parseMediaInfo } from "../src/platform/media/tools.js";
import { createHttpApp } from "./support/http.js";
import { createLibraryModule } from "./support/library.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
	const base = await realpath(
		await mkdtemp(join(tmpdir(), "anishelf-multi-root-")),
	);
	cleanup.push(() => rm(base, { recursive: true, force: true }));
	const roots = [join(base, "disk-a", "media"), join(base, "disk-b", "media")];
	for (const [index, root] of roots.entries()) {
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "Anime - 01.mkv"), `video-${index}`);
		await writeFile(join(root, "Anime - 01.srt"), `subtitle-${index}`);
	}
	const dataDir = join(base, "data");
	const configuration = await ConfigurationService.load({
		ANISHELF_DATA_DIR: dataDir,
	});
	await configuration.update({ resourceRoots: roots });
	const records: Record<string, unknown>[] = [];
	const logger = pino(
		{ level: "debug" },
		{ write: (line) => records.push(JSON.parse(line)) },
	);
	const index = new LibraryIndex();
	const library = createLibraryModule({ configuration, index, logger });
	cleanup.push(() => library.close());
	const database = ApplicationDatabase.open(dataDir);
	const playback = new PlaybackApplication({
		sources: library.sources,
		repository: database.playback,
		logger,
	});
	cleanup.push(async () => {
		await playback.close();
		database.close();
	});
	async function scan() {
		await library.startScan();
		return library.waitForCompletion();
	}
	await scan();
	const files = roots.map((root) =>
		index.getFile(
			createResourceId("file", "Anime - 01.mkv", resourceRootId(root)),
		),
	);
	return {
		base,
		roots,
		dataDir,
		configuration,
		library,
		index,
		records,
		logger,
		database,
		playback,
		files,
		scan,
	};
}

test("same-named files and sidecars are isolated across roots, including media tool inputs", async () => {
	const f = await fixture();
	expect(new Set(f.files.map((file) => file.id)).size).toBe(2);
	const mounts = f.library.getDirectory("root").children;
	expect(mounts).toHaveLength(2);
	expect(new Set(mounts.map((mount) => mount.name)).size).toBe(2);
	const info = parseMediaInfo(
		JSON.stringify({ format: { format_name: "matroska" }, streams: [] }),
		"matroska",
	);
	const probe = vi.fn().mockResolvedValue(info);
	const inspection = new MediaInspectionApplication({
		sources: f.library.sources,
		tools: { probe },
	});
	cleanup.push(() => inspection.close());
	for (const [index, file] of f.files.entries()) {
		const source = await f.library.sources.resolveSource(file.id);
		const media = await f.library.openMedia(file.id);
		try {
			expect(await media.handle.readFile("utf8")).toBe(`video-${index}`);
		} finally {
			await media.release();
		}
		const resources = await f.library.sources.openResources(source);
		const metadata = await resources.inspectSubtitleSource("Anime - 01.srt");
		const subtitle = await resources.openSubtitleSource({
			scopeId: source.identity.scopeId,
			relativePath: "Anime - 01.srt",
			sourceVersion: metadata.sourceVersion,
		});
		try {
			expect(await subtitle.handle.readFile("utf8")).toBe(`subtitle-${index}`);
		} finally {
			await subtitle.release();
		}
		await inspection.inspect(file.id);
		expect(probe).toHaveBeenLastCalledWith(
			join(f.roots[index] as string, file.name),
			expect.any(AbortSignal),
		);
	}
	expect(JSON.stringify(mounts)).not.toContain(f.base);
	const source = await f.library.sources.resolveSource(
		f.files[0]?.id as string,
	);
	await expect(
		f.library.sources.filePath({
			identity: {
				...source.identity,
				scopeId: resourceRootId(f.roots[1] as string),
			},
		}),
	).rejects.toMatchObject({ code: "PLAYBACK_CONFLICT" });
});

test("reordering, removing and restoring roots preserves identity and playback history", async () => {
	const f = await fixture();
	const file = f.files[0];
	if (!file) throw new Error("Missing fixture file");
	const session = await f.playback.open(file.id);
	await f.playback.save({
		token: session.token,
		generation: session.progress.generation,
		sourceVersion: session.sourceVersion,
		sequence: 1,
		positionMs: 20000,
		durationMs: 60000,
	});
	await f.library.updateResourceSettings({
		resourceRoots: [...f.roots].reverse(),
	});
	await f.library.waitForCompletion();
	expect((await f.playback.history()).items[0]?.file.id).toBe(file.id);
	await f.library.updateResourceSettings({
		resourceRoots: [f.roots[1] as string],
	});
	await f.library.waitForCompletion();
	expect((await f.playback.history()).items).toEqual([]);
	await expect(
		f.library.sources.revalidateSource({
			identity: {
				scopeId: resourceRootId(f.roots[0] as string),
				fileId: file.id,
				relativePath: file.relativePath,
				sourceVersion: session.sourceVersion,
			},
		}),
	).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
	await f.library.updateResourceSettings({ resourceRoots: f.roots });
	await f.library.waitForCompletion();
	expect((await f.playback.open(file.id)).progress.positionMs).toBe(20000);
	expect(
		f.records.some((record) => record.event === "resources.scope_invalidated"),
	).toBe(true);
});

test("an unavailable root retains its snapshot while healthy roots update and recover", async () => {
	const f = await fixture();
	const first = f.roots[0] as string;
	const second = f.roots[1] as string;
	for (const file of f.files) {
		const session = await f.playback.open(file.id);
		await f.playback.save({
			token: session.token,
			generation: session.progress.generation,
			sourceVersion: session.sourceVersion,
			sequence: 1,
			positionMs: 10000,
			durationMs: 60000,
		});
	}

	await rename(first, `${first}-offline`);
	await writeFile(join(second, "Anime - 02.mkv"), "new episode");
	expect(await f.scan()).toMatchObject({
		status: "completed",
		warnings: { count: 1 },
	});
	const status = await f.library.getStatus();
	expect(status.ready).toBe(true);
	expect(
		(await f.playback.history()).items.map((item) => item.file.id),
	).toEqual([f.files[1]?.id]);
	expect(status.roots?.map((root) => root.available)).toEqual([false, true]);
	expect(f.index.getFile(f.files[0]?.id as string)).toBeDefined();
	expect(
		f.index.getFile(
			createResourceId("file", "Anime - 02.mkv", resourceRootId(second)),
		),
	).toBeDefined();
	await expect(
		f.library.getFile(f.files[0]?.id as string),
	).rejects.toMatchObject({ code: "RESOURCE_ROOT_UNAVAILABLE" });
	expect((await f.library.getFile(f.files[1]?.id as string)).sizeBytes).toBe(7);
	expect(f.records).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				event: "scan.root_failed",
				scopeId: resourceRootId(first),
			}),
		]),
	);
	await rename(`${first}-offline`, first);
	await f.scan();
	expect((await f.playback.history()).items).toHaveLength(2);
	expect(
		(await f.library.getStatus()).roots?.every((root) => root.available),
	).toBe(true);
	const revision = f.index.revision;
	for (const root of f.roots) await rename(root, `${root}-offline`);
	await expect(f.library.startScan()).rejects.toMatchObject({
		code: "RESOURCE_ROOT_UNAVAILABLE",
	});
	expect(f.index.revision).toBe(revision);
	expect(f.index.getFile(f.files[0]?.id as string)).toBeDefined();
});

test("settings reject duplicate, nested, aliased and data-overlapping roots without changing configuration", async () => {
	const f = await fixture();
	const alias = join(f.base, "alias");
	await symlink(f.roots[0] as string, alias);
	for (const roots of [
		[f.roots[0], f.roots[0]],
		[f.roots[0], join(f.roots[0] as string, "nested")],
		[f.roots[0], alias],
		[f.dataDir],
		["relative"],
	]) {
		await expect(
			f.configuration.update({ resourceRoots: roots as string[] }),
		).rejects.toMatchObject({ code: "CONFIG_INVALID" });
		expect(f.configuration.settings.resourceRoots).toEqual(f.roots);
	}
	const snapshot = f.configuration.settings;
	snapshot.resourceRoots.push("/caller-owned");
	expect(f.configuration.settings.resourceRoots).toEqual(f.roots);
	await f.library.updateResourceSettings({ resourceRoots: [] });
	expect(
		f.index.readFilePage.bind(f.index, f.index.revision, 0, 100),
	).toThrow();
	expect(await f.library.getStatus()).toMatchObject({
		ready: false,
		error: { code: "RESOURCE_ROOT_NOT_CONFIGURED" },
	});
	expect(
		f.records.some((record) => record.event === "scan.settings_start_failed"),
	).toBe(false);
});

test("HTTP saves and browses multiple roots and reports directory availability without absolute paths", async () => {
	const f = await fixture();
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger: f.logger,
		library: f.library,
	});
	cleanup.push(() => app.close());
	const headers = { host: "127.0.0.1:3000" };
	const saved = await app.inject({
		method: "PUT",
		url: "/api/settings",
		headers,
		payload: { resourceRoots: f.roots },
	});
	expect(saved.statusCode).toBe(200);
	expect(saved.json().resourceRoots).toEqual(f.roots);
	const directory = await app.inject({ url: "/api/directories/root", headers });
	expect(directory.json().children).toHaveLength(2);
	expect(directory.body).not.toContain(f.base);
	const status = await app.inject({ url: "/api/library", headers });
	expect(status.json().roots).toHaveLength(2);
	expect(status.body).not.toContain(f.base);
	const removed = await app.inject({
		method: "PUT",
		url: "/api/settings",
		headers,
		payload: { resourceRoots: [] },
	});
	expect(removed.statusCode).toBe(200);
});

test("legacy settings and file IDs upgrade without changing durable source IDs or progress", async () => {
	expect(parsePersistentSettings('{"resourceRoot":"/old-media"}')).toEqual({
		resourceRoots: ["/old-media"],
	});
	expect(parsePersistentSettings('{"resourceRoot":null}')).toEqual({
		resourceRoots: [],
	});
	const base = await mkdtemp(join(tmpdir(), "anishelf-legacy-multi-root-"));
	cleanup.push(() => rm(base, { recursive: true, force: true }));
	const dataDir = join(base, "data");
	ApplicationDatabase.open(dataDir).close();
	const scopeId = resourceRootId("/legacy-media");
	const legacyFileId = createResourceId("file", "legacy.mkv");
	const raw = new Database(join(dataDir, "anishelf.sqlite"));
	try {
		raw
			.prepare("INSERT OR IGNORE INTO resource_roots VALUES (?, ?, ?)")
			.run(scopeId, "/legacy-media", 1);
		raw
			.prepare("INSERT INTO media_sources VALUES (?, ?, ?, ?, ?, ?)")
			.run(
				"legacy-source",
				scopeId,
				legacyFileId,
				"legacy.mkv",
				"legacy-version",
				1,
			);
		raw
			.prepare(
				"INSERT INTO playback_progress (source_id, position_ms, duration_ms, last_viewed_at_ms, generation, last_sequence) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run("legacy-source", 12345, 60000, 10, 1, 1);
		const target = {
			fileId: legacyFileId,
			sourceVersion: "legacy-version",
			reviewId: "legacy-source",
			mappingRevision: 7,
			episodeId: "episode-1",
			mediaId: 9,
			episode: 1,
		};
		raw
			.prepare(
				"INSERT INTO playback_completions (id, source_id, context, outcome) VALUES (?, ?, ?, ?)",
			)
			.run(
				"observation-1",
				"legacy-source",
				JSON.stringify({
					...target,
					accountId: 7,
					generation: "generation-1",
					manualVersion: 0,
				}),
				JSON.stringify({ state: "pending", reason: "observation-recorded" }),
			);
		const operation = {
			id: "operation-1",
			accountId: 7,
			mediaId: 9,
			origin: "manual-player",
			commandId: "command-1",
			intentAt: 100,
			target,
			decisionReason: null,
			revision: 2,
			baseline: null,
			desired: { progress: 1 },
			state: "pending",
			remote: null,
			attempt: null,
			attempts: 0,
			retryAt: null,
			error: null,
			updatedAt: 100,
		};
		raw
			.prepare(
				"INSERT INTO tracking_operations (id, account_id, media_id, operation) VALUES (?, ?, ?, ?)",
			)
			.run("operation-1", "7", "9", JSON.stringify(operation));
		// This fixture replays all migrations after the legacy identity schema.
		raw.exec(
			"DROP TABLE acquisition_intents; DROP TABLE acquisition_directories; DROP TABLE acquisition_authorizations; DROP TABLE acquisition_destination; DROP TABLE acquisition_candidates; DROP TABLE acquisition_subscriptions; DROP TABLE acquisition_feeds;",
		);
		raw
			.prepare("DELETE FROM __drizzle_migrations WHERE created_at >= ?")
			.run(1792252800000);
	} finally {
		raw.close();
	}
	const upgraded = ApplicationDatabase.open(dataDir);
	try {
		const source = upgraded.playback.registerSource({
			scopeId,
			fileId: createResourceId("file", "legacy.mkv", scopeId),
			relativePath: "legacy.mkv",
			sourceVersion: "legacy-version",
		});
		expect(source.id).toBe("legacy-source");
		expect(upgraded.playback.get(source.id)?.positionMs).toBe(12345);
		const fileId = createResourceId("file", "legacy.mkv", scopeId);
		expect(
			JSON.parse(upgraded.playback.completions()[0]?.context as string),
		).toMatchObject({
			fileId,
			mappingRevision: 7,
			reviewId: "legacy-source",
		});
		expect(upgraded.trackingOperations.list("anilist:7")[0]).toMatchObject({
			id: "operation-1",
			commandId: "command-1",
			revision: 2,
			desired: { progress: 1 },
			state: "pending",
			target: { fileId, mappingRevision: 7 },
		});
	} finally {
		upgraded.close();
	}
});

test("plural startup initialization validates all paths and preserves existing settings", async () => {
	const f = await fixture();
	const dataDir = join(f.base, "fresh-data");
	const service = await ConfigurationService.load({
		ANISHELF_DATA_DIR: dataDir,
		ANISHELF_INITIAL_RESOURCE_ROOTS: JSON.stringify(f.roots),
	});
	expect(service.settings.resourceRoots).toEqual(f.roots);
	expect(
		JSON.parse(await readFile(join(dataDir, "settings.json"), "utf8"))
			.resourceRoots,
	).toEqual(f.roots);
	const reloaded = await ConfigurationService.load({
		ANISHELF_DATA_DIR: dataDir,
		ANISHELF_INITIAL_RESOURCE_ROOTS: JSON.stringify([join(f.base, "missing")]),
	});
	expect(reloaded.settings.resourceRoots).toEqual(f.roots);
	await expect(
		ConfigurationService.load({
			ANISHELF_DATA_DIR: join(f.base, "invalid-data"),
			ANISHELF_INITIAL_RESOURCE_ROOTS: JSON.stringify([
				f.roots[0],
				join(f.roots[0] as string, "nested"),
			]),
		}),
	).rejects.toMatchObject({ code: "CONFIG_INVALID" });
});

test("adding a path retains unchanged offline-root entries while invalidating old access leases", async () => {
	const f = await fixture();
	const file = f.files[0];
	if (!file) throw new Error("Missing fixture file");
	const source = await f.library.sources.resolveSource(file.id);
	await rename(f.roots[0] as string, `${f.roots[0]}-offline`);
	const third = join(f.base, "disk-c");
	await mkdir(third);
	await f.library.updateResourceSettings({
		resourceRoots: [...f.roots, third],
	});
	await f.library.waitForCompletion();
	expect(f.library.getDirectory("root").children).toHaveLength(3);
	expect(f.index.getFile(file.id).scopeId).toBe(source.identity.scopeId);
	await expect(
		f.library.sources.revalidateSource(source),
	).rejects.toMatchObject({ code: "PLAYBACK_CONFLICT" });
	expect(f.library.state).toMatchObject({
		status: "completed",
		warnings: { count: 1 },
	});
});

test("retargeting a configured root alias during access cannot cross source scopes", async () => {
	const f = await fixture();
	const alias = join(f.base, "selected-media");
	await symlink(f.roots[0] as string, alias);
	await f.library.updateResourceSettings({ resourceRoots: [alias] });
	await f.library.waitForCompletion();
	const open = ResourceAccess.create;
	vi.spyOn(ResourceAccess, "create").mockImplementationOnce(async (...args) => {
		await rm(alias);
		await symlink(f.roots[1] as string, alias);
		return open(...args);
	});
	await expect(
		f.library.getFile(f.files[0]?.id as string),
	).rejects.toMatchObject({ code: "PLAYBACK_CONFLICT" });
});
