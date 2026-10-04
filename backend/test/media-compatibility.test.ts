import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";
import { createHttpApp } from "../src/bootstrap/http.js";
import { createLibraryModule } from "../src/bootstrap/library.js";
import type {
	CompatibilityEvidence,
	CompatibilityInspection,
} from "../src/contracts/http.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";
import { MediaCompatibilityApplication } from "../src/modules/media-compatibility/application/compatibility.js";
import { describeCompatibility } from "../src/modules/media-compatibility/application/description.js";
import { planCompatibility } from "../src/modules/media-compatibility/domain/planner.js";
import { MediaInspectionApplication } from "../src/modules/media-inspection/application/inspection.js";
import { codecDescriptor } from "../src/platform/media/codec-descriptor.js";
import { type MediaInfo, MediaToolError } from "../src/platform/media/index.js";
import { MediaTools, parseMediaInfo } from "../src/platform/media/tools.js";
import { settingsStore } from "./settings-store.js";

function dump(hex: string) {
	return `\n00000000: ${hex.match(/.{1,4}/g)?.join(" ")}  ....\n`;
}
function media(): MediaInfo {
	return parseMediaInfo(
		JSON.stringify({
			format: { format_name: "mov,mp4", duration: "10" },
			streams: [
				{
					index: 0,
					codec_type: "video",
					codec_name: "h264",
					extradata: dump("01640028ffe100"),
					profile: "High",
					width: 1920,
					height: 1080,
					pix_fmt: "yuv420p",
					avg_frame_rate: "24/1",
					bit_rate: "1000000",
					disposition: { default: 1 },
				},
				{
					index: 1,
					codec_type: "audio",
					codec_name: "aac",
					profile: "LC",
					extradata: dump("1210"),
					sample_rate: "48000",
					channels: 2,
					bit_rate: "128000",
				},
			],
		}),
		"mp4",
	);
}
function description() {
	return describeCompatibility("file", "version", media());
}
function reports(
	d: CompatibilityInspection,
	overrides: Record<string, CompatibilityEvidence["status"]> = {},
): CompatibilityEvidence[] {
	return d.queries.map((q) => {
		const status =
			overrides[q.id] ??
			overrides[q.id.replace(/-(mp4|webm)$/, "")] ??
			"supported";
		return {
			id: q.id,
			status,
			reason:
				status === "supported"
					? "browser-supported"
					: status === "unsupported"
						? "browser-rejected"
						: "browser-uncertain",
			smooth: null,
			powerEfficient: null,
		};
	});
}
test("reads exact AVC constraints and AAC object type; never guesses missing initialization", () => {
	expect(media().streams.map((s) => s.codecString)).toEqual([
		"avc1.640028",
		"mp4a.40.2",
	]);
	expect(
		codecDescriptor({ codec_name: "h264", profile: "High", level: 40 }),
	).toBeNull();
	expect(
		codecDescriptor({
			codec_name: "aac",
			profile: "HE-AAC",
			extradata: dump("1210"),
		}),
	).toBeNull();
	expect(
		codecDescriptor({
			codec_name: "h264",
			extradata: dump("0000000167640028aabb"),
		}),
	).toBe("avc1.640028");
	expect(
		codecDescriptor({
			codec_name: "hevc",
			extradata: dump("0101600000009000000000005df000fcfdf8f800000f03"),
		}),
	).toBe("hvc1.1.6.L93.90");
	expect(
		codecDescriptor({ codec_name: "av1", extradata: dump("810c0c00") }),
	).toBe("av01.0.12M.08");
	expect(codecDescriptor({ codec_name: "av1", extradata: "bad" })).toBeNull();
});
test.each([
	[{}, "direct"],
	[{ original: "unsupported", "original-container": "unsupported" }, "remux"],
	[{ original: "unsupported", "file-audio": "unsupported" }, "transcode-audio"],
	[{ original: "unsupported", "file-video": "unsupported" }, "transcode-video"],
	[
		{
			original: "unsupported",
			"file-video": "unsupported",
			"file-audio": "unsupported",
		},
		"transcode",
	],
	[{ original: "unknown", "file-video": "unknown" }, "unknown"],
] as const)("plans necessary processing %j", (overrides, mode) => {
	const d = description();
	const result = planCompatibility(d, reports(d, overrides));
	expect(result.plans[0]?.mode).toBe(mode);
	expect(result.plans.map((plan) => plan.target)).toEqual([
		"file",
		"media-source",
	]);
	expect(result).not.toHaveProperty("processing");
	for (const plan of result.plans) {
		expect(plan).not.toHaveProperty("execution");
		expect(plan).not.toHaveProperty("outputVideo");
		expect(plan).not.toHaveProperty("outputAudio");
	}
});
test("missing descriptions override optimistic client claims, missing audio is valid", () => {
	const info = media();
	info.streams = info.streams.slice(0, 1);
	let d = describeCompatibility("file", "version", info);
	expect(planCompatibility(d, reports(d)).plans[0]?.audioAction).toBe("none");
	if (info.streams[0]) info.streams[0].codecString = null;
	d = describeCompatibility("file", "version", info);
	expect(planCompatibility(d, reports(d)).direct.status).toBe("unknown");
	expect(planCompatibility(d, []).plans[0]?.mode).toBe("unknown");
});
test("selects default streams, excludes covers and guards native multitrack selection", () => {
	const info = media();
	const video = info.streams[0];
	if (!video) throw new Error("fixture");
	info.streams.unshift({ ...video, index: 9, attachedPicture: true });
	info.streams.push({ ...video, index: 4, default: false });
	const d = describeCompatibility("file", "version", info);
	expect(d.video?.index).toBe(0);
	expect(d.multipleTracks).toBe(true);
	expect(planCompatibility(d, reports(d)).direct.reason).toBe(
		"native-track-selection-uncertain",
	);
});
test("HDR encoding remains a recommendation and performance never forces encoding", () => {
	const d = description();
	if (!d.video) throw new Error("fixture");
	d.video.hdr = true;
	const result = planCompatibility(
		d,
		reports(d, { original: "unsupported", "file-video": "unsupported" }),
	);
	expect(result.plans[0]?.mode).toBe("transcode-video");
	expect(result.plans[0]).not.toHaveProperty("execution");
	expect(result.warnings).toContain("hdr-display-unverified");
	const plain = description();
	const evidence = reports(plain);
	if (evidence[0]) evidence[0].smooth = false;
	expect(planCompatibility(plain, evidence).plans[0]?.mode).toBe("direct");
	expect(planCompatibility(plain, evidence).warnings).toContain(
		"playback-may-not-be-smooth",
	);
});
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(cleanup.splice(0).map((fn) => fn()));
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "anishelf-compatibility-"));
	await writeFile(join(root, "video.mp4"), "source");
	const logger = pino({ enabled: false });
	const index = new LibraryIndex();
	const library = createLibraryModule({
		index,
		configuration: settingsStore(root),
		logger,
	});
	await library.startScan();
	await library.waitForCompletion();
	const file = [...index.snapshot.entriesById.values()].find(
		(e) => e.kind === "file",
	);
	if (!file) throw new Error("fixture missing");
	const probe = vi.fn().mockResolvedValue(media());
	const inspection = new MediaInspectionApplication({
		sources: library.sources,
		tools: { probe },
	});
	const compatibility = new MediaCompatibilityApplication({
		inspection,
		sources: library.sources,
	});
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 3000 },
		logger,
		library,
		compatibility,
	});
	app.addHook("onError", async (_request, _reply, error) => {
		logger.error({ err: error });
	});
	cleanup.push(async () => {
		await app.close();
		await inspection.close();
		await rm(root, { recursive: true, force: true });
	});
	return { app, probe, fileId: file.id, root, sources: library.sources };
}
test("HTTP negotiation uses shared probes, returns safe descriptors and rejects stale sources", async () => {
	const { app, probe, fileId, root } = await fixture();
	const url = `/api/files/${fileId}/compatibility`;
	const response = await app.inject({
		url,
		headers: { host: "127.0.0.1:3000" },
	});
	expect(response.statusCode).toBe(200);
	const d = response.json<CompatibilityInspection>();
	expect(response.headers["cache-control"]).toBe("no-store");
	expect(response.body).not.toContain(root);
	expect(response.body).not.toContain("extradata");
	const body = { sourceVersion: d.sourceVersion, evidence: reports(d) };
	const checked = await app.inject({
		method: "POST",
		url,
		headers: { host: "127.0.0.1:3000" },
		payload: body,
	});
	expect(checked.statusCode).toBe(200);
	expect(checked.json().direct.status).toBe("supported");
	expect(probe).toHaveBeenCalledTimes(1);
	for (const evidence of [
		[{ ...body.evidence[0], id: "arbitrary" }],
		[body.evidence[0], body.evidence[0]],
		[{ ...body.evidence[0], status: "unsupported" }],
	]) {
		expect(
			(
				await app.inject({
					method: "POST",
					headers: { host: "127.0.0.1:3000" },
					url,
					payload: { ...body, evidence },
				})
			).statusCode,
		).toBe(400);
	}
	await writeFile(join(root, "video.mp4"), "replacement source");
	expect(
		(
			await app.inject({
				method: "POST",
				url,
				headers: { host: "127.0.0.1:3000" },
				payload: body,
			})
		).statusCode,
	).toBe(409);
});
test("unavailable probe produces retryable inspection error without blocking media delivery", async () => {
	const { app, probe, fileId } = await fixture();
	probe.mockRejectedValue(
		new MediaToolError("TOOL_UNAVAILABLE", "secret executable path"),
	);
	const response = await app.inject({
		url: `/api/files/${fileId}/compatibility`,
		headers: { host: "127.0.0.1:3000" },
	});
	expect(response.statusCode).toBe(503);
	expect(response.json().error.code).toBe("MEDIA_INSPECTION_UNAVAILABLE");
	expect(response.body).not.toContain("secret");
	expect(
		(
			await app.inject({
				url: `/api/media/${fileId}`,
				headers: { host: "127.0.0.1:3000" },
			})
		).statusCode,
	).toBe(200);
});

