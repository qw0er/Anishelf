import type { Logger } from "pino";
import type { DeepReadonly } from "../../shared/policy.js";
import type { ExecutableSearch } from "../environment.js";
import type { MediaToolsConfig } from "./config.js";
import type { ToolStatus } from "./model.js";
import type { MediaToolPolicy } from "./policy.js";
import { resolveExecutable, runTool } from "./process.js";

type Tool = "ffmpeg" | "ffprobe";

/** Successful discovery is stable; failed discovery can recover on demand. */
export class MediaToolDiscovery {
	readonly status: Record<Tool, ToolStatus> = {
		ffmpeg: { available: false, message: "FFmpeg has not been detected." },
		ffprobe: { available: false, message: "FFprobe has not been detected." },
	};
	private readonly pending = new Map<Tool, Promise<ToolStatus>>();
	private readonly retryAt = new Map<Tool, number>();

	constructor(
		private readonly config: MediaToolsConfig,
		private readonly policy: DeepReadonly<MediaToolPolicy>,
		private readonly environment: ExecutableSearch,
		private readonly logger?: Logger,
	) {}

	async get(tool: Tool): Promise<ToolStatus> {
		const pending = this.pending.get(tool);
		if (pending) return pending;
		const status = this.status[tool];
		if (status.available || Date.now() < (this.retryAt.get(tool) ?? 0))
			return status;
		const attempt = this.detect(tool);
		this.pending.set(tool, attempt);
		try {
			return await attempt;
		} finally {
			this.pending.delete(tool);
		}
	}

	private async detect(tool: Tool): Promise<ToolStatus> {
		const command = this.config[`${tool}Path`];
		const started = Date.now();
		const retry = this.retryAt.has(tool);
		let status: ToolStatus;
		try {
			const path = await resolveExecutable(command, this.environment);
			const output = await runTool(
				path,
				["-version"],
				{
					timeoutMs: this.policy.detectionTimeoutMs,
					maxBytes: this.policy.detectionMaximumBytes,
				},
				this.policy,
				this.logger,
			);
			const version = output.split(/\r?\n/)[0] ?? "";
			if (!version.startsWith(`${tool} version `))
				throw new Error("Unexpected executable version output");
			status = { available: true, path, version };
			if (retry)
				this.logger?.info(
					{
						event: "media.tool_recovered",
						tool,
						durationMs: Date.now() - started,
					},
					"Media tool detection recovered.",
				);
		} catch (err) {
			this.retryAt.set(tool, Date.now() + this.policy.detectionRetryIntervalMs);
			this.logger?.warn(
				{
					event: "media.tool_detection_failed",
					tool,
					command,
					err,
					retry,
					durationMs: Date.now() - started,
					timeoutMs: this.policy.detectionTimeoutMs,
					retryAfterMs: this.policy.detectionRetryIntervalMs,
				},
				"Media tool detection failed; a later request can retry.",
			);
			status = {
				available: false,
				message: `Cannot run ${tool} at ${command}. Detection will retry on a later request. Check server diagnostics and PATH / ANISHELF_${tool.toUpperCase()}_PATH.`,
			};
		}
		this.status[tool] = status;
		return status;
	}
}
