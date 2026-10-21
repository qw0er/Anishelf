import type { Logger } from "pino";
import type { MediaInfo } from "../../../platform/media/index.js";
import { MediaToolError } from "../../../platform/media/index.js";
import { DomainError } from "../../../shared/errors.js";
import type { DeepReadonly } from "../../../shared/policy.js";
import type {
	ResolvedSource,
	ResourceAccessApi,
} from "../../resources/public.js";
import { type MediaInspectionPolicy, mediaInspectionPolicy } from "./policy.js";
import {
	type InspectionStore,
	MediaInspectionBusyError,
	type MediaInspectionResult,
	type MediaProbe,
} from "./ports.js";
import type { MediaInspectionApi } from "./public.js";

/** Shared, on-demand inspection of validated and version-bound media sources. */
export class MediaInspectionApplication implements MediaInspectionApi {
	private readonly active = new Map<string, Promise<MediaInspectionResult>>();
	private readonly controller = new AbortController();
	private readonly logger: Logger | undefined;
	private readonly policy: DeepReadonly<MediaInspectionPolicy>;

	constructor(
		private readonly options: {
			sources: ResourceAccessApi;
			tools: MediaProbe;
			repository: InspectionStore;
			cacheVersion?: string;
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

	private async probe(source: ResolvedSource): Promise<MediaInspectionResult> {
		this.options.sources.assertAccessRevision(source.accessRevision);
		const info = await this.options.tools.probe(
			await this.options.sources.filePath(source),
			this.controller.signal,
		);
		const current = await this.options.sources.revalidateSource(source);
		this.assertOpen();
		try {
			this.options.repository.save({
				scopeId: current.identity.scopeId,
				fileId: current.identity.fileId,
				sourceVersion: current.identity.sourceVersion,
				formatVersion: this.options.cacheVersion ?? "probe:1",
				info,
			});
		} catch {
			this.logger?.warn(
				{
					event: "media.inspection_cache_write_failed",
					fileId: current.identity.fileId,
				},
				"Media inspection was not cached; playback can continue.",
			);
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
			source.identity.scopeId,
			fileId,
			source.identity.sourceVersion,
		]);
		let cached: import("./ports.js").InspectionRecord | null = null;
		try {
			cached = this.options.repository.find(source.identity.scopeId, fileId);
		} catch {
			this.logger?.warn(
				{ event: "media.inspection_cache_read_failed", fileId },
				"Media inspection cache unavailable; probing the source.",
			);
		}
		let info =
			cached?.sourceVersion === source.identity.sourceVersion &&
			cached.formatVersion === (this.options.cacheVersion ?? "probe:1")
				? cached.info
				: undefined;
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
						return this.probe(source);
					})
					.finally(() => this.active.delete(key));
				this.active.set(key, pending);
			}
			const result = await pending;
			this.options.sources.assertAccessRevision(source.accessRevision);
			source = result.source;
			info = result.info;
		}
		this.assertOpen();
		this.options.sources.assertAccessRevision(source.accessRevision);
		// Each consumer owns its result; mutations cannot contaminate the shared cache.
		return { source, info: structuredClone(info) };
	}

	async chapters(
		fileId: string,
		sourceVersion: string,
	): Promise<{ sourceVersion: string; chapters: MediaInfo["chapters"] }> {
		try {
			const { source, info } = await this.inspect(fileId, sourceVersion);
			return {
				sourceVersion: source.identity.sourceVersion,
				chapters: info.chapters,
			};
		} catch (cause) {
			if (
				cause instanceof MediaInspectionBusyError ||
				cause instanceof MediaToolError
			)
				throw new DomainError(
					"MEDIA_INSPECTION_UNAVAILABLE",
					"Chapter inspection is unavailable.",
					{ cause },
				);
			throw cause;
		}
	}

	async reconcile(
		library: Pick<
			import("../../resources/public.js").LibraryApi,
			"getStatus" | "readFilePage"
		>,
	): Promise<void> {
		const status = await library.getStatus();
		if (
			!this.options.sources.hasSnapshot ||
			!status.ready ||
			status.stale ||
			status.monitor?.status === "degraded" ||
			(status.scan?.warnings.count ?? 0) > 0
		)
			return;
		const files = new Map<string, string>();
		let offset: number | null = 0;
		while (offset !== null) {
			const page = library.readFilePage(status.revision, offset, 500);
			for (const file of page.files)
				if (file.sourceVersion) files.set(file.id, file.sourceVersion);
			offset = page.nextOffset;
		}
		this.assertOpen();
		const scopes =
			status.roots?.filter((root) => root.available).map((root) => root.id) ??
			[];
		const removed = this.options.repository.reconcile(
			scopes,
			files,
			status.roots?.map((root) => root.id) ?? [],
		);
		if (removed)
			this.logger?.debug(
				{ event: "media.inspection_cache_pruned", removed },
				"Deleted or replaced resource inspection cache entries removed.",
			);
	}
	async close(): Promise<void> {
		this.controller.abort();
		await Promise.allSettled(this.active.values());
	}
}
