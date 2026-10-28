/** Shared business vocabulary for source-bound browser negotiation, independent of HTTP. */
type CompatibilityStatus = "supported" | "unsupported" | "unknown";

import type {
	MediaAudioDescription,
	MediaVideoDescription,
} from "../media-inspection/public.js";
export type CompatibilityVideoStream = MediaVideoDescription;
export type CompatibilityAudioStream = MediaAudioDescription;
export type CompatibilityStream =
	| CompatibilityVideoStream
	| CompatibilityAudioStream;
export interface CompatibilityQuery {
	id: string;
	type: "file" | "media-source";
	contentType: string | null;
	video: {
		contentType: string | null;
		width: number | null;
		height: number | null;
		frameRate: number | null;
		bitrate: number | null;
	} | null;
	audio: {
		contentType: string | null;
		sampleRate: number | null;
		channels: number | null;
		bitrate: number | null;
	} | null;
}
export interface CompatibilityEvidence {
	id: string;
	status: CompatibilityStatus;
	smooth: boolean | null;
	reason:
		| "browser-supported"
		| "browser-rejected"
		| "browser-uncertain"
		| "api-unavailable"
		| "query-failed"
		| "query-timeout"
		| "incomplete-description";
}
interface OutputIntent {
	profileId: string;
	target: "file" | "media-source";
}
export interface CompatibilityInspectInput {
	fileId: string;
	sourceVersion?: string;
	audioStreamIndices?: number[];
	output?: OutputIntent | null;
}
export interface CompatibilityInspection {
	fileId: string;
	sourceVersion: string;
	rulesVersion: "4";
	descriptionId: string;
	container: string | null;
	video: CompatibilityVideoStream | null;
	multipleTracks: boolean;
	audioTracks: CompatibilityAudioStream[];
	defaultAudioStreamIndex: number | null;
	selectedAudioStreamIndices: number[];
	queries: CompatibilityQuery[];
	output: (OutputIntent & { profileFingerprint: string }) | null;
}
export interface CompatibilityCheckRequest {
	sourceVersion: string;
	descriptionId: string;
	audioStreamIndices?: number[];
	output: OutputIntent | null;
	evidence: CompatibilityEvidence[];
}
interface CompatibilityDecision {
	status: CompatibilityStatus;
	reason: string;
}
type Combinations = Record<
	"copy-copy" | "copy-encode" | "encode-copy" | "encode-encode",
	CompatibilityStatus
>;
export interface CompatibilityResult {
	fileId: string;
	sourceVersion: string;
	rulesVersion: "4";
	direct: CompatibilityDecision;
	video: CompatibilityDecision;
	audio: CompatibilityDecision;
	container: CompatibilityDecision;
	selectedVideo: CompatibilityVideoStream | null;
	defaultAudioStreamIndex: number | null;
	selectedAudioStreamIndices: number[];
	audioTracks: {
		stream: CompatibilityAudioStream;
		compatibility: CompatibilityDecision;
	}[];
	output:
		| (OutputIntent & {
				profileFingerprint: string;
				copyVideo: CompatibilityStatus;
				copyAudio: CompatibilityStatus;
				combinations: Combinations;
				audioTracks: {
					streamIndex: number;
					copyAudio: CompatibilityStatus;
					combinations: Combinations;
				}[];
		  })
		| null;
	warnings: string[];
}
