import type { logLevels } from "../../contracts/defaults.js";
export type LogLevel = (typeof logLevels)[number];
export type LoggingConfig =
	| { level: LogLevel; destination: "stdout" }
	| {
			level: LogLevel;
			destination: "file" | "both";
			path: string;
			rotation: {
				maxSizeBytes: number;
				maxFiles: number;
				interval: "1h" | "1d";
			};
	  };
