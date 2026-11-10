import pino from "pino";
import { beforeEach, expect, test, vi } from "vitest";
import { PlaybackSelectionApplication } from "../../../src/modules/playback/playback-selection/application/selection.js";
import { catalog, copyId, fileId } from "../../support/playback-assets.js";

let data = catalog();
const list = vi.fn(async () => structuredClone(data));
const application = new PlaybackSelectionApplication({
	assets: { list },
	logger: pino({ level: "silent" }),
});
beforeEach(() => {
	data = catalog();
	vi.clearAllMocks();
});
test("defaults to the original without browser evidence or preparation", async () => {
	const result = await application.select({ fileId });
	expect(result.active?.asset.kind).toBe("original");
	expect(result).not.toHaveProperty("compatibility");
});
test("binds the requested prepared bytes", async () => {
	const result = await application.select({ fileId, assetId: copyId });
	expect(result.active?.asset.id).toBe(copyId);
	expect(result.active?.audio?.sourceStreamIndex).toBe(1);
});
test("a missing explicit asset never falls back to the original", async () => {
	const result = await application.select({ fileId, assetId: "missing" });
	expect(result.active).toBeNull();
	expect(result.reason).toBe("asset-unavailable");
});
test("missing requested audio does not silently select another file", async () => {
	const result = await application.select({
		fileId,
		assetId: copyId,
		audioStreamIndex: 2,
	});
	expect(result.active).toBeNull();
	expect(result.reason).toBe("audio-track-missing");
});
test("rejects nonexistent source tracks", async () => {
	await expect(
		application.select({ fileId, audioStreamIndex: 999 }),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});
test("allows a direct original trial without server inspection", async () => {
	data.source.audioTracks = [];
	data.source.defaultAudioStreamIndex = null;
	data.assets = data.assets.filter((a) => a.kind === "original");
	for (const a of data.assets) {
		a.inspection = "unavailable";
		a.audioTracks = [];
		a.video = null;
	}
	expect((await application.select({ fileId })).active?.asset.kind).toBe(
		"original",
	);
});
test("source identity is passed through to the catalog", async () => {
	await application.select({ fileId, sourceVersion: "v1" });
	expect(list).toHaveBeenCalledWith(fileId, "v1");
});
