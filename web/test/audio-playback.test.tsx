// @vitest-environment happy-dom
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import * as api from "../src/api/client.js";
import type {
	CompatibilityResult,
	PreparationTaskResponse,
} from "../src/api/contracts.js";
import FilePlayer from "../src/features/playback/components/file-player.js";
import { preparedWatchPath } from "../src/features/preparation/audio-tracks.js";
import { PreparationProvider } from "../src/features/preparation/context.js";
import * as capabilities from "../src/lib/media-capabilities.js";
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
vi.mock("../src/features/playback/hooks/use-media-compatibility.js", () => ({
	useMediaCompatibility: () => ({
		loading: false,
		result: original,
		error: null,
		canAttempt: original.direct.status === "supported",
		retry: vi.fn(),
		failed: vi.fn(),
		tryDirect: vi.fn(),
	}),
}));
vi.mock("../src/features/playback/hooks/use-playback-session.js", () => ({
	usePlaybackSession: () => ({
		session: { sourceVersion: "v1", plan: { playbackUrl: "/api/media/file" } },
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
	playbackUrl: "/api/prepared-media/jp-artifact",
	updatedAtMs: 1,
	audioStreamIndices: [2],
} as PreparationTaskResponse;

test("changing playback audio verifies only matching copies and never enqueues automatically", async () => {
	vi.spyOn(api, "getTranscodeProfiles").mockResolvedValue({
		profiles: [],
		selectedProfileId: "builtin:balanced",
		selectionAvailable: true,
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
	vi.spyOn(api, "getPreparation").mockResolvedValue(task);
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
						playbackUrl: "/api/media/file",
					}}
					returnDirectoryId="root"
					onRetry={vi.fn()}
				/>
			</PreparationProvider>
		</MemoryRouter>,
	);
	await waitFor(() =>
		expect(view.getByLabelText("Active video").textContent).toBe(
			task.playbackUrl,
		),
	);
	expect(api.checkMediaCompatibility).toHaveBeenCalledWith(
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
							playbackUrl: "/api/media/file",
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
