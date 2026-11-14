import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { coveredEpisodeCount } from "../domain/completion.js";
import type { SubscriptionStore } from "../ports.js";
import type { SubscriptionScheduling } from "./scheduling.js";

export class SubscriptionCompletion {
	private active: Promise<void> | undefined;

	constructor(
		private readonly options: {
			store: Pick<
				SubscriptionStore,
				"subscriptions" | "subscription" | "candidates" | "saveSubscription"
			>;
			scheduling: Pick<SubscriptionScheduling, "read" | "update">;
			signal: AbortSignal;
			assertOpen(): void;
			now(): number;
			logger: Logger;
		},
	) {}

	check(): Promise<void> {
		if (this.active) return this.active;
		const task = this.updateCompletion().finally(() => {
			this.active = undefined;
		});
		this.active = task;
		return task;
	}
	private async updateCompletion(): Promise<void> {
		for (const subscription of this.options.store.subscriptions()) {
			if (!subscription.enabled) continue;
			try {
				const target = await this.options.scheduling.read(subscription);
				if (!target) continue;
				this.options.assertOpen();
				const current = this.options.store.subscription(subscription.workKey);
				if (!current || current.revision !== subscription.revision) continue;
				const total = target.work.episodeCount;
				const previous = current.completion;
				const covered = coveredEpisodeCount(current, target);
				const expanded =
					previous && total !== null && total > previous.episodeCount;
				if (previous && !expanded) continue;
				if (covered === null && !expanded) continue;
				const updated = {
					...(this.options.store.subscription(current.workKey) ?? current),
					completion:
						covered === null
							? null
							: { episodeCount: covered, completedAt: this.options.now() },
					revision: randomUUID(),
				};
				this.options.store.saveSubscription(
					updated,
					this.options.store.candidates(current.workKey),
				);
				this.options.logger.info(
					{
						event:
							covered === null
								? "acquisition.subscription_reopened"
								: "acquisition.subscription_completed",
						workKey: current.workKey,
						episodeCount: total,
					},
					"Subscription coverage state changed.",
				);
			} catch {
				if (this.options.signal.aborted) return;
				this.options.scheduling.update(subscription, null);
				this.options.logger.debug(
					{
						event: "acquisition.subscription_coverage_unavailable",
						workKey: subscription.workKey,
					},
					"Coverage check will retry without changing subscription state.",
				);
			}
		}
	}
}
