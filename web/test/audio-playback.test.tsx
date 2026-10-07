// @vitest-environment happy-dom

import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "../src/api/client.js";
import type {
	CompatibilityResult,
	PreparationTaskResponse,
} from "../src/api/contracts.js";
import FilePlayer from "../src/features/playback/components/file-player.js";
import { preparedWatchPath } from "../src/features/preparation/audio-tracks.js";
import { PreparationProvider } from "../src/features/preparation/context.js";
import * as capabilities from "../src/lib/media-capabilities.js";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "./query-test-utils.js";
import "../src/i18n.js";

const original = {
	sourceVersion: "v1",
	selectedVideo: { index: 0 },
	warnings: [],
	direct: { status: "unknown", reason: "native-track-selection-uncertain" },
	container: { status: "supported", reason: "browser-supported" },
	video: { status: "supported", reason: "browser-supported" },
	audio: { status: "supported", reason: "browser-supported" },
	audioTracks: [
		{
			stream: {
				index: 1,
				label: "English",
				language: "eng",
				codec: "aac",
				channels: 2,
				default: true,
			},
			compatibility: { status: "supported", reason: "browser-supported" },
		},
		{
			stream: {
				index: 2,
				label: "Japanese",
				language: "jpn",
				codec: "aac",
				channels: 2,
			},
			compatibility: { status: "supported", reason: "browser-supported" },
		},
	],
} as unknown as CompatibilityResult;
vi.mock("../src/features/playback/hooks/use-playback-session.js", () => ({
	usePlaybackSession: () => ({
		session: { sourceVersion: "v1" },
		attach: vi.fn(),
	}),
}));
vi.mock("../src/features/playback/components/video-player.js", () => ({
	default: ({ playbackUrl }: { playbackUrl: string }) => (
		<div role="status" aria-label="Active video">
			{playbackUrl}
		</div>
	),
}));
beforeEach(() => {
	vi.spyOn(capabilities, "queryCapabilities").mockResolvedValue([]);
	vi.spyOn(api, "getPlaybackOptions").mockImplementation(async (input) => ({
		original: {
			sourceVersion: "v1",
			descriptionId: "fresh",
			queries: [],
			selectedAudioStreamIndices: input.audioStreamIndices ?? [1, 2],
			output: null,
		} as unknown as apiReturn,
		candidates: [],
	}));
	vi.spyOn(api, "selectPlayback").mockImplementation(async (input) => ({
		sourceVersion: "v1",
		compatibility: original,
		pending: false,
		plan: input.tryOriginal
			? {
					mode: "direct",
					resource: {
						delivery: "file",
						url: "/api/media/file",
						mimeType: "video/mp4",
						timeline: {
							sourceOriginMs: 0,
							mediaOriginMs: 0,
							sourceDurationMs: null,
						},
					},
				}
			: input.audioStreamIndices?.[0] === 2
				? {
						mode: "prepared",
						artifactId: "jp-artifact",
						resource: task.resource as NonNullable<
							PreparationTaskResponse["resource"]
						>,
					}
				: { mode: "blocked", reason: "audio-selection-requires-copy" },
	}));
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	original.direct = {
		status: "unknown",
		reason: "native-track-selection-uncertain",
	};
});
const task = {
	id: "jp",
	fileId: "file",
	filename: "Two tracks.mkv",
	sourceVersion: "v1",
	profileId: "builtin:balanced",
	mode: "remux",
	status: "ready",
	artifactId: "jp-artifact",
	resource: {
		delivery: "file" as const,
		url: "/api/prepared-media/jp-artifact",
		mimeType: "video/mp4",
		timeline: { sourceOriginMs: 0, mediaOriginMs: 0, sourceDurationMs: null },
	},
	updatedAtMs: 1,
	audioStreamIndices: [2],
} as PreparationTaskResponse;

