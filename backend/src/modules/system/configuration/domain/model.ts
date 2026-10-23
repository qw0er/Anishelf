import type { LoggingConfig } from "../../../../platform/logging/config.js";
import type { MediaToolsConfig } from "../../../../platform/media/config.js";
/** Validated startup settings resolved from defaults and environment variables. */
export interface DeploymentConfig {
	host: string;
	port: number;
	publicOrigin?: string;
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
