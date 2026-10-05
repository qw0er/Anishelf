// @vitest-environment happy-dom
import {
	cleanup,
	fireEvent,
	render,
	renderHook,
	waitFor,
} from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "../src/api/client.js";
import type {
	CompatibilityInspection,
	CompatibilityResult,
	PreparationTaskResponse,
} from "../src/api/contracts.js";
import { FileActions } from "../src/features/library/components/file-actions.js";
import { PreparationButton } from "../src/features/preparation/components/preparation-button.js";
import { PreparationMonitor } from "../src/features/preparation/components/preparation-monitor.js";
import { PreparationProfileSettings } from "../src/features/preparation/components/profile-settings.js";
import { PreparationTaskCard } from "../src/features/preparation/components/task-card.js";
import { PreparationProvider } from "../src/features/preparation/context.js";
import { verifyPreparedPlayback } from "../src/features/preparation/negotiation.js";
import { usePreparedPlayback } from "../src/features/preparation/use-prepared-playback.js";
import * as capabilities from "../src/lib/media-capabilities.js";
import "../src/i18n.js";

const task: PreparationTaskResponse = {
	id: "task-1",
	fileId: "file",
	filename: "Episode.mkv",
	sourceVersion: "version",
	profileId: "builtin:web",
	mode: "remux",
	reasons: { video: "copy", audio: "copy" },
	status: "queued",
	playbackAvailability: "unavailable",
	progress: null,
	failureReason: null,
	createdAtMs: 1,
	updatedAtMs: 1,
	artifactId: null,
	playbackUrl: null,
	sizeBytes: null,
};
const ready: PreparationTaskResponse = {
	...task,
	status: "ready",
	playbackAvailability: "ready",
	artifactId: "artifact",
	playbackUrl: "/api/prepared-media/artifact",
	sizeBytes: 100,
};
const description = {
	sourceVersion: "version",
	descriptionId: "description",
	queries: [],
	output: { profileId: task.profileId, target: "file" },
} as unknown as CompatibilityInspection;
const evidence = [
	{
		id: "fresh",
		status: "supported",
		smooth: null,
		powerEfficient: null,
		reason: "browser-supported",
	},
] as const;
const catalog = {
	profiles: [
		{
			id: task.profileId,
			name: "Browser copy",
			description: "MP4 browser profile",
			container: "mp4" as const,
			videoEncoder: "libx264",
			audioEncoder: "aac",
			source: "builtin" as const,
			usage: "preparation" as const,
		},
	],
	selectedProfileId: task.profileId,
	selectionAvailable: true,
};
const unsupported = {
	sourceVersion: "version",
	direct: { status: "unsupported" },
} as CompatibilityResult;
function Wrapper({ children }: { children: ReactNode }) {
	return (
		<MemoryRouter>
			<PreparationProvider>{children}</PreparationProvider>
		</MemoryRouter>
	);
}
beforeEach(() => {
	vi.spyOn(api, "getTranscodeProfiles").mockResolvedValue(catalog);
	vi.spyOn(api, "getPreparations").mockResolvedValue({ tasks: [] });
	vi.spyOn(api, "getFilePreparations").mockImplementation(async () =>
		api.getPreparations(),
	);
	vi.spyOn(api, "inspectMediaCompatibility").mockResolvedValue(description);
	vi.spyOn(capabilities, "queryCapabilities").mockResolvedValue([...evidence]);
	vi.spyOn(api, "createPreparation").mockResolvedValue({ kind: "task", task });
	vi.spyOn(api, "getPreparation").mockResolvedValue(ready);
	vi.spyOn(api, "checkMediaCompatibility").mockResolvedValue({
		output: { combinations: { "copy-copy": "supported" } },
	} as unknown as CompatibilityResult);
	vi.spyOn(api, "cancelPreparation").mockResolvedValue({
		...task,
		status: "cancelled",
	});
	vi.spyOn(api, "retryPreparation").mockResolvedValue(task);
	vi.spyOn(api, "deletePreparedMedia").mockResolvedValue();
	vi.spyOn(api, "selectTranscodeProfile").mockResolvedValue(catalog);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
function button(props = {}) {
	return render(
		<Wrapper>
			<PreparationButton
				fileId="file"
				loading={false}
				result={unsupported}
				error={null}
				onRecheck={vi.fn()}
				{...props}
			/>
			<PreparationMonitor />
		</Wrapper>,
	);
}

test("directory action has a placeholder while checking and no transcode button for supported files but an action for unknown files", async () => {
	const view = button({ loading: true });
	expect(
		view
			.getByLabelText("Checking playback compatibility…")
			.querySelector("svg.animate-spin"),
	).toBeTruthy();
	view.rerender(
		<Wrapper>
			<PreparationButton
				fileId="file"
				loading={false}
				result={{
					...unsupported,
					direct: { status: "supported", reason: "browser-supported" },
				}}
				error={null}
				onRecheck={vi.fn()}
			/>
		</Wrapper>,
	);
	expect(view.queryByRole("button", { name: "Pre-transcode" })).toBeNull();
	view.rerender(
		<Wrapper>
			<PreparationButton
				fileId="file"
				loading={false}
				result={{
					...unsupported,
					direct: { status: "unknown", reason: "browser-uncertain" },
				}}
				error={null}
				onRecheck={vi.fn()}
			/>
		</Wrapper>,
	);
	expect(
		await view.findByRole("button", { name: "Pre-transcode" }),
	).toBeTruthy();
});
test("directory icon action exposes its tooltip on keyboard focus", async () => {
	const view = button();
	const action = await view.findByRole("button", { name: "Pre-transcode" });
	expect(action.textContent).toBe("");
	fireEvent.focus(action);
	await waitFor(() =>
		expect(
			document.querySelector('[data-slot="tooltip-content"]')?.textContent,
		).toBe("Pre-transcode"),
	);
});
test("explicit directory preparation negotiates fresh evidence and opens the global collapsible monitor", async () => {
	vi.mocked(api.createPreparation).mockImplementation(async () => {
		vi.mocked(api.getPreparations).mockResolvedValue({ tasks: [task] });
		return { kind: "task", task };
	});
	const view = button();
	fireEvent.click(await view.findByRole("button", { name: "Pre-transcode" }));
	await waitFor(() =>
		expect(api.createPreparation).toHaveBeenCalledWith(
			"file",
			{
				sourceVersion: "version",
				descriptionId: "description",
				output: { profileId: task.profileId, target: "file" },
				evidence,
			},
			expect.anything(),
		),
	);
	const monitor = await view.findByRole("complementary", {
		name: "Transcoding tasks",
	});
	expect(monitor).toBeTruthy();
	const toggle = view.getByRole("button", { name: /Transcoding tasks/ });
	fireEvent.click(toggle);
	expect(toggle.getAttribute("aria-expanded")).toBe("false");
	view.unmount();
	expect(api.cancelPreparation).not.toHaveBeenCalled();
});
test("target profile is saved in Settings through the persistent selection API", async () => {
	const view = render(
		<Wrapper>
			<PreparationProfileSettings />
		</Wrapper>,
	);
	const profile = await view.findByRole("radio", { name: /Browser copy/ });
	await waitFor(() => expect((profile as HTMLInputElement).checked).toBe(true));
	fireEvent.click(view.getByRole("button", { name: "Save transcode profile" }));
	await waitFor(() =>
		expect(api.selectTranscodeProfile).toHaveBeenCalledWith(
			task.profileId,
			expect.anything(),
		),
	);
});
test("an unavailable target selection sends the user to Settings instead of guessing a profile", async () => {
	vi.mocked(api.getTranscodeProfiles).mockResolvedValue({
		...catalog,
		selectedProfileId: "custom:missing",
		selectionAvailable: false,
	});
	const view = button();
	const link = await view.findByRole("link", { name: "Set transcode profile" });
	expect(link.getAttribute("href")).toBe("/settings");
	expect(view.queryByRole("button", { name: "Pre-transcode" })).toBeNull();
});
test("unsupported original automatically selects a verified completed copy without creating work", async () => {
	vi.mocked(api.getPreparations).mockResolvedValue({ tasks: [ready] });
	const { result } = renderHook(
		() => usePreparedPlayback("file", "version", true),
		{ wrapper: Wrapper },
	);
	await waitFor(() => expect(result.current.task).toEqual(ready));
	expect(api.checkMediaCompatibility).toHaveBeenCalled();
	expect(api.createPreparation).not.toHaveBeenCalled();
});
test("missing pre-transcode is reported and does not enqueue work", async () => {
	const { result } = renderHook(
		() => usePreparedPlayback("file", "version", true),
		{ wrapper: Wrapper },
	);
	await waitFor(() => expect(result.current.loading).toBe(false));
	expect(result.current.task).toBeNull();
	expect(result.current.pending).toBe(false);
	expect(api.createPreparation).not.toHaveBeenCalled();
});
test("unsupported and stale completed copies are refused", async () => {
	vi.mocked(api.checkMediaCompatibility).mockResolvedValueOnce({
		output: { combinations: { "copy-copy": "unsupported" } },
	} as unknown as CompatibilityResult);
	await expect(
		verifyPreparedPlayback(ready, new AbortController().signal),
	).rejects.toThrow("not confirmed");
	vi.mocked(api.getPreparation).mockResolvedValueOnce({
		...ready,
		status: "failed",
		playbackUrl: null,
		artifactId: null,
	});
	await expect(
		verifyPreparedPlayback(ready, new AbortController().signal),
	).rejects.toThrow("unavailable");
	expect(api.createPreparation).not.toHaveBeenCalled();
});
test("cancel and retry remain explicit and retry obtains fresh evidence", async () => {
	const refresh = vi.fn();
	const view = render(<PreparationTaskCard task={task} refresh={refresh} />);
	fireEvent.click(view.getByRole("button", { name: "Cancel preparation" }));
	await waitFor(() =>
		expect(api.cancelPreparation).toHaveBeenCalledWith(
			task.id,
			expect.anything(),
		),
	);
	view.rerender(
		<PreparationTaskCard
			task={{ ...task, status: "failed", failureReason: "interrupted" }}
			refresh={refresh}
		/>,
	);
	fireEvent.click(view.getByRole("button", { name: "Retry preparation" }));
	await waitFor(() =>
		expect(api.retryPreparation).toHaveBeenCalledWith(
			task.id,
			expect.objectContaining({ evidence }),
			expect.anything(),
		),
	);
});
test("unknown source availability hides Watch and deleting a copy never cancels the original", async () => {
	const view = render(
		<PreparationTaskCard
			task={{ ...ready, playbackAvailability: "unknown", playbackUrl: null }}
			refresh={vi.fn()}
			onWatch={vi.fn()}
		/>,
	);
	expect(
		view.queryByRole("button", { name: "Watch prepared copy" }),
	).toBeNull();
	fireEvent.click(view.getByRole("button", { name: "Delete prepared copy" }));
	await waitFor(() =>
		expect(api.deletePreparedMedia).toHaveBeenCalledWith(
			ready.artifactId,
			expect.anything(),
		),
	);
	expect(api.cancelPreparation).not.toHaveBeenCalled();
});
test("a pending task completing updates automatic playback even while the monitor is collapsed", async () => {
	vi.mocked(api.getPreparations).mockResolvedValue({ tasks: [task] });
	const { result } = renderHook(
		() => usePreparedPlayback("file", "version", true),
		{ wrapper: Wrapper },
	);
	await waitFor(() => expect(result.current.pending).toBe(true));
	vi.mocked(api.getPreparations).mockResolvedValue({ tasks: [ready] });
	await waitFor(() => expect(result.current.task).toEqual(ready), {
		timeout: 3000,
	});
});
test("automatic prepared selection survives StrictMode and does not start transcoding", async () => {
	vi.mocked(api.getPreparations).mockResolvedValue({ tasks: [ready] });
	const wrapper = ({ children }: { children: ReactNode }) => (
		<StrictMode>
			<Wrapper>{children}</Wrapper>
		</StrictMode>
	);
	const { result } = renderHook(
		() => usePreparedPlayback("file", "version", true),
		{ wrapper },
	);
	await waitFor(() => expect(result.current.task).toEqual(ready));
	expect(api.createPreparation).not.toHaveBeenCalled();
});

test("automatic playback discovers older ready copies outside the global recent-task window", async () => {
	vi.mocked(api.getPreparations).mockResolvedValue({ tasks: [] });
	vi.mocked(api.getFilePreparations).mockResolvedValue({ tasks: [ready] });
	const { result } = renderHook(
		() => usePreparedPlayback("file", "version", true),
		{ wrapper: Wrapper },
	);
	await waitFor(() => expect(result.current.task).toEqual(ready));
	expect(api.getFilePreparations).toHaveBeenCalledWith(
		"file",
		expect.anything(),
	);
	expect(api.createPreparation).not.toHaveBeenCalled();
});

test("file menu discovers older prepared copies and deletes them even for a supported original", async () => {
	vi.mocked(api.getFilePreparations).mockResolvedValue({ tasks: [ready] });
	const view = render(
		<Wrapper>
			<FileActions
				fileId="file"
				loading={false}
				result={{
					...unsupported,
					direct: { status: "supported", reason: "browser-supported" },
				}}
				error={null}
				onRecheck={vi.fn()}
			/>
		</Wrapper>,
	);
	await waitFor(() => expect(api.getFilePreparations).toHaveBeenCalled());
	expect(
		await view.findByRole("button", {
			name: "A pre-transcoded copy is ready.",
		}),
	).toBeTruthy();
	fireEvent.click(view.getByRole("button", { name: "File actions" }));
	const remove = await view.findByRole("menuitem", {
		name: "Delete prepared copy",
	});
	expect(view.queryByRole("menuitem", { name: "Pre-transcode" })).toBeNull();
	fireEvent.click(remove);
	await waitFor(() =>
		expect(api.deletePreparedMedia).toHaveBeenCalledWith(
			"artifact",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		),
	);
	expect(api.cancelPreparation).not.toHaveBeenCalled();
});

test("task monitor disappears when its last active task completes", async () => {
	vi.mocked(api.getPreparations).mockResolvedValue({ tasks: [task] });
	const view = render(
		<Wrapper>
			<PreparationMonitor />
		</Wrapper>,
	);
	const monitor = await view.findByRole("complementary", {
		name: "Transcoding tasks",
	});
	vi.mocked(api.getPreparations).mockResolvedValue({ tasks: [ready] });
	fireEvent.click(view.getByRole("button", { name: "Refresh tasks" }));
	await waitFor(() => expect(monitor.isConnected).toBe(false));
});

test("preparation from a file menu continues after the menu closes", async () => {
	const view = render(
		<Wrapper>
			<FileActions
				fileId="file"
				loading={false}
				result={unsupported}
				error={null}
				onRecheck={vi.fn()}
			/>
		</Wrapper>,
	);
	fireEvent.click(view.getByRole("button", { name: "File actions" }));
	fireEvent.click(await view.findByRole("menuitem", { name: "Pre-transcode" }));
	await waitFor(() =>
		expect(api.createPreparation).toHaveBeenCalledWith(
			"file",
			expect.objectContaining({ sourceVersion: "version" }),
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		),
	);
	expect(view.queryByRole("menu")).toBeNull();
});

test("an older or unavailable copy does not mark the current file prepared", async () => {
	vi.mocked(api.getFilePreparations).mockResolvedValue({
		tasks: [
			{ ...ready, sourceVersion: "old-version" },
			{ ...ready, id: "unavailable", playbackAvailability: "unavailable" },
		],
	});
	const view = render(
		<Wrapper>
			<FileActions
				fileId="file"
				loading={false}
				result={unsupported}
				error={null}
				onRecheck={vi.fn()}
			/>
		</Wrapper>,
	);
	await view.findByRole("button", {
		name: "This file is not supported by this browser.",
	});
	expect(
		view.queryByRole("button", { name: "A pre-transcoded copy is ready." }),
	).toBeNull();
});

test.each([task, ready])(
	"file menu contains operations without $status status entries",
	async (entry) => {
		vi.mocked(api.getFilePreparations).mockResolvedValue({ tasks: [entry] });
		const view = render(
			<Wrapper>
				<FileActions
					fileId="file"
					loading={false}
					result={unsupported}
					error={null}
					onRecheck={vi.fn()}
				/>
			</Wrapper>,
		);
		fireEvent.click(view.getByRole("button", { name: "File actions" }));
		await view.findByRole("menuitem", {
			name:
				entry.status === "ready"
					? "Delete prepared copy"
					: "Cancel preparation",
		});
		for (const name of [
			"Queued",
			"Preparing",
			"Ready",
			"Checking playback compatibility…",
			"Loading prepared copies…",
			"Pre-transcode",
		]) {
			expect(view.queryByRole("menuitem", { name })).toBeNull();
		}
	},
);

const multiAudio = {
	...unsupported,
	direct: { status: "unknown", reason: "native-track-selection-uncertain" },
	audioTracks: [
		{
			stream: {
				index: 4,
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
				index: 7,
				label: "Japanese",
				language: "jpn",
				codec: "ac3",
				channels: 6,
				default: false,
			},
			compatibility: { status: "unsupported", reason: "browser-rejected" },
		},
	],
} as CompatibilityResult;

test.each(["all", "subset", "none"])(
	"multi-audio preparation chooses %s with fresh bound evidence",
	async (selection) => {
		const view = render(
			<PreparationButton
				fileId="file"
				loading={false}
				result={multiAudio}
				error={null}
				onRecheck={vi.fn()}
				showLabel
			/>,
			{ wrapper: Wrapper },
		);
		await waitFor(() =>
			expect(
				(
					view.getByRole("button", {
						name: "Pre-transcode",
					}) as HTMLButtonElement
				).disabled,
			).toBe(false),
		);
		fireEvent.click(view.getByRole("button", { name: "Pre-transcode" }));
		const english = await view.findByRole("checkbox", { name: /English/ });
		const japanese = view.getByRole("checkbox", { name: /Japanese/ });
		expect((english as HTMLInputElement).checked).toBe(true);
		expect((japanese as HTMLInputElement).checked).toBe(true);
		if (selection === "subset") fireEvent.click(english);
		if (selection === "none")
			fireEvent.click(view.getByRole("button", { name: "No audio" }));
		expect(api.createPreparation).not.toHaveBeenCalled();
		fireEvent.click(view.getByRole("button", { name: "Prepare for browser" }));
		await waitFor(() => expect(api.createPreparation).toHaveBeenCalledTimes(1));
		const input = vi.mocked(api.createPreparation).mock.calls[0]?.[1];
		if (selection === "all")
			expect(input).not.toHaveProperty("audioStreamIndices");
		else
			expect(input?.audioStreamIndices).toEqual(
				selection === "subset" ? [7] : [],
			);
		expect(
			vi.mocked(api.inspectMediaCompatibility).mock.calls.at(-1)?.[0]
				.audioStreamIndices,
		).toEqual(input?.audioStreamIndices);
	},
);

test("an existing all-audio copy does not disable preparing a selected audio track", async () => {
	vi.mocked(api.getPreparations).mockResolvedValue({
		tasks: [{ ...ready, audioStreamIndices: [4, 7] }],
	});
	const view = render(
		<PreparationButton
			fileId="file"
			loading={false}
			result={{
				...multiAudio,
				direct: { status: "supported", reason: "browser-supported" },
			}}
			error={null}
			onRecheck={vi.fn()}
			audioStreamIndices={[7]}
			showLabel
		/>,
		{ wrapper: Wrapper },
	);
	await waitFor(() =>
		expect(
			(view.getByRole("button", { name: "Pre-transcode" }) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	fireEvent.click(view.getByRole("button", { name: "Pre-transcode" }));
	await waitFor(() =>
		expect(api.createPreparation).toHaveBeenCalledWith(
			"file",
			expect.objectContaining({ audioStreamIndices: [7] }),
			expect.anything(),
		),
	);
});

test("ready-copy reuse filters audio selection and rechecks the exact tracks", async () => {
	const japanese = {
		...ready,
		id: "japanese",
		artifactId: "jp",
		audioStreamIndices: [7],
	};
	vi.mocked(api.getPreparations).mockResolvedValue({
		tasks: [{ ...ready, audioStreamIndices: [4, 7] }, japanese],
	});
	vi.mocked(api.getPreparation).mockResolvedValue(japanese);
	const { result, rerender } = renderHook(
		({ selection }: { selection: number[] }) =>
			usePreparedPlayback("file", "version", true, selection, [4, 7]),
		{ initialProps: { selection: [7] }, wrapper: Wrapper },
	);
	await waitFor(() => expect(result.current.task?.id).toBe("japanese"));
	expect(api.checkMediaCompatibility).toHaveBeenCalledWith(
		expect.objectContaining({ audioStreamIndices: [7] }),
		expect.anything(),
	);
	rerender({ selection: [4] });
	await waitFor(() => expect(result.current.loading).toBe(false));
	expect(result.current.task).toBeNull();
});

test("task retry and verification retain audio selection and reject changed task tracks", async () => {
	const selected = { ...ready, audioStreamIndices: [7] };
	vi.mocked(api.getPreparation).mockResolvedValue({
		...selected,
		audioStreamIndices: [4],
	});
	await expect(
		verifyPreparedPlayback(selected, new AbortController().signal),
	).rejects.toThrow("unavailable");
	const view = render(
		<PreparationTaskCard
			task={{ ...selected, status: "failed" }}
			refresh={vi.fn()}
		/>,
		{ wrapper: Wrapper },
	);
	fireEvent.click(view.getByRole("button", { name: "Retry preparation" }));
	await waitFor(() =>
		expect(api.retryPreparation).toHaveBeenCalledWith(
			selected.id,
			expect.objectContaining({ audioStreamIndices: [7] }),
			expect.anything(),
		),
	);
});

test("default-all playback does not silently reuse a subset copy", async () => {
	vi.mocked(api.getPreparations).mockResolvedValue({
		tasks: [{ ...ready, audioStreamIndices: [7] }],
	});
	const { result } = renderHook(
		() => usePreparedPlayback("file", "version", true, undefined, [4, 7]),
		{ wrapper: Wrapper },
	);
	await waitFor(() => expect(result.current.loading).toBe(false));
	expect(result.current.task).toBeNull();
	expect(api.checkMediaCompatibility).not.toHaveBeenCalled();
});

test.each([undefined, [7], []])(
	"unknown multi-audio selection %s offers pre-transcode",
	async (audioStreamIndices) => {
		const view = render(
			<PreparationButton
				fileId="file"
				loading={false}
				result={{
					...multiAudio,
					direct: { status: "unknown", reason: "browser-uncertain" },
				}}
				error={null}
				onRecheck={vi.fn()}
				{...(audioStreamIndices !== undefined ? { audioStreamIndices } : {})}
				showLabel
			/>,
			{ wrapper: Wrapper },
		);
		expect(
			await view.findByRole("button", { name: "Pre-transcode" }),
		).toBeTruthy();
	},
);
