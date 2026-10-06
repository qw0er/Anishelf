// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "../src/api/client.js";
import type {
	CompatibilityInspection,
	CompatibilityResult,
	PlaybackSelectionResponse,
} from "../src/api/contracts.js";
import { usePlaybackSelection } from "../src/features/playback/hooks/use-playback-selection.js";
import * as capabilities from "../src/lib/media-capabilities.js";

const description = {
	sourceVersion: "version",
	descriptionId: "d".repeat(64),
	selectedAudioStreamIndices: [1, 2],
	queries: [],
	output: null,
} as unknown as CompatibilityInspection;
const compatibility = {
	sourceVersion: "version",
	selectedAudioStreamIndices: [1, 2],
	audioTracks: [],
	direct: { status: "supported" },
} as unknown as CompatibilityResult;
const direct: PlaybackSelectionResponse = {
	sourceVersion: "version",
	compatibility,
	pending: false,
	plan: {
		mode: "direct",
		resource: {
			delivery: "file",
			url: "/api/media/file",
			mimeType: "video/mp4",
			timeline: { sourceOriginMs: 0, mediaOriginMs: 0, sourceDurationMs: null },
		},
	},
};
beforeEach(() => {
	vi.spyOn(api, "getPlaybackOptions").mockResolvedValue({
		original: description,
		candidates: [
			{
				taskId: "one",
				description: {
					...description,
					output: {
						profileId: "builtin:web",
						target: "file",
					} as CompatibilityInspection["output"],
				},
			},
			{
				taskId: "two",
				description: {
					...description,
					output: {
						profileId: "builtin:web",
						target: "file",
					} as CompatibilityInspection["output"],
				},
			},
		],
	});
	vi.spyOn(api, "selectPlayback").mockResolvedValue(direct);
	vi.spyOn(capabilities, "queryCapabilities").mockResolvedValue([]);
	vi.spyOn(api, "createPreparation");
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});
test("browser submits all server candidates and exact selection, and uses only returned resource", async () => {
	const { result } = renderHook(() =>
		usePlaybackSelection("file", undefined, "root"),
	);
	await waitFor(() => expect(result.current.loading).toBe(false));
	expect(api.selectPlayback).toHaveBeenCalledWith(
		expect.objectContaining({
			original: expect.objectContaining({ output: null }),
			candidates: [
				expect.objectContaining({ taskId: "one" }),
				expect.objectContaining({ taskId: "two" }),
			],
		}),
		expect.anything(),
	);
	expect(
		vi.mocked(api.selectPlayback).mock.calls[0]?.[0].original,
	).not.toHaveProperty("audioStreamIndices");
	expect(result.current.selection?.plan).toEqual(direct.plan);
	expect(api.createPreparation).not.toHaveBeenCalled();
});
test("session arriving and background rerenders preserve an active resource without renegotiation", async () => {
	const { result, rerender } = renderHook(
		({ version }) => usePlaybackSelection("file", version, "root"),
		{ initialProps: { version: undefined as string | undefined } },
	);
	await waitFor(() => expect(result.current.loading).toBe(false));
	const selection = result.current.selection;
	rerender({ version: "version" });
	expect(result.current.selection).toBe(selection);
	expect(api.selectPlayback).toHaveBeenCalledTimes(1);
	await new Promise((resolve) => setTimeout(resolve, 1100));
	expect(api.selectPlayback).toHaveBeenCalledTimes(1);
});
test("failed artifact is reported for server reselection and never creates work", async () => {
	const prepared: PlaybackSelectionResponse = {
		...direct,
		plan: {
			mode: "prepared",
			artifactId: "artifact",
			resource: {
				...(direct.plan.mode === "direct"
					? direct.plan.resource
					: {
							delivery: "file" as const,
							url: "",
							mimeType: "",
							timeline: {
								sourceOriginMs: 0,
								mediaOriginMs: 0,
								sourceDurationMs: null,
							},
						}),
				url: "/api/prepared-media/artifact",
			},
		},
	};
	vi.mocked(api.selectPlayback)
		.mockResolvedValueOnce(prepared)
		.mockResolvedValueOnce({
			...direct,
			plan: { mode: "blocked", reason: "browser-rejected" },
		});
	const { result } = renderHook(() =>
		usePlaybackSelection("file", undefined, "root"),
	);
	await waitFor(() => expect(result.current.loading).toBe(false));
	act(() => result.current.failed());
	await waitFor(() =>
		expect(result.current.selection?.plan.mode).toBe("blocked"),
	);
	expect(api.selectPlayback).toHaveBeenLastCalledWith(
		expect.objectContaining({ failedResourceIds: ["artifact"] }),
		expect.anything(),
	);
	expect(result.current.runtimeFailed).toBe(true);
	expect(api.createPreparation).not.toHaveBeenCalled();
});
test("only blocked pending selection polls and newly ready bytes stop that polling", async () => {
	vi.mocked(api.selectPlayback)
		.mockResolvedValueOnce({
			...direct,
			pending: true,
			plan: { mode: "blocked", reason: "preparation-pending" },
		})
		.mockResolvedValueOnce(direct);
	const { result } = renderHook(() =>
		usePlaybackSelection("file", undefined, "root"),
	);
	await waitFor(() => expect(result.current.selection?.pending).toBe(true));
	await waitFor(
		() => expect(result.current.selection?.plan.mode).toBe("direct"),
		{ timeout: 2500 },
	);
	expect(api.selectPlayback).toHaveBeenCalledTimes(2);
	expect(api.createPreparation).not.toHaveBeenCalled();
});
test("explicit original attempt succeeds with inspection unavailable and no fallback URL", async () => {
	vi.mocked(api.getPlaybackOptions).mockRejectedValue(
		new Error("Inspection unavailable"),
	);
	const { result } = renderHook(() =>
		usePlaybackSelection("file", undefined, "root"),
	);
	await waitFor(() => expect(result.current.error).toBeTruthy());
	act(() => result.current.tryDirect());
	await waitFor(() =>
		expect(result.current.selection?.plan.mode).toBe("direct"),
	);
	expect(api.selectPlayback).toHaveBeenCalledWith(
		expect.objectContaining({ tryOriginal: true, candidates: [] }),
		expect.anything(),
	);
	expect(api.getPlaybackOptions).toHaveBeenCalledTimes(1);
});
test("late cancelled selection cannot replace a new audio intent", async () => {
	let complete: (value: PlaybackSelectionResponse) => void = () => {};
	vi.mocked(api.selectPlayback).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	const { result, rerender } = renderHook(
		({ audio }) => usePlaybackSelection("file", undefined, "root", audio),
		{ initialProps: { audio: [1] } },
	);
	await waitFor(() => expect(api.selectPlayback).toHaveBeenCalledTimes(1));
	rerender({ audio: [] });
	await waitFor(() =>
		expect(result.current.selection?.plan.mode).toBe("direct"),
	);
	await act(async () =>
		complete({ ...direct, plan: { mode: "blocked", reason: "old" } }),
	);
	expect(result.current.selection?.plan.mode).toBe("direct");
	expect(api.selectPlayback).toHaveBeenLastCalledWith(
		expect.objectContaining({ audioStreamIndices: [] }),
		expect.anything(),
	);
});
test("StrictMode settles and releases negotiation on unmount without enqueuing work", async () => {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<StrictMode>{children}</StrictMode>
	);
	const { result, unmount } = renderHook(
		() => usePlaybackSelection("file", undefined, "root"),
		{ wrapper },
	);
	await waitFor(() =>
		expect(result.current.selection?.plan.mode).toBe("direct"),
	);
	unmount();
	expect(
		vi.mocked(api.getPlaybackOptions).mock.calls[0]?.[1]?.signal?.aborted,
	).toBe(true);
	expect(api.createPreparation).not.toHaveBeenCalled();
});

test("new preparation refresh unblocks a waiting player but leaves active resources untouched", async () => {
	vi.mocked(api.selectPlayback)
		.mockResolvedValueOnce({
			...direct,
			pending: false,
			plan: { mode: "blocked", reason: "missing-copy" },
		})
		.mockResolvedValueOnce(direct);
	const { result, rerender } = renderHook(
		({ revision }) =>
			usePlaybackSelection("file", undefined, "root", undefined, revision),
		{ initialProps: { revision: "none" } },
	);
	await waitFor(() =>
		expect(result.current.selection?.plan.mode).toBe("blocked"),
	);
	rerender({ revision: "queued" });
	await waitFor(() =>
		expect(result.current.selection?.plan.mode).toBe("direct"),
	);
	const selection = result.current.selection;
	rerender({ revision: "ready" });
	expect(result.current.selection).toBe(selection);
	expect(api.selectPlayback).toHaveBeenCalledTimes(2);
});
