import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { basename, delimiter, isAbsolute, join } from "node:path";
import type { Logger } from "pino";
import {
	type BuiltinPolicy,
	builtinPolicy,
	captureRuntimeEnvironment,
	type DeepReadonly,
} from "../../modules/configuration/public.js";

export class MediaToolError extends Error {
	constructor(
		readonly code:
			| "TOOL_UNAVAILABLE"
			| "TOOL_FAILED"
			| "INVALID_MEDIA"
			| "INVALID_INPUT"
			| "UNSUPPORTED_SUBTITLE"
			| "UNSUPPORTED_PROCESSING",
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "MediaToolError";
	}
}

/** Resolve once so later child processes do not depend on PATH changes. */
export async function resolveExecutable(
	command: string,
	environment = captureRuntimeEnvironment().executableSearch,
): Promise<string> {
	const candidates: string[] = [];
	if (isAbsolute(command)) {
		candidates.push(command);
	} else {
		const directories = environment.path.split(delimiter).filter(isAbsolute);

		for (const directory of directories) {
			if (process.platform !== "win32") {
				candidates.push(join(directory, command));
				continue;
			}

			const extensions = environment.pathExt.split(";");
			for (const extension of extensions) {
				candidates.push(
					join(directory, `${command}${extension.toLowerCase()}`),
				);
			}
		}
	}

	for (const candidate of candidates) {
		try {
			if (!(await stat(candidate)).isFile()) continue;
			await access(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Continue PATH discovery, but never fall back from an explicit override.
		}
	}
	throw new MediaToolError(
		"TOOL_UNAVAILABLE",
		`Cannot execute ${command}. Install FFmpeg/FFprobe or configure its absolute executable path.`,
	);
}

/** No shell, bounded output and runtime; cancellation kills the child. */
export function runTool(
	path: string,
	args: readonly string[],
	options: { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number } = {},
	policy: DeepReadonly<BuiltinPolicy>["media"] = builtinPolicy.media,
	logger?: Logger,
): Promise<string> {
	const started = Date.now();
	const tool = basename(path);
	const operation = args.includes("-version")
		? "detect"
		: args.includes("-show_streams")
			? "probe"
			: args.includes("-movflags")
				? "process"
				: "extract";
	logger?.debug(
		{ event: "media.tool_started", tool, operation },
		"Media tool started.",
	);
	return new Promise((resolve, reject) => {
		execFile(
			path,
			args,
			{
				encoding: "utf8",
				timeout: options.timeoutMs ?? policy.executionTimeoutMs,
				maxBuffer: options.maxBytes ?? policy.maximumOutputBytes,
				killSignal: "SIGKILL",
				windowsHide: true,
				...(options.signal ? { signal: options.signal } : {}),
			},
			(cause, stdout) => {
				if (cause) {
					const context = {
						event: "media.tool_failed",
						tool,
						operation,
						durationMs: Date.now() - started,
						exitCode: cause.code,
						signal: cause.signal,
						cancelled: options.signal?.aborted ?? false,
					};
					if (options.signal?.aborted)
						logger?.debug(context, "Media tool cancelled.");
					else logger?.warn(context, "Media tool failed.");
					reject(
						new MediaToolError(
							"TOOL_FAILED",
							"Media tool failed, was cancelled, timed out, or exceeded its output limit.",
							{
								cause: new Error(
									Buffer.from(cause.message)
										.subarray(0, policy.diagnosticMaximumBytes)
										.toString("utf8"),
								),
							},
						),
					);
				} else {
					logger?.debug(
						{
							event: "media.tool_completed",
							tool,
							operation,
							durationMs: Date.now() - started,
							outputBytes: Buffer.byteLength(stdout, "utf8"),
						},
						"Media tool completed.",
					);
					resolve(stdout);
				}
			},
		);
	});
}
