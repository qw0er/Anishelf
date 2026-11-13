import { delimiter, join } from "node:path";
import { expect, test } from "vitest";
import { detectPlayerPresets } from "../src/main/native/player-presets.js";

test("resolves built-in commands from PATH and keeps the command name", async () => {
	const iina = "/custom/bin/iina";
	const presets = await detectPlayerPresets({
		platform: "darwin",
		environment: { PATH: "/custom/bin" },
		isExecutable: async (file) => file === iina,
	});
	expect(presets).toEqual([
		{
			preset: {
				id: "preset:iina",
				name: "IINA",
				executable: "iina",
				args: ["{url}"],
			},
			resolvedExecutable: iina,
		},
	]);
});

test("detects players from PATH and skips duplicates", async () => {
	const mpv = "/custom/bin/mpv";
	const presets = await detectPlayerPresets({
		platform: "linux",
		environment: { PATH: ["/custom/bin", "/usr/bin"].join(delimiter) },
		isExecutable: async (file) => file === mpv,
	});
	expect(presets).toEqual([
		{
			preset: {
				id: "preset:mpv",
				name: "mpv",
				executable: "mpv",
				args: ["--", "{url}"],
			},
			resolvedExecutable: mpv,
		},
	]);
});

test("returns no presets when nothing is installed", async () => {
	expect(
		await detectPlayerPresets({
			platform: "linux",
			environment: { PATH: join("/empty") },
			isExecutable: async () => false,
		}),
	).toEqual([]);
});
