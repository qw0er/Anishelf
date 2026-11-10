import { type RequestOptions, request } from "../../../shared/api/client.js";
import type {
	MediaAccessLinkResponse,
	PlaybackOptionsRequest,
	PlaybackOptionsResponse,
	PlaybackSelectionRequest,
	PlaybackSelectionResponse,
	PlaybackSessionResponse,
	ResourceId,
	SavePlaybackProgressRequest,
	SavePlaybackProgressResponse,
} from "../../../shared/api/contracts.js";

export function openPlaybackSession(
	fileId: ResourceId,
	options?: RequestOptions,
): Promise<PlaybackSessionResponse> {
	return request("/api/playback/sessions", "POST", options, { fileId });
}
export function savePlaybackProgress(
	token: string,
	progress: SavePlaybackProgressRequest,
	options?: RequestOptions,
): Promise<SavePlaybackProgressResponse> {
	return request(
		`/api/playback/sessions/${encodeURIComponent(token)}/progress`,
		"PUT",
		options,
		progress,
	);
}
export function releasePlaybackSession(
	token: string,
	options?: RequestOptions,
): Promise<void> {
	return request(
		`/api/playback/sessions/${encodeURIComponent(token)}`,
		"DELETE",
		options,
	);
}

export function getPlaybackOptions(
	input: PlaybackOptionsRequest,
	options?: RequestOptions,
): Promise<PlaybackOptionsResponse> {
	return request("/api/playback/options", "POST", options, input);
}
export function selectPlayback(
	input: PlaybackSelectionRequest,
	options?: RequestOptions,
): Promise<PlaybackSelectionResponse> {
	return request("/api/playback/selection", "POST", options, input);
}

export function createMediaAccessLink(
	fileId: ResourceId,
	options?: RequestOptions,
): Promise<MediaAccessLinkResponse> {
	return request(
		`/api/media/${encodeURIComponent(fileId)}/access-link`,
		"POST",
		options,
	);
}
