import { create } from "fontkit";

export const subtitleFontLimits = {
	maximumBytes: 24 * 1024 * 1024,
	maximumSetBytes: 64 * 1024 * 1024,
	maximumCount: 32,
};

export interface SubtitleFontStream {
	index: number;
	sizeBytes: number;
}

interface AttachmentStream {
	index: number;
	codec_type: string;
	extradata_size: number;
	extradata?: string;
	tags?: { filename?: string; mimetype?: string };
}

function streams(output: string): AttachmentStream[] {
	return JSON.parse(output).streams ?? [];
}

export function subtitleFontStreams(output: string): SubtitleFontStream[] {
	const fonts: SubtitleFontStream[] = [];
	let total = 0;
	for (const stream of streams(output)) {
		if (fonts.length === subtitleFontLimits.maximumCount) break;
		const size = stream.extradata_size;
		if (
			stream.codec_type !== "attachment" ||
			!Number.isSafeInteger(stream.index) ||
			stream.index < 0 ||
			!Number.isSafeInteger(size) ||
			size <= 0 ||
			size > subtitleFontLimits.maximumBytes ||
			total + size > subtitleFontLimits.maximumSetBytes ||
			!(
				/\.(ttf|otf)$/i.test(stream.tags?.filename ?? "") ||
				/^(?:font\/(?:ttf|otf|sfnt)|application\/(?:x-truetype-font|x-font-ttf|x-font-otf|vnd\.ms-opentype))$/i.test(
					stream.tags?.mimetype ?? "",
				)
			)
		)
			continue;
		total += size;
		fonts.push({ index: stream.index, sizeBytes: size });
	}
	return fonts;
}

export function subtitleFontBytes(output: string, font: SubtitleFontStream) {
	const stream = streams(output)[0];
	if (
		stream?.index !== font.index ||
		stream.codec_type !== "attachment" ||
		stream.extradata_size !== font.sizeBytes ||
		!stream.extradata
	)
		throw new Error("Invalid subtitle font stream.");
	const hex = stream.extradata
		.split("\n")
		.flatMap((line) => {
			const match = /^[0-9a-f]{8}: ([0-9a-f ]+?)(?: {2}|$)/i.exec(line.trim());
			return match?.[1]?.replaceAll(" ", "") ?? [];
		})
		.join("");
	const bytes = Buffer.from(hex, "hex");
	const signature = bytes.subarray(0, 4).toString("hex");
	if (
		bytes.length !== font.sizeBytes ||
		(signature !== "00010000" && signature !== "4f54544f")
	)
		throw new Error("Invalid subtitle font payload.");
	const parsed = create(bytes);
	if (
		!("familyName" in parsed) ||
		!parsed.familyName ||
		!parsed.characterSet.length
	)
		throw new Error("Invalid subtitle font tables.");
	return bytes;
}
