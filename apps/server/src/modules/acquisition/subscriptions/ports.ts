import type {
	Candidate,
	Subscription,
	SubscriptionAuthorization,
} from "./domain/model.js";
export interface SubscriptionStore {
	transaction(operation: () => void): void;
	authorization(workKey: string): SubscriptionAuthorization | null;
	authorize(value: SubscriptionAuthorization): void;
	revoke(workKey: string): void;
	subscription(workKey: string): Subscription | null;
	subscriptions(): Subscription[];
	candidates(workKey: string): Candidate[];
	saveSchedule(
		workKey: string,
		revision: string,
		schedule: NonNullable<Subscription["schedule"]>,
	): boolean;
	saveSubscription(subscription: Subscription, candidates: Candidate[]): void;
	updateCandidates(
		subscription: Subscription,
		candidates: Candidate[],
		error?: string | null,
	): boolean;
	remove(workKey: string, revision: string): boolean;
}
