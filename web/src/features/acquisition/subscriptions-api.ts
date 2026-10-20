import { type RequestOptions, request } from "../../shared/api/client.js";
import type {
	SubscriptionPreview,
	SubscriptionPreviewInput,
	SubscriptionView,
} from "../../shared/api/contracts.js";

const path = "/api/acquisition/subscriptions";
export const getSubscription = (
	workKey: string,
	page: number,
	options?: RequestOptions,
): Promise<SubscriptionView> =>
	request(
		`${path}?${new URLSearchParams({ workKey, page: String(page) })}`,
		"GET",
		options,
	);
export const previewSubscription = (
	input: SubscriptionPreviewInput,
): Promise<SubscriptionPreview> =>
	request(`${path}/preview`, "POST", {}, input);
export const confirmSubscription = (
	workKey: string,
	token: string,
): Promise<SubscriptionView> =>
	request(`${path}/confirm`, "POST", {}, { workKey, token });
export const toggleSubscription = (
	workKey: string,
	revision: string,
	enabled: boolean,
): Promise<SubscriptionView> =>
	request(path, "PATCH", {}, { workKey, revision, enabled });
export const refreshSubscription = (
	workKey: string,
	revision: string,
): Promise<SubscriptionView> =>
	request(`${path}/refresh`, "POST", {}, { workKey, revision });
export const removeSubscription = (
	workKey: string,
	revision: string,
): Promise<{ removed: true }> =>
	request(path, "DELETE", {}, { workKey, revision });
