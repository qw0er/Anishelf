import pino from "pino";
import { beforeEach, expect, test, vi } from "vitest";
import type { PlaybackSelectionRequest } from "../src/contracts/http.js";
import { PlaybackSelectionApplication } from "../src/modules/playback/playback-selection/application/selection.js";
import { DomainError } from "../src/shared/errors.js";
import { createHttpApp } from "./support/http.js";
import {
	asset,
	audio,
	catalog,
	copyId,
	fileId,
} from "./support/playback-assets.js";

let data = catalog();
const logger = pino({ level: "silent" });
const list = vi.fn(async (_fileId: string, version?: string) => {
	if (version && version !== data.source.sourceVersion)
		throw new DomainError("PLAYBACK_CONFLICT", "Source changed");
	return structuredClone(data);
});
let application: PlaybackSelectionApplication;
beforeEach(() => {
	vi.clearAllMocks();
	data = catalog();
	application = new PlaybackSelectionApplication({ assets: { list }, logger });
});
async function request(
	overrides: Partial<PlaybackSelectionRequest> = {},
): Promise<PlaybackSelectionRequest> {
	const input = { fileId, canSelectAudio: false, ...overrides };
	const options = await application.inspect(input);
	return {
		...input,
		sourceVersion: options.source.sourceVersion,
		evidence: options.assets.map((inspection) => ({
			assetId: inspection.asset.id,
			descriptionId: inspection.descriptionId,
			evidence: inspection.queries.map((query) => ({
				id: query.id,
				status: "supported",
				reason: "browser-supported",
				smooth: true,
			})),
		})),
	};
}
test("automatic audio chooses the existing Japanese-only copy, using its actual AAC description", async () => {
	const result = await application.select(await request());
	expect(result.resolvedAudioStreamIndex).toBe(1);
	expect(result.active?.asset.id).toBe(copyId);
	expect(result.active?.asset.audioTracks[0]?.stream.codec).toBe("aac");
	expect(result.choices[0]?.asset.audioTracks[0]?.stream.codec).toBe("opus");
	expect(result.active).not.toHaveProperty("resource");
	expect(result).not.toHaveProperty("compatibility");
});
test("an explicit English intent cannot silently select a Japanese copy", async () => {
	const result = await application.select(
		await request({ audioStreamIndex: 2 }),
	);
	expect(result.active).toBeNull();
	expect(
		result.choices.find((choice) => choice.asset.id === copyId)
			?.unavailableReason,
	).toBe("audio-track-missing");
});
test("source audio 2 maps to actual output audio 1", async () => {
	data.assets[1] = {
		...asset(),
		audioTracks: [{ stream: audio(1, "eng", "aac"), sourceStreamIndex: 2 }],
	};
	const result = await application.select(
		await request({ audioStreamIndex: 2 }),
	);
	expect(result.active?.audio).toEqual({
		streamIndex: 1,
		sourceStreamIndex: 2,
		position: 0,
	});
});
test("extra retained tracks do not reject a copy when native selection is available", async () => {
	data.assets[1] = {
		...asset(),
		audioTracks: [
			{ stream: audio(1, "eng", "aac"), sourceStreamIndex: 2 },
			{ stream: audio(2, "jpn", "aac"), sourceStreamIndex: 1 },
		],
	};
	const input = await request({
		audioStreamIndex: 1,
		canSelectAudio: true,
		assetId: copyId,
	});
	expect((await application.select(input)).active?.audio).toEqual({
		streamIndex: 2,
		sourceStreamIndex: 1,
		position: 1,
	});
	const unavailable = await application.select(
		await request({
			audioStreamIndex: 1,
			canSelectAudio: false,
			assetId: copyId,
			allowUnverified: true,
		}),
	);
	expect(unavailable.active).toBeNull();
});
test("the original is preferred when it can satisfy the audio intent", async () => {
	const original = data.assets[0];
	if (!original) throw new Error("Missing original");
	original.audioTracks = original.audioTracks.slice(0, 1);
	expect((await application.select(await request())).active?.asset.kind).toBe(
		"original",
	);
});
test("a pinned copy remains selected independently of task or profile preference", async () => {
	expect(
		(await application.select(await request({ assetId: copyId }))).active?.asset
			.id,
	).toBe(copyId);
	data.assets[1] = { ...asset(), profileId: "custom:removed" };
	expect(
		(await application.select(await request({ assetId: copyId }))).active?.asset
			.id,
	).toBe(copyId);
});
test("pending guidance follows the requested track and never yields a pending URL", async () => {
	data.assets = data.assets.slice(0, 1);
	data.pendingAudioSelections = [[1]];
	expect(await application.select(await request())).toMatchObject({
		active: null,
		pending: true,
		reason: "preparation-pending",
	});
	expect(
		(await application.select(await request({ audioStreamIndex: 2 }))).pending,
	).toBe(false);
});
test("explicit trial can attempt uncertain original bytes but cannot override a missing audio track", async () => {
	const trial = await application.select(
		await request({ assetId: fileId, allowUnverified: true }),
	);
	expect(trial.active?.asset.kind).toBe("original");
	expect(
		(
			await application.select(
				await request({
					assetId: copyId,
					audioStreamIndex: 2,
					allowUnverified: true,
				}),
			)
		).active,
	).toBeNull();
});
test("failed attempts exclude only the failed asset", async () => {
	const result = await application.select(
		await request({ failedResourceIds: [copyId] }),
	);
	expect(result.active).toBeNull();
	expect(
		result.choices.find((choice) => choice.asset.id === copyId)
			?.unavailableReason,
	).toBe("asset-playback-failed");
	expect(result.choices[0]?.compatibility.video.status).toBe("supported");
});
test("stale asset revisions, source versions and duplicate evidence are fenced", async () => {
	const stale = await request();
	data.assets[1] = { ...asset(), revision: "e".repeat(64) };
	await expect(application.select(stale)).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
	const duplicate = await request();
	const entry = duplicate.evidence[0];
	if (entry) duplicate.evidence.push(entry);
	await expect(application.select(duplicate)).rejects.toMatchObject({
		code: "INVALID_REQUEST",
	});
	const changed = await request();
	data.source.sourceVersion = "changed";
	await expect(application.select(changed)).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
});
test("a silent prepared asset can be explicitly played without a retention array", async () => {
	data.assets[1] = {
		...asset(),
		audioTracks: [],
		defaultAudioStreamIndex: null,
	};
	const result = await application.select(
		await request({ audioStreamIndex: null, assetId: copyId }),
	);
	expect(result.active?.asset.id).toBe(copyId);
	expect(result.active?.audio).toBeNull();
});
test("browser reports for an unavailable inspection do not manufacture a known video stream", async () => {
	data.assets = [
		{
			...asset(fileId),
			kind: "original",
			inspection: "unavailable",
			container: null,
			video: null,
			audioTracks: [],
			defaultAudioStreamIndex: null,
		},
	];
	data.source.audioTracks = [];
	data.source.defaultAudioStreamIndex = null;
	expect((await application.select(await request())).active).toBeNull();
	expect(
		(
			await application.select(
				await request({ assetId: fileId, allowUnverified: true }),
			)
		).active?.compatibility.overall.status,
	).toBe("unknown");
});
test("HTTP returns the current asset, preserves source identity, and rejects retention-array intent", async () => {
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 80 },
		logger,
		playbackSelection: application,
	});
	try {
		const response = await app.inject({
			method: "POST",
			url: "/api/playback/selection",
			payload: await request(),
		});
		expect(response.statusCode, response.body).toBe(200);
		expect(response.json().active.asset.audioTracks[0].stream.codec).toBe(
			"aac",
		);
		expect(response.body).not.toContain("scopeId");
		expect(response.body).not.toContain("profileFingerprint");
		const invalid = await app.inject({
			method: "POST",
			url: "/api/playback/options",
			payload: { fileId, canSelectAudio: false, audioStreamIndices: [1, 2] },
		});
		expect(invalid.statusCode).toBe(400);
	} finally {
		await app.close();
	}
});
test("candidate descriptions are bounded while explicitly selected assets retain priority", async () => {
	data.assets = [
		...data.assets,
		...Array.from({ length: 140 }, (_, index) => asset(`extra-${index}`)),
		asset("pinned"),
	];
	const result = await application.inspect({
		fileId,
		canSelectAudio: false,
		assetId: "pinned",
	});
	expect(result.assets).toHaveLength(128);
	expect(result.assets[0]?.asset.id).toBe("pinned");
});
