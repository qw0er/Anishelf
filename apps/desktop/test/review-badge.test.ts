import { afterEach, expect, test, vi } from "vitest";
import {
	DesktopBadge,
	isReviewMutationPath,
	ReviewBadgeMonitor,
	type ReviewBadgeServer,
} from "../src/main/native/review-badge.js";

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

test("isReviewMutationPath matches catalog endpoints that alter pending reviews", () => {
	expect(isReviewMutationPath("/api/catalog/confirmations")).toBe(true);
	expect(isReviewMutationPath("/api/catalog/reviews/abc-123/reject")).toBe(
		true,
	);
	expect(isReviewMutationPath("/api/catalog/reviews/abc-123/remove")).toBe(
		true,
	);
	expect(isReviewMutationPath("/api/catalog/reviews/abc-123/reidentify")).toBe(
		true,
	);
	expect(isReviewMutationPath("/api/catalog/reviews")).toBe(false);
	expect(isReviewMutationPath("/api/catalog/reviews/summary")).toBe(false);
	expect(isReviewMutationPath("/api/catalog/reviews/abc/extra/reject")).toBe(
		false,
	);
});

test("DesktopBadge applies counts on darwin and linux, deduplicates, and resets on dispose", () => {
	const setBadgeCount = vi.fn(() => true);
	const darwin = new DesktopBadge({ platform: "darwin", setBadgeCount });
	darwin.setCount(3);
	darwin.setCount(3);
	darwin.setCount(-4);
	darwin.setCount(2.9);
	expect(setBadgeCount.mock.calls).toEqual([[3], [0], [2]]);
	darwin.dispose();
	expect(setBadgeCount).toHaveBeenLastCalledWith(0);

	// Ignored after dispose
	darwin.setCount(5);
	expect(setBadgeCount).toHaveBeenCalledTimes(4);

	setBadgeCount.mockClear();
	const win = new DesktopBadge({ platform: "win32", setBadgeCount });
	win.setCount(4);
	win.dispose();
	expect(setBadgeCount).not.toHaveBeenCalled();

	const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	const unsupportedLinux = new DesktopBadge({
		platform: "linux",
		setBadgeCount: vi.fn(() => false),
	});
	unsupportedLinux.setCount(1);
	unsupportedLinux.setCount(2);
	expect(
		debug.mock.calls.filter(
			([event]) => event === "desktop.badge_update_unsupported",
		),
	).toHaveLength(1);

	const throwing = new DesktopBadge({
		platform: "linux",
		setBadgeCount: vi.fn(() => {
			throw new Error("dbus failed");
		}),
	});
	throwing.setCount(1);
	expect(warn).toHaveBeenCalledWith(
		"desktop.badge_update_failed",
		expect.objectContaining({ count: 1, error: expect.any(Error) }),
	);
});

test("ReviewBadgeMonitor polls periodically, deduplicates in-flight refreshes, and queues one trailing refresh", async () => {
	vi.useFakeTimers();
	const onCountChange = vi.fn();
	const first = deferred<Response>();
	const fetch = vi
		.fn<() => Promise<Response>>()
		.mockImplementationOnce(() => first.promise)
		.mockResolvedValueOnce(Response.json({ pending: 5 }))
		.mockResolvedValueOnce(Response.json({ pending: 1 }));
	const server: ReviewBadgeServer = {
		origin: "http://127.0.0.1:3000",
		authorization: () => "Bearer token-1",
	};

	const monitor = new ReviewBadgeMonitor({
		server: () => server,
		fetch,
		onCountChange,
		pollIntervalMs: 30_000,
	});
	monitor.start();
	expect(fetch).toHaveBeenCalledTimes(1);

	// Trigger multiple refreshes while the first is still in flight; only one trailing poll should run.
	monitor.refresh();
	monitor.refresh();
	expect(fetch).toHaveBeenCalledTimes(1);

	first.resolve(Response.json({ pending: 3 }));
	await vi.advanceTimersByTimeAsync(0);
	expect(fetch).toHaveBeenCalledTimes(2);
	expect(onCountChange.mock.calls).toEqual([[3], [5]]);

	await vi.advanceTimersByTimeAsync(30_000);
	expect(fetch).toHaveBeenCalledTimes(3);
	expect(onCountChange).toHaveBeenLastCalledWith(1);

	monitor.dispose();
	expect(onCountChange).toHaveBeenLastCalledWith(0);
	await vi.advanceTimersByTimeAsync(30_000);
	expect(fetch).toHaveBeenCalledTimes(3);
});