test("checks only unchanged source streams without inventing encoded output", () => {
	const d = description();
	expect(d.rulesVersion).toBe("2");
	expect(d.queries.length).toBeLessThanOrEqual(16);
	expect(d.queries.some((query) => query.id.includes("encoded"))).toBe(false);
	for (const query of d.queries) {
		if (query.video) expect(query.video).toEqual(d.video);
		if (query.audio) expect(query.audio).toEqual(d.audio);
	}
	const result = planCompatibility(
		d,
		reports(d, { original: "unsupported", "file-video": "unsupported" }),
	);
	expect(result.plans[0]).toMatchObject({
		mode: "transcode-video",
		videoAction: "encode",
		audioAction: "copy",
		reason: "video-encoding-required",
	});
	expect(JSON.stringify(result.plans)).not.toMatch(
		/libx264|aac|yuv420p|crf|encoder|muxer|execution|outputVideo|outputAudio/,
	);
});

test("file and media-source recommendations use independent browser evidence", () => {
	const d = description();
	const result = planCompatibility(
		d,
		reports(d, { "media-source-audio": "unsupported" }),
	);
	expect(result.plans[0]?.mode).toBe("direct");
	expect(result.plans[1]).toMatchObject({
		mode: "transcode-audio",
		audioAction: "encode",
	});
});

