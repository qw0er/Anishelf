// @vitest-environment happy-dom
import "../../../src/shared/i18n.js";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { SubscriptionsPage } from "../../../src/features/acquisition/subscriptions-page.js";
import * as api from "../../../src/shared/api/client.js";
import { queryClient } from "../../../src/shared/api/query-client.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "../../support/query-test-utils.js";

vi.mock("../../../src/features/acquisition/subscription-panel.js", () => ({
	SubscriptionPanel: () => <span>Subscription control</span>,
}));
afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.restoreAllMocks();
});
test("inventory filters by title, management and actionable errors", async () => {
	vi.spyOn(api, "request").mockImplementation(async (path) =>
		path === "/api/acquisition/watching"
			? { enabled: false, reason: "disabled", works: [] }
			: [
					{
						title: "Frieren",
						view: {
							subscription: {
								workKey: "anilist:anime:1",
								management: "watching",
								error: null,
							},
						},
					},
					{
						title: "Dungeon Meshi",
						view: {
							subscription: {
								workKey: "anilist:anime:2",
								management: "manual",
								error: "source_changed",
							},
						},
					},
				],
	);
	render(
		<MemoryRouter>
			<SubscriptionsPage />
		</MemoryRouter>,
	);
	await screen.findByRole("link", { name: "Frieren" });
	fireEvent.change(
		screen.getByRole("combobox", { name: "Subscription type" }),
		{
			target: { value: "manual" },
		},
	);
	expect(screen.queryByRole("link", { name: "Frieren" })).toBeNull();
	expect(screen.getByRole("link", { name: "Dungeon Meshi" })).toBeTruthy();
	fireEvent.change(
		screen.getByRole("combobox", { name: "Subscription type" }),
		{
			target: { value: "all" },
		},
	);
	fireEvent.click(
		screen.getByRole("checkbox", { name: "Needs attention only" }),
	);
	await waitFor(() =>
		expect(screen.queryByRole("link", { name: "Frieren" })).toBeNull(),
	);
	fireEvent.change(
		screen.getByRole("combobox", { name: "Subscription type" }),
		{
			target: { value: "automatic" },
		},
	);
	expect(
		screen
			.getByRole("checkbox", { name: "Needs attention only" })
			.getAttribute("aria-checked"),
	).toBe("true");
	expect(screen.queryByRole("link", { name: "Dungeon Meshi" })).toBeNull();
	fireEvent.change(
		screen.getByRole("combobox", { name: "Subscription type" }),
		{
			target: { value: "all" },
		},
	);
	fireEvent.change(
		screen.getByRole("textbox", { name: "Search subscriptions" }),
		{ target: { value: "absent" } },
	);
	expect(screen.getByText("No matching subscriptions.")).toBeTruthy();
});

test("empty inventory offers browsing instead of clearing filters", async () => {
	vi.spyOn(api, "request").mockImplementation(async (path) =>
		path === "/api/acquisition/watching"
			? { enabled: false, reason: "disabled", works: [] }
			: [],
	);
	render(
		<MemoryRouter>
			<SubscriptionsPage />
		</MemoryRouter>,
	);
	await screen.findByRole("link", { name: "Browse works" });
	expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
	fireEvent.change(
		screen.getByRole("textbox", { name: "Search subscriptions" }),
		{ target: { value: "missing" } },
	);
	expect(
		screen.getByRole("heading", { name: "No matching subscriptions." }),
	).toBeTruthy();
	const clear = screen.getAllByRole("button", { name: "Clear filters" }).at(0);
	if (!clear) throw Error("Clear filters action missing");
	fireEvent.click(clear);
	expect(screen.getByRole("link", { name: "Browse works" })).toBeTruthy();
});

test("excluded works can be restored from their disclosure", async () => {
	const status = {
		enabled: true,
		reason: "ready",
		accountId: "account",
		trackingGeneration: 2,
		works: [
			{
				workKey: "anilist:anime:3",
				title: "Excluded work",
				excluded: true,
				revision: "revision",
			},
		],
	};
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (path) =>
			path === "/api/acquisition/watching" ||
			path === "/api/acquisition/watching/works"
				? status
				: [],
		);
	render(
		<MemoryRouter>
			<SubscriptionsPage />
		</MemoryRouter>,
	);
	fireEvent.click(await screen.findByText("Excluded works (1)"));
	fireEvent.click(
		await screen.findByRole("button", { name: "Include in automation" }),
	);
	await waitFor(() =>
		expect(request).toHaveBeenCalledWith(
			"/api/acquisition/watching/works",
			"PUT",
			{},
			{
				accountId: "account",
				trackingGeneration: 2,
				workKey: "anilist:anime:3",
				revision: "revision",
				excluded: false,
				paused: false,
			},
		),
	);
});
