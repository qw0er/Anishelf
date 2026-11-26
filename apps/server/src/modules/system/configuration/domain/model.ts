import type { MediaToolsConfig } from "@anishelf/media-tools";
import type { LoggingConfig } from "../../../../platform/logging/config.js";
/** Validated startup settings resolved from defaults and environment variables. */
export interface DeploymentConfig {
	host: string;
	port: number;
	publicOrigin?: string;
	allowedHosts?: readonly string[];
	trustedProxies?: readonly string[];
	dataDir: string;
	initialResourceRoots?: string[];
	initialQbittorrentWebUiUrl?: string;
	qbittorrentApiUrl?: string;
	bundledQbittorrentConnectionFile?: string;
	bundledJackettConfigFile?: string;
	frontendDir?: string;
	logging: LoggingConfig;
	mediaTools: MediaToolsConfig;
}
export type { PersistentSettings } from "../settings.js";
