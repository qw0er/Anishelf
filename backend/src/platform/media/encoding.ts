/** Typed encoder settings; transport validates its own representation. */
type VideoFields = { pixelFormat: string; maxHeight?: number };
type X26xPreset =
	| "ultrafast"
	| "superfast"
	| "veryfast"
	| "faster"
	| "fast"
	| "medium"
	| "slow"
	| "slower"
	| "veryslow";
export type VideoEncoding = VideoFields &
	(
		| { encoder: "libx264"; codec: "h264"; crf: number; preset: X26xPreset }
		| { encoder: "libx265"; codec: "hevc"; crf: number; preset: X26xPreset }
		| { encoder: "libsvtav1"; codec: "av1"; crf: number; preset: number }
		| { encoder: "libaom-av1"; codec: "av1"; crf: number; cpuUsed: number }
		| { encoder: "libvpx-vp9"; codec: "vp9"; crf: number; cpuUsed: number }
		| {
				encoder: "h264_nvenc" | "h264_qsv" | "h264_videotoolbox";
				codec: "h264";
				bitrateKbps: number;
		  }
		| {
				encoder: "hevc_nvenc" | "hevc_qsv" | "hevc_videotoolbox";
				codec: "hevc";
				bitrateKbps: number;
		  }
		| { encoder: "av1_nvenc" | "av1_qsv"; codec: "av1"; bitrateKbps: number }
	);
export type AudioEncoding = { channels: "preserve" | "stereo" } & (
	| { encoder: "aac"; codec: "aac"; bitrateKbps: number }
	| { encoder: "libopus"; codec: "opus"; bitrateKbps: number }
	| { encoder: "libvorbis"; codec: "vorbis"; bitrateKbps: number }
	| { encoder: "flac"; codec: "flac"; compressionLevel: number }
	| { encoder: "alac"; codec: "alac" }
	| { encoder: "pcm_s16le"; codec: "pcm_s16le" }
);
