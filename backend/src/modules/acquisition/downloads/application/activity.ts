import { posix } from "node:path";
import { DomainError } from "../../../../shared/errors.js";
import { downloadDefaults as policy } from "../defaults.js";
import type { DownloadActivity } from "../domain/model.js";
import type { DownloadApplicationContext } from "./context.js";
import type { DownloadDestinationSettings } from "./destination.js";
export class DownloadActivityQueries {
	constructor(
		private readonly context: DownloadApplicationContext,
		private readonly destination: DownloadDestinationSettings,
	) {}
	summary(workKey: string) {
		this.context.open();
		const subscription = this.context.options.selection.subscription(workKey);
		const result = this.context.options.store.summary(workKey);
		const planningError = subscription?.enabled
			? (this.context.planningErrors.get(workKey) ?? null)
			: null;
		return {
			...result,
			planningError,
			attention: result.attention + (planningError ? 1 : 0),
		};
	}
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
			planningError: subscription?.enabled
				? (this.context.planningErrors.get(workKey) ?? null)
				: null,
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
			attention:
				result.attention +
				(subscription?.enabled && this.context.planningErrors.has(workKey)
					? 1
					: 0),
			active: result.active,
			page,
		};
	}
}
