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

test("directory action has a placeholder while checking and no transcode button for supported or unknown files", async () => {
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
	expect(view.queryByRole("button", { name: "Pre-transcode" })).toBeNull();
	expect(view.getByRole("button", { name: "Check again" })).toBeTruthy();
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
	const select = await view.findByRole("combobox", {
		name: "Choose a profile",
	});
	await waitFor(() =>
		expect((select as HTMLSelectElement).value).toBe(task.profileId),
	);
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
