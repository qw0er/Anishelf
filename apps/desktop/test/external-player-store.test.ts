import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
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
		expect(player.id.startsWith("player:")).toBe(true);
		expect(await store.read()).toEqual([player]);
		const stored = JSON.parse(
			await readFile(join(directory, "external-players.json"), "utf8"),
		);
		expect(stored).toEqual([player]);
		await store.remove(player.id);
		expect(await store.read()).toEqual([]);
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
		expect(player.executable).toBe("mpv");
		await expect(
			store.add({
				name: "missing",
				executable: join(directory, "missing"),
				args: ["{url}"],
			}),
		).rejects.toThrow();
		await expect(
			store.add({
				name: "no url",
				executable,
				args: ["--no-terminal"],
			}),
		).rejects.toThrow();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("surfaces malformed configuration without overwriting it", async () => {
	const { directory, store } = await fixture();
	const file = join(directory, "external-players.json");
	try {
		await writeFile(file, "{not json");
		await expect(store.read()).rejects.toThrow();
		expect(await readFile(file, "utf8")).toBe("{not json");
		await expect(
			store.add({ name: "mpv", executable: "mpv", args: ["{url}"] }),
		).rejects.toThrow();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
