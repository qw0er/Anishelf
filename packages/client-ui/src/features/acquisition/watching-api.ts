import { request } from "../../shared/api/client.js";
import type {
	WatchingAutomationConfig,
	WatchingAutomationOverride,
	WatchingAutomationPreview,
	WatchingAutomationStatus,
} from "../../shared/api/contracts.js";

const path = "/api/acquisition/watching";
export const watchingKey = ["acquisition", "watching"] as const;
export const watchingQuery = () => ({
	queryKey: watchingKey,
	queryFn: ({ signal }: { signal: AbortSignal }) =>
		request<WatchingAutomationStatus>(path, "GET", { signal }),
	refetchInterval: 15000,
});
export const previewWatching = (
	revision: string,
	config: WatchingAutomationConfig,
) =>
	request<WatchingAutomationPreview>(
		`${path}/preview`,
		"POST",
		{},
		{ revision, config },
	);
export const confirmWatching = (id: string) =>
	request<WatchingAutomationStatus>(`${path}/confirm`, "POST", {}, { id });
export const disableWatching = (revision: string) =>
	request<WatchingAutomationStatus>(
		`${path}/disable`,
		"POST",
		{},
		{ revision },
	);
export const overrideWatching = (input: WatchingAutomationOverride) =>
	request<WatchingAutomationStatus>(`${path}/works`, "PUT", {}, input);
