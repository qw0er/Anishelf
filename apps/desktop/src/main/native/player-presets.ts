import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { CommandPlayerPreset } from "../../shared/player-command.js";

interface PresetDefinition {
	id: string;
	name: string;
	command: string;
	args: string[];
}

export interface DetectedPlayerPreset {
	preset: CommandPlayerPreset;
	resolvedExecutable: string;
}

export interface DetectPlayerPresetsOptions {
	platform?: NodeJS.Platform;
	environment?: NodeJS.ProcessEnv;
	isExecutable?: (file: string) => Promise<boolean>;
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
				args: ["{url}"],
			},
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
		];
	if (platform === "win32")
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
				id: "preset:potplayer",
				name: "PotPlayer",
				command: "PotPlayerMini64",
				args: ["{url}"],
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

function pathCandidates(
	command: string,
	platform: NodeJS.Platform,
	environment: NodeJS.ProcessEnv,
): string[] {
	const pathValue = environment.PATH ?? environment.Path ?? "";
	const names =
		platform === "win32" ? [`${command}.exe`, `${command}.com`] : [command];
	return pathValue
		.split(delimiter)
		.filter(Boolean)
		.flatMap((directory) => names.map((file) => join(directory, file)));
}

async function resolvePreset(
	preset: PresetDefinition,
	platform: NodeJS.Platform,
	environment: NodeJS.ProcessEnv,
	isExecutable: (file: string) => Promise<boolean>,
): Promise<string | null> {
	for (const candidate of pathCandidates(preset.command, platform, environment))
		if (await isExecutable(candidate)) return candidate;
	return null;
}

/** Detect built-in players by resolving their command names from PATH. */
export async function detectPlayerPresets(
	options: DetectPlayerPresetsOptions = {},
): Promise<DetectedPlayerPreset[]> {
	const platform = options.platform ?? process.platform;
	const environment = options.environment ?? process.env;
	const isExecutable = options.isExecutable ?? isExecutableFile;
	const seen = new Set<string>();
	const presets: DetectedPlayerPreset[] = [];
	for (const definition of presetDefinitions(platform)) {
		const resolvedExecutable = await resolvePreset(
			definition,
			platform,
			environment,
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
