import { describe, expect, test } from "vitest";
import type { AutoPreparationPreset } from "../../../../src/contracts/auto-preparation.js";
import {
	acceptsMedia,
	matchesPreset,
	planAutomaticPreparation,
	presetFingerprint,
	selectAutomaticAudio,
} from "../../../../src/modules/media/automatic-preparation/planning.js";
import { builtinAutoPreparationPresets } from "../../../../src/modules/system/configuration/domain/auto-preparation.js";
import { builtinTranscodeProfiles } from "../../../../src/modules/system/configuration/public.js";
import { acceptsStream } from "../../../../src/platform/media/acceptance-policy.js";
import type { MediaInfo } from "../../../../src/platform/media/model.js";
import { parseMediaInfo } from "../../../../src/platform/media/tools.js";
import { required } from "./support.js";

const source = {
	fileId: "file_test",
	scopeId: "root",
	relativePath: "Anime/episode.mkv",
	sourceVersion: "v1",
};
function info(
	container: MediaInfo["container"] = "matroska",
	codec = "h264",
): MediaInfo {
	return parseMediaInfo(
		JSON.stringify({
			format: { format_name: container ?? "matroska", duration: "2" },
			streams: [
				{
					index: 0,
					codec_type: "video",
					codec_name: codec,
					pix_fmt: "yuv420p",
					width: 1920,
					height: 1080,
					avg_frame_rate: "24/1",
					profile: codec === "h264" ? "High" : "Profile 0",
					level: 41,
				},
				{
					index: 1,
					codec_type: "audio",
					codec_name: "aac",
					profile: "LC",
					channels: 6,
					sample_rate: "48000",
					tags: { language: "jpn" },
					disposition: { default: 1 },
				},
				{
					index: 3,
					codec_type: "audio",
					codec_name: "pcm_s16le",
					channels: 2,
					sample_rate: "48000",
					tags: { language: "eng" },
				},
			],
		}),
		container,
	);
}
const preset = builtinAutoPreparationPresets[0] as AutoPreparationPreset;
const profile = {
	...required(builtinTranscodeProfiles[0]),
	copyCompatibleStreams: true,
};

