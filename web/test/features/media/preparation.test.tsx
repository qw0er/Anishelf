// @vitest-environment happy-dom
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "../../../src/features/media/preparation/api.js";
import { PreparationButton } from "../../../src/features/media/preparation/components/preparation-button.js";
import { PreparationTaskCard } from "../../../src/features/media/preparation/components/task-card.js";
import { PreparationProvider } from "../../../src/features/media/preparation/context.js";
import * as settings from "../../../src/features/settings/api.js";
import type { PreparationTaskResponse } from "../../../src/shared/api/contracts.js";
import "../../../src/shared/i18n.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "../../support/query-test-utils.js";

const source = { sourceVersion: "v1", audioTracks: [] };
const task: PreparationTaskResponse = {
	id: "task",
	fileId: "file",
	filename: "Episode.mkv",
	sourceVersion: "v1",
	profileId: "builtin:balanced",
	mode: "transcode",
	reasons: { video: "encoding-required", audio: "encoding-required" },
	status: "failed",
	playbackAvailability: "unavailable",
	progress: null,
	failureReason: "interrupted",
	createdAtMs: 1,
	updatedAtMs: 1,
	artifactId: null,
	resource: null,
	sizeBytes: null,
};
beforeEach(() => {
	vi.spyOn(api, "getPreparations").mockResolvedValue({
		tasks: [],
		hasMore: false,
	});
	vi.spyOn(settings, "getTranscodeProfiles").mockResolvedValue({
		profiles: [
			{
				id: "builtin:balanced",
				name: "Balanced",
				description: "Manual copy",
				container: "matroska",
				source: "builtin",
				videoCodec: "h264",
				audioCodec: "aac",
				validation: { status: "recognized", issues: [] },
			},
		],
		selectedProfileId: "builtin:balanced",
		selectionAvailable: true,
		revision: "test",
	});
	vi.spyOn(api, "createPreparation").mockResolvedValue({
		kind: "task",
		task: { ...task, status: "queued", failureReason: null },
	});
	vi.spyOn(api, "retryPreparation").mockResolvedValue({
		...task,
		status: "queued",
		failureReason: null,
	});
	vi.spyOn(api, "cancelPreparation").mockResolvedValue({
		...task,
		status: "cancelled",
		failureReason: "cancelled",
	});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
function mount(element: React.ReactNode) {
	return render(
		<MemoryRouter>
			<PreparationProvider>{element}</PreparationProvider>
		</MemoryRouter>,
	);
}
test("manual preparation submits a concrete command without browser evidence", async () => {
	mount(<PreparationButton fileId="file" source={source} showLabel />);
	const button = await screen.findByRole("button", { name: "Pre-transcode" });
	await waitFor(() =>
		expect(button.getAttribute("aria-disabled")).not.toBe("true"),
	);
	fireEvent.click(button);
	await waitFor(() => expect(api.createPreparation).toHaveBeenCalled());
	expect(vi.mocked(api.createPreparation).mock.calls[0]?.slice(0, 2)).toEqual([
		"file",
		{ sourceVersion: "v1", profileId: "builtin:balanced" },
	]);
});
test("explicit silent output remains distinct from all audio tracks", async () => {
	mount(
		<PreparationButton
			fileId="file"
			source={source}
			audioStreamIndices={[]}
			showLabel
		/>,
	);
	const button = await screen.findByRole("button", { name: "Pre-transcode" });
	await waitFor(() =>
		expect(button.getAttribute("aria-disabled")).not.toBe("true"),
	);
	fireEvent.click(button);
	await waitFor(() => expect(api.createPreparation).toHaveBeenCalled());
	expect(vi.mocked(api.createPreparation).mock.calls[0]?.[1]).toEqual({
		sourceVersion: "v1",
		profileId: "builtin:balanced",
		audioStreamIndices: [],
	});
});
test("retry sends the original task intent without compatibility negotiation", async () => {
	mount(<PreparationTaskCard task={{ ...task, audioStreamIndices: [2] }} />);
	fireEvent.click(
		await screen.findByRole("button", { name: "Retry preparation" }),
	);
	await waitFor(() => expect(api.retryPreparation).toHaveBeenCalled());
	expect(vi.mocked(api.retryPreparation).mock.calls[0]?.slice(0, 2)).toEqual([
		"task",
		{
			sourceVersion: "v1",
			profileId: "builtin:balanced",
			audioStreamIndices: [2],
		},
	]);
});
test("cancel is an explicit operation on the active task", async () => {
	mount(
		<PreparationTaskCard
			task={{ ...task, status: "queued", failureReason: null }}
		/>,
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Cancel preparation" }),
	);
	await waitFor(() =>
		expect(api.cancelPreparation).toHaveBeenCalledWith(
			"task",
			expect.anything(),
		),
	);
});
