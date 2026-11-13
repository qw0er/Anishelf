import { extname } from "node:path";
import type { DeepReadonly } from "../../../../shared/policy.js";
import { type SubtitlePolicy, subtitlePolicy } from "../policy.js";

export type { SubtitleFormat as ExternalSubtitleFormat } from "@anishelf/contracts/subtitles";

import type { SubtitleFormat as ExternalSubtitleFormat } from "@anishelf/contracts/subtitles";
export function externalSubtitleFormat(
	name: string,
	formats: DeepReadonly<SubtitlePolicy>["formats"] = subtitlePolicy.formats,
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
