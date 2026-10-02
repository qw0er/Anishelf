import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { captureRuntimeEnvironment } from "../config/deployment.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
} from "../config/policy.js";

export class MediaToolError extends Error {
	constructor(
		readonly code:
			| "TOOL_UNAVAILABLE"
			| "TOOL_FAILED"
			| "INVALID_MEDIA"
			| "INVALID_INPUT"
			| "UNSUPPORTED_SUBTITLE",
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
): Promise<string> {
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
				if (cause)
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
				else resolve(stdout);
			},
		);
	});
}
