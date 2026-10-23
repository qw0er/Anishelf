import { eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type {
	Candidate,
	Subscription,
	SubscriptionAuthorization,
} from "../domain/model.js";
import type { SubscriptionStore } from "../ports.js";
import {
	readAcquisitionAuthorizations,
	readAcquisitionCandidates,
	readAcquisitionSubscriptions,
	writeAcquisitionAuthorizations,
	writeAcquisitionCandidates,
	writeAcquisitionSubscriptions,
} from "./records.js";
import {
	acquisitionAuthorizations as authorizations,
	acquisitionCandidates as candidates,
	acquisitionSubscriptions as subscriptions,
} from "./schema.js";

export class SubscriptionRepository implements SubscriptionStore {
	constructor(private readonly store: Store) {}
	transaction(operation: () => void) {
		this.store.transaction(() => operation(), { behavior: "immediate" });
	}
	authorization(workKey: string) {
		const row = this.store
			.select()
			.from(authorizations)
			.where(eq(authorizations.workKey, workKey))
			.get();
		return row ? readAcquisitionAuthorizations(this.store, row) : null;
	}
	authorize(value: SubscriptionAuthorization) {
		writeAcquisitionAuthorizations(this.store, value);
	}
	revoke(workKey: string) {
		this.store
			.delete(authorizations)
			.where(eq(authorizations.workKey, workKey))
			.run();
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

	candidates(workKey: string) {
		return this.store
			.select()
			.from(candidates)
			.where(eq(candidates.workKey, workKey))
			.all()
			.map((row) => readAcquisitionCandidates(this.store, row));
	}

	saveSubscription(subscription: Subscription, result: Candidate[]) {
		this.store.transaction((store) => {
			const repository = new SubscriptionRepository(store);
			writeAcquisitionSubscriptions(store, subscription);
			repository.replaceCandidates(subscription.workKey, result);
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
			const repository = new SubscriptionRepository(store);
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
			const repository = new SubscriptionRepository(store);
			const current = repository.subscription(workKey);
			if (!current || current.revision !== revision) return false;
			store
				.delete(subscriptions)
				.where(eq(subscriptions.workKey, workKey))
				.run();
			return true;
		});
	}
}
