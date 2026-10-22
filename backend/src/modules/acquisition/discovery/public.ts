import type {
	PreviewInput,
	SubscriptionPreview,
	SubscriptionView,
} from "./domain/model.js";

export interface DiscoveryApi {
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
	get(workKey: string, page?: number): SubscriptionView;
	preview(session: string, input: PreviewInput): Promise<SubscriptionPreview>;
	confirm(
		session: string,
		workKey: string,
		token: string,
	): Promise<SubscriptionView>;
	setEnabled(
		workKey: string,
		revision: string,
		enabled: boolean,
	): Promise<SubscriptionView>;
	remove(workKey: string, revision: string): Promise<void>;
	refresh(workKey: string, revision: string): Promise<SubscriptionView>;
}

export type { Candidate, PreviewInput, Subscription } from "./domain/model.js";