test("changing playback audio verifies only matching copies and never enqueues automatically", async () => {
	vi.spyOn(api, "getTranscodeProfiles").mockResolvedValue({
		profiles: [],
		selectedProfileId: "builtin:balanced",
		selectionAvailable: true,
		preparationMode: "compatible" as const,
	});
	vi.spyOn(api, "getPreparations").mockResolvedValue({ tasks: [task] });
	vi.spyOn(api, "getFilePreparations").mockResolvedValue({ tasks: [task] });
	vi.spyOn(api, "inspectMediaCompatibility").mockResolvedValue({
		sourceVersion: "v1",
		descriptionId: "fresh",
		queries: [],
	} as unknown as apiReturn);
	vi.spyOn(capabilities, "queryCapabilities").mockResolvedValue([]);
	vi.spyOn(api, "checkMediaCompatibility").mockResolvedValue({
		output: { combinations: { "copy-copy": "supported" } },
	} as unknown as CompatibilityResult);
	const create = vi.spyOn(api, "createPreparation");
	const view = render(
		<MemoryRouter initialEntries={["/files/file?audio=2"]}>
			<PreparationProvider>
				<FilePlayer
					data={{
						file: {
							id: "file",
							kind: "file",
							name: "Two tracks.mkv",
							parentId: "root",
							sizeBytes: 1,
							modifiedAt: "now",
							mimeType: "video/x-matroska",
						},
						originalMediaUrl: "/api/media/file",
					}}
					returnDirectoryId="root"
					onRetry={vi.fn()}
				/>
			</PreparationProvider>
		</MemoryRouter>,
	);
	await waitFor(() =>
		expect(view.getByLabelText("Active video").textContent).toBe(
			task.resource?.url,
		),
	);
	expect(api.selectPlayback).toHaveBeenCalledWith(
		expect.objectContaining({ audioStreamIndices: [2] }),
		expect.anything(),
	);
	fireEvent.change(view.getByRole("combobox", { name: "Playback audio" }), {
		target: { value: "1" },
	});
	await waitFor(() => expect(view.queryByLabelText("Active video")).toBeNull());
	expect(create).not.toHaveBeenCalled();
	expect(view.getByRole("button", { name: "Pre-transcode" })).toBeTruthy();
	fireEvent.click(view.getByRole("button", { name: "Try original file" }));
	await waitFor(() =>
		expect(view.getByLabelText("Active video").textContent).toBe(
			"/api/media/file",
		),
	);
	expect(create).not.toHaveBeenCalled();
	fireEvent.click(
		view.getByRole("button", { name: "Playback compatibility info" }),
	);
	const dialog = await view.findByRole("dialog");
	expect(
		within(dialog).getByText(/English · AAC · 2 channels · Default/),
	).toBeTruthy();
	expect(within(dialog).getByText(/Japanese · AAC · 2 channels/)).toBeTruthy();
});
type apiReturn = Awaited<ReturnType<typeof api.inspectMediaCompatibility>>;

test("watch links preserve selected, all and silent task audio", () => {
	expect(preparedWatchPath(task)).toBe("/files/file?audio=2");
	expect(preparedWatchPath({ ...task, audioStreamIndices: [1, 2] })).toBe(
		"/files/file?audio=1%2C2",
	);
	expect(preparedWatchPath({ ...task, audioStreamIndices: [] })).toBe(
		"/files/file?audio=",
	);
});

test.each(["unknown", "unsupported", "list-error"])(
	"Try original file starts the original for %s playback",
	async (state) => {
		original.direct = {
			status: state === "unknown" ? "unknown" : "unsupported",
			reason: "browser-rejected",
		};
		vi.spyOn(api, "getTranscodeProfiles").mockResolvedValue({
			profiles: [],
			selectedProfileId: "builtin:balanced",
			selectionAvailable: true,
			preparationMode: "compatible" as const,
		});
		vi.spyOn(api, "getPreparations").mockResolvedValue({ tasks: [] });
		const list = vi.spyOn(api, "getFilePreparations");
		if (state === "list-error")
			list.mockRejectedValue(new Error("Server error"));
		else list.mockResolvedValue({ tasks: [] });
		const create = vi.spyOn(api, "createPreparation");
		const view = render(
			<MemoryRouter>
				<PreparationProvider>
					<FilePlayer
						data={{
							file: {
								id: "file",
								kind: "file",
								name: "Two tracks.mkv",
								parentId: "root",
								sizeBytes: 1,
								modifiedAt: "now",
								mimeType: "video/x-matroska",
							},
							originalMediaUrl: "/api/media/file",
						}}
						returnDirectoryId="root"
						onRetry={vi.fn()}
					/>
				</PreparationProvider>
			</MemoryRouter>,
		);
		const attempt = await view.findByRole("button", {
			name: "Try original file",
		});
		const notice = view.getByRole("region", {
			name: "Unable to play this video",
		});
		expect(
			within(notice).queryByRole("link", { name: "Back to files" }),
		).toBeNull();
		expect(
			within(notice).getByRole("button", { name: "Check again" }),
		).toBeTruthy();
		expect(
			await within(notice).findByRole("button", { name: "Pre-transcode" }),
		).toBeTruthy();
		expect(view.queryByLabelText("Active video")).toBeNull();
		expect(attempt.parentElement?.classList.contains("action-row")).toBe(true);
		fireEvent.click(attempt);
		await waitFor(() =>
			expect(view.getByLabelText("Active video").textContent).toBe(
				"/api/media/file",
			),
		);
		expect(create).not.toHaveBeenCalled();
	},
);
