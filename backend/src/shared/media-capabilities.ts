/** Internal FFmpeg build inventory; no HTTP or browser contract. */
export const mediaCapabilityKinds = [
	"codecs",
	"encoders",
	"decoders",
	"muxers",
	"demuxers",
	"filters",
	"bitstreamFilters",
	"protocols",
	"devices",
	"pixelFormats",
	"sampleFormats",
	"hardwareAccelerations",
] as const;

export type MediaCapabilityKind = (typeof mediaCapabilityKinds)[number];
export interface MediaCapabilityEntry {
	name: string;
	description: string;
	flags: string;
	codec: string | null;
	mediaType: "video" | "audio" | "subtitle" | "data" | "attachment" | null;
}
export interface MediaCapabilityInventory {
	status: "ready" | "failed" | "unavailable" | "unknown";
	entries: MediaCapabilityEntry[];
	error: string | null;
}
export interface ServerMediaCapabilities {
	scope: "build";
	runtimeValidation: "unverified";
	detectedAtMs: number | null;
	status: "ready" | "partial" | "failed" | "unavailable" | "unknown";
	tools: Record<
		"ffmpeg" | "ffprobe",
		{ available: boolean | null; version: string | null }
	>;
	inventory: Record<MediaCapabilityKind, MediaCapabilityInventory>;
}

function unknownInventory(): MediaCapabilityInventory {
	return { status: "unknown", entries: [], error: null };
}

export function unknownMediaCapabilities(): ServerMediaCapabilities {
	return {
		scope: "build",
		runtimeValidation: "unverified",
		detectedAtMs: null,
		status: "unknown",
		tools: {
			ffmpeg: { available: null, version: null },
			ffprobe: { available: null, version: null },
		},
		inventory: {
			codecs: unknownInventory(),
			encoders: unknownInventory(),
			decoders: unknownInventory(),
			muxers: unknownInventory(),
			demuxers: unknownInventory(),
			filters: unknownInventory(),
			bitstreamFilters: unknownInventory(),
			protocols: unknownInventory(),
			devices: unknownInventory(),
			pixelFormats: unknownInventory(),
			sampleFormats: unknownInventory(),
			hardwareAccelerations: unknownInventory(),
		},
	};
}

/** null means enumeration failed or was not performed, not confirmed absence. */
export function hasMediaCapability(
	inventory: MediaCapabilityInventory,
	name: string,
): boolean | null {
	if (inventory.status !== "ready") return null;
	return inventory.entries.some((entry) => entry.name === name);
}
