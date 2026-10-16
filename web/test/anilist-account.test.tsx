// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AniListAccountSettings } from "../src/features/anime/tracking/account-settings.js";
import { queryClient } from "../src/shared/api/query-client.js";
import "../src/shared/i18n.js";

import type { TrackingAccountResponse } from "../src/shared/api/contracts.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "./query-test-utils.js";

const disconnected: TrackingAccountResponse = {
	clientId: "53902",
	authorizationUrl:
		"https://anilist.co/api/v2/oauth/authorize?client_id=53902&response_type=token",
	generation: "one",
	account: null,
	state: "disconnected",
	connectivity: "unknown",
	checkedAt: null,
};
const connected: TrackingAccountResponse = {
	...disconnected,
	generation: "two",
	account: { id: 7, name: "Fixture" },
	state: "connected",
	connectivity: "available",
};
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
	fetcher.mockReset();
	vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});

test("previews without retaining token, requires confirmation and clears former account queries", async () => {
	let status: TrackingAccountResponse = disconnected;
	fetcher.mockImplementation(async (path, options) => {
		if (path === "/api/tracking/account" && options?.method === "GET")
			return json(status);
		if (path === "/api/tracking/account/preview") {
			expect(JSON.parse(String(options?.body))).toEqual({
				token: "fixture-token",
			});
			return json({
				candidateId: "candidate",
				account: connected.account,
				generation: "one",
				expiresAt: Date.now() + 300000,
			});
		}
		if (path === "/api/tracking/account/confirm") {
			expect(JSON.parse(String(options?.body))).toEqual({
				candidateId: "candidate",
				generation: "one",
			});
			status = connected;
			return json(connected);
		}
		throw new Error(`Unexpected route: ${path}`);
	});
	queryClient.setQueryData(["tracking", "old-account", "list"], {
		private: true,
	});
	const oldLibraryKey = [
		"anime-library",
		"root",
		7,
		"old-generation",
		{ scope: "all" },
	];
	queryClient.setQueryData(oldLibraryKey, { private: true });
	queryClient.setQueryData(["catalog", "root", "local-work-detail", "work-1"], {
		public: true,
	});
	render(<AniListAccountSettings />);
	expect(await screen.findByText("No AniList account connected.")).toBeTruthy();
	expect(
		screen
			.getByRole("link", { name: "Authorize Anishelf on AniList" })
			.getAttribute("href"),
	).toBe(disconnected.authorizationUrl);
	const input = screen.getByLabelText(
		"AniList access token",
	) as HTMLInputElement;
	fireEvent.change(input, { target: { value: "fixture-token" } });
	const actions = screen.getByRole("group", {
		name: "AniList account actions",
	});
	const previewButton = within(actions).getByRole("button", {
		name: "Preview account",
	});
	expect((previewButton as HTMLButtonElement).form).toBe(input.form);
	fireEvent.click(previewButton);
	await screen.findByText("Connect as Fixture?");
	expect(input.value).toBe("");
	expect(
		fetcher.mock.calls.some(
			([path]) => path === "/api/tracking/account/confirm",
		),
	).toBe(false);
	expect(within(actions).getByRole("button", { name: "Cancel" })).toBeTruthy();
	fireEvent.click(
		within(actions).getByRole("button", { name: "Confirm connection" }),
	);
	await screen.findByText("Account: Fixture");
	expect(
		within(actions).getByRole("button", { name: "Check connection" }),
	).toBeTruthy();
	expect(
		within(actions).getByRole("button", { name: "Disconnect" }),
	).toBeTruthy();
	expect(
		queryClient.getQueryData(["tracking", "old-account", "list"]),
	).toBeUndefined();
	expect(queryClient.getQueryData(oldLibraryKey)).toBeUndefined();
	expect(
		queryClient.getQueryData([
			"catalog",
			"root",
			"local-work-detail",
			"work-1",
		]),
	).toEqual({ public: true });
	expect(
		JSON.stringify(
			queryClient
				.getMutationCache()
				.getAll()
				.map((value) => value.state),
		),
	).not.toContain("fixture-token");
});

test("disconnect uses connection generation and authorization failure offers reconnection", async () => {
	let status: TrackingAccountResponse = connected;
	fetcher.mockImplementation(async (path, options) => {
		if (path === "/api/tracking/account" && options?.method === "DELETE") {
			expect(JSON.parse(String(options.body))).toEqual({ generation: "two" });
			status = disconnected;
			return json(disconnected);
		}
		if (path === "/api/tracking/account/check") {
			status = {
				...connected,
				state: "authorization-required",
				connectivity: "unavailable",
			};
			return json(
				{
					error: {
						code: "TRACKING_AUTHORIZATION_REQUIRED",
						message: "Reconnect your account.",
						requestId: "fixture",
					},
				},
				409,
			);
		}
		return json(status);
	});
	render(<AniListAccountSettings />);
	await screen.findByText("Account: Fixture");
	fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
	await screen.findByRole("alert");
	await screen.findByText("Reconnect required · Connection check failed");
	expect(
		screen.getByRole("link", { name: "Authorize Anishelf on AniList" }),
	).toBeTruthy();
	await waitFor(() =>
		expect(
			(screen.getByRole("button", { name: "Disconnect" }) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
	await screen.findByText("No AniList account connected.");
});
