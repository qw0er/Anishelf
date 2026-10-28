import type { Logger } from "pino";

export interface QbittorrentOptions {
	/** Server API base URL, independent from the browser WebUI setting. */
	url: string;
	username: string;
	password: string;
	logger: Logger;
	/** SDK timeout per HTTP request, not a deadline for the entire operation. */
	timeoutMs?: number;
}

export interface ConnectionInput {
	generation: string;
	url: string;
	username: string;
	password?: string;
}
export interface ConnectionSettings {
	generation: string;
	state: "unconfigured" | "configured" | "unavailable";
	url: string | null;
	username: string;
	passwordConfigured: boolean;
	bundled?: boolean;
}
export interface SavedConnection {
	version: 1;
	bundled?: boolean;
	generation: string;
	connection: { url: string; username: string; password: string } | null;
}
