import type {
	CompatibilityEvidence,
	CompatibilityQuery,
} from "../api/contracts.js";
export interface CapabilityEnvironment {
	canPlayType(type: string): string;
	isTypeSupported?: (type: string) => boolean;
	decodingInfo?: (
		configuration: MediaDecodingConfiguration,
	) => Promise<MediaCapabilitiesDecodingInfo>;
}
const cache = new Map<string, CompatibilityEvidence>();
export function clearCapabilityCache(): void {
	cache.clear();
}
function configuration(
	query: CompatibilityQuery,
): MediaDecodingConfiguration | null {
	const { video, audio, contentType } = query;
	if (!contentType || (!video && !audio)) return null;
	const positive = (value: number | null): value is number =>
		value !== null && Number.isFinite(value) && value > 0;
	if (
		video &&
		(!positive(video.width) ||
			!positive(video.height) ||
			!positive(video.bitrate) ||
			!positive(video.frameRate))
	)
		return null;
	if (
		audio &&
		(!positive(audio.bitrate) ||
			!positive(audio.sampleRate) ||
			!positive(audio.channels))
	)
		return null;
	return {
		type: query.type,
		...(video
			? {
					video: {
						contentType: video.contentType ?? "",
						width: video.width ?? 0,
						height: video.height ?? 0,
						bitrate: video.bitrate ?? 0,
						framerate: video.frameRate ?? 0,
					},
				}
			: {}),
		...(audio
			? {
					audio: {
						contentType: audio.contentType ?? "",
						channels: String(audio.channels),
						bitrate: audio.bitrate ?? 0,
						samplerate: audio.sampleRate ?? 0,
					},
				}
			: {}),
	};
}
export function browserEnvironment(): CapabilityEnvironment {
	const video = document.createElement("video");
	return {
		canPlayType: (type) => video.canPlayType(type),
		...(typeof MediaSource !== "undefined"
			? { isTypeSupported: (type) => MediaSource.isTypeSupported(type) }
			: {}),
		...(navigator.mediaCapabilities?.decodingInfo
			? {
					decodingInfo: (config) =>
						navigator.mediaCapabilities.decodingInfo(config),
				}
			: {}),
	};
}
/** Only queries exact descriptions; no user-agent codec whitelist or guessed bitrate. */
export async function queryCapability(
	query: CompatibilityQuery,
	environment: CapabilityEnvironment,
	signal?: AbortSignal,
	timeoutMs = 3000,
): Promise<CompatibilityEvidence> {
	signal?.throwIfAborted();
	const base: CompatibilityEvidence = {
		id: query.id,
		status: "unknown",
		reason: "incomplete-description",
		smooth: null,
	};
	if (!query.contentType) return base;
	try {
		const raw =
			query.type === "file"
				? environment.canPlayType(query.contentType)
				: environment.isTypeSupported?.(query.contentType);
		if (raw === undefined) return { ...base, reason: "api-unavailable" };
		const status =
			raw === "" || raw === false
				? "unsupported"
				: raw === "probably" || raw === true
					? "supported"
					: "unknown";
		const initial: CompatibilityEvidence = {
			...base,
			status,
			reason:
				status === "supported"
					? "browser-supported"
					: status === "unsupported"
						? "browser-rejected"
						: "browser-uncertain",
		};
		// Coarse container responses remain probabilistic; decodingInfo requires actual streams.
		const config = configuration(query);
		if (!config || !environment.decodingInfo || status === "unsupported")
			return initial;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let abort: (() => void) | undefined;
		try {
			const result = await Promise.race([
				environment.decodingInfo(config),
				new Promise<null>((resolve) => {
					timer = setTimeout(() => resolve(null), timeoutMs);
				}),
				new Promise<never>((_, reject) => {
					abort = () =>
						reject(
							signal?.reason ?? new DOMException("Cancelled", "AbortError"),
						);
					signal?.addEventListener("abort", abort, { once: true });
					if (signal?.aborted) abort();
				}),
			]);
			signal?.throwIfAborted();
			if (!result) return { ...base, reason: "query-timeout" };
			return {
				...base,
				status: result.supported ? "supported" : "unsupported",
				reason: result.supported ? "browser-supported" : "browser-rejected",
				smooth: result.smooth,
			};
		} finally {
			clearTimeout(timer);
			if (abort) signal?.removeEventListener("abort", abort);
		}
	} catch {
		signal?.throwIfAborted();
		return { ...base, reason: "query-failed" };
	}
}
export async function queryCapabilities(
	queries: CompatibilityQuery[],
	signal?: AbortSignal,
	fresh = false,
): Promise<CompatibilityEvidence[]> {
	const environment = browserEnvironment();
	return Promise.all(
		queries.map(async (query) => {
			const key = JSON.stringify(query);
			const cached = cache.get(key);
			if (!fresh && cached) return { ...cached, id: query.id };
			const result = await queryCapability(query, environment, signal);
			signal?.throwIfAborted();
			if (["browser-supported", "browser-rejected"].includes(result.reason)) {
				cache.set(key, result);
				const oldest = cache.keys().next().value;
				if (cache.size > 64 && oldest !== undefined) cache.delete(oldest);
			}
			return result;
		}),
	);
}
