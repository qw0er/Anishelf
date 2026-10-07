import pino, { type Logger } from "pino";
import { adapterPolicy } from "../adapter-policy.js";
import type { LoggingConfig } from "./config.js";
import { LogOutput } from "./output.js";

export class ApplicationLogging {
	readonly logger: Logger;

	private constructor(
		config: LoggingConfig,
		private readonly output: LogOutput,
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
		return new ApplicationLogging(config, new LogOutput(config));
	}

	flush(): Promise<void> {
		return this.output.flush();
	}
	reopen(): Promise<void> {
		return this.output.reopen();
	}
	close(): Promise<void> {
		return this.output.close();
	}
}
