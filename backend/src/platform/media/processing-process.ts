import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { Logger } from "pino";
import type {
	MediaExecutionProgress,
	MediaProcessEvent,
	MediaProcessFailureReason,
} from "../../shared/media-execution.js";
import type { DeepReadonly } from "../../shared/policy.js";
import { MediaToolError } from "./errors.js";
import { type MediaToolPolicy, mediaToolPolicy } from "./policy.js";

export class MediaProcessError extends MediaToolError {
	constructor(
		readonly reason: MediaProcessFailureReason,
		readonly exitCode: number | null,
		readonly signal: string | null,
		readonly diagnostic: string,
	) {
		super("TOOL_FAILED", `Media processing ${reason}.`);
	}
}
export interface MediaProcessHandle {
	readonly pid: number | null;
	readonly completion: Promise<void>;
	/** Waits for child close, including pipe closure, before resolving. */
	stop(): Promise<void>;
}
export interface MediaProcessOptions {
	signal?: AbortSignal;
	timeoutMs: number;
	durationMs?: number | null;
	onEvent?: (event: MediaProcessEvent) => void;
}

function number(value: string | undefined): number | null {
	if (!value || value === "N/A") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
export function parseExecutionProgress(
	fields: ReadonlyMap<string, string>,
	durationMs: number | null,
): MediaExecutionProgress {
	const microseconds = number(fields.get("out_time_us"));
	const clock = fields.get("out_time")?.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
	const mediaTimeMs =
		microseconds !== null
			? microseconds / 1000
			: clock
				? (Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3])) *
					1000
				: null;
	return {
		mediaTimeMs,
		frames: number(fields.get("frame")),
		outputBytes: number(fields.get("total_size")),
		speed: number(fields.get("speed")?.replace(/x$/, "")),
		percent:
			mediaTimeMs !== null && durationMs !== null && durationMs > 0
				? Math.min(100, (mediaTimeMs / durationMs) * 100)
				: null,
		ended: fields.get("progress") === "end",
	};
}

