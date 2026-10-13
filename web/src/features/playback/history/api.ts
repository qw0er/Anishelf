import { type RequestOptions, request } from "../../../shared/api/client.js";
import type { HistoryResponse } from "../../../shared/api/contracts.js";

export function getHistory(options?: RequestOptions): Promise<HistoryResponse> {
	return request("/api/history", "GET", options);
}
