import type { LoggingConfig } from "../../../platform/logging/config.js";
import type { MediaToolsConfig } from "../../../platform/media/config.js";
/** Validated startup settings resolved from defaults and environment variables. */
export interface DeploymentConfig {
	host: string;
	port: number;
	dataDir: string;
	logging: LoggingConfig;
	mediaTools: MediaToolsConfig;
}
export type { PersistentSettings } from "../../../shared/settings.js";
