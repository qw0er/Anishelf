import { DomainError } from "../errors.js";

export type DeepReadonly<T> = T extends object
	? { readonly [K in keyof T]: DeepReadonly<T[K]> }
	: T;
export function freeze<T>(value: T): DeepReadonly<T> {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value as DeepReadonly<T>;
}

const subtitleFormats: Record<string, "vtt" | "srt" | "ass" | "ssa"> = {
	".vtt": "vtt",
	".srt": "srt",
	".ass": "ass",
	".ssa": "ssa",
};
const nativeSubtitleFormats: Record<string, "srt" | "ass" | "webvtt"> = {
	subrip: "srt",
	ass: "ass",
	ssa: "ass",
	webvtt: "webvtt",
};
const videoMimeTypes: Record<string, string> = {
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".webm": "video/webm",
	".mkv": "video/x-matroska",
};

const defaults = {
	library: {
		defaultScanIntervalMinutes: 60,
		maximumScanIntervalMinutes: 10080,
		concurrency: 8,
		warningMessageLimit: 5,
	},
	playback: {
		sessionIdleMs: 30 * 60 * 1000,
		maximumSessions: 1000,
		continueWatchingLimit: 20,
		historyLimit: 100,
		maximumListLimit: 100,
		candidateBatchSize: 100,
		nearEndMs: 30000,
		nearEndRatio: 0.05,
	},
	subtitles: {
		maximumCacheBytes: 256 * 1024 * 1024,
		maximumBytes: 10 * 1024 * 1024,
		formats: subtitleFormats,
		nativeFormats: nativeSubtitleFormats,
		textCodecs: ["subrip", "ass", "ssa", "webvtt", "mov_text", "text"],
	},
	media: {
		maximumProbeCacheEntries: 32,
		videoMimeTypes,
		detectionTimeoutMs: 5000,
		detectionMaximumBytes: 64 * 1024,
		executionTimeoutMs: 30000,
		extractionTimeoutMs: 60000,
		maximumOutputBytes: 10 * 1024 * 1024,
		diagnosticMaximumBytes: 4096,
	},
	runtime: {
		httpBodyMaximumBytes: 64 * 1024,
		databaseBusyTimeoutMs: 5000,
		shutdownTimeoutMs: 5000,
	},
	client: {
		progressSaveIntervalMs: 5000,
		playbackRequestTimeoutMs: 5000,
		subtitleInitializationTimeoutMs: 15000,
		subtitleMemoryMaximumBytes: 64 * 1024 * 1024,
	},
};

export type BuiltinPolicy = typeof defaults;
export const builtinPolicy = freeze(defaults);

/** Policies are program-owned. Validation also protects injected policies in tests. */
export function validatePolicy(policy: DeepReadonly<BuiltinPolicy>): void {
	for (const section of [
		"library",
		"playback",
		"subtitles",
		"media",
		"runtime",
		"client",
	] as const) {
		for (const [key, value] of Object.entries(policy[section])) {
			if (typeof value !== "number") continue;
			const valid =
				key === "nearEndRatio"
					? Number.isFinite(value) && value > 0 && value <= 1
					: Number.isSafeInteger(value) &&
						(key === "defaultScanIntervalMinutes" ? value >= 0 : value > 0);
			if (!valid || (key.endsWith("Ms") && value > 2147483647))
				throw new DomainError(
					"CONFIG_INVALID",
					`policy.${section}.${key} has an invalid value.`,
				);
		}
	}
	if (
		policy.library.defaultScanIntervalMinutes >
			policy.library.maximumScanIntervalMinutes ||
		policy.library.maximumScanIntervalMinutes * 60000 > 2147483647
	)
		throw new DomainError(
			"CONFIG_INVALID",
			"policy.library scan interval exceeds its allowed range.",
		);
	if (
		policy.playback.continueWatchingLimit > policy.playback.maximumListLimit ||
		policy.playback.historyLimit > policy.playback.maximumListLimit
	)
		throw new DomainError(
			"CONFIG_INVALID",
			"policy.playback default list limits exceed maximumListLimit.",
		);
	// Capability subsets may be narrowed, but policy cannot introduce missing adapters.
	for (const [extension, mime] of Object.entries(policy.media.videoMimeTypes))
		if (builtinPolicy.media.videoMimeTypes[extension] !== mime)
			throw new DomainError(
				"CONFIG_INVALID",
				`policy.media.videoMimeTypes.${extension} is unsupported.`,
			);
	for (const [extension, format] of Object.entries(policy.subtitles.formats))
		if (builtinPolicy.subtitles.formats[extension] !== format)
			throw new DomainError(
				"CONFIG_INVALID",
				`policy.subtitles.formats.${extension} is unsupported.`,
			);
	for (const [codec, format] of Object.entries(policy.subtitles.nativeFormats))
		if (builtinPolicy.subtitles.nativeFormats[codec] !== format)
			throw new DomainError(
				"CONFIG_INVALID",
				`policy.subtitles.nativeFormats.${codec} is unsupported.`,
			);
	for (const codec of policy.subtitles.textCodecs)
		if (!builtinPolicy.subtitles.textCodecs.includes(codec))
			throw new DomainError(
				"CONFIG_INVALID",
				`policy.subtitles.textCodecs: unsupported codec ${codec}.`,
			);
}
