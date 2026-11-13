// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "../../../src/features/playback/player/api.js";
import { usePlaybackSelection } from "../../../src/features/playback/player/hooks/use-playback-selection.js";
import { originalActive, selection } from "../../support/playback-fixture.js";
import {
	act,
	cleanup,
	renderHook,
	waitFor,
} from "../../support/query-test-utils.js";

beforeEach(() => {
	vi.spyOn(api, "selectPlayback").mockResolvedValue(selection(originalActive));
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
test("binds the original directly without capability requests", async () => {
	const { result } = renderHook(() =>
		usePlaybackSelection("file", undefined, "root", 1),
	);
	await waitFor(() => expect(result.current.loading).toBe(false));
	expect(api.selectPlayback).toHaveBeenCalledWith(
		{ fileId: "file", audioStreamIndex: 1 },
		expect.anything(),
	);
	expect(result.current.selection?.active?.asset.kind).toBe("original");
});
test("runtime failure retains the binding and does not select a fallback", async () => {
	const { result } = renderHook(() =>
		usePlaybackSelection("file", undefined, "root"),
	);
	await waitFor(() => expect(result.current.loading).toBe(false));
	act(() => result.current.failed({ kind: "decode", code: 3 }));
	expect(result.current.runtimeFailure?.kind).toBe("decode");
	expect(result.current.selection?.active).toEqual(originalActive);
	expect(api.selectPlayback).toHaveBeenCalledTimes(1);
});
test("explicit retry starts another binding request", async () => {
	const { result } = renderHook(() =>
		usePlaybackSelection("file", undefined, "root", 1, true, "artifact"),
	);
	await waitFor(() => expect(result.current.loading).toBe(false));
	act(() => result.current.retry());
	await waitFor(() => expect(api.selectPlayback).toHaveBeenCalledTimes(2));
	expect(vi.mocked(api.selectPlayback).mock.calls[1]?.[0]).toEqual({
		fileId: "file",
		audioStreamIndex: 1,
		assetId: "artifact",
	});
});
