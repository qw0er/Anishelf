import type {
	CommandPlayer,
	ExternalPlayerCatalog,
	ExternalPlayerHost,
} from "@anishelf/client-ui/browser-platform";
import type { DesktopBridge } from "../ipc/desktop.js";
import type {
	CommandPlayerConfig,
	CommandPlayerPreset,
} from "../shared/player-command.js";
import {
	formatCommand,
	validateCommandPlayer,
} from "../shared/player-command.js";

function toCommandPlayer(
	player: CommandPlayerConfig | CommandPlayerPreset,
): CommandPlayer {
	return {
		kind: "command",
		id: player.id,
		name: player.name,
		executable: player.executable,
		args: player.args,
	};
}

export async function createDesktopExternalPlayers(
	desktop: DesktopBridge,
): Promise<ExternalPlayerHost> {
	let catalog: ExternalPlayerCatalog = {
		presets: [],
		custom: [],
		error: false,
	};
	const listeners = new Set<() => void>();

	async function load() {
		try {
			const response = await desktop.listExternalPlayers();
			catalog = {
				presets: response.presets.map(toCommandPlayer),
				custom: response.players.map(toCommandPlayer),
				error: response.error,
			};
		} catch (cause) {
			console.warn("[Players] External player settings could not be loaded.", {
				errorType: cause instanceof Error ? cause.name : "unknown",
			});
			catalog = { presets: [], custom: [], error: true };
		}
		for (const listener of listeners) listener();
	}

	await load();

	return {
		mode: "command",
		list: () => catalog,
		validate(draft) {
			if (draft.kind !== "command") return "externalPlayers.invalidCommand";
			return validateCommandPlayer(draft);
		},
		async add(draft) {
			if (draft.kind !== "command") throw new Error("Invalid external player.");
			await desktop.addExternalPlayer({
				name: draft.name,
				executable: draft.executable,
				args: draft.args,
			});
			console.debug("[Players] External player added.", {
				argumentCount: draft.args.length,
			});
			await load();
		},
		async remove(id) {
			await desktop.removeExternalPlayer(id);
			console.debug("[Players] External player removed.", { playerId: id });
			await load();
		},
		describe(player) {
			return player.kind === "command"
				? formatCommand(player.executable, player.args)
				: "";
		},
		async launch(player, media) {
			if (player.kind !== "command")
				throw new Error("Invalid external player.");
			console.debug("[Players] External player launch requested.", {
				playerId: player.id,
			});
			await desktop.launchExternalPlayer(player.id, media.url, media.mimeType);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		chooseExecutable: () => desktop.choosePlayerExecutable(),
	};
}
