import { type RequestOptions, request } from "../../shared/api/client.js";
import type {
	DownloadActivity,
	DownloadSettings,
} from "../../shared/api/contracts.js";

const path = "/api/acquisition/downloads";
export const downloadKeys = ["acquisition", "downloads"] as const;
export const getDownloadSettings = (
	options?: RequestOptions,
): Promise<DownloadSettings> => request(`${path}/settings`, "GET", options);
export const saveDownloadDestination = (input: {
	revision: string | null;
	scopeId: string;
	path: string;
}): Promise<NonNullable<DownloadSettings["destination"]>> =>
	request(`${path}/settings`, "PUT", {}, input);
export const validateDownloadDestination = (
	revision: string,
): Promise<NonNullable<DownloadSettings["destination"]>> =>
	request(`${path}/validate`, "POST", {}, { revision });
export const getDownloadActivity = (
	workKey: string,
	page: number,
	options?: RequestOptions,
): Promise<DownloadActivity> =>
	request(
		`${path}?${new URLSearchParams({ workKey, page: String(page) })}`,
		"GET",
		options,
	);
export const retryDownload = (
	id: string,
	revision: string,
	kind: "acquisition" | "import",
): Promise<{ accepted: boolean }> =>
	request(
		`${path}/${encodeURIComponent(id)}/retry`,
		"POST",
		{},
		{ revision, kind, commandId: crypto.randomUUID() },
	);
