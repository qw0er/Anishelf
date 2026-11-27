import { EventEmitter } from "node:events";
import type { Session, WebContents } from "electron";
import { expect, test, vi } from "vitest";
import { downloadMedia, revealDownload } from "../src/main/native/download.js";
import { transferDownload } from "../src/main/native/download-transfer.js";

const { showItemInFolder } = vi.hoisted(() => ({
	showItemInFolder: vi.fn(),
}));
vi.mock("electron", () => ({ shell: { showItemInFolder } }));

const origin = "https://example.test";
const url = `${origin}/api/media/file_123?access_token=test-token`;
const id = "9cb14031-711d-4620-a6fd-8b0323221575";

function startDownload() {
	const session = new EventEmitter();
	const item = Object.assign(new EventEmitter(), {
		getURLChain: () => [url],
		getSavePath: vi.fn(() => ""),
		getPercentComplete: vi.fn(() => -1),
		setSaveDialogOptions: vi.fn(),
	});
	const send = vi.fn();
	const onProgress = vi.fn();
	const sender = {
		session,
		send,
		isDestroyed: () => false,
		downloadURL: () => session.emit("will-download", {}, item, sender),
	} as unknown as WebContents;
	const result = downloadMedia(
		sender,
		origin,
		url,
		"video.mkv",
		id,
		onProgress,
	);
	return { sender, item, send, onProgress, result };
}

test("reports progress after save selection and reveals the actual saved path", async () => {
	const { sender, item, send, onProgress, result } = startDownload();
	expect(item.setSaveDialogOptions).toHaveBeenCalledWith({
		defaultPath: "video.mkv",
	});
	item.emit("updated", {}, "progressing");
	expect(send).not.toHaveBeenCalled();
	expect(onProgress).not.toHaveBeenCalled();
	await expect(revealDownload(sender, id)).rejects.toThrow();

	item.getSavePath.mockReturnValue("/downloads/renamed.mkv");
	item.emit("updated", {}, "progressing");
	item.getPercentComplete.mockReturnValue(42);
	item.emit("updated", {}, "progressing");
	item.emit("updated", {}, "progressing");
	expect(send.mock.calls).toEqual([
		["desktop:download-progress", id, null],
		["desktop:download-progress", id, 42],
	]);
	expect(onProgress.mock.calls).toEqual([[null], [42]]);

	item.emit("done", {}, "completed");
	await expect(result).resolves.toBe(true);
	expect(onProgress).toHaveBeenLastCalledWith(undefined);
	expect(item.listenerCount("updated")).toBe(0);
	await revealDownload(sender, id);
	expect(showItemInFolder).toHaveBeenCalledWith("/downloads/renamed.mkv");
});

test("treats a cancelled save separately from an interrupted transfer", async () => {
	const cancelled = startDownload();
	cancelled.item.emit("done", {}, "cancelled");
	await expect(cancelled.result).resolves.toBe(false);
	expect(cancelled.onProgress).toHaveBeenLastCalledWith(undefined);

	const interrupted = startDownload();
	interrupted.item.emit("done", {}, "interrupted");
	await expect(interrupted.result).rejects.toThrow(/interrupted/);
	expect(interrupted.onProgress).toHaveBeenLastCalledWith(undefined);
});

test("keeps a manual save and a managed cache transfer independent", async () => {
	const manual = startDownload();
	const session = new EventEmitter();
	const managed = Object.assign(new EventEmitter(), {
		getURLChain: () => [url],
		getSavePath: () => "/cache/video.mkv.part",
		setSavePath: vi.fn(),
	});
	const progress = vi.fn();
	const cache = transferDownload({
		session: session as Session,
		url,
		begin: () => {
			session.emit("will-download", {}, managed, null);
		},
		matches: () => true,
		configure: (item) => item.setSavePath("/cache/video.mkv.part"),
		progress,
	});

	manual.item.getSavePath.mockReturnValue("/downloads/video.mkv");
	manual.item.getPercentComplete.mockReturnValue(18);
	manual.item.emit("updated", {}, "progressing");
	managed.emit("done", {}, "completed");
	manual.item.emit("done", {}, "completed");
	await expect(cache).resolves.toBe("/cache/video.mkv.part");
	await expect(manual.result).resolves.toBe(true);
	expect(managed.setSavePath).toHaveBeenCalledWith("/cache/video.mkv.part");
	expect(progress).toHaveBeenCalledWith(managed);
	expect(manual.send).toHaveBeenCalledExactlyOnceWith(
		"desktop:download-progress",
		id,
		18,
	);
});
