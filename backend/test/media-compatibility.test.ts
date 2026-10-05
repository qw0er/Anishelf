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
import { builtinTranscodeProfiles } from "../src/modules/configuration/public.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";
import { MediaCompatibilityApplication } from "../src/modules/media-compatibility/application/compatibility.js";
import { describeOriginalMedia } from "../src/modules/media-compatibility/application/description.js";
import { checkDirectCompatibility } from "../src/modules/media-compatibility/domain/direct.js";
import type { OriginalMediaDescription } from "../src/modules/media-compatibility/domain/model.js";
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
	return describeOriginalMedia("file", "version", media());
}
function reports(
	d: Pick<CompatibilityInspection, "queries">,
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
test("original descriptions contain only source queries; missing codec initialization stays unknown", () => {
	const info = media();
	let d = describeOriginalMedia("file", "version", info);
	expect(d.queries.map((query) => query.id)).toEqual([
		"original-container",
		"original",
		"original-video",
		"original-audio",
	]);
	expect(checkDirectCompatibility(d, reports(d)).status).toBe("supported");
	if (info.streams[0]) info.streams[0].codecString = null;
	d = describeOriginalMedia("file", "version", info);
	expect(checkDirectCompatibility(d, reports(d)).status).toBe("unknown");
});
test("direct decisions retain no-video, missing-audio, multitrack and HDR guards", () => {
	const info = media();
	const video = info.streams[0];
	if (!video) throw new Error("fixture");
	info.streams = [video];
	expect(
		checkDirectCompatibility(
			describeOriginalMedia("file", "version", info),
			reports(description()),
		).status,
	).toBe("supported");
	info.streams.push({ ...video, index: 4, default: false });
	let d = describeOriginalMedia("file", "version", info);
	expect(checkDirectCompatibility(d, reports(d)).reason).toBe(
		"native-track-selection-uncertain",
	);
	const hdr: OriginalMediaDescription = {
		...description(),
		video: {
			...(description().video as NonNullable<CompatibilityInspection["video"]>),
			hdr: true,
		},
	};
	expect(checkDirectCompatibility(hdr, reports(hdr)).reason).toBe(
		"hdr-display-unverified",
	);
	d = { ...description(), video: null };
	expect(checkDirectCompatibility(d, reports(d)).reason).toBe(
		"no-video-stream",
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
		profiles: builtinTranscodeProfiles,
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
	const body = {
		sourceVersion: d.sourceVersion,
		descriptionId: d.descriptionId,
		output: null,
		evidence: reports(d),
	};
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
			descriptionId: d.descriptionId,
			output: null,
			evidence: reports(d, {
				original: "unsupported",
				"file-audio": "unsupported",
			}),
		},
	});
	expect(response.statusCode).toBe(200);
	expect(response.json()).not.toHaveProperty("plans");
	expect(response.json().output).toBeNull();
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
					descriptionId: d.descriptionId,
					output: null,
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
				payload: {
					sourceVersion: d.sourceVersion,
					descriptionId: d.descriptionId,
					output: null,
					evidence,
				},
			})
		).statusCode,
	).toBe(409);
});

test("unified HTTP contracts reject obsolete payloads and isolate output contexts", async () => {
	const { app, fileId, root } = await fixture();
	const url = `/api/files/${fileId}/compatibility`;
	const headers = { host: "127.0.0.1:3000" };
	const original = (
		await app.inject({ url, headers })
	).json<CompatibilityInspection>();
	expect(original.rulesVersion).toBe("3");
	expect(original.output).toBeNull();
	expect(
		original.queries.every((query) => query.id.startsWith("original")),
	).toBe(true);
	expect(
		(
			await app.inject({
				method: "POST",
				url,
				headers,
				payload: {
					sourceVersion: original.sourceVersion,
					evidence: reports(original),
				},
			})
		).statusCode,
	).toBe(400);
	const response = await app.inject({
		url: `${url}?profileId=builtin%3Abalanced&target=file`,
		headers,
	});
	expect(response.statusCode).toBe(200);
	const output = response.json<CompatibilityInspection>();
	expect(output.descriptionId).not.toBe(original.descriptionId);
	expect(output.output?.profileId).toBe("builtin:balanced");
	const payload = {
		sourceVersion: output.sourceVersion,
		descriptionId: output.descriptionId,
		output: { profileId: "builtin:balanced", target: "file" },
		evidence: reports(output),
	};
	const checked = await app.inject({ method: "POST", url, headers, payload });
	expect(checked.statusCode).toBe(200);
	expect(checked.json().output.combinations["copy-copy"]).toBe("supported");
	expect(checked.body).not.toContain(root);
	expect(checked.body).not.toMatch(
		/canonicalRoot|libx264|encoder|crf|preset|plans/,
	);
	expect(
		(
			await app.inject({
				method: "POST",
				url,
				headers,
				payload: { ...payload, output: null },
			})
		).statusCode,
	).toBe(400);
	expect(
		(
			await app.inject({
				method: "POST",
				url,
				headers,
				payload: {
					...payload,
					output: { profileId: "builtin:balanced", target: "media-source" },
				},
			})
		).statusCode,
	).toBe(400);
	expect(
		(await app.inject({ url: `${url}?target=media-source`, headers }))
			.statusCode,
	).toBe(400);
	expect(
		(await app.inject({ url: `${url}?profileId=custom%3Amissing`, headers }))
			.statusCode,
	).toBe(400);
});

test("HTTP audio selection parses comma-separated indexes and binds POST evidence", async () => {
	const { app, fileId } = await fixture();
	const url = `/api/files/${fileId}/compatibility`;
	for (const selection of ["1", ""]) {
		const response = await app.inject({
			url: `${url}?audioStreamIndices=${selection}`,
			headers: { host: "127.0.0.1:3000" },
		});
		expect(response.statusCode).toBe(200);
		const description = response.json<CompatibilityInspection>();
		expect(
			description.selectedAudioTracks?.map((track) => track.index),
		).toEqual(selection ? [1] : []);
		const checked = await app.inject({
			method: "POST",
			url,
			headers: { host: "127.0.0.1:3000" },
			payload: {
				sourceVersion: description.sourceVersion,
				descriptionId: description.descriptionId,
				output: null,
				audioStreamIndices: selection ? [1] : [],
				evidence: reports(description),
			},
		});
		expect(checked.statusCode).toBe(200);
		expect(checked.json().direct.reason).toBe(
			"audio-selection-requires-processing",
		);
	}
	for (const selection of ["0", "1,1", "-1", "garbage", "99"]) {
		const response = await app.inject({
			url: `${url}?audioStreamIndices=${selection}`,
			headers: { host: "127.0.0.1:3000" },
		});
		expect(response.statusCode).toBe(400);
	}
});
