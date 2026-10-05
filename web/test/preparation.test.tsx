// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "../src/api/client.js";
import type {
	CompatibilityInspection,
	CompatibilityResult,
	PreparationTaskResponse,
} from "../src/api/contracts.js";
import { toast } from "../src/components/ui/toast.js";
import { FilePreparation } from "../src/features/preparation/components/file-preparation.js";
import { PreparationTaskCard } from "../src/features/preparation/components/task-card.js";
import { verifyPreparedPlayback } from "../src/features/preparation/negotiation.js";
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
beforeEach(() => {
	vi.spyOn(api, "getTranscodeProfiles").mockResolvedValue({
		profiles: [
			{
				id: task.profileId,
				name: "Browser copy",
				description: "MP4 browser profile",
				source: "builtin",
				usage: "preparation",
			},
		],
		selectedProfileId: task.profileId,
		selectionAvailable: true,
	});
	vi.spyOn(api, "getPreparations").mockResolvedValue({ tasks: [] });
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
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
function panel(props: Partial<Parameters<typeof FilePreparation>[0]> = {}) {
	const onSelect = vi.fn();
	const view = render(
		<MemoryRouter>
			<FilePreparation
				fileId="file"
				sourceVersion="version"
				onSelect={onSelect}
				{...props}
			/>
		</MemoryRouter>,
	);
	return { ...view, onSelect };
}
test("create negotiates source/profile-bound fresh evidence, and departure does not cancel the server task", async () => {
	const view = panel();
	fireEvent.click(
		await view.findByRole("button", { name: "Prepare for browser" }),
	);
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
	expect(api.inspectMediaCompatibility).toHaveBeenCalledWith(
		{
			fileId: "file",
			sourceVersion: "version",
			output: { profileId: task.profileId, target: "file" },
		},
		expect.anything(),
	);
	expect(view.onSelect).not.toHaveBeenCalled();
	view.unmount();
	expect(api.cancelPreparation).not.toHaveBeenCalled();
});
test("blocked and direct responses do not pretend that a prepared copy is ready", async () => {
	vi.mocked(api.createPreparation)
		.mockResolvedValueOnce({ kind: "blocked", reason: "insufficient-evidence" })
		.mockResolvedValueOnce({
			kind: "direct",
			plan: { mode: "direct", playbackUrl: "/api/media/file" },
		});
	const view = panel();
	const button = await view.findByRole("button", {
		name: "Prepare for browser",
	});
	fireEvent.click(button);
	await view.findByText(
		"There is insufficient evidence to choose a preparation mode.",
	);
	expect(view.onSelect).not.toHaveBeenCalled();
	fireEvent.click(button);
	await waitFor(() => expect(view.onSelect).toHaveBeenCalledWith(null));
});
test("ready reuse checks the actual retained/encoded combination and does not create another job", async () => {
	vi.mocked(api.getPreparations).mockResolvedValue({ tasks: [ready] });
	const view = panel();
	fireEvent.click(
		await view.findByRole("button", { name: "Watch prepared copy" }),
	);
	await waitFor(() => expect(view.onSelect).toHaveBeenCalledWith(ready));
	expect(api.checkMediaCompatibility).toHaveBeenCalled();
	expect(api.createPreparation).not.toHaveBeenCalled();
});
test("unsupported browser and stale ready copy are refused", async () => {
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
test("ready links from the task list survive StrictMode and verify before selection", async () => {
	const onSelect = vi.fn();
	render(
		<StrictMode>
			<MemoryRouter>
				<FilePreparation
					fileId="file"
					sourceVersion="version"
					requestedTaskId={ready.id}
					onSelect={onSelect}
				/>
			</MemoryRouter>
		</StrictMode>,
	);
	await waitFor(() => expect(onSelect).toHaveBeenCalledWith(ready));
	expect(api.createPreparation).not.toHaveBeenCalled();
});
test("cancel and explicit retry are distinct, and retry obtains fresh evidence", async () => {
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
	expect(capabilities.queryCapabilities).toHaveBeenCalledWith(
		[],
		expect.any(AbortSignal),
		true,
	);
});
test("unknown availability hides Watch; cache deletion leaves the original untouched", async () => {
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
test("polling updates processing progress to ready, and cleanup aborts requests", async () => {
	vi.mocked(api.getPreparations)
		.mockResolvedValueOnce({
			tasks: [
				{
					...task,
					status: "processing",
					progress: {
						percent: 45,
						speed: 2,
						mediaTimeMs: 1000,
						frames: 30,
						outputBytes: 100,
						ended: false,
					},
				},
			],
		})
		.mockResolvedValue({ tasks: [ready] });
	const view = panel();
	await view.findByRole("progressbar");
	await view.findByRole(
		"button",
		{ name: "Watch prepared copy" },
		{ timeout: 3000 },
	);
	const options = vi.mocked(api.getPreparations).mock.calls.at(-1)?.[0];
	view.unmount();
	expect(options?.signal?.aborted).toBe(true);
});
test("failed creation is actionable and profile selection unavailable requires a choice", async () => {
	const add = vi.spyOn(toast, "add").mockReturnValue("notification");
	vi.mocked(api.getTranscodeProfiles).mockResolvedValue({
		profiles: [
			{
				id: task.profileId,
				name: "Browser copy",
				description: "profile",
				source: "builtin",
				usage: "preparation",
			},
		],
		selectedProfileId: "custom:missing",
		selectionAvailable: false,
	});
	vi.mocked(api.createPreparation).mockRejectedValueOnce(
		new api.ApiClientError({
			kind: "http",
			message: "full",
			code: "PREPARATION_CACHE_FULL",
		}),
	);
	const view = panel();
	const button = await view.findByRole("button", {
		name: "Prepare for browser",
	});
	expect((button as HTMLButtonElement).disabled).toBe(true);
	fireEvent.change(view.getByRole("combobox"), {
		target: { value: task.profileId },
	});
	fireEvent.click(button);
	await waitFor(() =>
		expect(add).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "error",
				title:
					"The prepared media cache is full. Delete a prepared copy and retry.",
			}),
		),
	);
	expect((button as HTMLButtonElement).disabled).toBe(false);
});
