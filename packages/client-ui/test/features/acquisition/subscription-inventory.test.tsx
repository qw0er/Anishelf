// @vitest-environment happy-dom
import "../../../src/shared/i18n.js";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import type { SubscriptionListItem } from "../../../src/features/acquisition/subscriptions-api.js";
import { SubscriptionsPage } from "../../../src/features/acquisition/subscriptions-page.js";
import * as api from "../../../src/shared/api/client.js";
import { queryClient } from "../../setup.js";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../support/query-test-utils.js";

const listKey = ["acquisition", "subscription", "list"];
function item(
	title: string,
	management: "watching" | "manual",
	error: string | null = null,
): SubscriptionListItem {
	return {
		title,
		view: {
			subscription: {
				workKey: `anilist:anime:${title}`,
				management,
				error,
				feedId: "feed",
				startEpisode: 4,
				sourceKind: "feed",
				source: "https://example.org/feed",
				enabled: true,
				runState: "active",
				revision: "one",
				checkedAt: null,
				nextAttemptAt: 0,
			},
			candidates: [],
			total: 0,
			page: 1,
		},
	};
}
function fixture() {
	let rows = [
		item("Frieren", "watching", "discovery_unavailable"),
		item("Dungeon Meshi", "manual"),
	];
	const watching = {
		enabled: true,
		reason: "ready",
		accountId: "account",
		trackingGeneration: 2,
		works: [
			{
				workKey: "anilist:anime:Frieren",
				title: "Frieren",
				managed: true,
				excluded: false,
				revision: "one",
			},
		],
	};
	return vi
		.spyOn(api, "request")
		.mockImplementation(async (path, method, _options, payload) => {
			if (path === "/api/acquisition/subscriptions/list")
				return structuredClone(rows);
			if (path === "/api/acquisition/watching")
				return structuredClone(watching);
			if (path === "/api/acquisition/profiles") return { profiles: [] };
			if (path === "/api/settings") return { qbittorrentWebUiUrl: "" };
			if (path.startsWith("/api/acquisition/downloads"))
				return { items: [], active: 0, total: 0, page: 1 };
			if (path === "/api/acquisition/watching/works") {
				const { excluded } = payload as { excluded: boolean };
				const work = watching.works[0];
				if (!work) throw Error("Missing automation work");
				work.excluded = excluded;
				if (excluded) rows = rows.filter((row) => row.title !== "Frieren");
				return structuredClone(watching);
			}
			if (path === "/api/acquisition/subscriptions" && method === "PATCH") {
				const { workKey, enabled } = payload as {
					workKey: string;
					enabled: boolean;
				};
				const row = rows.find(
					(row) => row.view.subscription?.workKey === workKey,
				);
				if (!row?.view.subscription) throw Error("Missing subscription");
				row.view.subscription = {
					...row.view.subscription,
					enabled,
					revision: "two",
				};
				return structuredClone(row.view);
			}
			throw Error(`Unexpected request: ${method} ${path}`);
		});
}
function show(initialEntry = "/subscriptions") {
	render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<SubscriptionsPage />
		</MemoryRouter>,
	);
}
afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.restoreAllMocks();
});

test("inventory uses its existing summaries, with specific issues and lazy details", async () => {
	const request = fixture();
	show();
	const row = await screen.findByRole("article", { name: "Frieren" });
	expect(within(row).getByText("Source unavailable")).toBeTruthy();
	expect(within(row).getByText("From episode 4")).toBeTruthy();
	expect(
		screen.queryByRole("button", { name: "Exclude from automation" }),
	).toBeNull();
	expect(
		request.mock.calls.some(
			([path]) =>
				path.startsWith("/api/anime/status/") ||
				path.startsWith("/api/acquisition/downloads"),
		),
	).toBe(false);
	fireEvent.click(
		within(row).getByRole("button", { name: "Subscription details" }),
	);
	const dialog = await screen.findByRole("dialog");
	expect(within(dialog).getByText("Frieren")).toBeTruthy();
	await within(dialog).findByText(
		"Source discovery is unavailable; it will retry.",
	);
	expect(
		request.mock.calls.some(([path]) => path.includes("diagnostics=true")),
	).toBe(false);
});

test("pause updates the inventory revision and preserves independent filters", async () => {
	const request = fixture();
	show("/subscriptions?search=Meshi&type=manual");
	const row = await screen.findByRole("article", { name: "Dungeon Meshi" });
	expect(screen.queryByRole("article", { name: "Frieren" })).toBeNull();
	fireEvent.click(
		within(row).getByRole("button", { name: "Subscription actions" }),
	);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Pause subscription" }),
	);
	await within(row).findByText("Paused");
	expect(
		(
			screen.getByRole("textbox", {
				name: "Search subscriptions",
			}) as HTMLInputElement
		).value,
	).toBe("Meshi");
	fireEvent.click(
		within(row).getByRole("button", { name: "Subscription actions" }),
	);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Resume subscription" }),
	);
	await waitFor(() =>
		expect(request).toHaveBeenCalledWith(
			"/api/acquisition/subscriptions",
			"PATCH",
			{},
			{
				workKey: "anilist:anime:Dungeon Meshi",
				revision: "two",
				enabled: true,
			},
		),
	);
});

test("automatic exclusion lives in the row menu with a restore route", async () => {
	const request = fixture();
	show();
	const row = await screen.findByRole("article", { name: "Frieren" });
	fireEvent.click(
		within(row).getByRole("button", { name: "Subscription actions" }),
	);
	expect(
		screen.queryByRole("menuitem", { name: "Manage automatic subscriptions" }),
	).toBeNull();
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Exclude from automation" }),
	);
	await waitFor(() =>
		expect(screen.queryByRole("article", { name: "Frieren" })).toBeNull(),
	);
	fireEvent.click(screen.getByRole("button", { name: "Excluded works (1)" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "Include in automation" }),
	);
	await waitFor(() =>
		expect(request).toHaveBeenCalledWith(
			"/api/acquisition/watching/works",
			"PUT",
			{},
			expect.objectContaining({ excluded: false }),
		),
	);
});

test("attention filtering includes configuration blockers and ignores completed errors", async () => {
	fixture();
	show("/subscriptions?attention=true");
	await screen.findByRole("article", { name: "Frieren" });
	const blocked = item("Blocked", "watching");
	if (!blocked.view.subscription) throw Error("Missing fixture");
	blocked.view.subscription.runState = "destination_changed";
	const completed = item("Completed", "manual", "fetch_failed");
	if (!completed.view.subscription) throw Error("Missing fixture");
	completed.view.subscription.runState = "completed";
	await act(async () =>
		queryClient.setQueryData(listKey, [blocked, completed]),
	);
	expect(screen.getByRole("article", { name: "Blocked" })).toBeTruthy();
	expect(screen.getByText("Destination changed")).toBeTruthy();
	expect(screen.queryByRole("article", { name: "Completed" })).toBeNull();
});
