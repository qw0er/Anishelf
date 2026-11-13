import { spawn } from "node:child_process";
import { basename } from "node:path";
import {
	type BrowserWindow,
	dialog,
	type MessageBoxOptions,
	type OpenDialogOptions,
} from "electron";
import type {
	CommandPlayerDraft,
	ExternalPlayerListResponse,
	PlayerMedia,
} from "../../shared/player-command.js";
import {
	formatCommand,
	maskMediaUrl,
	substituteCommandArgs,
	validateCommandPlayer,
} from "../../shared/player-command.js";
import { createExternalPlayerStore } from "./external-player-store.js";
import { httpUrl } from "./links.js";
import { detectPlayerPresets } from "./player-presets.js";

export interface ExternalPlayerService {
	list(): Promise<ExternalPlayerListResponse>;
	add(draft: unknown): Promise<void>;
	remove(id: unknown): Promise<void>;
	chooseExecutable(parent: BrowserWindow | null): Promise<string | null>;
	launch(
		parent: BrowserWindow | null,
		id: unknown,
		mediaUrl: unknown,
		mimeType: unknown,
	): Promise<void>;
}

function readDraft(value: unknown): CommandPlayerDraft {
	if (!value || typeof value !== "object")
		throw new Error("Invalid external player settings.");
	const item = value as Record<string, unknown>;
	if (
		typeof item.name !== "string" ||
		typeof item.executable !== "string" ||
		!Array.isArray(item.args) ||
		!item.args.every((argument) => typeof argument === "string")
	)
		throw new Error("Invalid external player settings.");
	return { name: item.name, executable: item.executable, args: item.args };
}

async function spawnDetached(executable: string, args: readonly string[]) {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(executable, args, {
			shell: false,
			detached: true,
			stdio: "ignore",
			windowsHide: false,
		});
		child.once("error", (error) => {
			console.warn("desktop.external_player_spawn_failed", {
				errorType: error instanceof Error ? error.name : "unknown",
			});
			reject(error);
		});
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
		child.once("exit", (code, signal) => {
			console.info("desktop.external_player_exited", { code, signal });
		});
	});
}

export function createExternalPlayerService(
	userDataDirectory: string,
): ExternalPlayerService {
	const store = createExternalPlayerStore(userDataDirectory);

	async function list(): Promise<ExternalPlayerListResponse> {
		let players = [] as Awaited<ReturnType<typeof store.read>>;
		let error = false;
		try {
			players = await store.read();
		} catch (cause) {
			error = true;
			console.warn("desktop.external_players_read_failed", {
				errorType: cause instanceof Error ? cause.name : "unknown",
			});
		}
		let detected = [] as Awaited<ReturnType<typeof detectPlayerPresets>>;
		try {
			detected = await detectPlayerPresets();
		} catch (cause) {
			console.warn("desktop.external_players_detection_failed", {
				errorType: cause instanceof Error ? cause.name : "unknown",
			});
		}
		const configured = new Set(players.map((player) => player.executable));
		const available = detected
			.filter(
				({ preset, resolvedExecutable }) =>
					!configured.has(preset.executable) &&
					!configured.has(resolvedExecutable),
			)
			.map(({ preset }) => preset);
		console.info("desktop.external_players_listed", {
			configured: players.length,
			presets: available.length,
			error,
		});
		return { presets: available, players, error };
	}

	async function add(draftValue: unknown) {
		const draft = readDraft(draftValue);
		const validationError = validateCommandPlayer(draft);
		if (validationError) throw new Error(validationError);
		const player = await store.add(draft);
		console.info("desktop.external_player_added", {
			playerId: player.id,
			executable: basename(player.executable),
			argumentCount: player.args.length,
		});
	}

	async function remove(idValue: unknown) {
		if (typeof idValue !== "string" || !idValue.startsWith("player:"))
			throw new Error("Invalid external player.");
		await store.remove(idValue);
		console.info("desktop.external_player_removed", { playerId: idValue });
	}

	async function chooseExecutable(
		parent: BrowserWindow | null,
	): Promise<string | null> {
		const options: OpenDialogOptions = {
			title: "Choose an external player executable",
			properties: ["openFile"],
			...(process.platform === "darwin"
				? { treatPackageAsDirectory: true }
				: {}),
			...(process.platform === "win32"
				? { filters: [{ name: "Programs", extensions: ["exe", "com"] }] }
				: {}),
		};
		const result = parent
			? await dialog.showOpenDialog(parent, options)
			: await dialog.showOpenDialog(options);
		const selected = result.canceled ? undefined : result.filePaths[0];
		if (!selected) {
			console.info("desktop.external_player_executable_cancelled");
			return null;
		}
		console.info("desktop.external_player_executable_selected", {
			executable: basename(selected),
		});
		return selected;
	}

	async function confirm(
		parent: BrowserWindow | null,
		playerName: string,
		preview: string,
	) {
		const options: MessageBoxOptions = {
			type: "question",
			buttons: ["Open", "Cancel"],
			defaultId: 0,
			cancelId: 1,
			noLink: true,
			message: `Open with ${playerName}?`,
			detail: preview,
		};
		return parent
			? dialog.showMessageBox(parent, options)
			: dialog.showMessageBox(options);
	}

	async function launch(
		parent: BrowserWindow | null,
		idValue: unknown,
		mediaUrl: unknown,
		mimeType: unknown,
	) {
		if (typeof idValue !== "string")
			throw new Error("Invalid external player.");
		const media = httpUrl(mediaUrl);
		let executable: string;
		let player: { name: string; executable: string; args: string[] };
		if (idValue.startsWith("preset:")) {
			const detected = (await detectPlayerPresets()).find(
				(entry) => entry.preset.id === idValue,
			);
			if (!detected) throw new Error("Unknown external player.");
			executable = detected.resolvedExecutable;
			player = detected.preset;
		} else {
			const stored = (await store.read()).find((entry) => entry.id === idValue);
			if (!stored) throw new Error("Unknown external player.");
			executable = stored.executable;
			player = stored;
		}
		const target: PlayerMedia = {
			url: media.href,
			mimeType: typeof mimeType === "string" ? mimeType : "video/*",
		};
		console.debug("desktop.external_player_target", {
			path: new URL(target.url).pathname,
			hasToken: new URL(target.url).searchParams.has("access_token"),
		});
		const args = substituteCommandArgs(player.args, target);
		const previewArgs = substituteCommandArgs(player.args, {
			...target,
			url: maskMediaUrl(target.url),
		});
		const result = await confirm(
			parent,
			player.name,
			formatCommand(player.executable, previewArgs),
		);
		if (result.response !== 0) {
			console.info("desktop.external_player_cancelled", {
				playerId: idValue,
			});
			return;
		}
		await spawnDetached(executable, args);
		console.info("desktop.external_player_launched", {
			playerId: idValue,
			executable: basename(executable),
			argumentCount: args.length,
		});
	}

	return { list, add, remove, chooseExecutable, launch };
}
