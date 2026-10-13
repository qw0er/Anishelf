import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { expect, test } from "vitest";
import { ApplicationDatabase } from "../src/app/bootstrap/database.js";
import { initializeMediaTools } from "../src/app/bootstrap/media-tools.js";
import { builtinPolicy } from "../src/app/policy.js";
import { createAnimeModule } from "../src/modules/anime/create.js";
import { createMediaModule } from "../src/modules/media/create.js";
import type { CompatibilityResult } from "../src/modules/media/public.js";
import { compatibilityView } from "../src/modules/media/views.js";
import { createPlaybackModule } from "../src/modules/playback/create.js";
import { createResourcesModule } from "../src/modules/resources/create.js";
import { createSystemModule } from "../src/modules/system/create.js";

test("Media publishes an immutable independent view without planner-private fields", () => {
	const result: CompatibilityResult & {
		canonicalRoot: string;
		profile: object;
		privateFutureField: string;
	} = {
		fileId: "file",
		sourceVersion: "version",
		rulesVersion: "4",
		direct: { status: "supported", reason: "supported" },
		video: { status: "supported", reason: "supported" },
		audio: { status: "supported", reason: "supported" },
		container: { status: "supported", reason: "supported" },
		selectedVideo: null,
		defaultAudioStreamIndex: null,
		selectedAudioStreamIndices: [],
		audioTracks: [],
		output: null,
		warnings: ["warning"],
		canonicalRoot: "/private/root",
		profile: { encoder: "private" },
		privateFutureField: "private",
	};
	const view = compatibilityView(result);
	expect(view).not.toHaveProperty("canonicalRoot");
	expect(view).not.toHaveProperty("profile");
	expect(view).not.toHaveProperty("privateFutureField");
	expect(Object.isFrozen(view)).toBe(true);
	expect(Object.isFrozen(view.warnings)).toBe(true);
	result.warnings.push("changed");
	expect(view.warnings).toEqual(["warning"]);
});

test("large modules expose capability objects and quiesce without destroying shared sources", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-module-runtime-"));
	const root = join(directory, "media");
	await mkdir(root);
	const logger = pino({ enabled: false });
	const system = await createSystemModule(
		{
			ANISHELF_DATA_DIR: join(directory, "data"),
			ANISHELF_INITIAL_RESOURCE_ROOT: root,
		},
		builtinPolicy,
	);
	const database = ApplicationDatabase.open(system.api.deployment.dataDir);
	const tools = await initializeMediaTools(
		system.api.deployment.mediaTools,
		logger,
		builtinPolicy,
		system.api.environment.executableSearch,
	);
	const resources = await createResourcesModule({ system: system.api, logger });
	const media = await createMediaModule({
		system: system.api,
		resources: resources.api,
		database,
		tools,
		logger,
	});
	const playback = createPlaybackModule({
		system: system.api,
		resources: resources.api,
		media: media.api,
		database,
		logger,
	});
	const anime = await createAnimeModule({
		system: system.api,
		resources: resources.api,
		database,
		logger,
	});
	try {
		expect(Object.getPrototypeOf(system.api)).toBe(Object.prototype);
		expect(system.api.snapshot).not.toHaveProperty("policy");
		expect(Object.getPrototypeOf(resources.api.sources)).toBe(Object.prototype);
		expect(resources.api.sources).not.toHaveProperty("invalidateRoot");
		expect(anime.api.catalog).toBeDefined();
		expect(anime.api.catalog).not.toHaveProperty("publish");
		expect(anime.api.catalog).not.toHaveProperty("close");
		expect((await anime.api.catalog?.list())?.items).toEqual([]);
		await anime.quiesce();
		await Promise.all([media.quiesce(), media.quiesce()]);
		await resources.quiesce();
		expect(await resources.api.sources.resolveRoot()).toBe(root);
	} finally {
		playback.close();
		await anime.close();
		await Promise.all([media.close(), media.close()]);
		await resources.close();
		database.close();
		await rm(directory, { recursive: true, force: true });
	}
});

test("app waits for producers and releases every owner even if one shutdown fails", async () => {
	const { closeModules } = await import("../src/app/lifecycle.js");
	const events: string[] = [];
	let release: () => void = () => {};
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const stopping = closeModules({
		anime: {
			quiesce: async () => {
				events.push("recognition stopping");
				await pending;
				events.push("recognition stopped");
			},
			close: async () => {
				events.push("anime closed");
			},
		},
		media: {
			quiesce: async () => {
				events.push("media stopped");
			},
			close: async () => {
				events.push("media closed");
				throw new Error("cleanup failed");
			},
		},
		resources: {
			quiesce: async () => {
				events.push("scans stopped");
			},
			close: async () => {
				events.push("resources closed");
			},
		},
		playback: {
			close: () => {
				events.push("playback closed");
			},
		},
		database: {
			close: () => {
				events.push("database closed");
			},
		},
	});
	expect(events).toEqual(["recognition stopping"]);
	release();
	await expect(stopping).rejects.toBeInstanceOf(AggregateError);
	expect(events.indexOf("media closed")).toBeGreaterThan(
		events.indexOf("scans stopped"),
	);
	expect(events.at(-1)).toBe("database closed");
});
