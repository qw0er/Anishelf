import type { LoggingConfig } from "../../../platform/logging/config.js";
import type { MediaToolsConfig } from "../../../platform/media/config.js";
/** Validated startup settings resolved from defaults and environment variables. */
export interface DeploymentConfig {
	host: string;
	port: number;
	publicOrigin?: string;
	dataDir: string;
	initialResourceRoot?: string;
	frontendDir?: string;
	logging: LoggingConfig;
	mediaTools: MediaToolsConfig;
}
export type { PersistentSettings } from "../../../shared/settings.js";
