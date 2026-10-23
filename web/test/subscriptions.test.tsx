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
		sourceKind: "feed",
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
			if (path === "/api/acquisition/sources/connector")
				return {
					generation: "sites",
					ready: true,
					providers: ["site"],
					url: null,
					origin: null,
					hasApiKey: true,
					error: null,
				};
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
			if (path === "/api/acquisition/subscriptions/search")
				return {
					source: {
						kind: "search",
						connectionRevision: "sources-one",
						providerId: "nyaasi",
						titles: ["Frieren"],
					},
					attempts: [
						{
							providerId: "nyaasi",
							outcome: "matched",
							code: null,
							limited: true,
						},
					],
					releases: [
						{
							id: "found",
							title: "Frieren - 03 [1080p]",
							episode: 3,
							waiting: true,
						},
					],
				};
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
test("subscribing saves immediately with automatic source defaults and no preliminary search", async () => {
	const request = fixture();
	render(<SubscriptionPanel workKey={workKey} />);
	fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }));
	const input = await screen.findByLabelText("Starting episode");
	fireEvent.change(input, { target: { value: "4" } });
	expect(screen.queryByRole("button", { name: "Find a source" })).toBeNull();
	expect(document.querySelector("details")?.open).toBe(false);
	await waitFor(() =>
		expect(
			(screen.getByRole("button", { name: "Subscribe" }) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(request).toHaveBeenCalledWith(
		"/api/acquisition/subscriptions",
		"PUT",
		{},
		{
			workKey,
			source: { kind: "automatic" },
			startEpisode: 4,
			profileId: null,
			revision: null,
			destinationRevision: "destination",
			connectionGeneration: "account",
		},
	);
	expect(
		request.mock.calls.some((call) => /search|preview|confirm/.test(call[0])),
	).toBe(false);
});

test("RSS and profile overrides remain available in More options", async () => {
	const request = fixture();
	render(<SubscriptionPanel workKey={workKey} />);
	fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }));
	fireEvent.click(await screen.findByText("More options"));
	fireEvent.change(screen.getByLabelText("Source"), {
		target: { value: "feed" },
	});
	fireEvent.change(screen.getByLabelText("RSS URL"), {
		target: { value: "https://feeds.example.org/custom" },
	});
	fireEvent.change(screen.getByLabelText("Release selection profile"), {
		target: { value: "builtin:efficient" },
	});
	await waitFor(() =>
		expect(
			(screen.getByRole("button", { name: "Subscribe" }) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(request).toHaveBeenCalledWith(
		"/api/acquisition/subscriptions",
		"PUT",
		{},
		expect.objectContaining({
			source: { kind: "feed", url: "https://feeds.example.org/custom" },
			profileId: "builtin:efficient",
		}),
	);
});

test("header row hides global instructions and release evidence until Activity diagnostics is opened", async () => {
	const request = fixture(saved);
	render(<SubscriptionPanel workKey={workKey} />);
	await screen.findByText("Subscribed");
	expect(screen.queryByText(selected.title)).toBeNull();
	expect(screen.queryByText(/Automatic download destination/)).toBeNull();
	expect(screen.queryByRole("button", { name: "Manage" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Activity" }));
	await screen.findByRole("dialog");
	expect(
		request.mock.calls.some((call) => call[0].includes("diagnostics=true")),
	).toBe(false);
	fireEvent.click(screen.getByText("Diagnostics"));
	await waitFor(() =>
		expect(
			request.mock.calls.some((call) => call[0].includes("diagnostics=true")),
		).toBe(true),
	);
});

test("manual and Watching-created subscriptions share editing without conversion consent", async () => {
	const request = fixture(saved);
	render(<SubscriptionPanel workKey={workKey} />);
	fireEvent.click(
		await screen.findByRole("button", { name: "Subscription actions" }),
	);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Edit subscription" }),
	);
	await screen.findByLabelText("Starting episode");
	expect(screen.queryByRole("checkbox")).toBeNull();
	await waitFor(() =>
		expect(
			(
				screen.getByRole("button", {
					name: "Save changes",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(request).toHaveBeenCalledWith(
		"/api/acquisition/subscriptions",
		"PUT",
		{},
		expect.objectContaining({ source: null, revision: "one" }),
	);
});

test("pause and unsubscribe remain secondary revision-checked actions", async () => {
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
	await screen.findByText("Paused");
	fireEvent.click(screen.getByRole("button", { name: "Subscription actions" }));
	fireEvent.click(await screen.findByRole("menuitem", { name: "Unsubscribe" }));
	await screen.findByText("Not subscribed");
	expect(request).toHaveBeenCalledWith(
		"/api/acquisition/subscriptions",
		"DELETE",
		{},
		{ workKey, revision: "two" },
	);
});

test("failed saves preserve editable fields, and setup failures expose a specific Settings action", async () => {
	const request = fixture();
	const implementation = request.getMockImplementation();
	request.mockImplementation(async (...args) => {
		if (args[1] === "PUT") throw Error("conflict");
		return implementation?.(...args);
	});
	render(<SubscriptionPanel workKey={workKey} />);
	fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }));
	fireEvent.change(await screen.findByLabelText("Starting episode"), {
		target: { value: "9" },
	});
	await waitFor(() =>
		expect(
			(screen.getByRole("button", { name: "Subscribe" }) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
	await screen.findByRole("alert");
	expect(
		(screen.getByLabelText("Starting episode") as HTMLInputElement).value,
	).toBe("9");
	expect(screen.getByRole("dialog")).toBeTruthy();
});

test("subscriptions can be created only after destination validation", async () => {
	const request = fixture();
	const implementation = request.getMockImplementation();
	request.mockImplementation(async (...args) =>
		args[0] === "/api/acquisition/downloads/settings"
			? { destination: null, roots: [] }
			: implementation?.(...args),
	);
	render(<SubscriptionPanel workKey={workKey} />);
	fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }));
	await screen.findByText("Validate a download destination first.");
	expect(
		(screen.getByRole("button", { name: "Subscribe" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(request.mock.calls.filter((call) => call[1] !== "GET")).toHaveLength(
		0,
	);
});
