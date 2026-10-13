import { type RequestOptions, request } from "../../../shared/api/client.js";
import type {
	ChaptersResponse,
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

export function getChapters(
	id: string,
	sourceVersion: string,
	options?: RequestOptions,
): Promise<ChaptersResponse> {
	const query = new URLSearchParams({ sourceVersion });
	return request(
		`/api/files/${encodeURIComponent(id)}/chapters?${query}`,
		"GET",
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
