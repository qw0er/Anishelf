// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from "vitest";
import { useDelayedPending } from "../src/hooks/use-delayed-pending.js";
import { act, cleanup, renderHook } from "./query-test-utils.js";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

test("fast requests finish without displaying an indicator", () => {
	vi.useFakeTimers();
	const { result, rerender } = renderHook(
		({ pending }) => useDelayedPending(pending),
		{ initialProps: { pending: true } },
	);
	act(() => vi.advanceTimersByTime(100));
	expect(result.current).toBe(false);
	rerender({ pending: false });
	act(() => vi.advanceTimersByTime(200));
	expect(result.current).toBe(false);
	expect(vi.getTimerCount()).toBe(0);
});

test("slow requests display feedback after the threshold and hide it immediately on completion", () => {
	vi.useFakeTimers();
	const { result, rerender, unmount } = renderHook(
		({ pending }) => useDelayedPending(pending),
		{ initialProps: { pending: true } },
	);
	act(() => vi.advanceTimersByTime(199));
	expect(result.current).toBe(false);
	act(() => vi.advanceTimersByTime(1));
	expect(result.current).toBe(true);
	rerender({ pending: false });
	expect(result.current).toBe(false);
	rerender({ pending: true });
	unmount();
	expect(vi.getTimerCount()).toBe(0);
});

test("a new navigation gets its own delay instead of inheriting stale feedback", () => {
	vi.useFakeTimers();
	const { result, rerender } = renderHook(
		({ identity }) => useDelayedPending(true, identity),
		{ initialProps: { identity: "first" } },
	);
	act(() => vi.advanceTimersByTime(200));
	expect(result.current).toBe(true);
	rerender({ identity: "second" });
	expect(result.current).toBe(false);
	act(() => vi.advanceTimersByTime(200));
	expect(result.current).toBe(true);
});
