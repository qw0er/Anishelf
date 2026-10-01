import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import pino, { type Logger } from "pino";
import type { LoggingConfig } from "../config/model.js";

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
					paths: [
						"password",
						"token",
						"secret",
						"authorization",
						"req.headers.authorization",
						"req.headers.cookie",
						"req.body",
						"res.body",
						"config",
						"settings",
					],
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
		sync: true,
	});
}
