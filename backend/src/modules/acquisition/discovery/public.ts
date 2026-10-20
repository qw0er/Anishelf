import type {
	PreviewInput,
	SubscriptionPreview,
	SubscriptionView,
} from "./domain/model.js";

export type { FeedTransport } from "./ports.js";
export interface DiscoveryApi {
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
