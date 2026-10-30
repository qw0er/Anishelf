// @vitest-environment happy-dom
import { rssConstraints } from "@anishelf/backend/contracts/defaults";
import { afterEach, expect, test, vi } from "vitest";
import { RssSettings } from "../../../src/features/acquisition/rss-settings.js";
import * as api from "../../../src/shared/api/client.js";
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

test("shows the RSS default and saves drafts only on explicit Save", async () => {
	let settings: {
		resourceRoots: string[];
		rssRefreshIntervalMinutes?: number;
	} = { resourceRoots: [] };
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (_path, method, _options, payload) => {
			if (_path === "/api/acquisition/profiles")
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
			if (method === "PUT")
				settings = {
					...settings,
					...(payload as { rssRefreshIntervalMinutes: number }),
				};
			return settings;
		});
	const notice = vi.spyOn(toast, "add").mockReturnValue("rss-settings-save");
	const view = render(<RssSettings />);
	const input = await screen.findByRole("spinbutton", {
		name: "Refresh interval (minutes)",
	});
	expect((input as HTMLInputElement).value).toBe(
		String(rssConstraints.defaultRefreshIntervalMinutes),
	);
	fireEvent.change(input, { target: { value: "60" } });
	expect(request.mock.calls.filter((call) => call[1] === "PUT")).toHaveLength(
		0,
	);
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(request.mock.calls.filter((call) => call[1] === "PUT")).toEqual([
			["/api/settings", "PUT", undefined, { rssRefreshIntervalMinutes: 60 }],
		]),
	);
	await waitFor(() =>
		expect(notice).toHaveBeenCalledWith(
			expect.objectContaining({ type: "success" }),
		),
	);
	view.unmount();
	render(<RssSettings />);
	expect(
		((await screen.findByRole("spinbutton")) as HTMLInputElement).value,
	).toBe("60");
});

test("failed RSS saves retain the draft and allow retry", async () => {
	vi.spyOn(api, "request").mockImplementation(async (_path, method) => {
		if (_path === "/api/acquisition/profiles")
			return {
				profiles: [],
				selectedProfileId: "builtin:general",
				selectionAvailable: false,
			};
		if (method === "PUT") throw new Error("unavailable");
		return { resourceRoots: [], rssRefreshIntervalMinutes: 45 };
	});
	const notice = vi.spyOn(toast, "add").mockReturnValue("rss-settings-save");
	render(<RssSettings />);
	const input = await screen.findByRole("spinbutton");
	fireEvent.change(input, { target: { value: "60" } });
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(notice).toHaveBeenCalledWith(
			expect.objectContaining({ type: "error" }),
		),
	);
	expect((input as HTMLInputElement).value).toBe("60");
	expect(
		screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
	).toBe(false);
});

test("profile choice is saved separately from the RSS interval", async () => {
	const request = vi.spyOn(api, "request").mockImplementation(async (path) =>
		path === "/api/acquisition/profiles"
			? {
					profiles: [
						{
							id: "builtin:general",
							name: "General",
							description: "General",
							source: "builtin",
						},
						{
							id: "custom:mine",
							name: "Mine",
							description: "My custom profile",
							source: "custom",
						},
					],
					selectedProfileId: "builtin:general",
					selectionAvailable: true,
				}
			: { resourceRoots: [] },
	);
	render(<RssSettings />);
	const general = await screen.findByRole("radio", { name: /General/ });
	expect(general.getAttribute("aria-checked")).toBe("true");
	const custom = screen.getByRole("radio", { name: /Mine/ });
	fireEvent.click(custom);
	expect(request.mock.calls.some((call) => call[1] === "PUT")).toBe(false);
	fireEvent.click(screen.getByRole("button", { name: "Save release profile" }));
	await waitFor(() =>
		expect(request).toHaveBeenCalledWith("/api/settings", "PUT", undefined, {
			defaultAcquisitionProfileId: "custom:mine",
		}),
	);
});

test("shows a warning when custom acquisition profiles could not be loaded", async () => {
	vi.spyOn(api, "request").mockImplementation(async (path) =>
		path === "/api/acquisition/profiles"
			? {
					profiles: [
						{
							id: "builtin:general",
							name: "General",
							description: "",
							source: "builtin",
						},
					],
					selectedProfileId: "builtin:general",
					selectionAvailable: true,
					issue: {
						file: "acquisition-profiles.yaml",
						detail: "acquisition-profiles.yaml: invalid YAML.",
					},
				}
			: { resourceRoots: [] },
	);
	render(<RssSettings />);
	const alert = await screen.findByRole("alert");
	expect(alert.textContent).toContain(
		"Custom acquisition profiles could not be loaded",
	);
	expect(alert.textContent).toContain("acquisition-profiles.yaml");
});
