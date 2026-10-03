/** Browser-safe subtitle definitions; every format is declared once. */
const definitions = {
	vtt: {
		extension: ".vtt",
		mime: "text/vtt",
		prepared: "webvtt",
		styled: false,
		nativeCodec: "webvtt",
	},
	srt: {
		extension: ".srt",
		mime: "text/plain",
		prepared: "srt",
		styled: false,
		nativeCodec: "subrip",
	},
	ass: {
		extension: ".ass",
		mime: "text/plain",
		prepared: "ass",
		styled: true,
		nativeCodec: "ass",
	},
	ssa: {
		extension: ".ssa",
		mime: "text/plain",
		prepared: "ass",
		styled: true,
		nativeCodec: "ssa",
	},
} as const;
export type SubtitleFormat = keyof typeof definitions;
export type PreparedSubtitleFormat =
	(typeof definitions)[SubtitleFormat]["prepared"];
export const subtitleFormats = Object.freeze(
	Object.keys(definitions) as SubtitleFormat[],
);
export const preparedSubtitleFormats = Object.freeze([
	...new Set(Object.values(definitions).map((value) => value.prepared)),
] as [PreparedSubtitleFormat, ...PreparedSubtitleFormat[]]);
export const styledSubtitleFormats: readonly string[] = Object.freeze(
	subtitleFormats.filter((format) => definitions[format].styled),
);
export const subtitleMimeTypes = Object.freeze(
	Object.fromEntries(
		subtitleFormats.map((format) => [format, definitions[format].mime]),
	) as Record<SubtitleFormat, string>,
);
export const subtitleExtensionFormats: Readonly<
	Record<string, SubtitleFormat>
> = Object.freeze(
	Object.fromEntries(
		subtitleFormats.map((format) => [definitions[format].extension, format]),
	),
);
export const nativeSubtitleFormats: Readonly<
	Record<string, PreparedSubtitleFormat>
> = Object.freeze(
	Object.fromEntries(
		Object.values(definitions).map((value) => [
			value.nativeCodec,
			value.prepared,
		]),
	),
);
export const textSubtitleCodecs = Object.freeze([
	...Object.keys(nativeSubtitleFormats),
	"mov_text",
	"text",
]);
export function publicSubtitleFormat(
	format: PreparedSubtitleFormat,
): SubtitleFormat {
	return format === "webvtt" ? "vtt" : format;
}
export function preparedSubtitleFormat(
	format: SubtitleFormat,
): PreparedSubtitleFormat {
	return definitions[format].prepared;
}
