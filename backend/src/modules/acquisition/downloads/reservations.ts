import { randomUUID } from "node:crypto";
import type { DownloadContext } from "./context.js";
import type { DownloadDestinationSettings } from "./destination.js";
import { DownloadError, type DownloadIntent } from "./domain/model.js";
import { workDirectory } from "./domain/paths.js";

export class DownloadReservations {
	constructor(
		private readonly context: DownloadContext,
		private readonly destination: DownloadDestinationSettings,
	) {}
	private readonly failures = new Map<
		string,
		{ attempts: number; next: number }
	>();
	async run() {
		for (const subscription of this.context.options.selection.subscriptions()) {
			if (!this.destination.authorized(subscription)) continue;
			const throttle = this.failures.get(subscription.workKey);
			if (throttle && throttle.next > this.context.now()) continue;
			try {
				const target = await this.context.options.anime.target(
					subscription.workKey,
					this.context.signal,
				);
				for (const candidate of this.context.options.selection.candidates(
					subscription.workKey,
				)) {
					if (
						candidate.status !== "selected" ||
						candidate.episode === null ||
						candidate.episode < subscription.startEpisode ||
						target.availableEpisodes.includes(candidate.episode)
					)
						continue;
					if (
						this.context.options.store.reservedEpisode(
							subscription.workKey,
							candidate.episode,
						)
					)
						continue;
					const entry = this.context.options.selection.release(
						subscription.feedId,
						candidate.entryId,
					);
					if (!entry?.downloadUrl) continue;

					this.context.open();
					const current = this.context.options.selection.subscription(
							subscription.workKey,
						),
						destination = this.context.options.store.destination();
					if (
						!current ||
						current.revision !== subscription.revision ||
						!this.destination.authorized(current) ||
						!destination
					)
						break;
					const directory =
						this.context.options.store.directory(subscription.workKey) ??
						workDirectory(
							subscription.workKey,
							target.work.titles[0] ?? "Anime",
						);
					this.context.options.store.saveDirectory(
						subscription.workKey,
						directory,
					);
					const now = this.context.now();
					const intent: DownloadIntent = {
						id: randomUUID(),
						revision: randomUUID(),
						workKey: subscription.workKey,
						candidateId: candidate.id,
						episode: candidate.episode,
						title: candidate.title.slice(0, 1024),
						hash: `unresolved:${randomUUID()}`,
						expectedHash: entry.hash,
						source: entry.downloadUrl,
						destination,
						directory,
						subscriptionRevision: subscription.revision,
						state: "pending",
						transfer: null,
						progress: null,
						ingestion: "not-ready",
						error: null,
						attempts: 0,
						nextAttemptAt: 0,
						observedAt: null,
						updatedAt: now,
						createdAt: now,
						sourceIdentity: null,
						lastCommand: null,
					};
					if (this.context.options.store.reserve(intent))
						this.context.options.logger.info(
							{
								event: "acquisition.intent_reserved",
								intentId: intent.id,
								episode: intent.episode,
							},
							"Download intent reserved.",
						);
				}
				this.context.options.selection.reservationOutcome(subscription, false);
				this.failures.delete(subscription.workKey);
			} catch (error) {
				if (this.context.signal.aborted) return;
				this.context.options.selection.reservationOutcome(subscription, true);
				const attempts = (throttle?.attempts ?? 0) + 1;
				this.failures.set(subscription.workKey, {
					attempts,
					next: this.context.now() + this.context.delay(attempts),
				});
				this.context.options.logger.warn(
					{
						event: "acquisition.reservation_failed",
						workKey: subscription.workKey,
						code: error instanceof DownloadError ? error.code : "unavailable",
					},
					"Could not reserve acquisition; discovery will retry.",
				);
			}
		}
	}
}
