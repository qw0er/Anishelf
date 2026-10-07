import { mkdirSync, writeSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { Writable } from "node:stream";
import { createStream } from "rotating-file-stream";
import { adapterPolicy } from "../adapter-policy.js";
import type { LoggingConfig } from "./config.js";

/** Emergency output never goes through the failing logger. */
function stderr(line: string): void {
	try {
		writeDescriptor(2, line);
	} catch {
		// There is no further destination when stderr also fails.
	}
}

function writeDescriptor(fd: number, line: string): void {
	const buffer = Buffer.from(line);
	let offset = 0;
	while (offset < buffer.length) {
		const written = writeSync(fd, buffer, offset, buffer.length - offset);
		if (written === 0) throw new Error("Log output made no progress.");
		offset += written;
	}
}

function report(
	event: string,
	destination: string,
	bytes = 0,
	cause?: unknown,
): void {
	const errorCode =
		typeof cause === "object" &&
		cause !== null &&
		"code" in cause &&
		typeof cause.code === "string"
			? cause.code
			: undefined;
	stderr(
		`${JSON.stringify({ level: 40, time: new Date().toISOString(), service: "anishelf", event, destination, errorCode, potentialLostBytes: bytes })}\n`,
	);
}

type FileConfig = Exclude<LoggingConfig, { destination: "stdout" }>;

/** Serialize file writes and maintenance with a bounded queue around the rotation library. */
class FileOutput {
	private stream: Writable | undefined;
	private queue: string[] = [];
	private bytes = 0;
	private writing = false;
	private activeRecord = false;
	private failed = false;
	private closing = false;
	private reopenRequested = false;
	private waiters: (() => void)[] = [];

	constructor(private readonly config: FileConfig) {
		try {
			this.stream = this.open();
		} catch (cause) {
			this.fail(cause);
		}
	}

	private open(): Writable {
		mkdirSync(dirname(this.config.path), { recursive: true });
		const stream = createStream(basename(this.config.path), {
			path: dirname(this.config.path),
			size: `${this.config.rotation.maxSizeBytes}B`,
			interval: this.config.rotation.interval,
			maxFiles: this.config.rotation.maxFiles,
			mode: 0o600,
		});
		stream.on("error", (cause) => {
			if (this.stream === stream) this.fail(cause);
		});
		stream.on("warning", (cause) =>
			report("logging.rotation_warning", "file", 0, cause),
		);
		return stream;
	}

	write(line: string): void {
		if (this.failed || this.closing) {
			stderr(line);
			return;
		}
		const size = Buffer.byteLength(line);
		if (this.bytes + size > adapterPolicy.logging.maximumBufferedBytes) {
			report("logging.buffer_overflow", "file", size);
			// Overflow records bypass the queue; queued records keep their order.
			stderr(line);
			return;
		}
		this.queue.push(line);
		this.bytes += size;
		this.pump();
	}

	get usingFallback(): boolean {
		return this.failed || this.closing;
	}

	private fail(cause?: unknown): void {
		if (this.failed) return;
		this.failed = true;
		// An in-flight record may have been partially written; never replay it.
		const active = this.activeRecord ? this.queue.shift() : undefined;
		report(
			"logging.output_failed",
			"file",
			active ? Buffer.byteLength(active) : 0,
			cause,
		);
		this.stream?.destroy();
		for (const line of this.queue.splice(0)) stderr(line);
		this.bytes = 0;
		this.writing = false;
		this.activeRecord = false;
		this.notify();
	}

	private pump(): void {
		if (this.writing || this.failed) return;
		if (this.reopenRequested) {
			this.reopenRequested = false;
			this.writing = true;
			this.stream?.end(() => {
				if (this.failed) return;
				try {
					this.stream = this.open();
					this.writing = false;
					this.pump();
				} catch (cause) {
					this.writing = false;
					this.fail(cause);
				}
			});
			return;
		}
		const line = this.queue[0];
		if (line === undefined) {
			this.notify();
			return;
		}
		this.writing = true;
		this.activeRecord = true;
		const stream = this.stream;
		try {
			stream?.write(line, (error?: Error | null) => {
				if (this.failed || this.stream !== stream) return;
				if (error) {
					this.fail(error);
					return;
				}
				this.queue.shift();
				this.bytes -= Buffer.byteLength(line);
				this.writing = false;
				this.activeRecord = false;
				this.pump();
			});
		} catch (cause) {
			this.fail(cause);
		}
	}

	private notify(): void {
		for (const resolve of this.waiters.splice(0)) resolve();
	}

	flush(): Promise<void> {
		if (!this.writing && this.queue.length === 0) return Promise.resolve();
		return new Promise((resolve) => this.waiters.push(resolve));
	}

	async reopen(): Promise<void> {
		if (this.closing) return;
		// Recovery after failure is explicit; queued records are not replayed.
		if (this.failed) {
			try {
				this.stream = this.open();
				this.failed = false;
			} catch (cause) {
				report("logging.reopen_failed", "file", 0, cause);
			}
			return;
		}
		this.reopenRequested = true;
		this.pump();
		await this.flush();
	}

	async close(): Promise<void> {
		this.closing = true;
		await this.flush();
		if (this.failed) return;
		await new Promise<void>((resolve) => {
			this.stream?.once("close", resolve);
			this.stream?.end();
		});
	}

	abort(): void {
		report("logging.shutdown_timeout", "file", this.bytes);
		this.fail();
	}
}

/** Stable destination shared by Pino and every child logger. */
export class LogOutput {
	private readonly file: FileOutput | undefined;
	private stdoutFailed = false;
	private readonly onReopen = () => {
		void this.file?.reopen();
	};
	private closeTask: Promise<void> | undefined;

	constructor(private readonly config: LoggingConfig) {
		if (config.destination !== "stdout") {
			this.file = new FileOutput(config);
			process.on("SIGHUP", this.onReopen);
		}
	}

	write(line: string): void {
		if (this.config.destination !== "file") {
			if (!this.stdoutFailed) {
				try {
					writeDescriptor(1, line);
				} catch (cause) {
					this.stdoutFailed = true;
					report(
						"logging.output_failed",
						"stdout",
						Buffer.byteLength(line),
						cause,
					);
				}
			} else if (!this.file?.usingFallback) stderr(line);
		}
		this.file?.write(line);
	}

	flush(): Promise<void> {
		return this.file?.flush() ?? Promise.resolve();
	}
	reopen(): Promise<void> {
		return this.file?.reopen() ?? Promise.resolve();
	}

	close(): Promise<void> {
		this.closeTask ??= this.finish();
		return this.closeTask;
	}

	private async finish(): Promise<void> {
		process.off("SIGHUP", this.onReopen);
		if (!this.file) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			this.file.close(),
			new Promise<void>((resolve) => {
				timer = setTimeout(() => {
					this.file?.abort();
					resolve();
				}, adapterPolicy.logging.shutdownTimeoutMs);
			}),
		]);
		clearTimeout(timer);
	}
}
