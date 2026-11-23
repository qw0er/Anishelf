import type { Static } from "typebox";
import type { PlaybackPlanDto } from "./http.ts";
import type { MediaTimelineSchema } from "./schemas/media.ts";

export type MediaTimeline = Static<typeof MediaTimelineSchema>;

export function sourceTimeMs(
	mediaTimeMs: number,
	timeline: MediaTimeline,
): number {
	return boundedTime(
		mediaTimeMs - timeline.mediaOriginMs + timeline.sourceOriginMs,
		timeline.sourceDurationMs,
	);
}
export function mediaTimeMs(
	sourcePositionMs: number,
	timeline: MediaTimeline,
): number {
	return Math.max(
		0,
		boundedTime(sourcePositionMs, timeline.sourceDurationMs) -
			timeline.sourceOriginMs +
			timeline.mediaOriginMs,
	);
}
function boundedTime(value: number, durationMs: number | null): number {
	if (!Number.isFinite(value)) throw new RangeError("Invalid media time.");
	const position = Math.max(0, Math.round(value));
	return durationMs === null ? position : Math.min(position, durationMs);
}
export function originalTimeline(
	sourceDurationMs: number | null = null,
): MediaTimeline {
	return { sourceOriginMs: 0, mediaOriginMs: 0, sourceDurationMs };
}

export function directPlaybackPlan(
	fileId: string,
	mimeType = "application/octet-stream",
): Extract<PlaybackPlanDto, { mode: "direct" }> {
	return {
		mode: "direct",
		resource: {
			delivery: "file",
			url: originalMediaPath(fileId),
			mimeType,
			timeline: originalTimeline(),
		},
	};
}

type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

// Malformed/multipart fields are ignored; BigInt prevents integer overflow.
export function byteRange(header: string | undefined, size: number): ByteRange {
	const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/i);
	if (!match || (!match[1] && !match[2])) return null;
	const length = BigInt(size);
	if (!match[1]) {
		const suffix = BigInt(match[2] as string);
		if (suffix === 0n || length === 0n) return "unsatisfiable";
		return {
			start: Number(suffix >= length ? 0n : length - suffix),
			end: size - 1,
		};
	}
	const start = BigInt(match[1]);
	const end = match[2] ? BigInt(match[2]) : null;
	if (end !== null && end < start) return null;
	if (start >= length) return "unsatisfiable";
	return {
		start: Number(start),
		end: Number(end === null || end >= length ? length - 1n : end),
	};
}

export function originalMediaPath(fileId: string) {
	return `/api/media/${encodeURIComponent(fileId)}`;
}

export function matchesOriginalMediaLink(
	origin: string,
	fileId: string,
	url: {
		origin: string;
		username: string;
		password: string;
		pathname: string;
		searchParams: { get(name: string): string | null };
	},
) {
	return (
		url.origin === origin &&
		!url.username &&
		!url.password &&
		url.pathname === originalMediaPath(fileId) &&
		Boolean(url.searchParams.get("access_token"))
	);
}
