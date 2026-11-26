import type { OfflineCacheHost } from "@anishelf/contracts/offline-cache";

export interface CommandPlayerDraft {
	name: string;
	executable: string;
	args: string[];
}

export interface CommandPlayerConfig extends CommandPlayerDraft {
	id: string;
}

export interface CommandPlayerPreset extends CommandPlayerDraft {
	id: string;
}

export interface ExternalPlayerListResponse {
	presets: CommandPlayerPreset[];
	players: CommandPlayerConfig[];
	error: boolean;
}

export type ServerSignInResult =
	| { status: "ok"; origin: string }
	| { status: "rejected"; httpStatus: number }
	| {
			status:
				| "invalidAddress"
				| "invalidResponse"
				| "unreachable"
				| "saveFailed"
				| "busy"
				| "localStartFailed";
	  };

export interface DesktopLoginItemState {
	supported: boolean;
	enabled: boolean;
}

export interface DesktopUpdateCheck {
	status:
		| "available"
		| "current"
		| "ahead"
		| "uncomparable"
		| "no-release"
		| "no-package";
	checkedAt: string;
	latest: { version: string; url: string } | null;
	downloads?: readonly { name: string; url: string }[];
}

export type DesktopMenuCommand =
	| { kind: "navigate"; path: string }
	| { kind: "checkForUpdates" }
	| { kind: "history"; direction: "back" | "forward" };

export interface DesktopBridge {
	offlineCache: OfflineCacheHost;
	checkForUpdates(): Promise<DesktopUpdateCheck>;
	setLanguage(language: string): Promise<void>;
	consumePendingMenuCommand(): Promise<DesktopMenuCommand | null>;
	onMenuCommand(listener: (command: DesktopMenuCommand) => void): () => void;
	getLaunchAtLogin(): Promise<DesktopLoginItemState>;
	setLaunchAtLogin(enabled: boolean): Promise<void>;
	getCloseToTray(): Promise<boolean>;
	setCloseToTray(enabled: boolean): Promise<void>;
	setWindowControlsColors(color: string, symbolColor: string): Promise<void>;
	getServerConnection(): Promise<{
		kind: "local" | "external";
		origin: string;
	}>;
	useLocalBackend(): Promise<ServerSignInResult>;
	signIn(origin: string, password: string): Promise<ServerSignInResult>;
	clearDeviceToken(origin: string): Promise<void>;
	copyText(text: string): Promise<void>;
	chooseDirectory(): Promise<string | null>;
	openExternal(url: string): Promise<void>;
	downloadFile(url: string, filename: string, id?: string): Promise<boolean>;
	onDownloadProgress(
		listener: (id: string, percent: number | null) => void,
	): () => void;
	revealDownload(id: string): Promise<void>;
	listExternalPlayers(): Promise<ExternalPlayerListResponse>;
	addExternalPlayer(draft: CommandPlayerDraft): Promise<void>;
	removeExternalPlayer(id: string): Promise<void>;
	choosePlayerExecutable(): Promise<string | null>;
	launchExternalPlayer(
		id: string,
		mediaUrl: string,
		mimeType: string,
	): Promise<void>;
}