test.each(["h264", "vp9"])(
	"accepts original %s with any audio and all tracks",
	(codec) => {
		expect(
			planAutomaticPreparation(source, info("mp4", codec), preset, profile)
				.kind,
		).toBe("playable");
	},
);
test.each(["h264", "vp9"])(
	"Web accepts 10-bit SDR %s while Conservative requires 8-bit",
	(codec) => {
		const media = info("mp4", codec);
		const video = required(media.streams[0]);
		video.pixelFormat = "yuv420p10le";
		video.bitDepth = 10;
		video.colorTransfer = "bt709";
		expect(acceptsStream(video, preset.accept?.video)).toBe("accepted");
		expect(
			acceptsStream(
				video,
				required(builtinAutoPreparationPresets[1]).accept?.video,
			),
		).toBe("rejected");
		expect(planAutomaticPreparation(source, media, preset, profile).kind).toBe(
			"playable",
		);
	},
);
test("plans remux with individual audio copy and encoding, independent of browser evidence", () => {
	const plan = planAutomaticPreparation(source, info(), preset, profile);
	expect(plan).toMatchObject({
		kind: "processing-required",
		mode: "transcode-audio",
		execution: {
			audioStreamIndices: [1, 3],
			plan: {
				video: { action: "copy" },
				audioTracks: [
					{ sourceIndex: 1, execution: { action: "copy" }, default: true },
					{ sourceIndex: 3, execution: { action: "encode", codec: "aac" } },
				],
			},
		},
	});
});
test("remuxes accepted audio without encoding and encodes rejected video", () => {
	const media = info();
	media.streams = media.streams.slice(0, 2);
	expect(
		planAutomaticPreparation(source, media, preset, profile),
	).toMatchObject({ kind: "processing-required", mode: "remux" });
	required(media.streams[0]).codec = "hevc";
	expect(
		planAutomaticPreparation(source, media, preset, profile),
	).toMatchObject({ kind: "processing-required", mode: "transcode-video" });
});
test("unknown source color facts still block conversion; omitted audio constraints remain unrestricted", () => {
	const media = info();
	required(media.streams[0]).pixelFormat = null;
	expect(
		planAutomaticPreparation(source, media, preset, profile),
	).toMatchObject({ kind: "blocked", reason: "hdr-conversion-unverified" });
	expect(
		acceptsStream({ ...required(media.streams[1]), codec: null }, []),
	).toBe("accepted");
});
test("matching HDR streams require verified conversion when preset acceptance rejects them", () => {
	const media = info();
	required(media.streams[0]).hdr.pq = true;
	expect(
		planAutomaticPreparation(source, media, preset, profile),
	).toMatchObject({ kind: "blocked", reason: "hdr-conversion-unverified" });
	const hdrPreset = {
		...preset,
		accept: {
			...preset.accept,
			video: [{ codecs: ["h264"], dynamicRanges: ["hdr10" as const] }],
		},
	};
	expect(
		planAutomaticPreparation(source, media, hdrPreset, profile),
	).toMatchObject({
		kind: "processing-required",
		execution: { plan: { video: { action: "copy" } } },
	});
});
test("candidate lists use OR, fields use AND, and profiles are normalized", () => {
	const video = required(info().streams[0]);
	expect(
		acceptsStream(video, [
			{ codecs: ["vp9"], pixelFormats: ["yuv420p"] },
			{ codecs: ["h264"], profiles: ["high"], maxLevel: "4.1" },
		]),
	).toBe("accepted");
	expect(acceptsStream(video, [{ codecs: ["h264"], maxLevel: "4.0" }])).toBe(
		"rejected",
	);
	expect(acceptsStream(video, [{ codecs: ["h264"], maxWidth: 1280 }])).toBe(
		"rejected",
	);
});
test("output settings must meet acceptance, without implicit profile overrides", () => {
	const media = info();
	const constrained = {
		...preset,
		accept: { ...preset.accept, video: [{ codecs: ["h264"], maxHeight: 720 }] },
	};
	expect(
		planAutomaticPreparation(source, media, constrained, profile),
	).toMatchObject({ kind: "blocked", reason: "output-video-rejected" });
	expect(
		planAutomaticPreparation(source, media, constrained, {
			...profile,
			video: { ...profile.video, maxHeight: 720 },
		}),
	).toMatchObject({
		kind: "processing-required",
		execution: { plan: { video: { action: "encode" } } },
	});
});
test("path exclusions and viewing state filter originals", () => {
	const filtered = {
		...preset,
		match: {
			rootIds: ["root"],
			include: ["Anime/**"],
			exclude: ["**/Extras/**"],
			viewingStates: ["unwatched" as const],
		},
	};
	expect(matchesPreset(filtered, source, "unwatched")).toBe(true);
	expect(matchesPreset(filtered, source, "completed")).toBe(false);
	expect(
		matchesPreset(
			filtered,
			{ ...source, relativePath: "Anime/Extras/a.mkv" },
			"unwatched",
		),
	).toBe(false);
	expect(presetFingerprint(preset)).toBe(
		presetFingerprint({ ...preset, name: "Renamed", description: "New text" }),
	);
});
describe("audio selection", () => {
	test("defaults to all, supports default and none", () => {
		expect(selectAutomaticAudio(info(), preset)?.map((s) => s.index)).toEqual([
			1, 3,
		]);
		expect(
			selectAutomaticAudio(info(), {
				...preset,
				audio: { selection: "default" },
			})?.map((s) => s.index),
		).toEqual([1]);
		expect(
			selectAutomaticAudio(info(), { ...preset, audio: { selection: "none" } }),
		).toEqual([]);
	});
	test("languages keeps all matching tracks with explicit fallback", () => {
		const language = {
			...preset,
			audio: { selection: "languages" as const, languages: ["eng"] },
		};
		expect(selectAutomaticAudio(info(), language)?.map((s) => s.index)).toEqual(
			[3],
		);
		expect(
			selectAutomaticAudio(info(), {
				...language,
				audio: { ...language.audio, languages: ["fra"], fallback: "skip" },
			}),
		).toBeNull();
	});
	test("handles video-only input and validates asset descriptions", () => {
		const media = info("mp4");
		media.streams = media.streams.filter((s) => s.type === "video");
		expect(planAutomaticPreparation(source, media, preset, profile).kind).toBe(
			"playable",
		);
		expect(acceptsMedia(media, preset)).toBe(true);
		required(media.streams[0]).codec = "hevc";
		expect(acceptsMedia(media, preset)).toBe(false);
	});
});

test("explicit color filters defer dynamic-range acceptance to the actual output", () => {
	const media = info();
	required(media.streams[0]).hdr.pq = true;
	const result = planAutomaticPreparation(source, media, preset, {
		...profile,
		copyCompatibleStreams: false,
		video: { ...profile.video, filters: ["tonemap=tonemap=mobius"] },
	});
	expect(result).toMatchObject({
		kind: "processing-required",
		execution: {
			plan: { video: { action: "encode" }, acceptance: preset.accept },
		},
	});
});

test("target matches remux H264/AAC with compatibility copying disabled", () => {
	const media = info();
	media.streams = media.streams.slice(0, 2);
	const plan = planAutomaticPreparation(source, media, preset, {
		...profile,
		copyCompatibleStreams: false,
	});
	expect(plan).toMatchObject({
		kind: "processing-required",
		mode: "remux",
		reasons: { video: "profile-matched", audio: "profile-matched" },
		execution: {
			plan: {
				container: "mp4",
				video: { action: "copy" },
				audioTracks: [{ sourceIndex: 1, execution: { action: "copy" } }],
				filters: [],
			},
		},
	});
});

