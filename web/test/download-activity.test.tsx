// @vitest-environment happy-dom
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { DownloadDestinationSettings } from "../src/features/acquisition/destination-settings.js";
import { DownloadActivityPanel } from "../src/features/acquisition/download-activity.js";
import * as api from "../src/shared/api/client.js";
import type {
	DownloadActivity,
	SubscriptionView,
} from "../src/shared/api/contracts.js";
import { queryClient } from "../src/shared/api/query-client.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "./query-test-utils.js";

afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.restoreAllMocks();
});
const view: SubscriptionView = {
	subscription: {
		workKey: "anilist:anime:1",
		feedId: "feed",
		startEpisode: 1,
		enabled: true,
		revision: "one",
		source: "https://example.org",
		sourceKind: "feed",
		checkedAt: 1,
		nextAttemptAt: 2,
		error: null,
	},
	candidates: [],
	total: 0,
	page: 1,
};
const item: DownloadActivity["items"][number] = {
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
	observedAt: Date.now(),
	updatedAt: Date.now(),
	createdAt: Date.now(),
};
function fixture(override: Partial<typeof item> = {}) {
	const activity: DownloadActivity = {
		authorized: true,
		destination: "/downloads/Anime",
		items: [{ ...item, ...override }],
		total: 1,
		active: 1,
		attention: override.error ? 1 : 0,
		managedCandidateIds: ["candidate"],
		page: 1,
	};
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (path, method) => {
			if (path === "/api/settings")
				return { qbittorrentWebUiUrl: "https://downloads.example.org/" };
			if (path.includes("/retry")) return { accepted: true };
			if (method === "GET") return activity;
			throw new Error("Unexpected request");
		});
	render(
		<MemoryRouter>
			<DownloadActivityPanel
				workKey="anilist:anime:1"
				view={view}
				reason={(code) => code}
				onConfigure={() => {}}
			/>
		</MemoryRouter>,
	);
	return request;
}
test("compact activity is collapsed, reports real progress and delegates transfer controls to WebUI", async () => {
	const request = fixture();
	await screen.findByText("Downloading 42%");
	expect(document.querySelector("details")?.open).toBe(false);
	expect(
		screen.getByRole("link", { name: "Open WebUI" }).getAttribute("href"),
	).toBe("https://downloads.example.org/");
	expect(
		screen.queryByRole("button", { name: /pause|resume|cancel|delete|retry/i }),
	).toBeNull();
	expect(request.mock.calls.every((call) => call[1] === "GET")).toBe(true);
});
test("import failure offers only import recovery and settings, without resubmitting a download", async () => {
	const request = fixture({ ingestion: "failed", error: "file_size_conflict" });
	await screen.findByText("Import failed");
	fireEvent.click(await screen.findByRole("button", { name: "Retry import" }));
	await waitFor(() =>
		expect(
			request.mock.calls.some((call) => call[0].endsWith("/task/retry")),
		).toBe(true),
	);
	expect(
		request.mock.calls.find((call) => call[0].endsWith("/task/retry"))?.[3],
	).toMatchObject({
		revision: "one",
		kind: "import",
		commandId: expect.any(String),
	});
	expect(
		screen.queryByRole("button", { name: "Retry acquisition" }),
	).toBeNull();
});
test("externally removed tasks require explicit acquisition retry", async () => {
	fixture({
		state: "missing",
		transfer: "missing",
		error: "externally_removed",
	});
	await screen.findByText("Removed in qBittorrent");
	expect(
		screen.getByRole("button", { name: "Retry acquisition" }),
	).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Retry import" })).toBeNull();
});
test("destination settings separate saving from validation and do not start downloads", async () => {
	let destination: null | {
		revision: string;
		scopeId: string;
		path: string;
		validated: boolean;
		visibilityVerified: boolean;
		connectionGeneration: string;
	} = null;
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (path, method, _options, payload) => {
			if (method === "GET")
				return { destination, roots: [{ scopeId: "root", name: "Anime" }] };
			if (method === "PUT") {
				destination = {
					...(payload as { scopeId: string; path: string }),
					revision: "saved",
					validated: false,
					visibilityVerified: false,
					connectionGeneration: "one",
				};
				return destination;
			}
			if (path.endsWith("/validate")) {
				if (!destination) throw new Error();
				destination = { ...destination, validated: true };
				return destination;
			}
			throw new Error();
		});
	render(<DownloadDestinationSettings />);
	await screen.findByLabelText("qBittorrent completed path");
	expect(
		(screen.getByLabelText("qBittorrent completed path") as HTMLInputElement)
			.value,
	).toBe("/data/media");
	fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
	await screen.findByText("Validation required");
	expect(request.mock.calls.some((call) => call[0].endsWith("/validate"))).toBe(
		false,
	);
	fireEvent.click(screen.getByRole("button", { name: "Validate destination" }));
	await screen.findByText(
		"Mapping configured · File visibility not yet verified",
	);
	expect(
		request.mock.calls
			.filter((call) => call[1] !== "GET")
			.map((call) => call[0]),
	).toEqual([
		"/api/acquisition/downloads/settings",
		"/api/acquisition/downloads/validate",
	]);
});
