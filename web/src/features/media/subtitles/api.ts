import { type RequestOptions, request } from "../../../shared/api/client.js";
import type {
	ResourceId,
	SubtitleDiscoveryResponse,
	SubtitlePreparationResponse,
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
export function prepareSubtitle(
	fileId: string,
	trackId: string,
	sourceVersion: string,
	subtitleVersion: string,
	options?: RequestOptions,
): Promise<SubtitlePreparationResponse> {
	return request(
		`/api/files/${encodeURIComponent(fileId)}/subtitles/${encodeURIComponent(trackId)}/prepare`,
		"POST",
		options,
		{ sourceVersion, subtitleVersion },
	);
}
export function getSubtitlePreparation(
	statusUrl: string,
	options?: RequestOptions,
): Promise<SubtitlePreparationResponse> {
	return request(statusUrl, "GET", options);
}

export function getSubtitleFonts(
	statusUrl: string,
	options?: RequestOptions,
): Promise<NonNullable<SubtitlePreparationResponse["fonts"]>> {
	return request(statusUrl, "GET", options);
}
