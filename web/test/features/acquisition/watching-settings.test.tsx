// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { WatchingSettings } from "../../../src/features/acquisition/watching-settings.js";
import * as api from "../../../src/shared/api/client.js";
import type { WatchingAutomationStatus } from "../../../src/shared/api/contracts.js";
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

afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.restoreAllMocks();
});
const base = "/api/acquisition/watching";
function fixture(overrides: Partial<WatchingAutomationStatus> = {}) {
	let status: WatchingAutomationStatus = {
		effectiveProfile: {
			id: "builtin:general",
			name: "General",
			available: true,
		},
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
		...overrides,
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
					config: { backlog: "progress" },
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
	await screen.findByRole("dialog", { name: "Watching activation preview" });
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
	fireEvent.click(screen.getByRole("button", { name: "Close" }));
	fireEvent.click(
		await screen.findByRole("radio", { name: /^From episode 1/ }),
	);
	expect(
		screen.queryByRole("button", {
			name: "Confirm and enable Watching automation",
		}),
	).toBeNull();
	cleanup();
	render(<WatchingSettings management />);
	await screen.findByText("Automatic subscriptions · 1 work");
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

test("activation uses the saved subscription default instead of an older automation profile and retains previews when the default changes", async () => {
	const request = fixture({
		config: { backlog: "progress" },
	});
	render(<WatchingSettings />);
	const preview = await screen.findByRole("button", {
		name: "Preview Watching automation",
	});
	await waitFor(() =>
		expect((preview as HTMLButtonElement).disabled).toBe(false),
	);
	expect(screen.queryByRole("combobox")).toBeNull();
	fireEvent.click(preview);
	await screen.findByRole("button", {
		name: "Confirm and enable Watching automation",
	});
	expect(request).toHaveBeenCalledWith(
		`${base}/preview`,
		"POST",
		{},
		{
			revision: "one",
			config: { backlog: "progress" },
		},
	);
	queryClient.setQueryData(["acquisition", "profiles"], {
		selectedProfileId: "custom:new-default",
		selectionAvailable: true,
		profiles: [
			{
				id: "custom:new-default",
				name: "New default",
				description: "New",
				source: "custom",
			},
		],
	});
	await waitFor(() =>
		expect(
			screen.getByRole("button", {
				name: "Confirm and enable Watching automation",
			}),
		).toBeTruthy(),
	);
	expect(
		screen.getAllByText("Follows global default: New default").length,
	).toBeGreaterThan(0);
	fireEvent.click(
		screen.getByRole("button", {
			name: "Confirm and enable Watching automation",
		}),
	);
	await waitFor(() =>
		expect(request).toHaveBeenCalledWith(
			`${base}/confirm`,
			"POST",
			{},
			{ id: "preview" },
		),
	);
});

test("management failures use one toast and keep the work action available", async () => {
	const notice = vi.spyOn(toast, "add").mockReturnValue("watching-command");
	const request = fixture();
	const fallback = request.getMockImplementation();
	request.mockImplementation(async (...args) => {
		if (args[0] === `${base}/works`) throw new Error("offline");
		return fallback?.(...args);
	});
	render(<WatchingSettings management />);
	const include = await screen.findByRole("button", {
		name: "Include in automation",
	});
	fireEvent.click(include);
	await waitFor(() => expect(notice).toHaveBeenCalledOnce());
	expect(notice).toHaveBeenCalledWith(
		expect.objectContaining({ id: "watching-command", type: "error" }),
	);
	expect(screen.queryByRole("alert")).toBeNull();
	expect(screen.getByRole("button", { name: "Include in automation" })).toBe(
		include,
	);
	expect((include as HTMLButtonElement).disabled).toBe(false);
});
