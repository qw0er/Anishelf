// @vitest-environment happy-dom
import { useEffect } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { playbackUiSlots } from "../src/app/composition/playback-ui.js";
import * as capabilities from "../src/features/media/media-compatibility/capabilities.js";
import * as preparationApi from "../src/features/media/preparation/api.js";
import { preparedWatchPath } from "../src/features/media/preparation/audio-tracks.js";
import { PreparationProvider } from "../src/features/media/preparation/context.js";
import * as playbackApi from "../src/features/playback/player/api.js";
import FilePlayer from "../src/features/playback/player/components/file-player.js";
import * as runtime from "../src/features/playback/player/runtime.js";
import * as settingsApi from "../src/features/settings/api.js";
import * as api from "../src/shared/api/client.js";
import type {
	ActivePlayback,
	PreparationTaskResponse,
} from "../src/shared/api/contracts.js";
import { queryClient } from "../src/shared/api/query-client.js";
import {
	options,
	originalActive,
	preparedActive,
	preparedAsset,
	required,
	selection,
	source,
} from "./playback-fixture.js";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "./query-test-utils.js";
import { trackingProvider } from "./tracking-fixture.js";
import "../src/shared/i18n.js";

const mounted = vi.hoisted(() => vi.fn());
vi.mock(
	"../src/features/playback/player/hooks/use-playback-session.js",
	() => ({
		usePlaybackSession: () => ({
			session: { sourceVersion: "v1" },
			attach: () => {},
		}),
	}),
);
vi.mock("../src/features/playback/player/components/video-player.js", () => ({
	default: ({ active }: { active: ActivePlayback }) => {
		useEffect(() => {
			mounted();
		}, []);
		return (
			<div role="status" aria-label="Active video">
				{active.resource.url}
			</div>
		);
	},
}));
const task = {
	id: "job",
	fileId: "file",
	filename: "Two tracks.mkv",
	sourceVersion: "v1",
	profileId: "builtin:balanced",
	mode: "transcode",
	status: "ready",
	artifactId: "artifact",
	audioStreamIndices: [1],
	updatedAtMs: 1,
} as PreparationTaskResponse;
beforeEach(() => {
	mounted.mockClear();
	vi.spyOn(api, "request").mockResolvedValue({
		provider: trackingProvider,
		generation: "fixture",
		state: "disconnected",
		account: null,
		connectivity: "unknown",
		checkedAt: null,
	});
	vi.spyOn(capabilities, "queryCapabilities").mockResolvedValue([]);
	vi.spyOn(playbackApi, "getPlaybackOptions").mockResolvedValue(options());
	vi.spyOn(playbackApi, "selectPlayback").mockImplementation(async (input) =>
		input.audioStreamIndex === 2
			? selection(null)
			: input.assetId === "file"
				? selection(originalActive)
				: selection(),
	);
	vi.spyOn(settingsApi, "getTranscodeProfiles").mockResolvedValue({
		profiles: [],
		selectedProfileId: "builtin:balanced",
		selectionAvailable: true,
		preparationMode: "compatible",
	});
	vi.spyOn(preparationApi, "getPreparations").mockResolvedValue({
		tasks: [task],
	});
	vi.spyOn(preparationApi, "getFilePreparations").mockResolvedValue({
		tasks: [task],
	});
	vi.spyOn(preparationApi, "createPreparation");
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
function page(path = "/files/file") {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<PreparationProvider>
				<FilePlayer
					slots={playbackUiSlots}
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
}
test("the tracking control shares the audio and More action row", async () => {
	const view = render(
		<MemoryRouter>
			<PreparationProvider>
				<FilePlayer
					slots={{
						...playbackUiSlots,
						renderViewing: () => <button type="button">Mark as watched</button>,
					}}
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
	const watched = await view.findByRole("button", { name: "Mark as watched" });
	const more = view.getByRole("button", { name: "More playback options" });
	expect(watched.parentElement).toBe(more.parentElement);
});
test("the current Japanese AAC copy never offers original-only English or automatic as audio tracks", async () => {
	const view = page();
	await waitFor(() =>
		expect(view.getByLabelText("Active video").textContent).toBe(
			"/api/prepared-media/artifact",
		),
	);
	expect(view.getByLabelText("Playback audio").textContent).toMatch(
		/Japanese.*AAC/,
	);
	expect(view.queryByRole("combobox", { name: "Playback audio" })).toBeNull();
	expect(view.queryByText(/English/)).toBeNull();
	expect(view.queryByRole("option", { name: "Automatic" })).toBeNull();
	expect(preparationApi.createPreparation).not.toHaveBeenCalled();
});
test("an explicit English link is blocked without exposing source audio as current-file controls", async () => {
	const view = page("/files/file?audio=2");
	await view.findByText(/No available version has confirmed playback support/);
	expect(view.queryByLabelText("Active video")).toBeNull();
	expect(view.queryByLabelText("Playback audio")).toBeNull();
	expect(playbackApi.selectPlayback).toHaveBeenLastCalledWith(
		expect.objectContaining({ audioStreamIndex: 2 }),
		expect.anything(),
	);
	expect(
		await view.findByText(
			/No available version has confirmed playback support/,
		),
	).toBeTruthy();
	expect(preparationApi.createPreparation).not.toHaveBeenCalled();
});
function dualAudioActive(): ActivePlayback {
	return {
		...preparedActive,
		asset: {
			...preparedAsset,
			audioTracks: [
				...preparedAsset.audioTracks,
				{
					stream: {
						...required(source.audioTracks[1]),
						index: 5,
						codec: "aac",
						codecString: "mp4a.40.2",
					},
					sourceStreamIndex: 2,
				},
			],
		},
	};
}
test("switching actual output audio retains the current file and maps to source intent", async () => {
	vi.spyOn(runtime, "canSelectNativeAudio").mockReturnValue(true);
	const dual = dualAudioActive();
	vi.mocked(playbackApi.selectPlayback).mockImplementation(async (input) =>
		selection({
			...dual,
			audio:
				input.audioStreamIndex === 2
					? { streamIndex: 5, sourceStreamIndex: 2, position: 1 }
					: dual.audio,
		}),
	);
	const view = page();
	const control = await view.findByRole("combobox", { name: "Playback audio" });
	expect(within(control).getAllByRole("option")).toHaveLength(2);
	expect(
		within(control).getByRole("option", { name: /English.*AAC/ }),
	).toBeTruthy();
	fireEvent.change(control, { target: { value: "2" } });
	await waitFor(() =>
		expect(playbackApi.selectPlayback).toHaveBeenLastCalledWith(
			expect.objectContaining({ audioStreamIndex: 2, assetId: "artifact" }),
			expect.anything(),
		),
	);
	expect(view.getByLabelText("Active video").textContent).toBe(
		"/api/prepared-media/artifact",
	);
});
test("a browser without native audio switching shows only the current track", async () => {
	vi.spyOn(runtime, "canSelectNativeAudio").mockReturnValue(false);
	vi.mocked(playbackApi.selectPlayback).mockResolvedValue(
		selection(dualAudioActive()),
	);
	const view = page();
	await view.findByLabelText("Active video");
	expect(view.queryByRole("combobox", { name: "Playback audio" })).toBeNull();
	expect(view.getByLabelText("Playback audio").textContent).toMatch(
		/Japanese.*AAC/,
	);
	expect(view.queryByText(/English/)).toBeNull();
});
test("compatibility details display the active AAC copy separately from original Opus", async () => {
	const view = page();
	await view.findByLabelText("Active video");
	fireEvent.click(view.getByRole("button", { name: "More playback options" }));
	fireEvent.click(
		await view.findByRole("menuitem", { name: "Playback compatibility info" }),
	);
	const dialog = await view.findByRole("dialog");
	const report = within(dialog).getByRole("region", {
		name: "Current playback",
	});
	expect(within(report).getByText(/Audio · AAC/)).toBeTruthy();
	expect(report.textContent).not.toContain("OPUS");
	expect(within(dialog).getByText("Original file details")).toBeTruthy();
});
test("background preparation completion preserves the current player and intent", async () => {
	const view = page();
	await view.findByLabelText("Active video");
	expect(mounted).toHaveBeenCalledTimes(1);
	vi.mocked(preparationApi.getFilePreparations).mockResolvedValue({
		tasks: [
			task,
			{
				...task,
				id: "new-job",
				artifactId: "new-copy",
				audioStreamIndices: [2],
				updatedAtMs: 2,
			},
		],
	});
	await act(async () => {
		await queryClient.invalidateQueries({ queryKey: ["preparations"] });
	});
	expect(view.getByLabelText("Active video").textContent).toBe(
		"/api/prepared-media/artifact",
	);
	expect(mounted).toHaveBeenCalledTimes(1);
	expect(playbackApi.selectPlayback).toHaveBeenCalledTimes(1);
});
test("prepared watch links pin actual bytes and one source track instead of all retained tracks", () => {
	const parsed = new URL(preparedWatchPath(task), "http://localhost");
	expect(parsed.searchParams.get("asset")).toBe("artifact");
	expect(parsed.searchParams.get("audio")).toBe("1");
	expect(parsed.searchParams.get("version")).toBe("v1");
	const multiple = new URL(
		preparedWatchPath({ ...task, audioStreamIndices: [2, 1] }),
		"http://localhost",
	);
	expect(multiple.searchParams.get("audio")).toBe("2");
	const silent = new URL(
		preparedWatchPath({ ...task, audioStreamIndices: [] }),
		"http://localhost",
	);
	expect(silent.searchParams.get("audio")).toBe("none");
});

test("version inventory refreshes independently and explicit selection changes the active asset", async () => {
	const view = page();
	await view.findByLabelText("Active video");
	const nextAsset = {
		...preparedAsset,
		id: "new-copy",
		video: { ...required(preparedAsset.video), height: 720 },
	};
	const fresh = options();
	fresh.assets.push({ ...required(fresh.assets[1]), asset: nextAsset });
	vi.mocked(playbackApi.getPlaybackOptions).mockResolvedValue(fresh);
	fireEvent.click(view.getByRole("button", { name: "More playback options" }));
	fireEvent.click(
		await view.findByRole("menuitem", { name: "Playback options" }),
	);
	await view.findByRole("option", { name: /720p/ });
	expect(playbackApi.selectPlayback).toHaveBeenCalledTimes(1);
	expect(mounted).toHaveBeenCalledTimes(1);
	vi.mocked(playbackApi.selectPlayback).mockResolvedValueOnce(
		selection({
			...preparedActive,
			asset: nextAsset,
			resource: {
				...preparedActive.resource,
				url: "/api/prepared-media/new-copy",
			},
		}),
	);
	fireEvent.change(view.getByRole("combobox", { name: "Playback version" }), {
		target: { value: "new-copy" },
	});
	await waitFor(() =>
		expect(view.getByLabelText("Active video").textContent).toBe(
			"/api/prepared-media/new-copy",
		),
	);
	expect(playbackApi.selectPlayback).toHaveBeenLastCalledWith(
		expect.objectContaining({ assetId: "new-copy" }),
		expect.anything(),
	);
	expect(preparationApi.createPreparation).not.toHaveBeenCalled();
});
