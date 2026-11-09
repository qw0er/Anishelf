import type { Logger } from "pino";
import type { MediaInfo } from "../../../../platform/media/model.js";
import { DomainError } from "../../../../shared/errors.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type { ResourceAccessApi } from "../../../resources/public.js";
import type { TranscodeProfile } from "../../../system/public.js";
import type { MediaProcessingApi } from "../../media-processing/public.js";
import type { PreparationTask } from "../domain/model.js";
import type { PreparedMediaFiles } from "../infrastructure/files.js";
import type { PreparationPolicy } from "../policy.js";
import type { PreparationStore } from "../ports.js";

/** Per-application dependencies and shutdown guard; no shared global registry. */
export class PreparationContext {
	closed = false;
	automaticGuard?: (task: PreparationTask) => Promise<boolean>;
	constructor(
		readonly repository: PreparationStore,
		readonly sources: ResourceAccessApi,
		readonly processing: MediaProcessingApi,
		readonly files: PreparedMediaFiles,
		private readonly profileSource:
			| DeepReadonly<TranscodeProfile[]>
			| (() => DeepReadonly<TranscodeProfile[]>),
		readonly policy: DeepReadonly<PreparationPolicy>,
		readonly logger: Logger,
		readonly probe: (path: string) => Promise<MediaInfo>,
		readonly maximumCacheBytes: () => number = () => policy.maximumCacheBytes,
	) {}
	assertOpen(): void {
		if (this.closed)
			throw new DomainError(
				"PREPARATION_UNAVAILABLE",
				"Preparation is closed.",
			);
	}
	required(id: string): PreparationTask {
		const task = this.repository.get(id);
		if (!task)
			throw new DomainError(
				"RESOURCE_NOT_FOUND",
				"Preparation task not found.",
			);
		return task;
	}
	get profiles(): DeepReadonly<TranscodeProfile[]> {
		return typeof this.profileSource === "function"
			? this.profileSource()
			: this.profileSource;
	}
	async source(task: PreparationTask) {
		const expected = task.spec.source;
		const source = await this.sources.resolveSource(
			expected.fileId,
			expected.sourceVersion,
		);
		if (
			source.identity.scopeId !== expected.scopeId ||
			source.identity.relativePath !== expected.relativePath
		)
			throw new DomainError(
				"PLAYBACK_CONFLICT",
				"The preparation source changed.",
			);
		return source;
	}
}
