import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
	checkResourceRoot,
	PersistentConfiguration,
	parsePersistentSettings,
} from "../src/config/persistent.js";

async function loadPersistentSettings(dataDir: string) {
	return (await PersistentConfiguration.load(dataDir)).settings;
}

let fixture: string;
let dataDir: string;
let resourceRoot: string;
beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "anishelf-settings-"));
	dataDir = join(fixture, "data");
	resourceRoot = join(fixture, "中文 media");
	await mkdir(dataDir);
});
afterEach(async () => {
	await rm(fixture, { recursive: true, force: true });
});
async function settings(root = resourceRoot): Promise<void> {
	await writeFile(
		join(dataDir, "settings.json"),
		JSON.stringify({ resourceRoot: root }),
	);
}

test.each([
	"",
	'{"resourceRoot":',
	"null",
	"[]",
	"123",
	"{}",
	'{"resourceRoot":123}',
	'{"resourceRoot":"relative"}',
	'{"resourceRoot":""}',
	'{"resourceRoot":"\\u0000"}',
	'{"resourceRoot":"/media","port":3000}',
])("rejects invalid persistent configuration: %s", (source) => {
	expect(() => parsePersistentSettings(source)).toThrow();
});

test("loads read-only settings and handles valid paths with spaces and Chinese", async () => {
	await mkdir(resourceRoot);
	await settings();
	const path = join(dataDir, "settings.json");
	const original = await readFile(path, "utf8");
	await chmod(path, 0o400);
	expect(await loadPersistentSettings(dataDir)).toEqual({ resourceRoot });
	expect(await checkResourceRoot({ resourceRoot })).toBeNull();
	expect(await readFile(path, "utf8")).toBe(original);
});

test("missing settings names the expected location and setting", async () => {
	await expect(loadPersistentSettings(dataDir)).rejects.toThrow(
		join(dataDir, "settings.json"),
	);
	await expect(loadPersistentSettings(dataDir)).rejects.toThrow("resourceRoot");
});

test("malformed JSON does not put its contents in diagnostics", () => {
	expect(() => parsePersistentSettings("secret-value")).toThrow(
		"not valid JSON",
	);
});

test.each(["same", "resource-in-data", "data-in-resource"])(
	"rejects overlapping directories: %s",
	async (kind) => {
		const root =
			kind === "same"
				? dataDir
				: kind === "resource-in-data"
					? join(dataDir, "media")
					: fixture;
		await settings(root);
		await expect(loadPersistentSettings(dataDir)).rejects.toThrow(
			"separate directories",
		);
	},
);

test("rejects overlap through a symlink", async () => {
	const alias = join(fixture, "alias");
	await symlink(dataDir, alias, "dir");
	await settings(alias);
	await expect(loadPersistentSettings(dataDir)).rejects.toThrow(
		"separate directories",
	);
});

test("missing root is recoverable and availability can be rechecked", async () => {
	await settings();
	const loaded = await loadPersistentSettings(dataDir);
	const issue = await checkResourceRoot(loaded);
	expect(issue?.code).toBe("RESOURCE_ROOT_UNAVAILABLE");
	expect(issue?.message).not.toContain(resourceRoot);
	await mkdir(resourceRoot);
	expect(await checkResourceRoot(loaded)).toBeNull();
});

test("a resource path pointing to a file is unavailable", async () => {
	await writeFile(resourceRoot, "not a directory");
	expect(await checkResourceRoot({ resourceRoot })).toMatchObject({
		code: "RESOURCE_ROOT_UNAVAILABLE",
	});
});

test.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
	"distinguishes unreadable settings from an unreadable root",
	async () => {
		await mkdir(resourceRoot);
		await settings();
		const path = join(dataDir, "settings.json");
		await chmod(path, 0o000);
		try {
			await expect(loadPersistentSettings(dataDir)).rejects.toMatchObject({
				code: "CONFIG_INVALID",
			});
		} finally {
			await chmod(path, 0o600);
		}
		await chmod(resourceRoot, 0o000);
		try {
			expect(await checkResourceRoot({ resourceRoot })).toMatchObject({
				code: "RESOURCE_ROOT_UNAVAILABLE",
			});
		} finally {
			await chmod(resourceRoot, 0o700);
		}
	},
);

