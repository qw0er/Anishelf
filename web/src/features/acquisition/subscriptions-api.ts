import { type RequestOptions, request } from "../../shared/api/client.js";
import type {
	AcquisitionProfileCatalog,
	SubscriptionSaveInput,
	SubscriptionSearchInput,
	SubscriptionSearchResult,
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
export const saveSubscription = (
	input: SubscriptionSaveInput,
): Promise<SubscriptionView> => request(path, "PUT", {}, input);
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

export const acquisitionProfilesQuery = () => ({
	queryKey: ["acquisition", "profiles"] as const,
	queryFn: ({ signal }: { signal: AbortSignal }) =>
		request<AcquisitionProfileCatalog>("/api/acquisition/profiles", "GET", {
			signal,
		}),
});

export const searchSubscriptionSource = (
	input: SubscriptionSearchInput,
): Promise<SubscriptionSearchResult> =>
	request(`${path}/search`, "POST", {}, input);
