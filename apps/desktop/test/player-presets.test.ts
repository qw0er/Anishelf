import { expect, test, vi } from "vitest";
import { detectPlayerPresets } from "../src/main/native/player-presets.js";

const emptyConfiguredPath = async () => "";

test("resolves built-in commands from PATH and keeps the command name", async () => {
	const iina = "/custom/bin/iina";
	const presets = await detectPlayerPresets({
		platform: "darwin",
		environment: { PATH: "/custom/bin" },
		readConfiguredPath: emptyConfiguredPath,
		isExecutable: async (file) => file === iina,
	});
	expect(presets).toEqual([
		{
			preset: {
				id: "preset:iina",
				name: "IINA",
				executable: "iina",
				args: ["--no-stdin", "{url}"],
			},
			resolvedExecutable: iina,
		},
	]);
});

test("uses inherited PATH first, then configured PATH and common Linux locations", async () => {
	const files = new Set([
		"/inherited/mpv",
		"/configured/mpv",
		"/configured/vlc",
		"/home/player/.local/bin/celluloid",
		"/usr/bin/haruna",
	]);
	const isExecutable = vi.fn(async (file: string) => files.has(file));
	const presets = await detectPlayerPresets({
		platform: "linux",
		environment: { PATH: "/inherited" },
		homeDirectory: "/home/player",
		readConfiguredPath: async () => "/inherited:/configured",
		isExecutable,
	});
	expect(presets.map(({ resolvedExecutable }) => resolvedExecutable)).toEqual([
		"/inherited/mpv",
		"/configured/vlc",
		"/home/player/.local/bin/celluloid",
		"/usr/bin/haruna",
	]);
	expect(
		isExecutable.mock.calls.filter(([file]) => file === "/inherited/vlc"),
	).toHaveLength(1);
});

test("detects macOS app bundles and Homebrew commands outside PATH", async () => {
	const files = [
		"/Users/player/Applications/IINA.app/Contents/MacOS/iina-cli",
		"/opt/homebrew/bin/mpv",
		"/Applications/VLC.app/Contents/MacOS/VLC",
	];
	const presets = await detectPlayerPresets({
		platform: "darwin",
		environment: {},
		homeDirectory: "/Users/player",
		readConfiguredPath: emptyConfiguredPath,
		isExecutable: async (file) => files.includes(file),
	});
	expect(presets.map(({ resolvedExecutable }) => resolvedExecutable)).toEqual(
		files,
	);
});

test("detects Windows commands on the configured PATH and in standard install locations", async () => {
	const files = [
		String.raw`D:\User Tools\mpv.com`,
		String.raw`C:\Users\player\AppData\Local\Programs\VideoLAN\VLC\vlc.exe`,
		String.raw`C:\Program Files (x86)\DAUM\PotPlayer\PotPlayerMini.exe`,
	];
	const presets = await detectPlayerPresets({
		platform: "win32",
		environment: {
			Path: String.raw`C:\Windows\System32`,
			ProgramFiles: String.raw`C:\Program Files`,
			"ProgramFiles(x86)": String.raw`C:\Program Files (x86)`,
			LOCALAPPDATA: String.raw`C:\Users\player\AppData\Local`,
		},
		homeDirectory: String.raw`C:\Users\player`,
		readConfiguredPath: async () => String.raw`C:\SystemTools;"D:\User Tools"`,
		isExecutable: async (file) => files.includes(file),
	});
	expect(presets.map(({ resolvedExecutable }) => resolvedExecutable)).toEqual(
		files,
	);
});

test("continues checking install locations when configured PATH cannot be read", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		const presets = await detectPlayerPresets({
			platform: "darwin",
			environment: {},
			readConfiguredPath: async () => {
				throw new Error("shell failed");
			},
			isExecutable: async (file) =>
				file === "/Applications/VLC.app/Contents/MacOS/VLC",
		});
		expect(presets.map(({ preset }) => preset.id)).toEqual(["preset:vlc"]);
		expect(warn).toHaveBeenCalledWith(
			"desktop.external_player_path_read_failed",
			{
				platform: "darwin",
				errorType: "Error",
			},
		);
	} finally {
		warn.mockRestore();
	}
});

test("returns no presets when nothing is installed", async () => {
	expect(
		await detectPlayerPresets({
			platform: "linux",
			environment: { PATH: "/empty" },
			readConfiguredPath: emptyConfiguredPath,
			isExecutable: async () => false,
		}),
	).toEqual([]);
});
