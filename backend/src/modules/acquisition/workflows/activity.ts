import { posix } from "node:path";
import { DomainError } from "../../../shared/errors.js";
import { downloadPolicy as policy } from "../downloads/application/policy.js";
import type { DownloadActivity } from "../downloads/domain/model.js";
import type { AcquisitionContext } from "./context.js";
import type { DownloadDestinationSettings } from "./destination.js";
export class DownloadActivityQueries {
	constructor(
		private readonly context: AcquisitionContext,
		private readonly destination: DownloadDestinationSettings,
	) {}
	activity(workKey: string, page = 1): DownloadActivity {
		this.context.open();
		if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
			throw new DomainError("INVALID_REQUEST", "Invalid activity page.");
		const subscription = this.context.options.selection.subscription(workKey);
		const result = this.context.options.store.activity(
			workKey,
			page,
			policy.pageSize,
		);
		const directory = this.context.options.store.directory(workKey),
			destination = this.context.options.store.destination();
		return {
			authorized: Boolean(
				subscription && this.destination.authorized(subscription),
			),
			destination:
				directory && destination
					? posix.join(destination.path, directory)
					: null,
			items: result.items.map((item) => ({
				id: item.id,
				revision: item.revision,
				workKey: item.workKey,
				candidateId: item.candidateId,
				episode: item.episode,
				title: item.title,
				state: item.state,
				transfer: item.transfer,
				progress: item.progress,
				ingestion: item.ingestion,
				error: item.error,
				attempts: item.attempts,
				nextAttemptAt: item.nextAttemptAt,
				observedAt: item.observedAt,
				updatedAt: item.updatedAt,
				createdAt: item.createdAt,
			})),
			total: result.total,
			managedCandidateIds: this.context.options.selection
				.candidates(workKey)
				.filter((candidate) => result.candidateIds.includes(candidate.id))
				.map((candidate) => candidate.id),
			attention: result.attention,
			active: result.active,
			page,
		};
	}
}
