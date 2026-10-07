import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import type { DeepReadonly } from "../../../shared/policy.js";
import {
	type TranscodeProfile,
	transcodeProfileFingerprint,
} from "../../../shared/transcode-profiles.js";
import type { MediaProcessingApi } from "../../media-processing/public.js";
import type { ResourceAccessApi } from "../../resource-access/public.js";
import type { PreparationTask } from "../domain/model.js";
import type { PreparationPolicy } from "../domain/policy.js";
import type { PreparedMediaFiles } from "../infrastructure/files.js";
import type { PreparationStore } from "../ports.js";

export class PreparationProfileChangedError extends DomainError {
	constructor() {
		super("PLAYBACK_CONFLICT", "The preparation profile changed.");
	}
}
/** Per-application dependencies and shutdown guard; no shared global registry. */
export class PreparationContext {
	closed = false;
	constructor(
		readonly repository: PreparationStore,
		readonly sources: ResourceAccessApi,
		readonly processing: MediaProcessingApi,
		readonly files: PreparedMediaFiles,
		readonly profiles: DeepReadonly<TranscodeProfile[]>,
		readonly policy: DeepReadonly<PreparationPolicy>,
		readonly logger: Logger,
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
	profileValid(task: PreparationTask): boolean {
		const profile = this.profiles.find(
			(profile) => profile.id === task.profileId,
		);
		return (
			profile !== undefined &&
			transcodeProfileFingerprint(profile) === task.spec.profileFingerprint
		);
	}
	async source(task: PreparationTask) {
		if (!this.profileValid(task)) throw new PreparationProfileChangedError();
		const expected = task.spec.source;
		const source = await this.sources.resolveSource(
			expected.fileId,
			expected.sourceVersion,
		);
		if (
			source.identity.canonicalRoot !== expected.canonicalRoot ||
			source.identity.relativePath !== expected.relativePath
		)
			throw new DomainError(
				"PLAYBACK_CONFLICT",
				"The preparation source changed.",
			);
		return source;
	}
}
