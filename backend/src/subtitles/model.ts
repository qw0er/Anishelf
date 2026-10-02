import { extname } from "node:path";
import {
	type BuiltinPolicy,
	builtinPolicy,
	type DeepReadonly,
} from "../config/policy.js";

export type ExternalSubtitleFormat = "vtt" | "srt" | "ass" | "ssa";
export function externalSubtitleFormat(
	name: string,
	formats: DeepReadonly<BuiltinPolicy>["subtitles"]["formats"] = builtinPolicy
		.subtitles.formats,
): ExternalSubtitleFormat | null {
	return formats[extname(name).toLowerCase()] ?? null;
}
export interface ExternalSubtitle {
	id: string;
	name: string;
	format: ExternalSubtitleFormat;
	language: string | null;
	label: string | null;
	sizeBytes: number;
	sourceVersion: string;
}
export interface SubtitleDiscovery {
	sourceVersion: string;
	tracks: ExternalSubtitle[];
	warnings: {
		name: string;
		code:
			| "RESOURCE_MISSING"
			| "RESOURCE_UNREADABLE"
			| "RESOURCE_ACCESS_DENIED"
			| "SUBTITLE_TOO_LARGE";
	}[];
}
