import type { AcquisitionTarget } from "../../../anime/public.js";
import {
	airingPolicy,
	scheduleAiring,
	waitingForAiring,
} from "../domain/airing-schedule.js";
import type { Subscription } from "../domain/model.js";
import type { SubscriptionsContext } from "./context.js";

/** Owns advisory search timing. It never grants or revokes permission. */
export class SubscriptionScheduling {
	private readonly pending = new Map<
		string,
		{ revision: string; task: Promise<AcquisitionTarget | null> }
	>();
	constructor(private readonly context: SubscriptionsContext) {}
	private normalDue(sub: Subscription) {
		return sub.feedId
			? (this.context.options.sources.snapshot(sub.feedId)?.nextAttemptAt ?? 0)
			: (sub.automatic?.retryAt ?? 0);
	}
	update(sub: Subscription, target: AcquisitionTarget | null) {
		const current = this.context.options.store.subscription(sub.workKey);
		if (
			this.context.signal.aborted ||
			!current ||
			(current.completion && !current.completion.resumed) ||
			current.revision !== sub.revision
		)
			return;
		const schedule = scheduleAiring(
			current,
			target,
			this.context.now(),
			this.normalDue(current),
		);
		if (
			this.context.options.store.saveSchedule(
				current.workKey,
				current.revision,
				schedule,
			) &&
			(current.schedule?.reason !== schedule.reason ||
				current.schedule?.nextCheckAt !== schedule.nextCheckAt)
		)
			this.context.options.logger.info(
				{
					event: "acquisition.subscription_scheduled",
					workKey: sub.workKey,
					...schedule,
				},
				"Subscription search timing updated; airing does not prove resource availability.",
			);
	}
	async ensure(sub: Subscription): Promise<void> {
		await this.read(sub);
	}
	read(sub: Subscription): Promise<AcquisitionTarget | null> {
		const pending = this.pending.get(sub.workKey);
		if (pending)
			return pending.revision === sub.revision
				? pending.task
				: pending.task.then(() => this.read(sub));
		const task = (async () => {
			let target: AcquisitionTarget | null = null;
			try {
				target = await this.context.options.anime.target(
					sub.workKey,
					this.context.signal,
				);
			} catch {
				/* Metadata failure uses a bounded fallback, without changing subscription permission. */
			}
			this.update(sub, target);
			return target;
		})().finally(() => {
			this.pending.delete(sub.workKey);
		});
		this.pending.set(sub.workKey, { revision: sub.revision, task });
		return task;
	}
	dueAt(sub: Subscription) {
		const schedule = sub.schedule;
		if (!schedule) return 0;
		// Metadata expiry must be reconsidered even while source searches are suspended.
		if (waitingForAiring(schedule))
			return Math.min(
				schedule.nextCheckAt ?? Infinity,
				schedule.metadataCheckAt,
			);
		return Math.min(
			schedule.nextCheckAt ?? this.normalDue(sub),
			this.normalDue(sub),
		);
	}
	resourceDueAt(sub: Subscription) {
		return sub.schedule && waitingForAiring(sub.schedule)
			? (sub.schedule.nextCheckAt ?? Infinity)
			: this.dueAt(sub);
	}
	maySearch(sub: Subscription) {
		const schedule = sub.schedule;
		if (schedule && waitingForAiring(schedule))
			return (
				schedule.nextCheckAt !== null &&
				schedule.nextCheckAt <= this.context.now()
			);
		return this.dueAt(sub) <= this.context.now();
	}
	attempted(sub: Subscription, manual: boolean) {
		const current = this.context.options.store.subscription(sub.workKey);
		if (!current || current.revision !== sub.revision || !current.schedule)
			return;
		const schedule = {
			...current.schedule,
			lastAttemptAt: this.context.now(),
			wakeAt: null,
		};
		if (!waitingForAiring(schedule))
			schedule.nextCheckAt = this.context.now() + airingPolicy.retryMs;
		this.context.options.store.saveSchedule(
			current.workKey,
			current.revision,
			schedule,
		);
		this.context.options.logger.info(
			{
				event: "acquisition.subscription_search_requested",
				workKey: sub.workKey,
				manual,
				reason: schedule.reason,
				episode: schedule.episode,
			},
			"Subscription search requested under existing authorization.",
		);
	}
	collected(sub: Subscription) {
		const current = this.context.options.store.subscription(sub.workKey);
		if (
			!current?.schedule ||
			current.revision !== sub.revision ||
			waitingForAiring(current.schedule)
		)
			return;
		this.context.options.store.saveSchedule(current.workKey, current.revision, {
			...current.schedule,
			nextCheckAt: this.normalDue(current),
		});
	}
	async close() {
		await Promise.allSettled(
			[...this.pending.values()].map((pending) => pending.task),
		);
	}
}
