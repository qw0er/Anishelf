import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ScanRunner } from "../../../../src/modules/resources/library/application/scan-runner.js";
import { ResourceMutations } from "../../../../src/modules/resources/library/infrastructure/mutations.js";
import { libraryRuntimePolicy } from "../../../../src/modules/resources/library/policy.js";
import { createHttpApp } from "../../../support/http.js";
import { createLibraryModule } from "../../../support/library.js";
import { settingsStore } from "../../../support/settings-store.js";

let fixture: string;
let root: string;
let library: ReturnType<typeof createLibraryModule>;
let app: ReturnType<typeof createHttpApp>;
const headers = { host: "127.0.0.1:3000" };
beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-mutations-"));
	root = join(fixture, "media");
	await mkdir(root);
	await mkdir(join(root, "Season", "Extras"), { recursive: true });
	await mkdir(join(root, "Target"));
	await writeFile(join(root, "Season", "episode.mp4"), "video");
	await writeFile(join(root, "Season", "Extras", "sub.srt"), "subtitle");
	await writeFile(join(root, "Season", "notes.txt"), "notes");
	const logger = pino({ enabled: false });
	library = createLibraryModule({
		configuration: settingsStore(root),
		logger,
		policy: {
			...libraryRuntimePolicy,
			library: { ...libraryRuntimePolicy.library, changeDebounceMs: 60_000 },
		},
	});
	app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger,
		library,
	});
	await library.startScan();
	await library.waitForCompletion();
});
afterEach(async () => {
	vi.restoreAllMocks();
	await app.close();
	await rm(fixture, { recursive: true, force: true });
});
function find(name: string, parent = "root") {
	const entry = library
		.getDirectory(parent)
		.children.find((item) => item.name === name);
	if (!entry) throw new Error(`Missing ${name}`);
	return entry;
}
async function command(input: object) {
	return app.inject({
		method: "POST",
		url: "/api/resources/execute",
		headers,
		payload: input,
	});
}

test("recursively deletes all contents, including non-media files, then publishes removal", async () => {
	const season = find("Season");
	const input = { id: season.id, action: "delete" };
	const response = await command(input);
	expect(response.statusCode, response.body).toBe(200);
	expect(response.json()).toEqual({ refreshRequired: false });
	expect(await readdir(root)).toEqual(["Target"]);
	expect(
		library.getDirectory("root").children.map((item) => item.name),
	).toEqual(["Target"]);
	const replay = await command(input);
	expect(replay.statusCode).toBe(404);
});

test.each(["folder", "file"])(
	"moves a %s with its name and contents and indexes the new location",
	async (kind) => {
		const season = find("Season");
		const source = kind === "folder" ? season : find("episode.mp4", season.id);
		const target = find("Target");
		const input = { id: source.id, action: "move", destinationId: target.id };
		const response = await command(input);
		expect(response.statusCode, response.body).toBe(200);
		const path =
			kind === "folder"
				? join(root, "Target", "Season", "episode.mp4")
				: join(root, "Target", "episode.mp4");
		expect(await readFile(path, "utf8")).toBe("video");
		const moved = find(source.name, target.id);
		expect(moved.id).not.toBe(source.id);
		if (kind === "folder")
			expect(
				await readFile(
					join(root, "Target", "Season", "Extras", "sub.srt"),
					"utf8",
				),
			).toBe("subtitle");
	},
);

test("deletes an individual file without its siblings", async () => {
	const season = find("Season");
	const input = { id: find("episode.mp4", season.id).id, action: "delete" };
	expect((await command(input)).statusCode).toBe(200);
	expect(await readFile(join(root, "Season", "notes.txt"), "utf8")).toBe(
		"notes",
	);
});

test("rejects files changed since indexing", async () => {
	const input = {
		id: find("episode.mp4", find("Season").id).id,
		action: "delete",
	};
	await writeFile(join(root, "Season", "episode.mp4"), "replacement");
	expect((await command(input)).statusCode).toBe(409);
	expect(await readFile(join(root, "Season", "episode.mp4"), "utf8")).toBe(
		"replacement",
	);
});

