import type {
	CommandPlayer,
	ExternalPlayer,
	ExternalPlayerCatalog,
	ExternalPlayerDraft,
	ExternalPlayerHost,
	PlayerMedia,
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

type PlayerBridge = Pick<
	DesktopBridge,
	| "listExternalPlayers"
	| "addExternalPlayer"
	| "removeExternalPlayer"
	| "launchExternalPlayer"
	| "choosePlayerExecutable"
>;

export async function createDesktopExternalPlayers(
	desktop: PlayerBridge,
): Promise<ExternalPlayerHost> {
	return DesktopExternalPlayers.open(desktop);
}

class DesktopExternalPlayers implements ExternalPlayerHost {
	readonly mode = "command";
	private catalog: ExternalPlayerCatalog = {
		presets: [],
		custom: [],
		error: false,
	};
	private readonly listeners = new Set<() => void>();

	private constructor(private readonly desktop: PlayerBridge) {
		this.add = this.add.bind(this);
		this.remove = this.remove.bind(this);
		this.launch = this.launch.bind(this);
		this.chooseExecutable = this.chooseExecutable.bind(this);
	}

	static async open(desktop: PlayerBridge): Promise<DesktopExternalPlayers> {
		const players = new DesktopExternalPlayers(desktop);
		await players.load();
		return players;
	}

	list(): ExternalPlayerCatalog {
		return this.catalog;
	}
	validate(draft: ExternalPlayerDraft): string | null {
		if (draft.kind !== "command") return "externalPlayers.invalidCommand";
		return validateCommandPlayer(draft);
	}
	async add(draft: ExternalPlayerDraft): Promise<void> {
		if (draft.kind !== "command") throw new Error("Invalid external player.");
		await this.desktop.addExternalPlayer({
			name: draft.name,
			executable: draft.executable,
			args: draft.args,
		});
		console.debug("[Players] External player added.", {
			argumentCount: draft.args.length,
		});
		await this.load();
	}
	async remove(id: string): Promise<void> {
		await this.desktop.removeExternalPlayer(id);
		console.debug("[Players] External player removed.", { playerId: id });
		await this.load();
	}
	describe(player: ExternalPlayer): string {
		return player.kind === "command"
			? formatCommand(player.executable, player.args)
			: "";
	}
	async launch(player: ExternalPlayer, media: PlayerMedia): Promise<void> {
		if (player.kind !== "command") throw new Error("Invalid external player.");
		console.debug("[Players] External player launch requested.", {
			playerId: player.id,
		});
		await this.desktop.launchExternalPlayer(
			player.id,
			media.url,
			media.mimeType,
		);
	}
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	chooseExecutable(): Promise<string | null> {
		return this.desktop.choosePlayerExecutable();
	}

	private async load(): Promise<void> {
		try {
			const response = await this.desktop.listExternalPlayers();
			this.catalog = {
				presets: response.presets.map(toCommandPlayer),
				custom: response.players.map(toCommandPlayer),
				error: response.error,
			};
		} catch (cause) {
			console.warn("[Players] External player settings could not be loaded.", {
				errorType: cause instanceof Error ? cause.name : "unknown",
			});
			this.catalog = { presets: [], custom: [], error: true };
		}
		for (const listener of this.listeners) listener();
	}
}
