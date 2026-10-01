/** Validated startup settings resolved from defaults and environment variables. */
export type LogLevel =
	| "trace"
	| "debug"
	| "info"
	| "warn"
	| "error"
	| "fatal"
	| "silent";

export type LoggingConfig =
	| { level: LogLevel; destination: "stdout" }
	| { level: LogLevel; destination: "file"; path: string };

export interface DeploymentConfig {
	host: string;
	port: number;
	dataDir: string;
	logging: LoggingConfig;
	mediaTools: MediaToolsConfig;
}

export interface MediaToolsConfig {
	ffmpegPath: string;
	ffprobePath: string;
}

/** Stored in settings.json; deployment parameters never belong here. */
export interface PersistentSettings {
	resourceRoot: string | null;
	scanIntervalMinutes?: number;
}

export const defaultScanIntervalMinutes = 60;
export const maximumScanIntervalMinutes = 10080;
