// @vitest-environment happy-dom
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PlayerViewingControl } from "../../../src/features/anime/tracking/player-viewing-control.js";
import type { TrackingOperationResponse } from "../../../src/shared/api/contracts.js";
import { queryClient } from "../../../src/shared/api/query-client.js";
import { toast } from "../../../src/shared/components/ui/toast.js";
import "../../../src/shared/i18n.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "../../support/query-test-utils.js";
import { trackingProvider } from "../../support/tracking-fixture.js";

const target = {
	fileId: "file",
	sourceVersion: "v1",
	reviewId: "review",
	mappingRevision: 1,
	episodeId: "ep7",
	mediaId: "anilist:anime:9",
	episode: 7,
};
let operation: TrackingOperationResponse | undefined;
let confirmed = 3;
const fetcher = vi.fn<typeof fetch>();
const op = (
	state: TrackingOperationResponse["state"],
): TrackingOperationResponse => ({
	id: "operation",
	origin: "manual-player",
	commandId: "command",
	intentAt: 1,
	target,
	decisionReason: state === "decision-required" ? "skipped-episodes" : null,
	accountId: "anilist:7",
	mediaId: "anilist:anime:9",
	revision: (operation?.revision ?? 0) + 1,
	baseline: { id: "anilist:1", progress: 3, status: "watching", updatedAt: 1 },
	desired: { progress: 7 },
	state,
	remote: {
		id: "anilist:1",
		progress: state === "succeeded" ? 7 : 3,
		status: "watching",
		updatedAt: 1,
	},
	attempts: 0,
	retryAt: null,
	error: null,
	updatedAt: 1,
});
beforeEach(() => {
	confirmed = 3;
	operation = undefined;
	fetcher.mockReset().mockImplementation(async (url, init) => {
		const path = String(url);
		if (path.endsWith("/account"))
			return Response.json({
				provider: trackingProvider,
				account: { id: "anilist:7", name: "Fixture" },
				generation: "generation",
				state: "connected",
			});
		if (path.includes("/episode-target?"))
			return Response.json({ state: "resolved", target });
		if (path.includes("/operations?"))
			return Response.json(operation ? [operation] : []);
		if (path.includes("/entries/anilist%3Aanime%3A9?"))
			return Response.json({
				provider: trackingProvider,
				accountId: "anilist:7",
				generation: "generation",
				state: "connected",
				fetchedAt: 1000,
				stale: false,
				refreshing: false,
				error: null,
				entry: {
					id: "anilist:1",
					mediaId: "anilist:anime:9",
					progress: confirmed,
					status: "watching",
					updatedAt: 1,
				},
			});
		if (path.endsWith("/episode-commands")) {
			const body = JSON.parse(String(init?.body));
			operation = op(
				body.action === "keep"
					? "cancelled"
					: body.confirmSkipped
						? "pending"
						: "decision-required",
			);
			return Response.json(operation);
		}
		if (path.endsWith("/retry")) {
			operation = op("pending");
			return Response.json(operation);
		}
		throw Error(`Unexpected request ${path}`);
	});
	vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
function mount() {
	return render(
		<MemoryRouter>
			<PlayerViewingControl fileId="file" sourceVersion="v1" />
		</MemoryRouter>,
	);
}
test("the player control offers no progress editor", async () => {
	mount();
	await screen.findByRole("button", { name: "Mark as watched" });
	expect(screen.queryByRole("button", { name: "Edit progress" })).toBeNull();
	expect(screen.queryByText("Progress")).toBeNull();
});
test("manual mark creates a Tracking decision, confirms separately and reports the result once", async () => {
	const notify = vi.spyOn(toast, "add");
	mount();
	fireEvent.click(
		await screen.findByRole("button", { name: "Mark as watched" }),
	);
	await screen.findByText(/including skipped episodes/);
	const first = fetcher.mock.calls.find(
		([url, init]) =>
			String(url).endsWith("/episode-commands") && init?.method === "POST",
	);
	expect(JSON.parse(String(first?.[1]?.body))).toMatchObject({
		action: "mark",
		revision: null,
	});
	expect(JSON.parse(String(first?.[1]?.body))).not.toHaveProperty(
		"confirmSkipped",
	);
	fireEvent.click(
		screen.getByRole("button", { name: "Confirm progress update" }),
	);
	await waitFor(() =>
		expect(notify).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "loading",
				title: "Progress change queued",
			}),
		),
	);
	expect(
		(
			screen.getByRole("button", {
				name: "Mark as watched",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	operation = op("succeeded");
	confirmed = 7;
	await queryClient.invalidateQueries({ queryKey: ["tracking", "operations"] });
	await waitFor(() =>
		expect(notify).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "success",
				title: "Episode 7 marked as watched",
			}),
		),
	);
	// The completed result leaves the control instead of becoming a static label.
	expect(screen.queryByRole("status")).toBeNull();
	await screen.findByRole("button", {
		name: "Watched on the tracking service",
	});
	expect(
		fetcher.mock.calls.some(([url]) => String(url).includes("/api/playback/")),
	).toBe(false);
});
test("keep then mark again remains actionable and final submission failures offer retry", async () => {
	const notify = vi.spyOn(toast, "add");
	mount();
	fireEvent.click(
		await screen.findByRole("button", { name: "Mark as watched" }),
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Keep current progress" }),
	);
	await waitFor(() =>
		expect(notify).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "success",
				title: "Kept the previous progress",
			}),
		),
	);
	expect(screen.queryByRole("status")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Mark as watched" }));
	await screen.findByText(/including skipped episodes/);
	fireEvent.click(
		screen.getByRole("button", { name: "Confirm progress update" }),
	);
	await waitFor(() =>
		expect(notify).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "loading",
				title: "Progress change queued",
			}),
		),
	);
	expect(
		(
			screen.getByRole("button", {
				name: "Mark as watched",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	operation = { ...op("failed"), error: "unavailable" };
	await queryClient.invalidateQueries({ queryKey: ["tracking", "operations"] });
	await screen.findByText("Could not save the progress change");
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(([url]) => String(url).endsWith("/retry")),
		).toBe(true),
	);
});
test("a result stored by an earlier session stays out of the player control", async () => {
	const notify = vi.spyOn(toast, "add");
	operation = { ...op("succeeded"), id: "previous-session" };
	confirmed = 7;
	mount();
	await waitFor(() =>
		expect(
			queryClient.getQueryData([
				"tracking",
				"operations",
				"anilist:7",
				"generation",
			]),
		).toBeDefined(),
	);
	await screen.findByRole("button", {
		name: "Watched on the tracking service",
	});
	expect(screen.queryByRole("status")).toBeNull();
	expect(notify).not.toHaveBeenCalled();
	// The stored revision still anchors the next command.
	fireEvent.click(
		screen.getByRole("button", { name: "Watched on the tracking service" }),
	);
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(
				([url, init]) =>
					String(url).endsWith("/episode-commands") && init?.method === "POST",
			),
		).toBe(true),
	);
	const command = fetcher.mock.calls.find(([url]) =>
		String(url).endsWith("/episode-commands"),
	);
	expect(JSON.parse(String(command?.[1]?.body))).toMatchObject({ revision: 1 });
});
test("unmapped files show no progress controls", async () => {
	const original = fetcher.getMockImplementation();
	if (!original) throw Error("Missing fixture");
	fetcher.mockImplementation(async (url, init) =>
		String(url).includes("/episode-target?")
			? Response.json(null)
			: original(url, init),
	);
	const view = mount();
	await waitFor(() =>
		expect(
			fetcher.mock.calls.some(([url]) =>
				String(url).includes("/episode-target?"),
			),
		).toBe(true),
	);
	expect(view.container.textContent).toBe("");
});
