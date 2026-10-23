// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { SubscriptionPanel } from "../src/features/acquisition/subscription-panel.js";
import * as api from "../src/shared/api/client.js";
import type { SubscriptionView } from "../src/shared/api/contracts.js";
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
const workKey = "anilist:anime:1";
const selected = {
	id: "release",
	entryId: "entry",
	workKey,
	title: "[G] Frieren - 03 [1080p]",
	episode: 3,
	status: "selected" as const,
	reasons: [],
	version: "v1",
	snapshotId: "snapshot",
	publishedAt: 1,
};
const saved: SubscriptionView = {
	subscription: {
		workKey,
		feedId: "feed",
		startEpisode: 2,
		enabled: true,
		revision: "one",
		source: "https://feeds.example.org",
		checkedAt: 1,
		nextAttemptAt: 600001,
		error: null,
	},
	candidates: [selected],
	total: 1,
	page: 1,
};
function fixture(
	initial: SubscriptionView = {
		subscription: null,
		candidates: [],
		total: 0,
		page: 1,
	},
) {
	let view = structuredClone(initial);
	return vi
		.spyOn(api, "request")
		.mockImplementation(async (path, method, _options, payload) => {
			if (path === "/api/acquisition/profiles")
				return {
					profiles: [
						{
							id: "builtin:general",
							name: "General",
							description: "Any codec",
							source: "builtin",
						},
						{
							id: "builtin:efficient",
							name: "Efficient codecs preferred",
							description: "Prefer HEVC / AV1",
							source: "builtin",
						},
					],
					selectedProfileId: "builtin:general",
					selectionAvailable: true,
				};
			if (path === "/api/acquisition/downloads/settings")
				return {
					destination: {
						revision: "destination",
						scopeId: "root",
						path: "/downloads",
						connectionGeneration: "account",
						validated: true,
						visibilityVerified: false,
					},
					roots: [],
				};
			if (path.startsWith("/api/acquisition/downloads"))
				return {
					authorized: true,
					destination: null,
					items: [],
					total: 0,
					active: 0,
					page: 1,
				};
			if (path === "/api/settings") return { qbittorrentWebUiUrl: "" };
			if (method === "GET") return view;
			if (path === "/api/acquisition/subscriptions" && method === "PUT") {
				view = structuredClone(saved);
				return view;
			}
			if (method === "PATCH") {
				if (!saved.subscription) throw new Error("Missing saved fixture.");
				view = {
					...view,
					subscription: {
						...saved.subscription,
						revision: "two",
						enabled: (payload as { enabled: boolean }).enabled,
					},
				};
				return view;
			}
			if (method === "DELETE") {
				view = { subscription: null, candidates: [], total: 0, page: 1 };
				return { removed: true };
			}
			return view;
		});
}
test("subscription saves and enables with one request carrying the displayed destination", async () => {
	const request = fixture();
	render(<SubscriptionPanel workKey={workKey} />);
	fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }));
	fireEvent.change(await screen.findByLabelText("RSS URL"), {
		target: { value: "https://feeds.example.org/rss?passkey=private" },
	});
	fireEvent.change(screen.getByLabelText("Starting episode"), {
		target: { value: "2" },
	});
	await screen.findByText(/Automatic download destination:.*downloads/);
	expect(request.mock.calls.filter((call) => call[1] !== "GET")).toHaveLength(
		0,
	);
	expect(screen.queryByRole("button", { name: "Check RSS" })).toBeNull();
	fireEvent.click(
		screen.getByRole("button", { name: "Save and enable subscription" }),
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(request).toHaveBeenCalledWith(
		"/api/acquisition/subscriptions",
		"PUT",
		{},
		{
			workKey,
			source: {
				kind: "feed",
				url: "https://feeds.example.org/rss?passkey=private",
			},
			startEpisode: 2,
			profileId: null,
			revision: null,
			destinationRevision: "destination",
			connectionGeneration: "account",
		},
	);
	expect(request.mock.calls.filter((call) => call[1] !== "GET")).toHaveLength(
		1,
	);
	expect(
		request.mock.calls.some((call) => /preview|confirm/.test(call[0])),
	).toBe(false);
	expect(
		JSON.stringify(
			queryClient.getQueriesData({ queryKey: ["acquisition", "subscription"] }),
		),
	).not.toContain("passkey");
});
test("subscription activation is blocked until the destination is validated", async () => {
	const request = fixture();
	const implementation = request.getMockImplementation();
	request.mockImplementation(async (...args) =>
		args[0] === "/api/acquisition/downloads/settings"
			? { destination: null, roots: [] }
			: implementation?.(...args),
	);
	render(<SubscriptionPanel workKey={workKey} />);
	fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }));
	await screen.findByText(/Configure and validate a download destination/);
	expect(
		(
			screen.getByRole("button", {
				name: "Save and enable subscription",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	expect(request.mock.calls.filter((call) => call[1] !== "GET")).toHaveLength(
		0,
	);
});
test("pause, resume, edit and remove use the current subscription revision", async () => {
	const request = fixture(saved);
	render(<SubscriptionPanel workKey={workKey} />);
	fireEvent.click(
		await screen.findByRole("button", { name: "Subscription actions" }),
	);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Pause subscription" }),
	);
	await waitFor(() =>
		expect(request.mock.calls.some((call) => call[1] === "PATCH")).toBe(true),
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Subscription actions" }),
	);
	await screen.findByRole("menuitem", { name: "Resume subscription" });
	expect(request).toHaveBeenCalledWith(
		"/api/acquisition/subscriptions",
		"PATCH",
		{},
		{ workKey, revision: "one", enabled: false },
	);
	fireEvent.click(screen.getByRole("menuitem", { name: "Edit subscription" }));
	expect(
		((await screen.findByLabelText("RSS URL")) as HTMLInputElement).value,
	).toBe("");
	fireEvent.click(screen.getByRole("button", { name: "Close" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	fireEvent.click(screen.getByRole("button", { name: "Subscription actions" }));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Remove subscription" }),
	);
	await waitFor(() =>
		expect(
			screen.queryByRole("button", { name: "Subscription actions" }),
		).toBeNull(),
	);
	expect(request).toHaveBeenCalledWith(
		"/api/acquisition/subscriptions",
		"DELETE",
		{},
		{ workKey, revision: "two" },
	);
});
test("skipped candidates explain automatic decisions without review actions", async () => {
	fixture({
		...saved,
		candidates: [
			{ ...selected, status: "skipped", reasons: ["another_version_selected"] },
		],
	});
	render(<SubscriptionPanel workKey={workKey} />);
	expect(
		await screen.findByText(/Skipped · another version was selected/),
	).toBeTruthy();
	expect(screen.queryByRole("button", { name: /review|approve/i })).toBeNull();
});

test("Manage opens saved configuration without exposing the feed in the summary", async () => {
	fixture(saved);
	render(<SubscriptionPanel workKey={workKey} />);
	await screen.findByRole("button", { name: "Manage" });
	expect(screen.queryByText(saved.subscription?.source ?? "")).toBeNull();
	expect(screen.queryByLabelText("RSS URL")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Manage" }));
	await screen.findByRole("dialog", { name: "Manage RSS subscription" });
	expect(screen.getByText(saved.subscription?.source ?? "")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Close" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(screen.getByRole("button", { name: "Manage" })).toBeTruthy();
});

test("saving sends the selected release profile without a separate preview", async () => {
	const request = fixture();
	render(<SubscriptionPanel workKey={workKey} />);
	fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }));
	fireEvent.change(await screen.findByLabelText("RSS URL"), {
		target: { value: "https://feeds.example.org/rss" },
	});
	await screen.findByText("Efficient codecs preferred");
	fireEvent.change(
		screen.getByRole("combobox", { name: "Release selection profile" }),
		{ target: { value: "builtin:efficient" } },
	);
	await screen.findByText(/Automatic download destination:/);
	fireEvent.click(
		screen.getByRole("button", { name: "Save and enable subscription" }),
	);
	await waitFor(() =>
		expect(request).toHaveBeenCalledWith(
			"/api/acquisition/subscriptions",
			"PUT",
			{},
			expect.objectContaining({ profileId: "builtin:efficient" }),
		),
	);
});

test("a failed save retains editable inputs and allows a direct retry", async () => {
	const request = fixture();
	const implementation = request.getMockImplementation();
	let attempts = 0;
	request.mockImplementation(async (...args) => {
		if (
			args[0] === "/api/acquisition/subscriptions" &&
			args[1] === "PUT" &&
			attempts++ === 0
		)
			throw new Error("changed target");
		return implementation?.(...args);
	});
	render(<SubscriptionPanel workKey={workKey} />);
	fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }));
	const url = await screen.findByLabelText("RSS URL");
	fireEvent.change(url, { target: { value: "https://feeds.example.org/rss" } });
	await screen.findByText(/Automatic download destination:/);
	fireEvent.click(
		screen.getByRole("button", { name: "Save and enable subscription" }),
	);
	await waitFor(() => expect(attempts).toBe(1));
	await waitFor(() =>
		expect(
			(
				screen.getByRole("button", {
					name: "Save and enable subscription",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false),
	);
	expect((url as HTMLInputElement).value).toBe("https://feeds.example.org/rss");
	fireEvent.click(
		screen.getByRole("button", { name: "Save and enable subscription" }),
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(attempts).toBe(2);
});
