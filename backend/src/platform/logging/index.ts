import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import pino, { type Logger } from "pino";
import { adapterPolicy } from "../adapter-policy.js";
import type { LoggingConfig } from "./config.js";

export class ApplicationLogging {
	readonly logger: Logger;

	private constructor(
		config: LoggingConfig,
		output: ReturnType<typeof pino.destination>,
	) {
		this.logger = pino(
			{
				level: config.level,
				timestamp: pino.stdTimeFunctions.isoTime,
				base: { service: "anishelf" },
				serializers: { err: pino.stdSerializers.err },
				redact: {
					paths: [...adapterPolicy.logging.redactPaths],
					remove: true,
				},
			},
			output,
		);
	}

	static create(config: LoggingConfig): ApplicationLogging {
		return new ApplicationLogging(config, createDestination(config));
	}
}

function createDestination(
	config: LoggingConfig,
): ReturnType<typeof pino.destination> {
	if (config.destination === "file") {
		mkdirSync(dirname(config.path), { recursive: true });
	}
	return pino.destination({
		dest: config.destination === "file" ? config.path : 1,
		sync: adapterPolicy.logging.synchronous,
	});
}