test("rejects root operations, subtree moves, overwrites, symlinks and invalid commands", async () => {
	expect((await command({ id: "root", action: "delete" })).statusCode).toBe(
		403,
	);
	const season = find("Season");
	const target = find("Target");
	expect(
		(
			await command({
				id: season.id,
				action: "move",
				destinationId: find("Extras", season.id).id,
			})
		).statusCode,
	).toBe(409);
	await mkdir(join(root, "Target", "Season"));
	expect(
		(await command({ id: season.id, action: "move", destinationId: target.id }))
			.statusCode,
	).toBe(409);

	expect((await command({ id: season.id, action: "rename" })).statusCode).toBe(
		400,
	);
	expect(
		(
			await command({
				id: season.id,
				action: "delete",
				destinationId: target.id,
			})
		).statusCode,
	).toBe(400);
	expect((await command({ id: season.id, action: "move" })).statusCode).toBe(
		400,
	);
});

test("does not overwrite an existing destination", async () => {
	const input = {
		id: find("Season").id,
		action: "move",
		destinationId: find("Target").id,
	};
	await mkdir(join(root, "Target", "Season"));
	await writeFile(join(root, "Target", "Season", "keep.txt"), "keep");
	expect((await command(input)).statusCode).toBe(409);
	expect(
		await readFile(join(root, "Target", "Season", "keep.txt"), "utf8"),
	).toBe("keep");
});

test("rejects traversal, symbolic-link parents and symbolic-link targets", async () => {
	const access = await ResourceMutations.create(root);
	await symlink(fixture, join(root, "escape"));
	await expect(access.execute("../outside.mp4")).rejects.toMatchObject({
		code: "RESOURCE_ACCESS_DENIED",
	});
	await expect(access.execute("escape/outside.mp4")).rejects.toMatchObject({
		code: "RESOURCE_ACCESS_DENIED",
	});
	await expect(access.execute("escape")).rejects.toMatchObject({
		code: "RESOURCE_ACCESS_DENIED",
	});
	await expect(
		access.execute("Season", { access, path: "escape" }),
	).rejects.toMatchObject({
		code: "RESOURCE_ACCESS_DENIED",
	});
});

test("recursive deletion removes nested symlinks without deleting their targets", async () => {
	const outside = join(fixture, "outside");
	await mkdir(outside);
	await writeFile(join(outside, "keep.txt"), "keep");
	await symlink(outside, join(root, "Season", "escape"));
	expect(
		(await command({ id: find("Season").id, action: "delete" })).statusCode,
	).toBe(200);
	expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep");
});

test("holds the scan/settings gate until the mutation and reconciliation finish", async () => {
	const input = { id: find("Season").id, action: "delete" };
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const original = ResourceMutations.prototype.execute;
	let entered = () => {};
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	vi.spyOn(ResourceMutations.prototype, "execute").mockImplementation(
		async function (this: ResourceMutations, ...args) {
			entered();
			await gate;
			return original.apply(this, args);
		},
	);
	const pending = command(input);
	await started;
	try {
		await expect(library.startScan()).rejects.toMatchObject({
			code: "SETTINGS_BUSY",
		});
		await expect(
			library.settings.coordinateSettingsChange(async () => ({
				resourceRoots: [],
			})),
		).rejects.toMatchObject({ code: "SETTINGS_BUSY" });
	} finally {
		release();
	}
	expect((await pending).statusCode).toBe(200);
});

test("reports a completed write separately from failed reconciliation", async () => {
	const input = { id: find("Season").id, action: "delete" };
	vi.spyOn(ScanRunner.prototype, "reconcile").mockRejectedValue(
		new Error("Root unavailable"),
	);
	const response = await command(input);
	expect(response.statusCode).toBe(200);
	expect(response.json()).toEqual({ refreshRequired: true });
	expect(await readdir(root)).toEqual(["Target"]);
	expect((await library.getStatus()).monitor?.status).toBe("degraded");
});

test("a failed operation reconciles partial filesystem changes", async () => {
	const season = find("Season");
	const input = { id: season.id, action: "delete" };
	vi.spyOn(ResourceMutations.prototype, "execute").mockImplementation(
		async () => {
			await rm(join(root, "Season", "episode.mp4"));
			throw new Error("Injected failure after partial deletion");
		},
	);
	const response = await command(input);
	expect(response.statusCode).toBe(403);
	expect(
		library.getDirectory(season.id).children.map((item) => item.name),
	).toEqual(["Extras"]);
	expect(await readFile(join(root, "Season", "notes.txt"), "utf8")).toBe(
		"notes",
	);
});
