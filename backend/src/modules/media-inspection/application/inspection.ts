import { join } from "node:path";
import type { Logger } from "pino";
import type { MediaInfo } from "../../../platform/media/index.js";
import { MediaToolError } from "../../../platform/media/index.js";
import type { DeepReadonly } from "../../../shared/policy.js";
import type {
	ResolvedSource,
	ResourceAccessApi,
} from "../../resource-access/public.js";
import {
	type MediaInspectionPolicy,
	mediaInspectionPolicy,
} from "../domain/policy.js";
import {
	MediaInspectionBusyError,
	type MediaInspectionResult,
	type MediaProbe,
} from "../ports.js";
import type { MediaInspectionApi } from "../public.js";

/** Shared, on-demand inspection of validated and version-bound media sources. */
export class MediaInspectionApplication implements MediaInspectionApi {
	private readonly cache = new Map<string, MediaInfo>();
	private readonly active = new Map<string, Promise<MediaInspectionResult>>();
	private readonly controller = new AbortController();
	private readonly logger: Logger | undefined;
	private readonly policy: DeepReadonly<MediaInspectionPolicy>;

	constructor(
		private readonly options: {
			sources: ResourceAccessApi;
			tools: MediaProbe;
			policy?: DeepReadonly<MediaInspectionPolicy>;
			logger?: Logger;
		},
	) {
		this.policy = options.policy ?? mediaInspectionPolicy;
		this.logger = options.logger?.child({ module: "media-inspection" });
	}

	private assertOpen(): void {
		if (this.controller.signal.aborted)
			throw new MediaToolError(
				"TOOL_UNAVAILABLE",
				"Media inspection is closed.",
			);
	}

	private async probe(
		source: ResolvedSource,
		key: string,
	): Promise<MediaInspectionResult> {
		this.options.sources.assertRootEpoch(source.rootEpoch);
		const info = await this.options.tools.probe(
			join(source.identity.canonicalRoot, source.identity.relativePath),
			this.controller.signal,
		);
		const current = await this.options.sources.revalidateSource(source);
		this.assertOpen();
		this.cache.set(key, info);
		if (this.cache.size > this.policy.maximumProbeCacheEntries) {
			const oldest = this.cache.keys().next().value;
			if (oldest !== undefined) this.cache.delete(oldest);
		}
		return { source: current, info };
	}

	async inspect(
		fileId: string,
		expectedSourceVersion?: string,
	): Promise<MediaInspectionResult> {
		this.assertOpen();
		let source = await this.options.sources.resolveSource(
			fileId,
			expectedSourceVersion,
		);
		this.assertOpen();
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
			const result = await pending;
			this.options.sources.assertRootEpoch(source.rootEpoch);
			source = result.source;
			info = result.info;
		}
		this.assertOpen();
		this.options.sources.assertRootEpoch(source.rootEpoch);
		// Each consumer owns its result; mutations cannot contaminate the shared cache.
		return { source, info: structuredClone(info) };
	}

	async close(): Promise<void> {
		this.controller.abort();
		await Promise.allSettled(this.active.values());
		this.cache.clear();
	}
}