test("accepts unchanged WebM streams without forcing MP4 or H.264/AAC output", () => {
	const info = media();
	const video = info.streams[0];
	const audio = info.streams[1];
	if (!video || !audio) throw new Error("fixture");
	video.codec = "vp9";
	video.codecString = "vp9";
	audio.codec = "opus";
	audio.codecString = "opus";
	const d = describeCompatibility("file", "version", info);
	const evidence = reports(d, {
		original: "unsupported",
		"file-video-mp4": "unsupported",
		"file-audio-mp4": "unsupported",
		"file-combined-mp4": "unsupported",
	});
	const result = planCompatibility(d, evidence);
	expect(result.plans[0]).toMatchObject({
		mode: "remux",
		videoAction: "copy",
		audioAction: "copy",
	});
	expect(result.plans[0]).not.toHaveProperty("container");
	expect(result.plans[0]).not.toHaveProperty("codec");
});

test("missing candidate evidence stays unknown, separate stream acceptance does not certify packaging", () => {
	const d = description();
	let evidence = reports(d, {
		original: "unsupported",
		"file-video-mp4": "unsupported",
		"file-video-webm": "unknown",
	});
	expect(planCompatibility(d, evidence).plans[0]?.mode).toBe("unknown");
	evidence = reports(d, {
		original: "unsupported",
		"file-combined": "unsupported",
	});
	expect(planCompatibility(d, evidence).plans[0]).toMatchObject({
		mode: "unknown",
		videoAction: "copy",
		audioAction: "copy",
		reason: "stream-combination-unverified",
	});
});

