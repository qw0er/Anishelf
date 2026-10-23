/** Decode FFprobe's hex dump without including its ASCII column. Never publish raw data. */
function initializationData(value: unknown): Buffer {
	if (typeof value !== "string" || value.length > 65536) return Buffer.alloc(0);
	const hex = value
		.split("\n")
		.flatMap((line) => {
			const match = /^[0-9a-f]{8}: ([0-9a-f ]+?)(?: {2}|$)/i.exec(line.trim());
			return match?.[1]?.replaceAll(" ", "") ?? [];
		})
		.join("");
	return Buffer.from(hex, "hex");
}
export function codecDescriptor(
	stream: Record<string, unknown>,
): string | null {
	const data = initializationData(stream.extradata);
	switch (stream.codec_name) {
		case "h264": {
			// AVCDecoderConfigurationRecord retains profile, constraint flags and level exactly.
			if (
				data.length >= 7 &&
				data[0] === 1 &&
				(data.readUInt8(4) & 0xfc) === 0xfc
			)
				return `${stream.codec_tag_string === "avc3" ? "avc3" : "avc1"}.${data.subarray(1, 4).toString("hex")}`;
			// Annex B SPS: NAL header followed by the same three bytes.
			for (let i = 0; i + 4 < data.length; i++) {
				const start =
					data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1
						? i + 3
						: data[i] === 0 &&
								data[i + 1] === 0 &&
								data[i + 2] === 0 &&
								data[i + 3] === 1
							? i + 4
							: -1;
				if (
					start >= 0 &&
					start + 4 <= data.length &&
					(data.readUInt8(start) & 31) === 7
				)
					return `avc1.${data.subarray(start + 1, start + 4).toString("hex")}`;
			}
			return null;
		}
		case "hevc": {
			if (data.length < 23 || data[0] !== 1) return null;
			const profile = data.readUInt8(1);
			let compatibility = 0;
			const flags = data.readUInt32BE(2);
			for (let i = 0; i < 32; i++)
				compatibility = (compatibility * 2 + ((flags >>> i) & 1)) >>> 0;
			const constraints = [...data.subarray(6, 12)];
			while (constraints.at(-1) === 0) constraints.pop();
			const suffix = constraints
				.map((value) => value.toString(16).toUpperCase())
				.join(".");
			const tag = stream.codec_tag_string === "hev1" ? "hev1" : "hvc1";
			return `${tag}.${["", "A", "B", "C"][profile >> 6]}${profile & 31}.${compatibility.toString(16).toUpperCase()}.${profile & 32 ? "H" : "L"}${data[12]}${suffix ? `.${suffix}` : ""}`;
		}
		case "av1": {
			// AV1CodecConfigurationRecord's mandatory codec-string fields.
			if (data.length < 4 || data[0] !== 0x81) return null;
			const profile = data.readUInt8(1) >> 5;
			const level = data.readUInt8(1) & 31;
			const depth =
				data.readUInt8(2) & 0x40 ? (data.readUInt8(2) & 0x20 ? 12 : 10) : 8;
			return `av01.${profile}.${String(level).padStart(2, "0")}${data.readUInt8(2) & 0x80 ? "H" : "M"}.${String(depth).padStart(2, "0")}`;
		}
		case "aac": {
			if (data.length < 2) return null;
			let objectType = data.readUInt8(0) >> 3;
			if (objectType === 31)
				objectType =
					32 + ((data.readUInt8(0) & 7) << 3) + (data.readUInt8(1) >> 5);
			// Only explicit LC/HE signaling is queried; implicit extensions need fuller parsing.
			return objectType === 2 && stream.profile === "LC"
				? "mp4a.40.2"
				: objectType === 5 && stream.profile === "HE-AAC"
					? "mp4a.40.5"
					: objectType === 29 && stream.profile === "HE-AACv2"
						? "mp4a.40.29"
						: null;
		}
		case "vp9":
			return stream.profile === "Profile 0" && stream.pix_fmt === "yuv420p"
				? "vp9"
				: null;
		case "vp8":
			return "vp8";
		case "opus":
			return "opus";
		case "vorbis":
			return "vorbis";
		case "mp3":
			return "mp4a.6B";
		case "ac3":
			return "ac-3";
		case "eac3":
			return "ec-3";
		default:
			return null;
	}
}
