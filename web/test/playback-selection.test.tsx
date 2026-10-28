// @vitest-environment happy-dom
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as capabilities from "../src/features/media/media-compatibility/capabilities.js";
import * as preparationApi from "../src/features/media/preparation/api.js";
import * as playbackApi from "../src/features/playback/player/api.js";
import { usePlaybackSelection } from "../src/features/playback/player/hooks/use-playback-selection.js";
import type { PlaybackSelectionResponse } from "../src/shared/api/contracts.js";
import { queryClient } from "../src/shared/api/query-client.js";
import { options, originalActive, selection } from "./playback-fixture.js";
import { act, cleanup, renderHook, waitFor } from "./query-test-utils.js";

beforeEach(() => {
	vi.spyOn(playbackApi, "getPlaybackOptions").mockResolvedValue(options());
	vi.spyOn(playbackApi, "selectPlayback").mockResolvedValue(selection());
	vi.spyOn(capabilities, "queryCapabilities").mockResolvedValue([]);
	vi.spyOn(preparationApi, "createPreparation");
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});
test("browser checks actual assets and submits a single-track listening intent without preparation", async () => {
	const { result } = renderHook(() =>
		usePlaybackSelection("file", undefined, "root", 1),
	);
	await waitFor(() => expect(result.current.loading).toBe(false));
	expect(playbackApi.selectPlayback).toHaveBeenCalledWith(
		expect.objectContaining({
			audioStreamIndex: 1,
			evidence: [
				expect.objectContaining({ assetId: "file" }),
				expect.objectContaining({ assetId: "artifact" }),
			],
		}),
		expect.anything(),
	);
	const input = vi.mocked(playbackApi.selectPlayback).mock.calls[0]?.[0];
	expect(input).not.toHaveProperty("original");
	expect(input).not.toHaveProperty("audioStreamIndices");
	expect(
		result.current.selection?.active?.asset.audioTracks[0]?.stream.codec,
	).toBe("aac");
	expect(preparationApi.createPreparation).not.toHaveBeenCalled();
});
test("a matching session and background invalidation preserve the active binding", async () => {
	const { result, rerender } = renderHook(
		({ version }) => usePlaybackSelection("file", version, "root"),
		{ initialProps: { version: undefined as string | undefined } },
	);
	await waitFor(() => expect(result.current.selection?.active).toBeTruthy());
	const active = result.current.selection?.active;
	rerender({ version: "v1" });
	await act(async () => {
		await queryClient.invalidateQueries({ queryKey: ["playback-selection"] });
	});
	expect(result.current.selection?.active).toBe(active);
	expect(playbackApi.selectPlayback).toHaveBeenCalledTimes(1);
});
test("a network failure retains the resource and does not poison browser capability evidence", async () => {
	const clear = vi.spyOn(capabilities, "clearCapabilityCache");
	const { result } = renderHook(() =>
		usePlaybackSelection("file", undefined, "root"),
	);
	await waitFor(() => expect(result.current.selection?.active).toBeTruthy());
	const active = result.current.selection?.active;
	act(() => result.current.failed({ kind: "network", code: 2 }));
	expect(result.current.selection?.active).toBe(active);
	expect(result.current.runtimeFailure?.kind).toBe("network");
	expect(clear).not.toHaveBeenCalled();
	expect(playbackApi.selectPlayback).toHaveBeenCalledTimes(1);
});
test("decode failure excludes only the failed asset for this attempt", async () => {
	vi.mocked(playbackApi.selectPlayback)
		.mockResolvedValueOnce(selection())
		.mockResolvedValueOnce(selection(null));
	const { result } = renderHook(() =>
		usePlaybackSelection("file", undefined, "root"),
	);
	await waitFor(() => expect(result.current.selection?.active).toBeTruthy());
	act(() => result.current.failed({ kind: "decode", code: 3 }));
	await waitFor(() => expect(result.current.selection?.active).toBeNull());
	expect(playbackApi.selectPlayback).toHaveBeenLastCalledWith(
		expect.objectContaining({ failedResourceIds: ["artifact"] }),
		expect.anything(),
	);
	expect(preparationApi.createPreparation).not.toHaveBeenCalled();
});
test("blocked pending selection polls until an actual asset becomes available", async () => {
	vi.useFakeTimers();
	vi.mocked(playbackApi.selectPlayback)
		.mockResolvedValueOnce({ ...selection(null), pending: true })
		.mockResolvedValueOnce(selection());
	const { result } = renderHook(() =>
		usePlaybackSelection("file", undefined, "root"),
	);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
	expect(result.current.selection?.pending).toBe(true);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1000);
	});
	expect(result.current.selection?.active).toBeTruthy();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(5000);
	});
	expect(playbackApi.selectPlayback).toHaveBeenCalledTimes(2);
});
test("resource changes re-resolve a blocked intent and then preserve the active binding", async () => {
	vi.mocked(playbackApi.selectPlayback)
		.mockResolvedValueOnce(selection(null))
		.mockResolvedValueOnce(selection());
	const { result } = renderHook(() =>
		usePlaybackSelection("file", undefined, "root"),
	);
	await waitFor(() => expect(result.current.selection).toBeTruthy());
	await act(async () => {
		await queryClient.invalidateQueries({ queryKey: ["playback-selection"] });
	});
	await waitFor(() => expect(result.current.selection?.active).toBeTruthy());
	const active = result.current.selection?.active;
	await act(async () => {
		await queryClient.invalidateQueries({ queryKey: ["playback-selection"] });
	});
	expect(result.current.selection?.active).toBe(active);
	expect(playbackApi.selectPlayback).toHaveBeenCalledTimes(2);
});
test("explicit original trial still negotiates a server-returned binding", async () => {
	vi.mocked(playbackApi.selectPlayback).mockResolvedValue(
		selection(originalActive),
	);
	const { result } = renderHook(() =>
		usePlaybackSelection("file", undefined, "root", undefined, true, "file"),
	);
	await waitFor(() =>
		expect(result.current.selection?.active?.asset.kind).toBe("original"),
	);
	expect(playbackApi.selectPlayback).toHaveBeenLastCalledWith(
		expect.objectContaining({ assetId: "file", allowUnverified: true }),
		expect.anything(),
	);
});
test("late cancelled evidence cannot replace a new audio intent", async () => {
	let complete: (value: PlaybackSelectionResponse) => void = () => {};
	vi.mocked(playbackApi.selectPlayback).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	const { result, rerender } = renderHook(
		({ audio }) => usePlaybackSelection("file", undefined, "root", audio),
		{ initialProps: { audio: 1 } },
	);
	await waitFor(() =>
		expect(playbackApi.selectPlayback).toHaveBeenCalledTimes(1),
	);
	rerender({ audio: 2 });
	await waitFor(() => expect(result.current.selection?.active).toBeTruthy());
	await act(async () => complete(selection(null)));
	expect(result.current.selection?.active).toBeTruthy();
	expect(playbackApi.selectPlayback).toHaveBeenLastCalledWith(
		expect.objectContaining({ audioStreamIndex: 2 }),
		expect.anything(),
	);
});
test("StrictMode does not turn playback inspection into preparation", async () => {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<StrictMode>{children}</StrictMode>
	);
	const { result } = renderHook(
		() => usePlaybackSelection("file", undefined, "root"),
		{ wrapper },
	);
	await waitFor(() => expect(result.current.selection?.active).toBeTruthy());
	expect(preparationApi.createPreparation).not.toHaveBeenCalled();
});
