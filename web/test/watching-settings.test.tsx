// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { WatchingSettings } from "../src/features/acquisition/watching-settings.js";
import * as api from "../src/shared/api/client.js";
import type { WatchingAutomationStatus } from "../src/shared/api/contracts.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "./query-test-utils.js";
import "../src/shared/i18n.js";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
const base = "/api/acquisition/watching";
function fixture() {
	let status: WatchingAutomationStatus = {
		revision: "one",
		enabled: false,
		reason: "disabled",
		accountId: "account",
		trackingGeneration: "generation",
		config: null,
		works: [
			{
				workKey: "anilist:anime:1",
				title: "Frieren",
				revision: "member",
				managed: true,
				excluded: true,
				paused: false,
				startEpisode: 3,
				reason: "disabled",
			},
		],
	};
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (path, method, _options, payload) => {
			if (path === "/api/acquisition/profiles")
				return {
					profiles: [
						{
							id: "builtin:general",
							name: "General",
							description: "Any",
							source: "builtin",
						},
					],
					selectedProfileId: "builtin:general",
					selectionAvailable: true,
				};
			if (path === base && method === "GET") return structuredClone(status);
			if (path === `${base}/preview`)
				return {
					id: "preview",
					revision: status.revision,
					expiresAt: Date.now() + 300000,
					config: { backlog: "progress", profileId: "builtin:general" },
					destination: "/downloads",
					providers: ["nyaasi"],
					works: [
						{
							workKey: "anilist:anime:1",
							title: "Frieren",
							startEpisode: 3,
							reason: "will_manage",
						},
					],
				};
			if (path === `${base}/confirm`)
				status = { ...status, revision: "two", enabled: true, reason: "ready" };
			else if (path === `${base}/disable`)
				status = {
					...status,
					revision: "three",
					enabled: false,
					reason: "disabled",
				};
			else if (path === `${base}/works`) {
				const input = payload as { excluded: boolean; paused: boolean };
				status = {
					...status,
					works: status.works.map((work) => ({
						...work,
						...input,
						revision: `${work.revision}-next`,
					})),
				};
			} else throw Error(`Unexpected request ${path}`);
			return structuredClone(status);
		});
	return request;
}

test("Watching activation requires a separate preview and explicit confirmation, then can be disabled", async () => {
	const request = fixture();
	render(<WatchingSettings />);
	const preview = await screen.findByRole("button", {
		name: "Preview Watching automation",
	});
	await waitFor(() =>
		expect((preview as HTMLButtonElement).disabled).toBe(false),
	);
	expect(request.mock.calls.filter((call) => call[1] !== "GET")).toHaveLength(
		0,
	);
	fireEvent.click(preview);
	await screen.findByLabelText("Watching activation preview");
	expect(screen.getByText("Destination: /downloads")).toBeTruthy();
	expect(request.mock.calls.some((call) => call[0] === `${base}/confirm`)).toBe(
		false,
	);
	fireEvent.click(
		screen.getByRole("button", {
			name: "Confirm and enable Watching automation",
		}),
	);
	const disable = await screen.findByRole("button", {
		name: "Disable Watching automation",
	});
	expect(request).toHaveBeenCalledWith(
		`${base}/confirm`,
		"POST",
		{},
		{ id: "preview" },
	);
	fireEvent.click(disable);
	await waitFor(() =>
		expect(
			screen.queryByRole("button", { name: "Disable Watching automation" }),
		).toBeNull(),
	);
	expect(request).toHaveBeenCalledWith(
		`${base}/disable`,
		"POST",
		{},
		{ revision: "two" },
	);
});

test("changing activation policy discards the preview; work overrides carry current member/account revisions", async () => {
	const request = fixture();
	render(<WatchingSettings />);
	const preview = await screen.findByRole("button", {
		name: "Preview Watching automation",
	});
	await waitFor(() =>
		expect((preview as HTMLButtonElement).disabled).toBe(false),
	);
	fireEvent.click(preview);
	await screen.findByRole("button", {
		name: "Confirm and enable Watching automation",
	});
	fireEvent.change(screen.getByLabelText("Starting episode policy"), {
		target: { value: "beginning" },
	});
	expect(
		screen.queryByRole("button", {
			name: "Confirm and enable Watching automation",
		}),
	).toBeNull();
	fireEvent.click(screen.getByText("Automatic creation exclusions · 1 work"));
	fireEvent.click(
		screen.getByRole("button", { name: "Include in automation" }),
	);
	await waitFor(() =>
		expect(request).toHaveBeenCalledWith(
			`${base}/works`,
			"PUT",
			{},
			{
				accountId: "account",
				trackingGeneration: "generation",
				workKey: "anilist:anime:1",
				revision: "member",
				excluded: false,
				paused: false,
			},
		),
	);
	expect(
		screen.queryByRole("button", { name: "Pause automated acquisition" }),
	).toBeNull();
});
