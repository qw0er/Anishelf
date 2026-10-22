import type { ExtractionEvidence } from "../identification/public.js";
import type { ReleaseAttributes } from "./public.js";

/** Release declarations only: never infer subtitle language from a group, title or site. */
export function releaseAttributes(
	evidence: ExtractionEvidence,
): ReleaseAttributes {
	const title = evidence.originalName.normalize("NFKC");
	const raw =
		evidence.inputs.find((input) => input.mode === "basename")?.elements ?? [];
	const values = (kind: string) =>
		raw
			.filter((element) => element.kind === kind)
			.map((element) => element.value);
	const languages = new Set<string>();
	const formats = new Set<string>();
	// Restrict supplementary language markers to annotations, not the work's title.
	const groups = new Set(
		values("release_group").map((value) => value.trim().toLowerCase()),
	);
	const annotations = [...title.matchAll(/\[([^\]]+)\]|\(([^)]+)\)/gu)]
		.map((match) => match[1] ?? match[2] ?? "")
		.filter((marker) => !groups.has(marker.trim().toLowerCase()));
	annotations.push(
		...[
			...title
				.replace(/\[[^\]]+\]|\([^)]*\)/gu, " ")
				.matchAll(
					/(?:简体|簡體|繁体|繁體|简繁日?|簡繁日?|简日|簡日|繁日|日文|英文|韩文|韓文)(?:字幕|内封字幕?|內封字幕?|内嵌字幕?|內嵌字幕?)/gu,
				),
		].map((match) => match[0]),
	);
	for (const marker of [
		...values("language").filter((value) =>
			/^(?:CHS|CHT|SC|TC)$/iu.test(value),
		),
		...annotations,
	]) {
		if (
			/dub(?:bed)?|配音|音轨|音軌/iu.test(marker) &&
			!/sub|字幕/iu.test(marker)
		)
			continue;
		if (
			/\b(?:CHS|SC|zh[-_]Hans)\b|简体|簡體|简繁|簡繁|简日|簡日/iu.test(marker)
		)
			languages.add("zh-Hans");
		if (/\b(?:CHT|TC|zh[-_]Hant)\b|繁体|繁體|简繁|簡繁|繁日/iu.test(marker))
			languages.add("zh-Hant");
		if (/\b(?:ENG|English|EN)\b|英文字幕/iu.test(marker)) languages.add("en");
		if (
			/\b(?:JPN|Japanese|JA)\b|日文字幕|[简繁簡]日|简繁日|簡繁日/iu.test(marker)
		)
			languages.add("ja");
		if (/\b(?:KOR|Korean|KO)\b|韩文字幕|韓文字幕/iu.test(marker))
			languages.add("ko");
		if (/内嵌|內嵌|硬字幕|\bhardsub(?:s)?\b/iu.test(marker))
			formats.add("hard");
		if (/内封|內封|软字幕|軟字幕|\bsoftsub(?:s)?\b/iu.test(marker))
			formats.add("soft");
		if (/外挂|外掛|\bexternal\s+sub(?:title)?s?\b/iu.test(marker))
			formats.add("external");
	}
	const terms = values("video_term").join(" ");
	const codecs = new Set<string>();
	if (/\b(?:AVC|H[ ._-]?264|x264)\b/iu.test(terms)) codecs.add("avc");
	if (/\b(?:HEVC|H[ ._-]?265|x265)\b/iu.test(terms)) codecs.add("hevc");
	if (/\bAV1\b/iu.test(terms)) codecs.add("av1");
	if (/\bVP9\b/iu.test(terms)) codecs.add("vp9");
	if (/\bMPEG[- ]?2\b/iu.test(terms)) codecs.add("mpeg2");
	if (/\b(?:MPEG[- ]?4|XviD|DivX)\b/iu.test(terms)) codecs.add("mpeg4");
	const resolutions = values("video_resolution").flatMap((value) => {
		if (/^4k$/iu.test(value)) return [2160];
		if (/^8k$/iu.test(value)) return [4320];
		const match = /^(?:\d+x)?(\d+)(?:[pi])?$/iu.exec(value);
		return match ? [Number(match[1])] : [];
	});
	const sources = new Set<string>();
	for (const source of values("source")) {
		if (/web/iu.test(source)) sources.add("web");
		if (/blu.?ray|bd(?:rip)?/iu.test(source)) sources.add("bluray");
		if (/hdtv/iu.test(source)) sources.add("hdtv");
		if (/dvd/iu.test(source)) sources.add("dvd");
	}
	return {
		subtitleLanguages: [...languages],
		subtitleFormats: [...formats],
		resolutions,
		videoCodecs: [...codecs],
		sources: [...sources],
		releaseGroups: [
			...new Set(
				values("release_group").flatMap((group) => [
					group,
					...group.split(/\s*[&＆+]\s*/u),
				]),
			),
		],
		revision:
			Number.isSafeInteger(Number(values("release_version")[0])) &&
			Number(values("release_version")[0]) > 0
				? Number(values("release_version")[0])
				: 1,
	};
}
