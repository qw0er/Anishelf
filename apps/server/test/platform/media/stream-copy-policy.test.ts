import { expect, test } from "vitest";
import type {
	AudioEncoding,
	VideoEncoding,
} from "../../../src/platform/media/encoding.js";
import {
	matchesAudioTarget,
	matchesVideoTarget,
} from "../../../src/platform/media/stream-copy-policy.js";

const video = {
	codec: "h264",
	profile: "High",
	level: 41,
	pixelFormat: "yuv420p",
	width: 1920,
	height: 1080,
	frameRate: 24,
};
const videoTarget: VideoEncoding = { encoder: "libx264", codec: "h264" };
const audio = { codec: "aac", profile: "LC", channels: 6, sampleRate: 48000 };
const audioTarget: AudioEncoding = { encoder: "aac", codec: "aac" };

test("codec always matches; encoder names and all options do not constrain copying", () => {
	expect(
		matchesVideoTarget(video, {
			...videoTarget,
			encoder: "h264_nvenc",
			options: {
				crf: 40,
				preset: "slow",
				tune: "animation",
				b: "1M",
				profile: "baseline",
				level: "3.1",
				"x264-params": "ref=3",
				fast: null,
			},
		}),
	).toBe(true);
	expect(
		matchesAudioTarget(audio, {
			...audioTarget,
			options: { b: "192k", profile: "aac_he" },
		}),
	).toBe(true);
	expect(matchesVideoTarget({ ...video, codec: "hevc" }, videoTarget)).toBe(
		false,
	);
	expect(matchesAudioTarget({ ...audio, codec: "opus" }, audioTarget)).toBe(
		false,
	);
	expect(matchesVideoTarget(video, { ...videoTarget, codec: "" })).toBe(false);
	expect(matchesAudioTarget({ ...audio, codec: null }, audioTarget)).toBe(
		false,
	);
});

test("omitted constraints do not require corresponding source metadata", () => {
	expect(
		matchesVideoTarget(
			{
				codec: "h264",
				pixelFormat: null,
				width: null,
				height: null,
				frameRate: null,
			},
			videoTarget,
		),
	).toBe(true);
	expect(
		matchesAudioTarget(
			{ codec: "aac", channels: null, sampleRate: null },
			audioTarget,
		),
	).toBe(true);
});

test.each([
	[{ pixelFormat: "yuv420p" }, {}, true],
	[{ pixelFormat: "yuv420p" }, { pixelFormat: "yuv420p10le" }, false],
	[{ pixelFormat: "yuv420p" }, { pixelFormat: null }, false],
	[{ options: { profile: "high" } }, {}, true],
	[{ options: { profile: "high" } }, { profile: "Main" }, true],
	[{ options: { profile: "high" } }, { profile: null }, true],
	[{ options: { level: "4.1" } }, {}, true],
	[{ options: { level: "4.1" } }, { level: 51 }, true],
	[{ options: { level: "4.1" } }, { level: null }, true],
	[{ options: { level: "auto" } }, {}, true],
	[{ maxWidth: 1920, maxHeight: 1080, maxFrameRate: 24 }, {}, true],
	[{ maxWidth: 1280 }, {}, false],
	[{ maxHeight: 720 }, {}, false],
	[{ maxFrameRate: 23 }, {}, false],
	[{ maxWidth: 1920 }, { width: null }, false],
	[{ maxHeight: 1080 }, { height: null }, false],
	[{ maxFrameRate: 24 }, { frameRate: null }, false],
	[{ filters: ["null"] }, {}, false],
] as const)(
	"checks only explicit video constraints %j against %j",
	(target, source, expected) => {
		expect(
			matchesVideoTarget(
				{ ...video, ...source },
				{ ...videoTarget, ...target },
			),
		).toBe(expected);
	},
);

test.each([
	[{ channels: 6 }, {}, true],
	[{ channels: 2 }, {}, false],
	[{ channels: 2 }, { channels: null }, false],
	[{ sampleRate: 48000 }, {}, true],
	[{ sampleRate: 44100 }, {}, false],
	[{ sampleRate: 48000 }, { sampleRate: null }, false],
	[{ options: { profile: "aac_low" } }, {}, true],
	[{ options: { profile: "aac_low" } }, { profile: "HE-AAC" }, true],
	[{ options: { profile: "aac_low" } }, { profile: null }, true],
	[{ options: { profile: "aac_he" } }, { profile: "HE-AAC" }, true],
	[{ filters: ["anull"] }, {}, false],
] as const)(
	"checks only explicit audio constraints %j against %j",
	(target, source, expected) => {
		expect(
			matchesAudioTarget(
				{ ...audio, ...source },
				{ ...audioTarget, ...target },
			),
		).toBe(expected);
	},
);
