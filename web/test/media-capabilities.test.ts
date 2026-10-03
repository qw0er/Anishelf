// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import type { CompatibilityQuery } from "../src/api/contracts.js";
import { queryCapability } from "../src/features/playback/capabilities.js";

const query: CompatibilityQuery = {
	id: "original-video",
	type: "file",
	contentType: 'video/mp4; codecs="avc1.640028"',
	audio: null,
	video: {
		index: 0,
		kind: "video",
		codec: "h264",
		codecString: "avc1.640028",
		profile: "High",
		pixelFormat: "yuv420p",
		bitDepth: 8,
		hdr: false,
		width: 1920,
		height: 1080,
		frameRate: 24,
		bitrate: 1000000,
		sampleRate: null,
		channels: null,
	},
};
test.each([
	["", "unsupported"],
	["maybe", "unknown"],
	["probably", "supported"],
])("preserves canPlayType %s", async (raw, status) => {
	expect(
		(await queryCapability(query, { canPlayType: () => raw })).status,
	).toBe(status);
});
test("MSE support is independent of native support", async () => {
	expect(
		(
			await queryCapability(
				{ ...query, type: "media-source" },
				{ canPlayType: () => "probably", isTypeSupported: () => false },
			)
		).status,
	).toBe("unsupported");
	expect(
		(
			await queryCapability(
				{ ...query, type: "media-source" },
				{ canPlayType: () => "probably" },
			)
		).reason,
	).toBe("api-unavailable");
});
test("exact decoding configuration retains performance separately", async () => {
	const decodingInfo = vi.fn().mockResolvedValue({
		supported: true,
		smooth: false,
		powerEfficient: false,
	});
	const result = await queryCapability(query, {
		canPlayType: () => "maybe",
		decodingInfo,
	});
	expect(result).toMatchObject({
		status: "supported",
		smooth: false,
		powerEfficient: false,
	});
	expect(decodingInfo).toHaveBeenCalledWith({
		type: "file",
		video: {
			contentType: query.contentType,
			width: 1920,
			height: 1080,
			bitrate: 1000000,
			framerate: 24,
		},
	});
});
test("missing metadata is not invented; query failures and timeouts remain unknown", async () => {
	const decodingInfo = vi
		.fn()
		.mockRejectedValue(new Error("unsupported query API"));
	expect(
		(
			await queryCapability(query, {
				canPlayType: () => "probably",
				decodingInfo,
			})
		).reason,
	).toBe("query-failed");
	expect(
		(
			await queryCapability(
				query,
				{
					canPlayType: () => "probably",
					decodingInfo: () => new Promise(() => {}),
				},
				undefined,
				5,
			)
		).reason,
	).toBe("query-timeout");
	if (!query.video) throw new Error("fixture");
	decodingInfo.mockClear();
	await queryCapability(
		{ ...query, video: { ...query.video, bitrate: null } },
		{ canPlayType: () => "maybe", decodingInfo },
	);
	expect(decodingInfo).not.toHaveBeenCalled();
	expect(
		(
			await queryCapability(
				{ ...query, contentType: null },
				{ canPlayType: () => "probably" },
			)
		).status,
	).toBe("unknown");
});
test("abort releases pending browser query immediately", async () => {
	const controller = new AbortController();
	const pending = queryCapability(
		query,
		{
			canPlayType: () => "probably",
			decodingInfo: () => new Promise(() => {}),
		},
		controller.signal,
	);
	controller.abort();
	await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
