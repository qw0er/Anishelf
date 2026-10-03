import { join } from "node:path";
import type { Logger } from "pino";
import type { MediaInfo, MediaTools } from "../../../platform/media/index.js";
import { MediaToolError } from "../../../platform/media/index.js";
import { DomainError } from "../../../shared/errors.js";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
} from "../../configuration/public.js";
import type {
	MediaSourceApi,
	ResolvedSource,
} from "../../media-source/public.js";

export class MediaInspectionBusyError extends Error {
	constructor() {
		super("Media inspection is busy.");
		this.name = "MediaInspectionBusyError";
	}
}

export interface MediaInspectionResult {
	source: ResolvedSource;
	info: MediaInfo;
}

/** Shared, on-demand inspection of validated and version-bound media sources. */
export class MediaInspectionApplication {
	private readonly cache = new Map<string, MediaInfo>();
	private readonly active = new Map<string, Promise<MediaInfo>>();
	private readonly controller = new AbortController();
	private readonly logger: Logger | undefined;
	private readonly policy: DeepReadonly<BuiltinPolicy>["media"];

	constructor(
		private readonly options: {
			sources: MediaSourceApi;
			tools: Pick<MediaTools, "probe">;
			policy?: DeepReadonly<BuiltinPolicy>["media"];
			logger?: Logger;
		},
	) {
		this.policy = options.policy ?? builtinPolicy.media;
		this.logger = options.logger?.child({ module: "media-inspection" });
	}

	private assertOpen(): void {
		if (this.controller.signal.aborted)
			throw new MediaToolError(
				"TOOL_UNAVAILABLE",
				"Media inspection is closed.",
			);
	}

	private async resolveSource(
		fileId: string,
		rootEpoch = this.options.sources.resourceRootEpoch,
	): Promise<ResolvedSource> {
		this.assertOpen();
		const assertEpoch = () => {
			if (rootEpoch !== this.options.sources.resourceRootEpoch)
				throw new DomainError("PLAYBACK_CONFLICT", "The media source changed.");
		};
		assertEpoch();
		let source: ResolvedSource;
		try {
			source = await this.options.sources.resolveSource(fileId);
		} catch (error) {
			assertEpoch();
			throw error;
		}
		this.assertOpen();
		assertEpoch();
		return source;
	}

	private async validate(source: ResolvedSource): Promise<void> {
		this.assertOpen();
		if (source.rootEpoch !== this.options.sources.resourceRootEpoch)
			throw new DomainError("PLAYBACK_CONFLICT", "The media source changed.");
		const current = await this.resolveSource(
			source.identity.fileId,
			source.rootEpoch,
		);
		this.assertOpen();
		if (
			current.rootEpoch !== source.rootEpoch ||
			current.identity.canonicalRoot !== source.identity.canonicalRoot ||
			current.identity.sourceVersion !== source.identity.sourceVersion
		)
			throw new DomainError("PLAYBACK_CONFLICT", "The media source changed.");
	}

	private async probe(source: ResolvedSource, key: string): Promise<MediaInfo> {
		if (source.rootEpoch !== this.options.sources.resourceRootEpoch)
			throw new DomainError("PLAYBACK_CONFLICT", "The media source changed.");
		const info = await this.options.tools.probe(
			join(source.identity.canonicalRoot, source.identity.relativePath),
			this.controller.signal,
		);
		await this.validate(source);
		this.cache.set(key, info);
		if (this.cache.size > this.policy.maximumProbeCacheEntries) {
			const oldest = this.cache.keys().next().value;
			if (oldest !== undefined) this.cache.delete(oldest);
		}
		return info;
	}

	async inspect(
		fileId: string,
		expectedSourceVersion?: string,
	): Promise<MediaInspectionResult> {
		this.assertOpen();
		const source = await this.resolveSource(fileId);
		this.assertOpen();
		if (
			expectedSourceVersion !== undefined &&
			expectedSourceVersion !== source.identity.sourceVersion
		)
			throw new DomainError("PLAYBACK_CONFLICT", "The media source changed.");
		const key = JSON.stringify([
			source.identity.canonicalRoot,
			fileId,
			source.identity.sourceVersion,
		]);
		let info = this.cache.get(key);
		if (info) {
			this.logger?.trace(
				{ event: "media.inspection_cache_hit", fileId },
				"Reusing cached media inspection.",
			);
		} else {
			let pending = this.active.get(key);
			if (pending) {
				this.logger?.trace(
					{ event: "media.inspection_joined", fileId },
					"Joining media inspection.",
				);
			} else {
				if (this.active.size >= this.policy.probeConcurrency)
					throw new MediaInspectionBusyError();
				pending = Promise.resolve()
					.then(() => {
						this.assertOpen();
						return this.probe(source, key);
					})
					.finally(() => this.active.delete(key));
				this.active.set(key, pending);
			}
			info = await pending;
		}
		await this.validate(source);
		// Each consumer owns its result; mutations cannot contaminate the shared cache.
		return { source, info: structuredClone(info) };
	}

	async close(): Promise<void> {
		this.controller.abort();
		await Promise.allSettled(this.active.values());
		this.cache.clear();
	}
}
