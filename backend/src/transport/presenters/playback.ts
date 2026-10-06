import type {
	HistoryResponse,
	PlaybackProgressDto,
	PlaybackSessionResponse,
} from "../../contracts/http.js";
import type {
	HistoryResult,
	PlaybackProgress,
	PlaybackSession,
} from "../../modules/playback/public.js";
import { fileDto } from "./library.js";

export function playbackProgressDto(
	progress: PlaybackProgress,
): PlaybackProgressDto {
	return {
		positionMs: progress.positionMs,
		durationMs: progress.durationMs,
		lastViewedAtMs: progress.lastViewedAtMs,
		generation: progress.generation,
		lastSequence: progress.lastSequence,
	};
}

export function playbackSessionResponse(
	session: PlaybackSession,
): PlaybackSessionResponse {
	return {
		token: session.token,
		sourceVersion: session.sourceVersion,
		file: fileDto(session.file),
		progress: playbackProgressDto(session.progress),
	};
}

export function historyResponse(result: HistoryResult): HistoryResponse {
	return {
		availability: result.availability,
		items: result.items.map((item) => ({
			file: fileDto(item.file),
			progress: playbackProgressDto(item.progress),
		})),
	};
}