/** Trusted argument arrays only. Consume progress incrementally; never buffer a film's stdout. */
export function startMediaProcess(
	executable: string,
	args: readonly string[],
	options: MediaProcessOptions,
	policy: DeepReadonly<MediaToolPolicy> = mediaToolPolicy,
	logger?: Logger,
): MediaProcessHandle {
	for (const value of [
		options.timeoutMs,
		policy.processingStartupTimeoutMs,
		policy.processingStallTimeoutMs,
		policy.processingStopGraceMs,
		policy.progressMaximumBytes,
		policy.diagnosticMaximumBytes,
	]) {
		if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647)
			throw new MediaToolError(
				"INVALID_INPUT",
				"Invalid processing runtime limits.",
			);
	}
	const durationMs = options.durationMs ?? null;
	if (durationMs !== null && (!Number.isFinite(durationMs) || durationMs <= 0))
		throw new MediaToolError("INVALID_INPUT", "Invalid processing duration.");
	let child: ReturnType<typeof spawn> | undefined;
	let closed = false;
	let reason: MediaProcessFailureReason | null = null;
	let diagnostics = Buffer.alloc(0);
	let startupTimer: ReturnType<typeof setTimeout> | undefined;
	let stallTimer: ReturnType<typeof setTimeout> | undefined;
	let totalTimer: ReturnType<typeof setTimeout> | undefined;
	let killTimer: ReturnType<typeof setTimeout> | undefined;
	let progressStarted = false;
	const highWater = { mediaTimeMs: -1, frames: -1, outputBytes: -1 };
	const decoder = new StringDecoder("utf8");
	let pending = "";
	let recordBytes = 0;
	const fields = new Map<string, string>();
	function emit(event: MediaProcessEvent) {
		try {
			void Promise.resolve(options.onEvent?.(structuredClone(event))).catch(
				() =>
					logger?.warn(
						{ event: "media.processing_observer_failed" },
						"Processing observer failed.",
					),
			);
		} catch {
			logger?.warn(
				{ event: "media.processing_observer_failed" },
				"Processing observer failed.",
			);
		}
	}
	function terminate(failure: MediaProcessFailureReason) {
		if (closed || reason) return;
		const exited =
			child && (child.exitCode !== null || child.signalCode !== null);
		if (exited && failure !== "invalid-progress") return;
		reason = failure;
		clearTimeout(startupTimer);
		clearTimeout(stallTimer);
		clearTimeout(totalTimer);
		emit({ type: "stopping", reason: failure });
		if (exited) return;
		child?.kill("SIGTERM");
		killTimer = setTimeout(
			() => child?.kill("SIGKILL"),
			policy.processingStopGraceMs,
		);
	}
	function abort() {
		terminate("cancelled");
	}
	function record() {
		const progress = parseExecutionProgress(fields, durationMs);
		const advanced =
			!progressStarted ||
			(["mediaTimeMs", "frames", "outputBytes"] as const).some(
				(key) =>
					progress[key] !== null && (progress[key] as number) > highWater[key],
			);
		progressStarted = true;
		clearTimeout(startupTimer);
		if (advanced) {
			for (const key of ["mediaTimeMs", "frames", "outputBytes"] as const)
				highWater[key] = Math.max(highWater[key], progress[key] ?? -1);
			clearTimeout(stallTimer);
			stallTimer = setTimeout(
				() => terminate("stalled"),
				policy.processingStallTimeoutMs,
			);
		}
		emit({ type: "progress", progress });
		fields.clear();
		recordBytes = 0;
	}
	function consume(text: string) {
		pending += text;
		while (!reason) {
			const newline = pending.indexOf("\n");
			if (newline === -1) break;
			const line = pending.slice(0, newline).replace(/\r$/, "");
			pending = pending.slice(newline + 1);
			recordBytes += Buffer.byteLength(line) + 1;
			if (recordBytes > policy.progressMaximumBytes) {
				terminate("invalid-progress");
				return;
			}
			if (!line) continue;
			const match = line.match(/^([a-zA-Z0-9_]+)=(.*)$/);
			if (!match) {
				terminate("invalid-progress");
				return;
			}
			fields.set(match[1] as string, match[2] as string);
			if (match[1] === "progress") {
				if (match[2] !== "continue" && match[2] !== "end") {
					terminate("invalid-progress");
					return;
				}
				record();
			}
		}
		if (Buffer.byteLength(pending) + recordBytes > policy.progressMaximumBytes)
			terminate("invalid-progress");
	}
	let resolveCompletion: () => void;
	let rejectCompletion: (error: Error) => void;
	const completion = new Promise<void>((resolve, reject) => {
		resolveCompletion = resolve;
		rejectCompletion = reject;
	});
	// A handle may be inspected or stopped before its consumer awaits completion.
	void completion.catch(() => {});
	function finish(code: number | null, signal: string | null) {
		if (closed) return;
		closed = true;
		clearTimeout(startupTimer);
		clearTimeout(stallTimer);
		clearTimeout(totalTimer);
		clearTimeout(killTimer);
		options.signal?.removeEventListener("abort", abort);
		if (!reason && code !== 0) reason = "exit-failed";
		emit({ type: "closed", exitCode: code, signal, reason });
		logger?.debug(
			{ event: "media.processing_closed", exitCode: code, signal, reason },
			"Media processing child closed.",
		);
		if (reason)
			rejectCompletion(
				new MediaProcessError(
					reason,
					code,
					signal,
					diagnostics.toString("utf8"),
				),
			);
		else resolveCompletion();
	}
	if (options.signal?.aborted) {
		reason = "cancelled";
		finish(null, null);
	} else {
		try {
			child = spawn(executable, [...args], {
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
				shell: false,
			});
			child.once("spawn", () => {
				if (child?.pid) emit({ type: "started", pid: child.pid });
			});
			child.once("error", () => {
				reason ??= "spawn-failed";
			});
			child.once("close", finish);
			child.stdout?.on("data", (chunk: Buffer) => {
				if (!reason) consume(decoder.write(chunk));
			});
			child.stdout?.once("end", () => {
				if (!reason) {
					consume(decoder.end());
					if (pending.trim() || fields.size) terminate("invalid-progress");
				}
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				diagnostics = Buffer.concat([
					diagnostics,
					chunk.subarray(-policy.diagnosticMaximumBytes),
				]).subarray(-policy.diagnosticMaximumBytes);
			});
			startupTimer = setTimeout(
				() => terminate("startup-timeout"),
				policy.processingStartupTimeoutMs,
			);
			totalTimer = setTimeout(() => terminate("timeout"), options.timeoutMs);
			options.signal?.addEventListener("abort", abort, { once: true });
			if (options.signal?.aborted) abort();
		} catch {
			reason = "spawn-failed";
			finish(null, null);
		}
	}
	return {
		get pid() {
			return child?.pid ?? null;
		},
		completion,
		async stop() {
			terminate("cancelled");
			await completion.catch(() => {});
		},
	};
}
