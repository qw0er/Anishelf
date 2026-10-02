import { extname } from "node:path";

export type ExternalSubtitleFormat = "vtt" | "srt" | "ass" | "ssa";
export const maximumSubtitleBytes = 10 * 1024 * 1024;
const formats: Readonly<Record<string, ExternalSubtitleFormat>> = {
	".vtt": "vtt",
	".srt": "srt",
	".ass": "ass",
	".ssa": "ssa",
};
export function externalSubtitleFormat(
	name: string,
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
