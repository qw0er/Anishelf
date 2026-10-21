import { mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import pino, { type Logger } from "pino";
import { createStream } from "rotating-file-stream";
import { adapterPolicy } from "../adapter-policy.js";
import type { LoggingConfig } from "./config.js";

/** Pino owns routing; rotating-file-stream owns buffering, rotation and stream behavior. */
export class ApplicationLogging {
	readonly logger: Logger;
	private readonly file: Writable | undefined;
	private closing: Promise<void> | undefined;
	private constructor(config: LoggingConfig) {
		const streams: pino.StreamEntry[] = [];
		if (config.destination !== "file")
			streams.push({ stream: process.stdout, level: "trace" });
		if (config.destination !== "stdout") {
			mkdirSync(dirname(config.path), { recursive: true });
			this.file = createStream(basename(config.path), {
				path: dirname(config.path),
				size: `${config.rotation.maxSizeBytes}B`,
				interval: config.rotation.interval,
				maxFiles: config.rotation.maxFiles,
				mode: 0o600,
			});
			this.file.on("error", () =>
				process.stderr.write("Logging file output failed.\n"),
			);
			streams.push({ stream: this.file, level: "trace" });
		}
		this.logger = pino(
			{
				level: config.level,
				timestamp: pino.stdTimeFunctions.isoTime,
				base: { service: "anishelf" },
				serializers: { err: pino.stdSerializers.err },
				redact: { paths: [...adapterPolicy.logging.redactPaths], remove: true },
			},
			pino.multistream(streams, { levels: pino.levels.values }),
		);
	}
	static create(config: LoggingConfig) {
		return new ApplicationLogging(config);
	}
	flush(): Promise<void> {
		if (!this.file || this.file.destroyed) return Promise.resolve();
		return new Promise((resolve, reject) =>
			this.file?.write("", (error: Error | null | undefined) =>
				error ? reject(error) : resolve(),
			),
		);
	}
	close(): Promise<void> {
		this.closing ??= this.finish();
		return this.closing;
	}
	private async finish() {
		if (!this.file) return;
		const done = finished(this.file);
		this.file.end();
		await done;
	}
}
