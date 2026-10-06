import type { FileInfo } from "../../resource-access/public.js";

export type {
	RegisteredSource,
	ResolvedSource,
	SourceIdentity,
} from "../../resource-access/public.js";

import type { RegisteredSource } from "../../resource-access/public.js";

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
	token: string;
	sourceVersion: string;
	file: FileInfo;
	progress: PlaybackProgress;
}

export interface SavePlaybackProgress {
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
