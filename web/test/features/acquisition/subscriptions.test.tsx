// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { SubscriptionPanel } from "../../../src/features/acquisition/subscription-panel.js";
import * as api from "../../../src/shared/api/client.js";
import type { SubscriptionView } from "../../../src/shared/api/contracts.js";
import { queryClient } from "../../../src/shared/api/query-client.js";
import { animeStatusFixture } from "../../fixtures/anime.js";
import {
	act,
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
			if (path.startsWith("/api/anime/status/"))
				return {
					...animeStatusFixture(),
					subscription: { subscription: view.subscription },
				};

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
	expect(
		document
			.querySelector("[data-slot=collapsible-trigger]")
			?.getAttribute("aria-expanded"),
	).toBe("false");
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
	fireEvent.click(screen.getByRole("radio", { name: "RSS URL" }));
	fireEvent.change(screen.getByRole("textbox", { name: "RSS URL" }), {
		target: { value: "https://feeds.example.org/custom" },
	});
	fireEvent.click(
		screen.getByRole("radio", { name: /Efficient codecs preferred/ }),
	);
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

test("background subscription revisions preserve the open editor and its accepted revision", async () => {
	const request = fixture(saved);
	render(<SubscriptionPanel workKey={workKey} />);
	fireEvent.click(
		await screen.findByRole("button", { name: "Subscription actions" }),
	);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Edit subscription" }),
	);
	fireEvent.change(await screen.findByLabelText("Starting episode"), {
		target: { value: "9" },
	});
	fireEvent.click(screen.getByText("More options"));
	await act(async () => {
		queryClient.setQueryData(["acquisition", "subscription", workKey], {
			...saved,
			subscription: {
				...saved.subscription,
				revision: "bound-in-background",
				startEpisode: 4,
			},
		});
	});
	expect(
		(screen.getByLabelText("Starting episode") as HTMLInputElement).value,
	).toBe("9");
	expect(
		screen
			.getByRole("button", { name: "More options" })
			.getAttribute("aria-expanded"),
	).toBe("true");
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
	await waitFor(() =>
		expect(request).toHaveBeenCalledWith(
			"/api/acquisition/subscriptions",
			"PUT",
			{},
			expect.objectContaining({ revision: "one", startEpisode: 9 }),
		),
	);
});

test("source attempts appear only in lazy diagnostics with outcomes and coverage", async () => {
	fixture({
		...saved,
		discovery: {
			checkedAt: 1000000,
			attempts: [
				{
					providerId: "site-empty",
					outcome: "no_match",
					reasons: [],
					code: null,
					limited: true,
				},
				{
					providerId: "site-offline",
					outcome: "unavailable",
					reasons: [],
					code: "unavailable",
					limited: false,
				},
			],
		},
	});
	render(<SubscriptionPanel workKey={workKey} />);
	fireEvent.click(await screen.findByRole("button", { name: "Activity" }));
	expect(screen.queryByText(/site-empty/)).toBeNull();
	fireEvent.click(screen.getByText("Diagnostics"));
	await screen.findByText(/site-empty · No matching releases/);
	expect(screen.getByText(/site-offline · Site unavailable/)).toBeTruthy();
	expect(screen.getByText(/Limited search coverage/)).toBeTruthy();
});

test("a discovery outage offers a direct check instead of generic configuration guidance", async () => {
	if (!saved.subscription) throw new Error("Missing subscription fixture");
	const request = fixture({
		...saved,
		subscription: {
			...saved.subscription,
			error: "discovery_unavailable",
		},
	});
	render(<SubscriptionPanel workKey={workKey} />);
	fireEvent.click(await screen.findByRole("button", { name: /Activity/ }));
	fireEvent.click(await screen.findByRole("button", { name: "Check now" }));
	await waitFor(() =>
		expect(
			request.mock.calls.some(
				([path, method]) => path.endsWith("/refresh") && method === "POST",
			),
		).toBe(true),
	);
	expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
});

test("automatic subscriptions show group management and manual takeover without individual pause or unsubscribe", async () => {
	if (!saved.subscription) throw Error("Missing fixture");
	fixture({
		...saved,
		subscription: {
			...saved.subscription,
			management: "watching",
			runState: "disabled",
		},
	});
	render(<SubscriptionPanel workKey={workKey} />);
	await screen.findByText(/Automatic subscription/);
	fireEvent.click(screen.getByRole("button", { name: "Subscription actions" }));
	expect(
		await screen.findByRole("menuitem", {
			name: "Manage automatic subscriptions",
		}),
	).toBeTruthy();
	expect(
		screen.getByRole("menuitem", { name: "Convert to manual subscription" }),
	).toBeTruthy();
	expect(
		screen.queryByRole("menuitem", { name: "Pause subscription" }),
	).toBeNull();
	expect(screen.queryByRole("menuitem", { name: "Unsubscribe" })).toBeNull();
});

test.each(["manual", "watching"] as const)(
	"completed %s subscriptions show resume and block source checks",
	async (management) => {
		if (!saved.subscription) throw Error("Missing fixture");
		const request = fixture({
			...saved,
			subscription: {
				...saved.subscription,
				management,
				runState: "completed",
			},
		});
		render(<SubscriptionPanel workKey={workKey} />);
		await screen.findByText("Completed · acquisition stopped");
		fireEvent.click(
			screen.getByRole("button", { name: "Subscription actions" }),
		);
		const resume = await screen.findByRole("menuitem", {
			name: "Resume subscription",
		});
		expect(
			screen
				.getByRole("menuitem", { name: "Check now" })
				.getAttribute("aria-disabled"),
		).toBe("true");
		fireEvent.click(resume);
		await waitFor(() =>
			expect(request).toHaveBeenCalledWith(
				"/api/acquisition/subscriptions",
				"PATCH",
				{},
				{ workKey, revision: "one", enabled: true },
			),
		);
	},
);