test("ReviewBadgeMonitor handles missing tokens, 401/404, transient errors, invalid JSON, and server switches", async () => {
	const onCountChange = vi.fn();
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	const info = vi.spyOn(console, "info").mockImplementation(() => {});
	let token: string | undefined = "Bearer token-1";
	let origin = "https://old.example.test";

	const stale = deferred<Response>();
	const fetch = vi
		.fn<() => Promise<Response>>()
		// 1: valid count 4
		.mockResolvedValueOnce(Response.json({ pending: 4 }))
		// 2: 500 transient error (keeps count 4)
		.mockResolvedValueOnce(new Response(null, { status: 500 }))
		// 3: invalid payload (keeps count 4)
		.mockResolvedValueOnce(Response.json({ pending: "bad" }))
		// 4: 401 unauthorized (clears count to 0)
		.mockResolvedValueOnce(new Response(null, { status: 401 }))
		// 5: 404 unsupported origin (clears count and caches unsupportedOrigin)
		.mockResolvedValueOnce(new Response(null, { status: 404 }))
		// 6: stale request before switching servers
		.mockImplementationOnce(() => stale.promise)
		// 7: new server returns 2
		.mockResolvedValueOnce(Response.json({ pending: 2 }));

	const monitor = new ReviewBadgeMonitor({
		server: () => ({ origin, authorization: () => token }),
		fetch,
		onCountChange,
	});

	monitor.refresh();
	await vi.waitFor(() => expect(onCountChange).toHaveBeenCalledWith(4));

	monitor.refresh();
	await vi.waitFor(() =>
		expect(warn).toHaveBeenCalledWith(
			"desktop.review_badge_poll_failed",
			expect.objectContaining({ origin, status: 500 }),
		),
	);
	expect(onCountChange).toHaveBeenCalledTimes(1);

	monitor.refresh();
	await vi.waitFor(() =>
		expect(warn).toHaveBeenCalledWith("desktop.review_badge_invalid_response"),
	);
	expect(onCountChange).toHaveBeenCalledTimes(1);

	monitor.refresh();
	await vi.waitFor(() => expect(onCountChange).toHaveBeenLastCalledWith(0));

	monitor.refresh();
	await vi.waitFor(() =>
		expect(info).toHaveBeenCalledWith(
			"desktop.review_badge_endpoint_unavailable",
			{ origin },
		),
	);
	// Cached 404 avoids extra fetch on the same origin until resetForServer().
	monitor.refresh();
	await Promise.resolve();
	expect(fetch).toHaveBeenCalledTimes(5);

	// Resetting clears cached 404; missing token yields 0 without fetching.
	token = undefined;
	monitor.resetForServer();
	expect(fetch).toHaveBeenCalledTimes(5);

	// Start in-flight request, then switch server before it settles.
	token = "Bearer token-2";
	monitor.refresh();
	expect(fetch).toHaveBeenCalledTimes(6);

	origin = "https://new.example.test";
	monitor.resetForServer();
	stale.resolve(Response.json({ pending: 99 }));
	await vi.waitFor(() => expect(onCountChange).toHaveBeenLastCalledWith(2));
	expect(onCountChange).not.toHaveBeenCalledWith(99);

	monitor.dispose();
});
