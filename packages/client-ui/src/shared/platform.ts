export interface ClientStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface PlayerMedia {
	url: string;
	mimeType: string;
}

type ExternalPlayerMode = "url-template" | "command";

export interface UrlTemplatePlayer {
	readonly kind: "url-template";
	readonly id: string;
	readonly name: string;
	readonly template: string;
}

export interface CommandPlayer {
	readonly kind: "command";
	readonly id: string;
	readonly name: string;
	readonly executable: string;
	readonly args: readonly string[];
}

export type ExternalPlayer = UrlTemplatePlayer | CommandPlayer;

export type ExternalPlayerDraft =
	| { kind: "url-template"; name: string; template: string }
	| { kind: "command"; name: string; executable: string; args: string[] };

export interface ExternalPlayerCatalog {
	readonly presets: readonly ExternalPlayer[];
	readonly custom: readonly ExternalPlayer[];
	readonly error: boolean;
}

/**
 * Host boundary for external-player settings and handoff.
 *
 * Web stores URL templates in browser storage and opens a custom-scheme URL.
 * Desktop stores command players in the main process and spawns the executable.
 */
export interface ExternalPlayerHost {
	readonly mode: ExternalPlayerMode;
	list(): ExternalPlayerCatalog;
	validate(draft: ExternalPlayerDraft): string | null;
	add(draft: ExternalPlayerDraft): Promise<void>;
	remove(id: string): Promise<void>;
	describe(player: ExternalPlayer): string;
	link?(player: ExternalPlayer, media: PlayerMedia): string | undefined;
	launch(player: ExternalPlayer, media: PlayerMedia): Promise<void>;
	subscribe(listener: () => void): () => void;
}

export interface ClientPlatform {
	preferences: ClientStorage;
	sessionStorage: ClientStorage;
	preferredLanguages(): readonly string[];
	device: {
		userAgent: string;
		platform?: string;
		maxTouchPoints?: number;
		userAgentData?: { platform: string };
	};
	onPreferenceChange(key: string, callback: () => void): () => void;
	externalPlayers: ExternalPlayerHost;
	openExternal(url: string): void;
	copyText(text: string): Promise<void>;
	downloadFile(url: string, filename: string): void;
	downloadText(content: string, filename: string, mediaType: string): void;
	isVisible(): boolean;
	isOnline(): boolean;
	onForegroundChange(callback: () => void): () => void;
	onPlaybackLifecycle(handlers: {
		onBackground: () => void;
		onOnline: () => void;
	}): () => void;
}
