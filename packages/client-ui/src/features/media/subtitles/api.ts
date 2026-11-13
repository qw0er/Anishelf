import { type RequestOptions, request } from "../../../shared/api/client.js";
import type {
	ResourceId,
	SubtitleDiscoveryResponse,
} from "../../../shared/api/contracts.js";

export function getSubtitles(
	id: ResourceId,
	options?: RequestOptions,
): Promise<SubtitleDiscoveryResponse> {
	return request(
		`/api/files/${encodeURIComponent(id)}/subtitles`,
		"GET",
		options,
	);
}
