import type { FileInfo } from "../../../resources/public.js";
import type { WatchedInterval } from "./completion.js";

export type {
	RegisteredSource,
	ResolvedSource,
	SourceIdentity,
} from "../../../resources/public.js";

import type { RegisteredSource } from "../../../resources/public.js";

/** Durable business progress, independent of the database schema. */
export interface PlaybackProgress {
	sourceId: string;
	positionMs: number;
	durationMs: number | null;
	lastViewedAtMs: number | null;
	generation: number;
	lastSequence: number;
}

export interface PlaybackProgressUpdate {
	evidence?: {
		intervals: WatchedInterval[];
		durationMs: number;
		context: string | null;
		capturedAt: number;
	};
	sourceId: string;
	generation: number;
	sequence: number;
	positionMs: number;
	durationMs: number | null;
}

export type SavePlaybackProgressResult =
	| { status: "saved" | "duplicate"; progress: PlaybackProgress }
	| { status: "stale" };

export interface HistoryCandidate {
	source: RegisteredSource;
	progress: PlaybackProgress;
}

/** Application result, projected into public JSON by the HTTP presenter. */
export interface PlaybackSession {
	completionEnabled?: boolean;
	token: string;
	sourceVersion: string;
	file: FileInfo;
	progress: PlaybackProgress;
}

export interface SavePlaybackProgress {
	intervals?: WatchedInterval[];
	token: string;
	generation: number;
	sourceVersion: string;
	sequence: number;
	positionMs: number;
	durationMs: number | null;
}

export interface HistoryItem {
	file: FileInfo;
	progress: PlaybackProgress;
}

export interface HistoryResult {
	availability: "unknown" | "checked";
	items: HistoryItem[];
}
