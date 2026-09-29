/** Validated deployment settings, not the untrusted TOML input shape. */
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
}

/** Stored in settings.json; deployment parameters never belong here. */
export interface PersistentSettings {
	resourceRoot: string | null;
}
