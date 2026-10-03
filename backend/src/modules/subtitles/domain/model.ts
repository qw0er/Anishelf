import { extname } from "node:path";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
} from "../../configuration/public.js";
import type { SourceIdentity } from "../../media-source/public.js";

export type {
	PreparedSubtitleFormat,
	SubtitleFormat as ExternalSubtitleFormat,
} from "../../../contracts/subtitles.js";

import type {
	SubtitleFormat as ExternalSubtitleFormat,
	PreparedSubtitleFormat,
} from "../../../contracts/subtitles.js";
export function externalSubtitleFormat(
	name: string,
	formats: DeepReadonly<BuiltinPolicy>["subtitles"]["formats"] = builtinPolicy
		.subtitles.formats,
): ExternalSubtitleFormat | null {
	return formats[extname(name).toLowerCase()] ?? null;
}
export interface ExternalSubtitle {
	origin: "external";
	id: string;
	name: string;
	format: ExternalSubtitleFormat;
	language: string | null;
	label: string | null;
	sizeBytes: number;
	sourceVersion: string;
}
export interface EmbeddedSubtitle {
	origin: "embedded";
	id: string;
	name: string;
	format: ExternalSubtitleFormat | null;
	language: string | null;
	label: string | null;
	sizeBytes: null;
	sourceVersion: string;
	codec: string | null;
	default: boolean;
	forced: boolean;
	extractionSupported: boolean;
	webSupported: boolean;
	unsupportedReason: "UNSUPPORTED_CODEC" | "UNSUPPORTED_FORMAT" | null;
}
export interface ExternalSubtitleDiscovery {
	sourceVersion: string;
	tracks: ExternalSubtitle[];
	warnings: {
		name: string;
		code:
			| "RESOURCE_MISSING"
			| "RESOURCE_UNREADABLE"
			| "RESOURCE_ACCESS_DENIED"
			| "SUBTITLE_TOO_LARGE"
			| "SUBTITLE_PROBE_UNAVAILABLE"
			| "SUBTITLE_PROBE_FAILED"
			| "SUBTITLE_PROBE_BUSY";
	}[];
}

export interface SubtitleDiscovery
	extends Omit<ExternalSubtitleDiscovery, "tracks"> {
	tracks: (ExternalSubtitle | EmbeddedSubtitle)[];
}

export type SubtitlePreparationError =
	| "SUBTITLE_EXTRACTION_FAILED"
	| "SUBTITLE_TOOL_UNAVAILABLE"
	| "SUBTITLE_TOO_LARGE"
	| "SUBTITLE_CACHE_FULL"
	| "PLAYBACK_CONFLICT"
	| "SUBTITLE_INTERRUPTED";
export interface SubtitleAsset {
	id: string;
	source: SourceIdentity;
	trackId: string;
	streamIndex: number;
	processingVersion: string;
	format: PreparedSubtitleFormat;
	status: "pending" | "ready" | "failed";
	sizeBytes: number | null;
	errorCode: SubtitlePreparationError | null;
}
export interface SubtitlePreparation {
	id: string;
	status: SubtitleAsset["status"];
	format: ExternalSubtitleFormat;
	errorCode: SubtitlePreparationError | null;
}
