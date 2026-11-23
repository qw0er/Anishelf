import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import type { CommandPlayerPreset } from "../../shared/player-command.js";
import { readConfiguredPlayerPath } from "./player-search-path.js";

interface PresetDefinition {
	id: string;
	name: string;
	command: string;
	args: string[];
	alternateCommand?: string;
	installPaths?: string[];
}

export interface DetectedPlayerPreset {
	preset: CommandPlayerPreset;
	resolvedExecutable: string;
}

export interface DetectPlayerPresetsOptions {
	platform?: NodeJS.Platform;
	environment?: NodeJS.ProcessEnv;
	homeDirectory?: string;
	isExecutable?: (file: string) => Promise<boolean>;
	readConfiguredPath?: typeof readConfiguredPlayerPath;
}

async function isExecutableFile(file: string): Promise<boolean> {
	try {
		const info = await stat(file);
		if (!info.isFile()) return false;
		if (process.platform !== "win32") await access(file, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function presetDefinitions(platform: NodeJS.Platform): PresetDefinition[] {
	if (platform === "darwin")
		return [
			{
				id: "preset:iina",
				name: "IINA",
				command: "iina",
				args: ["--no-stdin", "{url}"],
				installPaths: ["IINA.app/Contents/MacOS/iina-cli"],
			},
			{
				id: "preset:mpv",
				name: "mpv",
				command: "mpv",
				args: ["--", "{url}"],
				installPaths: ["mpv.app/Contents/MacOS/mpv"],
			},
			{
				id: "preset:vlc",
				name: "VLC",
				command: "vlc",
				args: ["{url}"],
				installPaths: ["VLC.app/Contents/MacOS/VLC"],
			},
		];
	if (platform === "win32")
		return [
			{
				id: "preset:mpv",
				name: "mpv",
				command: "mpv",
				args: ["--", "{url}"],
				installPaths: ["mpv/mpv.exe", "mpv/mpv.com"],
			},
			{
				id: "preset:vlc",
				name: "VLC",
				command: "vlc",
				args: ["{url}"],
				installPaths: ["VideoLAN/VLC/vlc.exe", "VLC/vlc.exe"],
			},
			{
				id: "preset:potplayer",
				name: "PotPlayer",
				command: "PotPlayerMini64",
				args: ["{url}"],
				alternateCommand: "PotPlayerMini",
				installPaths: [
					"DAUM/PotPlayer/PotPlayerMini64.exe",
					"DAUM/PotPlayer/PotPlayerMini.exe",
					"PotPlayer/PotPlayerMini64.exe",
					"PotPlayer/PotPlayerMini.exe",
				],
			},
		];
	return [
		{
			id: "preset:mpv",
			name: "mpv",
			command: "mpv",
			args: ["--", "{url}"],
		},
		{
			id: "preset:vlc",
			name: "VLC",
			command: "vlc",
			args: ["{url}"],
		},
		{
			id: "preset:celluloid",
			name: "Celluloid",
			command: "celluloid",
			args: ["{url}"],
		},
		{
			id: "preset:haruna",
			name: "Haruna",
			command: "haruna",
			args: ["{url}"],
		},
	];
}

function searchLocations(
	platform: NodeJS.Platform,
	environment: NodeJS.ProcessEnv,
	homeDirectory: string,
	configuredPath: string,
) {
	const paths = platform === "win32" ? win32 : posix;
	const pathDirectories = [
		...(environment.PATH ?? environment.Path ?? "").split(paths.delimiter),
		...configuredPath.split(paths.delimiter),
	];
	if (platform === "win32") {
		const localAppData = environment.LOCALAPPDATA;
		const programFiles = [
			environment.ProgramW6432,
			environment.ProgramFiles,
			environment["ProgramFiles(x86)"],
		].filter((directory): directory is string => Boolean(directory));
		const installRoots = [...programFiles];
		pathDirectories.push(
			...programFiles.map((directory) =>
				win32.join(directory, "WinGet", "Links"),
			),
			win32.join(
				environment.SCOOP || win32.join(homeDirectory, "scoop"),
				"shims",
			),
		);
		if (localAppData) {
			installRoots.push(win32.join(localAppData, "Programs"), localAppData);
			pathDirectories.push(
				win32.join(localAppData, "Microsoft", "WinGet", "Links"),
			);
		}
		return { pathDirectories, installRoots };
	}

	pathDirectories.push(
		posix.join(homeDirectory, ".local/bin"),
		posix.join(homeDirectory, "bin"),
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
	);
	if (platform === "darwin") {
		pathDirectories.push("/opt/homebrew/bin", "/opt/local/bin");
		return {
			pathDirectories,
			installRoots: [
				"/Applications",
				posix.join(homeDirectory, "Applications"),
			],
		};
	}
	return { pathDirectories, installRoots: [] };
}

async function resolvePreset(
	preset: PresetDefinition,
	platform: NodeJS.Platform,
	{ pathDirectories, installRoots }: ReturnType<typeof searchLocations>,
	isExecutable: (file: string) => Promise<boolean>,
): Promise<string | null> {
	const isWindows = platform === "win32";
	const paths = isWindows ? win32 : posix;
	const commands = [preset.command];
	if (preset.alternateCommand) commands.push(preset.alternateCommand);
	const names = isWindows
		? commands.flatMap((command) => [`${command}.exe`, `${command}.com`])
		: commands;
	const candidates = [
		...pathDirectories
			.map((directory) =>
				isWindows ? directory.replace(/^"|"$/g, "") : directory,
			)
			.filter(Boolean)
			.flatMap((directory) => names.map((name) => paths.join(directory, name))),
		...installRoots.flatMap((directory) =>
			(preset.installPaths ?? []).map((file) => paths.join(directory, file)),
		),
	];
	const checked = new Set<string>();
	for (const candidate of candidates) {
		const key = isWindows ? candidate.toLowerCase() : candidate;
		if (checked.has(key)) continue;
		checked.add(key);
		if (await isExecutable(candidate)) return candidate;
	}
	return null;
}

export async function detectPlayerPresets(
	options: DetectPlayerPresetsOptions = {},
): Promise<DetectedPlayerPreset[]> {
	const platform = options.platform ?? process.platform;
	const environment = options.environment ?? process.env;
	const isExecutable = options.isExecutable ?? isExecutableFile;
	const readConfiguredPath =
		options.readConfiguredPath ?? readConfiguredPlayerPath;
	let configuredPath = "";
	try {
		configuredPath = await readConfiguredPath(platform, environment);
	} catch (cause) {
		console.warn("desktop.external_player_path_read_failed", {
			platform,
			errorType: cause instanceof Error ? cause.name : "unknown",
		});
	}
	const locations = searchLocations(
		platform,
		environment,
		options.homeDirectory ?? homedir(),
		configuredPath,
	);
	const seen = new Set<string>();
	const presets: DetectedPlayerPreset[] = [];
	for (const definition of presetDefinitions(platform)) {
		const resolvedExecutable = await resolvePreset(
			definition,
			platform,
			locations,
			isExecutable,
		);
		if (!resolvedExecutable || seen.has(resolvedExecutable)) continue;
		seen.add(resolvedExecutable);
		presets.push({
			preset: {
				id: definition.id,
				name: definition.name,
				executable: definition.command,
				args: definition.args,
			},
			resolvedExecutable,
		});
	}
	return presets;
}
