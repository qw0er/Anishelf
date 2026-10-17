// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useSessionCheck } from "../src/app/auth/use-session-check.js";
import { act, cleanup, renderHook } from "./query-test-utils.js";

const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	fetcher
		.mockReset()
		.mockResolvedValue(
			new Response(JSON.stringify({ authenticated: true, csrfToken: "csrf" })),
		);
	vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
test("session checks coalesce focus events and use a five-minute visible fallback", async () => {
	const onInvalid = vi.fn();
	window.addEventListener("anishelf:auth-required", onInvalid);
	try {
		renderHook(() => useSessionCheck());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(30_000);
		});
		await act(async () => {
			window.dispatchEvent(new Event("focus"));
			document.dispatchEvent(new Event("visibilitychange"));
			window.dispatchEvent(new Event("focus"));
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
		fetcher.mockResolvedValue(
			new Response(JSON.stringify({ authenticated: false, csrfToken: "csrf" })),
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(onInvalid).toHaveBeenCalledTimes(1);
	} finally {
		window.removeEventListener("anishelf:auth-required", onInvalid);
	}
});
test("hidden tabs stop scheduled checks and revalidate once when made visible", async () => {
	const { unmount } = renderHook(() => useSessionCheck());
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
	document.dispatchEvent(new Event("visibilitychange"));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(15 * 60_000);
	});
	expect(fetcher).not.toHaveBeenCalled();
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	await act(async () => {
		document.dispatchEvent(new Event("visibilitychange"));
	});
	expect(fetcher).toHaveBeenCalledTimes(1);
	unmount();
	await vi.advanceTimersByTimeAsync(15 * 60_000);
	window.dispatchEvent(new Event("focus"));
	expect(fetcher).toHaveBeenCalledTimes(1);
});
