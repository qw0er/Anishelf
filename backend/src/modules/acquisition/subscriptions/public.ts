import type {
	SaveSubscriptionInput,
	SubscriptionSearchInput,
	SubscriptionSearchResult,
	SubscriptionView,
} from "./domain/model.js";

export interface SubscriptionsApi {
	profiles(): {
		profiles: {
			id: string;
			name: string;
			description: string;
			source: "builtin" | "custom";
		}[];
		selectedProfileId: string;
		selectionAvailable: boolean;
	};
	search(input: SubscriptionSearchInput): Promise<SubscriptionSearchResult>;
	get(workKey: string, page?: number): SubscriptionView;
	save(input: SaveSubscriptionInput): Promise<SubscriptionView>;
	setEnabled(
		workKey: string,
		revision: string,
		enabled: boolean,
	): Promise<SubscriptionView>;
	remove(workKey: string, revision: string): Promise<void>;
	refresh(workKey: string, revision: string): Promise<SubscriptionView>;
}

export type {
	Candidate,
	SaveSubscriptionInput,
	Subscription,
	SubscriptionAuthorization,
} from "./domain/model.js";
