import { type RequestOptions, request } from "../../shared/api/client.js";
import type { FileResponse, ResourceId } from "../../shared/api/contracts.js";
export function getFile(
	id: ResourceId,
	options?: RequestOptions,
): Promise<FileResponse> {
	return request<FileResponse>(
		`/api/files/${encodeURIComponent(id)}`,
		"GET",
		options,
	);
}
