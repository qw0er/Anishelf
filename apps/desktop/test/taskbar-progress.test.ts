import type { OfflineCacheEntry } from "@anishelf/contracts/offline-cache";
import { expect, test, vi } from "vitest";
import {
	aggregateTaskbarProgress,
	offlineCacheTaskProgress,
	TaskbarProgress,
	type TaskbarProgressTarget,
} from "../src/main/native/taskbar-progress.js";

function createEntry(
	overrides: Partial<OfflineCacheEntry> = {},
): OfflineCacheEntry {
	return {
		id: "entry-1",
		server: "local",
		fileId: "file-1",
		sourceVersion: "v1",
		name: "Episode 1",
		episodes: [],
		status: "downloading",
		percent: 50,
		sizeBytes: 0,
		failure: null,
		playing: false,
		...overrides,
	};
}

function createTarget(destroyed = false) {
	let isDestroyed = destroyed;
	const setProgressBar = vi.fn();
	const target: TaskbarProgressTarget = {
		isDestroyed: () => isDestroyed,
		setProgressBar,
	};
	return {
		target,
		setProgressBar,
		destroy() {
			isDestroyed = true;
		},
	};
}

test("aggregateTaskbarProgress computes none, indeterminate, and averaged determinate states", () => {
	expect(aggregateTaskbarProgress([])).toEqual({ mode: "none", progress: -1 });
	expect(aggregateTaskbarProgress([null, null])).toEqual({
		mode: "indeterminate",
		progress: 2,
	});
	expect(aggregateTaskbarProgress([0.25, 0.75])).toEqual({
		mode: "normal",
		progress: 0.5,
	});
	expect(aggregateTaskbarProgress([null, 0.4, 0.8])).toEqual({
		mode: "normal",
		progress: 0.6,
	});
	expect(aggregateTaskbarProgress([-0.5, 1.5])).toEqual({
		mode: "normal",
		progress: 0.5,
	});
});

test("offlineCacheTaskProgress maps offline cache statuses", () => {
	expect(offlineCacheTaskProgress(null)).toBeUndefined();
	expect(
		offlineCacheTaskProgress(createEntry({ status: "queued" })),
	).toBeNull();
	expect(
		offlineCacheTaskProgress(createEntry({ status: "preparing" })),
	).toBeNull();
	expect(
		offlineCacheTaskProgress(
			createEntry({ status: "downloading", percent: null }),
		),
	).toBeNull();
	expect(
		offlineCacheTaskProgress(
			createEntry({ status: "downloading", percent: 42 }),
		),
	).toBe(0.42);
	expect(offlineCacheTaskProgress(createEntry({ status: "finalizing" }))).toBe(
		1,
	);
	expect(
		offlineCacheTaskProgress(createEntry({ status: "ready" })),
	).toBeUndefined();
	expect(
		offlineCacheTaskProgress(createEntry({ status: "failed" })),
	).toBeUndefined();
	expect(
		offlineCacheTaskProgress(createEntry({ status: "unavailable" })),
	).toBeUndefined();
});

test("TaskbarProgress updates attached windows across download and offline cache tasks", () => {
	const progress = new TaskbarProgress();
	const first = createTarget();
	progress.attach(first.target);

	progress.setOfflineCacheEntry(
		"cache-1",
		createEntry({ id: "cache-1", status: "preparing", percent: null }),
	);
	expect(first.setProgressBar).toHaveBeenLastCalledWith(2, {
		mode: "indeterminate",
	});

	progress.setOfflineCacheEntry(
		"cache-1",
		createEntry({ id: "cache-1", status: "downloading", percent: 40 }),
	);
	expect(first.setProgressBar).toHaveBeenLastCalledWith(0.4, {
		mode: "normal",
	});

	progress.setTask("download:1", 0.8);
	expect(first.setProgressBar).toHaveBeenLastCalledWith(0.6, {
		mode: "normal",
	});

	// Attaching a new window immediately receives the current active progress.
	const second = createTarget();
	progress.attach(second.target);
	expect(second.setProgressBar).toHaveBeenCalledWith(0.6, { mode: "normal" });

	// Refreshing a shown window re-applies active progress.
	first.setProgressBar.mockClear();
	progress.refresh(first.target);
	expect(first.setProgressBar).toHaveBeenCalledWith(0.6, { mode: "normal" });

	progress.setOfflineCacheEntry(
		"cache-1",
		createEntry({ id: "cache-1", status: "ready", percent: 100 }),
	);
	expect(first.setProgressBar).toHaveBeenLastCalledWith(0.8, {
		mode: "normal",
	});

	progress.clearTask("download:1");
	expect(first.setProgressBar).toHaveBeenLastCalledWith(-1);
	expect(second.setProgressBar).toHaveBeenLastCalledWith(-1);
});

test("TaskbarProgress skips destroyed targets, handles errors, and resets on dispose", () => {
	const progress = new TaskbarProgress();
	const failing = createTarget();
	failing.setProgressBar.mockImplementationOnce(() => {
		throw new Error("unsupported");
	});
	const destroyed = createTarget();
	const active = createTarget();
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

	progress.attach(failing.target);
	progress.attach(destroyed.target);
	progress.attach(active.target);
	destroyed.destroy();

	progress.setTask("download:1", 0.5);
	expect(warn).toHaveBeenCalledWith(
		"desktop.taskbar_progress_failed",
		expect.objectContaining({ mode: "normal" }),
	);
	expect(destroyed.setProgressBar).not.toHaveBeenCalled();
	expect(active.setProgressBar).toHaveBeenCalledWith(0.5, { mode: "normal" });

	progress.dispose();
	expect(active.setProgressBar).toHaveBeenLastCalledWith(-1);

	active.setProgressBar.mockClear();
	progress.setTask("download:2", 0.25);
	expect(active.setProgressBar).not.toHaveBeenCalled();

	warn.mockRestore();
});
