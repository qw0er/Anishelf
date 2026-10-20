import { eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { Candidate, FeedRecord, Subscription } from "../domain/model.js";
import type { DiscoveryStore } from "../ports.js";
import {
	readAcquisitionCandidates,
	readAcquisitionFeeds,
	readAcquisitionSubscriptions,
	writeAcquisitionCandidates,
	writeAcquisitionFeeds,
	writeAcquisitionSubscriptions,
} from "./records.js";
import {
	acquisitionCandidates as candidates,
	acquisitionFeeds as feeds,
	acquisitionSubscriptions as subscriptions,
} from "./schema.js";

export class DiscoveryRepository implements DiscoveryStore {
	constructor(private readonly store: Store) {}
	transaction(operation: () => void) {
		this.store.transaction(() => operation(), { behavior: "immediate" });
	}
	reservationOutcome(subscription: Subscription, failed: boolean) {
		const current = this.subscription(subscription.workKey);
		if (!current?.enabled || current.revision !== subscription.revision) return;
		// Reservation recovery must not erase a separate assessment error or replace candidates.
		if (!failed && current.lastError !== "acquisition_unavailable") return;
		writeAcquisitionSubscriptions(this.store, {
			...current,
			lastError: failed ? "acquisition_unavailable" : null,
		});
	}
	subscription(workKey: string) {
		const row = this.store
			.select()
			.from(subscriptions)
			.where(eq(subscriptions.workKey, workKey))
			.get();
		return row ? readAcquisitionSubscriptions(this.store, row) : null;
	}
	subscriptions() {
		return this.store
			.select()
			.from(subscriptions)
			.all()
			.map((row) => readAcquisitionSubscriptions(this.store, row));
	}
	feed(id: string) {
		const row = this.store.select().from(feeds).where(eq(feeds.id, id)).get();
		return row ? readAcquisitionFeeds(this.store, row) : null;
	}
	candidates(workKey: string) {
		return this.store
			.select()
			.from(candidates)
			.where(eq(candidates.workKey, workKey))
			.all()
			.map((row) => readAcquisitionCandidates(this.store, row));
	}
	saveFeed(feed: FeedRecord) {
		writeAcquisitionFeeds(this.store, feed);
	}

	saveSubscription(
		subscription: Subscription,
		feed: FeedRecord,
		result: Candidate[],
	) {
		this.store.transaction((store) => {
			const repository = new DiscoveryRepository(store);
			const previous = repository.subscription(subscription.workKey);
			repository.saveFeed(feed);
			writeAcquisitionSubscriptions(store, subscription);
			repository.replaceCandidates(subscription.workKey, result);
			if (
				previous &&
				previous.feedId !== feed.id &&
				!repository
					.subscriptions()
					.some((item) => item.feedId === previous.feedId)
			)
				store.delete(feeds).where(eq(feeds.id, previous.feedId)).run();
		});
	}
	private replaceCandidates(workKey: string, result: Candidate[]) {
		this.store.delete(candidates).where(eq(candidates.workKey, workKey)).run();
		for (const candidate of result)
			writeAcquisitionCandidates(this.store, candidate);
	}
	updateCandidates(
		subscription: Subscription,
		result: Candidate[],
		error: string | null = null,
	) {
		return this.store.transaction((store) => {
			const repository = new DiscoveryRepository(store);
			const current = repository.subscription(subscription.workKey);
			if (!current?.enabled || current.revision !== subscription.revision)
				return false;
			repository.replaceCandidates(subscription.workKey, result);
			writeAcquisitionSubscriptions(store, { ...current, lastError: error });
			return true;
		});
	}
	remove(workKey: string, revision: string) {
		return this.store.transaction((store) => {
			const repository = new DiscoveryRepository(store);
			const current = repository.subscription(workKey);
			if (!current || current.revision !== revision) return false;
			store
				.delete(subscriptions)
				.where(eq(subscriptions.workKey, workKey))
				.run();
			if (
				!repository
					.subscriptions()
					.some((subscription) => subscription.feedId === current.feedId)
			)
				store.delete(feeds).where(eq(feeds.id, current.feedId)).run();
			return true;
		});
	}
}