test("server enumeration is independent of planning and its HTTP endpoint is removed", async () => {
	const capabilities = vi
		.spyOn(MediaTools.prototype, "capabilities")
		.mockRejectedValue(
			new Error("server enumeration must not run during planning"),
		);
	const { app, probe, fileId } = await fixture();
	const headers = { host: "127.0.0.1:3000" };
	const url = `/api/files/${fileId}/compatibility`;
	const d = (
		await app.inject({ url, headers })
	).json<CompatibilityInspection>();
	const response = await app.inject({
		method: "POST",
		url,
		headers,
		payload: {
			sourceVersion: d.sourceVersion,
			evidence: reports(d, {
				original: "unsupported",
				"file-audio": "unsupported",
			}),
		},
	});
	expect(response.statusCode).toBe(200);
	expect(response.json().plans[0].mode).toBe("transcode-audio");
	expect(response.json()).not.toHaveProperty("processing");
	expect(capabilities).not.toHaveBeenCalled();
	probe.mockClear();
	expect(
		(await app.inject({ url: "/api/media/capabilities", headers })).statusCode,
	).toBe(404);
	expect(probe).not.toHaveBeenCalled();
});

test("rejects obsolete encoded-output reports and revalidates the source before returning the plan", async () => {
	const { app, fileId, root, sources } = await fixture();
	const headers = { host: "127.0.0.1:3000" };
	const url = `/api/files/${fileId}/compatibility`;
	const d = (
		await app.inject({ url, headers })
	).json<CompatibilityInspection>();
	const evidence = reports(d);
	const first = evidence[0];
	if (!first) throw new Error("fixture");
	expect(
		(
			await app.inject({
				method: "POST",
				url,
				headers,
				payload: {
					sourceVersion: d.sourceVersion,
					evidence: [{ ...first, id: "mp4-encoded-video" }],
				},
			})
		).statusCode,
	).toBe(400);
	const revalidate = sources.revalidateSource.bind(sources);
	vi.spyOn(sources, "revalidateSource").mockImplementationOnce(
		async (source) => {
			await writeFile(join(root, "video.mp4"), "replacement during planning");
			return revalidate(source);
		},
	);
	expect(
		(
			await app.inject({
				method: "POST",
				url,
				headers,
				payload: { sourceVersion: d.sourceVersion, evidence },
			})
		).statusCode,
	).toBe(409);
});
