import type { FeedRecord } from "../sources/public.js";
import type { Candidate, Subscription } from "./domain/model.js";
export interface DiscoveryStore {
	transaction(operation: () => void): void;
	reservationOutcome(subscription: Subscription, failed: boolean): void;
	subscription(workKey: string): Subscription | null;
	subscriptions(): Subscription[];
	candidates(workKey: string): Candidate[];
	saveSubscription(
		subscription: Subscription,
		feed: FeedRecord,
		candidates: Candidate[],
	): void;
	updateCandidates(
		subscription: Subscription,
		candidates: Candidate[],
		error?: string | null,
	): boolean;
	remove(workKey: string, revision: string): boolean;
}
