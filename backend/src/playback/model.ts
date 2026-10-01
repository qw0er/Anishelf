import type { FileInfo } from "../library/model.js";

/** Identifies one file version within a canonical resource root. Backend only. */
export interface PlaybackSourceIdentity {
	canonicalRoot: string;
	fileId: string;
	relativePath: string;
	sourceVersion: string;
}

export interface ResolvedPlaybackSource {
	identity: PlaybackSourceIdentity;
	file: FileInfo;
	rootEpoch: number;
}

/** Durable business progress, independent of the database schema. */
export interface PlaybackProgress {
	sourceId: string;
	positionMs: number;
	durationMs: number | null;
	lastViewedAtMs: number | null;
	revision: number;
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

export interface RegisteredPlaybackSource {
	id: string;
	rootId: string;
	fileId: string;
	relativePath: string;
	sourceVersion: string;
	createdAtMs: number;
}

export interface ContinueWatchingCandidate {
	source: RegisteredPlaybackSource;
	progress: PlaybackProgress;
}

/** Application result; no playback session HTTP endpoint is registered yet. */
export interface PlaybackSession {
	token: string;
	generation: number;
	sourceVersion: string;
	file: FileInfo;
	plan: { mode: "direct"; playbackUrl: string };
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

export interface StartOverPlayback {
	token: string;
	generation: number;
	requestId: string;
}

export interface ContinueWatchingItem {
	file: FileInfo;
	progress: PlaybackProgress;
}

export interface ContinueWatchingResult {
	availability: "unknown" | "checked";
	items: ContinueWatchingItem[];
}
