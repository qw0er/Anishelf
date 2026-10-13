import { codecDescriptor } from "./codec-descriptor.js";
import { MediaToolError } from "./errors.js";
import type {
	HdrSideData,
	MediaContainer,
	MediaInfo,
	MediaStream,
} from "./model.js";
export function probeRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new MediaToolError(
			"INVALID_MEDIA",
			"FFprobe returned an invalid media descriptor.",
		);
	return value as Record<string, unknown>;
}
function text(value: unknown): string | null {
	return typeof value === "string" &&
		value.trim() !== "" &&
		!/^(N\/A|unknown|unspecified)$/i.test(value)
		? value
		: null;
}
function number(value: unknown): number | null {
	if (typeof value !== "number" && typeof value !== "string") return null;
	if (value === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function tags(value: unknown): Record<string, string> {
	if (value === undefined) return {};
	return Object.fromEntries(
		Object.entries(probeRecord(value)).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}
function rate(value: unknown): {
	frameRate: string | null;
	framesPerSecond: number | null;
} {
	const raw = text(value);
	const parts = raw?.match(/^(\d+)\/(\d+)$/);
	const fps = parts ? Number(parts[1]) / Number(parts[2]) : null;
	return fps !== null && Number.isFinite(fps) && fps > 0
		? { frameRate: raw, framesPerSecond: fps }
		: { frameRate: null, framesPerSecond: null };
}
export function parseMediaInfo(
	json: string,
	container: MediaContainer | null = null,
): MediaInfo {
	try {
		const root = probeRecord(JSON.parse(json));
		const format = probeRecord(root.format);
		if (!Array.isArray(root.streams)) throw new Error("Missing streams");
		const pixelDepths = new Map<string, number>();
		if (Array.isArray(root.pixel_formats)) {
			for (const value of root.pixel_formats) {
				const pixel = probeRecord(value);
				if (typeof pixel.name !== "string" || !Array.isArray(pixel.components))
					continue;
				const depths = pixel.components.map((component) =>
					number(probeRecord(component).bit_depth),
				);
				if (
					depths.length &&
					depths.every((depth): depth is number => depth !== null && depth > 0)
				)
					pixelDepths.set(pixel.name, Math.max(...depths));
			}
		}
		const streams: MediaStream[] = root.streams.map((value) => {
			const stream = probeRecord(value);
			const index = number(stream.index);
			if (
				index === null ||
				!Number.isSafeInteger(index) ||
				typeof stream.codec_type !== "string"
			)
				throw new Error("Invalid stream");
			const disposition =
				stream.disposition === undefined ? {} : probeRecord(stream.disposition);
			const sideData: HdrSideData[] = [];
			if (Array.isArray(stream.side_data_list)) {
				for (const value of stream.side_data_list) {
					const data = probeRecord(value);
					const type = text(data.side_data_type);
					if (
						!type ||
						!/mastering display|content light|dovi|dolby vision|smpte2094|hdr/i.test(
							type,
						)
					)
						continue;
					const values: Record<string, number | string> = {};
					for (const [key, value] of Object.entries(data)) {
						if (
							!/^(red_x|red_y|green_x|green_y|blue_x|blue_y|white_point_x|white_point_y|min_luminance|max_luminance|max_content|max_average|dv_version_major|dv_version_minor|dv_profile|dv_level|rpu_present_flag|el_present_flag|bl_present_flag|dv_bl_signal_compatibility_id)$/.test(
								key,
							)
						)
							continue;
						if (
							typeof value === "number" &&
							Number.isFinite(value) &&
							value >= 0
						)
							values[key] = value;
						else if (
							typeof value === "string" &&
							/^\d+(?:\.\d+|\/[1-9]\d*)?$/.test(value)
						)
							values[key] = value;
					}
					sideData.push({ type, values });
				}
			}
			const sideDataTypes = [...new Set(sideData.map((data) => data.type))];
			const rawDepth = number(stream.bits_per_raw_sample);
			return {
				index,
				type: stream.codec_type,
				codec: text(stream.codec_name),
				codecTag: text(stream.codec_tag_string),
				codecString: codecDescriptor(stream),
				profile: text(stream.profile),
				level: number(stream.level),
				bitDepth:
					stream.codec_type === "video"
						? rawDepth && rawDepth > 0
							? rawDepth
							: (pixelDepths.get(text(stream.pix_fmt) ?? "") ?? null)
						: null,
				colorRange: text(stream.color_range),
				colorSpace: text(stream.color_space),
				colorTransfer: text(stream.color_transfer),
				colorPrimaries: text(stream.color_primaries),
				hdr: {
					pq: stream.color_transfer === "smpte2084",
					hlg: stream.color_transfer === "arib-std-b67",
					sideDataTypes,
					sideData,
				},
				attachedPicture: number(disposition.attached_pic) === 1,
				width: number(stream.width),
				height: number(stream.height),
				pixelFormat: text(stream.pix_fmt),
				...rate(stream.avg_frame_rate),
				sampleRate: number(stream.sample_rate),
				channels: number(stream.channels),
				channelLayout: text(stream.channel_layout),
				duration: number(stream.duration),
				bitRate: number(stream.bit_rate),
				tags: tags(stream.tags),
				default: number(disposition.default) === 1,
				forced: number(disposition.forced) === 1,
			};
		});
		return {
			format: text(format.format_name),
			formatAliases: [
				...new Set(
					(text(format.format_name) ?? "")
						.split(",")
						.map((name) => name.trim().toLowerCase())
						.filter(Boolean),
				),
			],
			container,
			duration: number(format.duration),
			size: number(format.size),
			bitRate: number(format.bit_rate),
			tags: tags(format.tags),
			streams,
			chapters: (Array.isArray(root.chapters) ? root.chapters : [])
				.flatMap((value) => {
					if (!value || typeof value !== "object" || Array.isArray(value))
						return [];
					const chapter = probeRecord(value);
					const rawStart = chapter.start_time;
					const start =
						(typeof rawStart === "number" || typeof rawStart === "string") &&
						rawStart !== "" &&
						Number.isFinite(Number(rawStart))
							? Number(rawStart)
							: null;
					const end = number(chapter.end_time);
					const duration = number(format.duration);
					if (start === null || end === null) return [];
					const startMs = Math.round(Math.max(0, start) * 1000);
					const endMs = Math.round(
						Math.min(end, duration !== null && duration > 0 ? duration : end) *
							1000,
					);
					if (
						!Number.isSafeInteger(startMs) ||
						!Number.isSafeInteger(endMs) ||
						endMs <= startMs
					)
						return [];
					return [
						{
							title: text(
								chapter.tags &&
									typeof chapter.tags === "object" &&
									!Array.isArray(chapter.tags)
									? probeRecord(chapter.tags).title
									: null,
							),
							startMs,
							endMs,
						},
					];
				})
				.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs),
		};
	} catch (cause) {
		throw new MediaToolError(
			"INVALID_MEDIA",
			"FFprobe returned invalid media information.",
			{ cause },
		);
	}
}
