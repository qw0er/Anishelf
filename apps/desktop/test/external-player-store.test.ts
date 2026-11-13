import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createExternalPlayerStore } from "../src/main/native/external-player-store.js";

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-players-"));
	const executable = join(
		directory,
		process.platform === "win32" ? "mpv.exe" : "mpv",
	);
	await writeFile(executable, "");
	if (process.platform !== "win32") await chmod(executable, 0o755);
	return { directory, executable, store: createExternalPlayerStore(directory) };
}

test("stores, lists and removes command players", async () => {
	const { directory, executable, store } = await fixture();
	try {
		const player = await store.add({
			name: "mpv",
			executable,
			args: ["--", "{url}"],
		});
		assert.ok(player.id.startsWith("player:"));
		assert.deepEqual(await store.read(), [player]);
		const stored = JSON.parse(
			await readFile(join(directory, "external-players.json"), "utf8"),
		);
		assert.deepEqual(stored, [player]);
		await store.remove(player.id);
		assert.deepEqual(await store.read(), []);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("accepts a bare command name and rejects a missing path", async () => {
	const { directory, executable, store } = await fixture();
	try {
		const player = await store.add({
			name: "mpv",
			executable: "mpv",
			args: ["{url}"],
		});
		assert.equal(player.executable, "mpv");
		await assert.rejects(
			store.add({
				name: "missing",
				executable: join(directory, "missing"),
				args: ["{url}"],
			}),
		);
		await assert.rejects(
			store.add({
				name: "no url",
				executable,
				args: ["--no-terminal"],
			}),
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("surfaces malformed configuration without overwriting it", async () => {
	const { directory, store } = await fixture();
	const file = join(directory, "external-players.json");
	try {
		await writeFile(file, "{not json");
		await assert.rejects(store.read());
		assert.equal(await readFile(file, "utf8"), "{not json");
		await assert.rejects(
			store.add({ name: "mpv", executable: "mpv", args: ["{url}"] }),
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
