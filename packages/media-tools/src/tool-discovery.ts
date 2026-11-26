import type { MediaToolsConfig } from "./config.ts";
import type { ExecutableSearch } from "./environment.ts";
import type { MediaToolsLogger } from "./logger.ts";
import type { ToolStatus } from "./model.ts";
import type { DeepReadonly, MediaToolPolicy } from "./policy.ts";
import { resolveExecutable, runTool } from "./process.ts";

type Tool = "ffmpeg" | "ffprobe";

/** Successful discovery is stable; failed discovery can recover on demand. */
export class MediaToolDiscovery {
	private readonly status: Record<Tool, ToolStatus> = {
		ffmpeg: { available: false, message: "FFmpeg has not been detected." },
		ffprobe: { available: false, message: "FFprobe has not been detected." },
	};
	private readonly pending = new Map<Tool, Promise<ToolStatus>>();
	private readonly retryAt = new Map<Tool, number>();
	private readonly config: MediaToolsConfig;
	private readonly policy: DeepReadonly<MediaToolPolicy>;
	private readonly environment: ExecutableSearch;
	private readonly logger: MediaToolsLogger | undefined;

	constructor(
		config: MediaToolsConfig,
		policy: DeepReadonly<MediaToolPolicy>,
		environment: ExecutableSearch,
		logger?: MediaToolsLogger,
	) {
		this.config = config;
		this.policy = policy;
		this.environment = environment;
		this.logger = logger;
	}

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
			this.logger?.info(
				{
					event: retry ? "media.tool_recovered" : "media.tool_ready",
					tool,
					path,
					version,
					durationMs: Date.now() - started,
				},
				"Media tool detected.",
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