test("manager updates both disk and memory and reloads the saved settings", async () => {
	await settings();
	const manager = await PersistentConfiguration.load(dataDir);
	const next = { resourceRoot: join(fixture, "new media") };
	expect(await manager.update(next)).toEqual(next);
	expect(manager.settings).toEqual(next);
	expect(
		JSON.parse(await readFile(join(dataDir, "settings.json"), "utf8")),
	).toEqual(next);
	expect((await PersistentConfiguration.load(dataDir)).settings).toEqual(next);
	expect(await readdir(dataDir)).toEqual(["settings.json"]);
});

test("settings snapshots and caller-owned input cannot mutate manager state", async () => {
	await settings();
	const manager = await PersistentConfiguration.load(dataDir);
	const snapshot = manager.settings as { resourceRoot: string };
	snapshot.resourceRoot = "/changed-outside-manager";
	expect(manager.settings.resourceRoot).toBe(resourceRoot);
	const input = { resourceRoot: join(fixture, "next") };
	const pending = manager.update(input);
	input.resourceRoot = "/changed-after-update-call";
	await pending;
	expect(manager.settings.resourceRoot).toBe(join(fixture, "next"));
});

test("invalid updates leave memory and file unchanged", async () => {
	await settings();
	const manager = await PersistentConfiguration.load(dataDir);
	const original = await readFile(join(dataDir, "settings.json"), "utf8");
	await expect(
		manager.update({ resourceRoot: "relative" }),
	).rejects.toMatchObject({ code: "CONFIG_INVALID" });
	await expect(manager.update({ resourceRoot: dataDir })).rejects.toMatchObject(
		{ code: "CONFIG_INVALID" },
	);
	expect(manager.settings).toEqual({ resourceRoot });
	expect(await readFile(join(dataDir, "settings.json"), "utf8")).toBe(original);
});

test("concurrent updates save in call order and continue after rejection", async () => {
	await settings();
	const manager = await PersistentConfiguration.load(dataDir);
	const first = { resourceRoot: join(fixture, "first") };
	const last = { resourceRoot: join(fixture, "last") };
	const results = await Promise.allSettled([
		manager.update(first),
		manager.update({ resourceRoot: dataDir }),
		manager.update(last),
	]);
	expect(results.map((result) => result.status)).toEqual([
		"fulfilled",
		"rejected",
		"fulfilled",
	]);
	expect(manager.settings).toEqual(last);
	expect(
		JSON.parse(await readFile(join(dataDir, "settings.json"), "utf8")),
	).toEqual(last);
});

test("failed atomic replacement preserves memory, cleans temporary files and permits retry", async () => {
	await settings();
	const manager = await PersistentConfiguration.load(dataDir);
	const path = join(dataDir, "settings.json");
	const backup = join(dataDir, "backup.json");
	await rename(path, backup);
	await mkdir(path); // Force replacement failure without relying on OS permission rules.
	const next = { resourceRoot: join(fixture, "next") };
	await expect(manager.update(next)).rejects.toMatchObject({
		code: "CONFIG_WRITE_FAILED",
	});
	expect(manager.settings).toEqual({ resourceRoot });
	expect((await readdir(dataDir)).some((name) => name.endsWith(".tmp"))).toBe(
		false,
	);
	await rm(path, { recursive: true });
	await rename(backup, path);
	expect(await manager.update(next)).toEqual(next);
});

test.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
	"unwritable data directory leaves the old settings file and memory intact",
	async () => {
		await settings();
		const manager = await PersistentConfiguration.load(dataDir);
		const original = await readFile(join(dataDir, "settings.json"), "utf8");
		await chmod(dataDir, 0o500);
		try {
			await expect(
				manager.update({ resourceRoot: join(fixture, "next") }),
			).rejects.toMatchObject({ code: "CONFIG_WRITE_FAILED" });
			expect(manager.settings).toEqual({ resourceRoot });
			expect(await readFile(join(dataDir, "settings.json"), "utf8")).toBe(
				original,
			);
		} finally {
			await chmod(dataDir, 0o700);
		}
	},
);
