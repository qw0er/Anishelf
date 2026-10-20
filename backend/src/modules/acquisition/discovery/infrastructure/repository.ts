import { eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { Candidate, FeedRecord, Subscription } from "../domain/model.js";
import type { DiscoveryStore } from "../ports.js";
import {
	acquisitionCandidates as candidates,
	acquisitionFeeds as feeds,
	acquisitionSubscriptions as subscriptions,
} from "./schema.js";

export class DiscoveryRepository implements DiscoveryStore {
	constructor(private readonly store: Store) {}
	subscription(workKey: string) {
		return (
			this.store
				.select()
				.from(subscriptions)
				.where(eq(subscriptions.workKey, workKey))
				.get()?.data ?? null
		);
	}
	subscriptions() {
		return this.store
			.select()
			.from(subscriptions)
			.all()
			.map((row) => row.data);
	}
	feed(id: string) {
		return (
			this.store.select().from(feeds).where(eq(feeds.id, id)).get()?.data ??
			null
		);
	}
	candidates(workKey: string) {
		return this.store
			.select()
			.from(candidates)
			.where(eq(candidates.workKey, workKey))
			.all()
			.map((row) => row.data);
	}
	saveFeed(feed: FeedRecord) {
		this.store
			.insert(feeds)
			.values({ id: feed.id, data: feed })
			.onConflictDoUpdate({ target: feeds.id, set: { data: feed } })
			.run();
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
			const row = {
				workKey: subscription.workKey,
				feedId: feed.id,
				data: subscription,
			};
			store
				.insert(subscriptions)
				.values(row)
				.onConflictDoUpdate({ target: subscriptions.workKey, set: row })
				.run();
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
			this.store
				.insert(candidates)
				.values({ id: candidate.id, workKey, data: candidate })
				.run();
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
			store
				.update(subscriptions)
				.set({ data: { ...current, lastError: error } })
				.where(eq(subscriptions.workKey, subscription.workKey))
				.run();
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
