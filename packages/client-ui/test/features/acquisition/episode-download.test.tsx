// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { EpisodeDownloadAction } from "../../../src/features/acquisition/episode-download-action.js";
import * as api from "../../../src/shared/api/client.js";
import type { DownloadActivity } from "../../../src/shared/api/contracts.js";
import { queryClient } from "../../setup.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "../../support/query-test-utils.js";

afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.restoreAllMocks();
});
const item: DownloadActivity["items"][number] = {
	origin: "one-off",
	canRetryAcquisition: true,
	id: "task",
	revision: "one",
	workKey: "anilist:anime:1",
	candidateId: "candidate",
	episode: 3,
	title: "Release",
	state: "bound",
	transfer: "downloading",
	progress: 0.42,
	ingestion: "not-ready",
	error: null,
	attempts: 1,
	nextAttemptAt: 0,
	observedAt: 1,
	updatedAt: 1,
	createdAt: 1,
};
function activity(
	items: DownloadActivity["items"],
	total = items.length,
): DownloadActivity {
	return {
		authorized: false,
		destination: null,
		items,
		total,
		active: 1,
		attention: 0,
		managedCandidateIds: [],
		page: 1,
	};
}

test.each([
	[{}, "↓ 42%"],
	[{ progress: null }, "Downloading"],
	[{ state: "discovering" }, "Searching"],
	[{ state: "pending" }, "Waiting"],
	[{ progress: 1 }, "Processing"],
	[{ ingestion: "validating" }, "Processing"],
	[{ transfer: "pausedDL" }, "Paused"],
	[{ error: "file_size_conflict" }, "Needs attention"],
] as const)("shows compact episode state %j", async (override, label) => {
	vi.spyOn(api, "request").mockResolvedValue(
		activity([{ ...item, ...override }]),
	);
	render(<EpisodeDownloadAction workKey={item.workKey} episode={3} />);
	expect(await screen.findByText(label)).toBeTruthy();
	expect(screen.queryByRole("progressbar")).toBeNull();
});

test("shares all activity pages across rows and opens only the selected episode", async () => {
	const request = vi.spyOn(api, "request").mockImplementation(async (path) => {
		if (path === "/api/settings") return {};
		return path.endsWith("page=2")
			? activity([{ ...item, id: "second", episode: 22 }], 21)
			: activity([item], 21);
	});
	render(
		<>
			<EpisodeDownloadAction workKey={item.workKey} episode={3} />
			<EpisodeDownloadAction workKey={item.workKey} episode={22} />
		</>,
	);
	await waitFor(() => expect(screen.getAllByText("↓ 42%")).toHaveLength(2));
	expect(
		request.mock.calls.filter(([path]) => path.includes("/downloads?")),
	).toHaveLength(2);
	fireEvent.click(screen.getByRole("button", { name: /episode 22:/ }));
	await screen.findByRole("dialog", { name: "Episode 22 task" });
	expect(await screen.findByText(/Episode 22 ·/)).toBeTruthy();
	expect(screen.queryByText(/Episode 3 ·/)).toBeNull();
	expect(screen.queryByText("Diagnostics")).toBeNull();
});

test("retains reported progress and marks it stale when a background read fails", async () => {
	const key = ["acquisition", "downloads", item.workKey, "episodes"];
	queryClient.setQueryDefaults(key, { retry: false });
	const request = vi.spyOn(api, "request").mockResolvedValue(activity([item]));
	render(<EpisodeDownloadAction workKey={item.workKey} episode={3} />);
	await screen.findByText("↓ 42%");
	request.mockRejectedValue(new Error("Offline"));
	await queryClient.invalidateQueries({ queryKey: key });
	expect(await screen.findByText("↓ 42% · Stale")).toBeTruthy();
	expect(screen.queryByText("Needs attention")).toBeNull();
});