test("target matching independently copies AAC and encodes PCM", () => {
	const plan = planAutomaticPreparation(source, info(), preset, {
		...profile,
		copyCompatibleStreams: false,
	});
	expect(plan).toMatchObject({
		kind: "processing-required",
		mode: "transcode-audio",
		execution: {
			plan: {
				video: { action: "copy" },
				audioTracks: [
					{ sourceIndex: 1, execution: { action: "copy" } },
					{ sourceIndex: 3, execution: { action: "encode", codec: "aac" } },
				],
			},
		},
	});
});

test("missing metadata matters only when the target explicitly constrains it", () => {
	const media = info();
	media.streams = media.streams.slice(0, 2);
	const audio = required(media.streams[1]);
	audio.profile = null;
	audio.channels = null;
	audio.sampleRate = null;
	const target = {
		...profile,
		copyCompatibleStreams: false,
		audio: { encoder: "aac", codec: "aac", options: { b: "192k" } },
	};
	expect(planAutomaticPreparation(source, media, preset, target)).toMatchObject(
		{ kind: "processing-required", mode: "remux" },
	);
	expect(
		planAutomaticPreparation(source, media, preset, {
			...target,
			audio: { ...target.audio, channels: 2, sampleRate: 48000 },
		}),
	).toMatchObject({
		kind: "processing-required",
		mode: "transcode-audio",
		execution: {
			plan: {
				audioTracks: [
					{
						sourceIndex: 1,
						execution: { action: "encode" },
						parameters: { channels: 2, sampleRate: 48000 },
					},
				],
			},
		},
	});
});

test("matching output still cannot violate a declared automatic acceptance constraint", () => {
	const media = info();
	media.streams = media.streams.slice(0, 2);
	const constrained = {
		...preset,
		accept: { ...preset.accept, audio: [{ codecs: ["aac"], maxChannels: 2 }] },
	};
	expect(
		planAutomaticPreparation(source, media, constrained, {
			...profile,
			copyCompatibleStreams: false,
		}),
	).toMatchObject({ kind: "blocked", reason: "output-audio-rejected" });
	expect(
		planAutomaticPreparation(source, media, constrained, {
			...profile,
			copyCompatibleStreams: false,
			audio: { ...profile.audio, channels: 2 },
		}),
	).toMatchObject({ kind: "processing-required", mode: "transcode-audio" });
});

test.each(["Main", null])(
	"automatic acceptance falls back to encoding video profile %s",
	(sourceProfile) => {
		const media = info();
		media.streams = media.streams.slice(0, 2);
		required(media.streams[0]).profile = sourceProfile;
		const constrained = {
			...preset,
			accept: {
				...preset.accept,
				video: [{ codecs: ["h264"], profiles: ["high"] }],
			},
		};
		const target = { ...profile, copyCompatibleStreams: false };
		const result = planAutomaticPreparation(source, media, constrained, target);
		expect(result).toMatchObject({
			kind: "processing-required",
			mode: "transcode-video",
			execution: {
				plan: {
					video: { action: "encode" },
					videoParameters: { options: { profile: "high" } },
					acceptance: constrained.accept,
				},
			},
		});
		expect(
			planAutomaticPreparation(source, media, constrained, {
				...target,
				video: { encoder: "copy", codec: "h264" },
			}),
		).toMatchObject({
			kind: "blocked",
			reason: "forced-video-copy-unavailable",
		});
	},
);

test.each(["HE-AAC", null])(
	"automatic acceptance falls back to encoding audio profile %s per track",
	(sourceProfile) => {
		const media = info();
		media.streams.push({
			...required(media.streams[1]),
			index: 4,
			profile: sourceProfile,
			default: false,
		});
		const constrained = {
			...preset,
			accept: {
				...preset.accept,
				audio: [{ codecs: ["aac"], profiles: ["lc"] }],
			},
		};
		const target = { ...profile, copyCompatibleStreams: false };
		const result = planAutomaticPreparation(source, media, constrained, target);
		expect(result).toMatchObject({
			kind: "processing-required",
			mode: "transcode-audio",
			execution: {
				plan: {
					video: { action: "copy" },
					audioTracks: [
						{ sourceIndex: 1, execution: { action: "copy" } },
						{ sourceIndex: 3, execution: { action: "encode" } },
						{
							sourceIndex: 4,
							execution: { action: "encode" },
							parameters: { options: { profile: "aac_low" } },
						},
					],
					acceptance: constrained.accept,
				},
			},
		});
		// Exclude the unrelated PCM track so this assertion tests AAC acceptance alone.
		media.streams = media.streams.filter((stream) => stream.index !== 3);
		expect(
			planAutomaticPreparation(source, media, constrained, {
				...target,
				audio: { encoder: "copy", codec: "aac" },
			}),
		).toMatchObject({
			kind: "blocked",
			reason: "forced-audio-copy-unavailable",
		});
	},
);
