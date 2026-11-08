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

const profiles = {
	profiles: [
		{
			id: "builtin:general",
			name: "General",
			description: "Any codec",
			source: "builtin" as const,
		},
		{
			id: "builtin:efficient",
			name: "Efficient codecs preferred",
			description: "Prefer HEVC / AV1",
			source: "builtin" as const,
		},
	],
	selectedProfileId: "builtin:general",
	selectionAvailable: true,
};

test("saves the RSS interval after the draft changes", async () => {
	let settings: {
		resourceRoots: string[];
		rssRefreshIntervalMinutes?: number;
	} = { resourceRoots: [] };
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (_path, method, _options, payload) => {
			if (_path === "/api/acquisition/profiles") return profiles;
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
	await waitFor(
		() =>
			expect(request.mock.calls.filter((call) => call[1] === "PUT")).toEqual([
				["/api/settings", "PUT", undefined, { rssRefreshIntervalMinutes: 60 }],
			]),
		{ timeout: 2_000 },
	);
	await waitFor(() =>
		expect(notice).toHaveBeenCalledWith(
			expect.objectContaining({ type: "success" }),
		),
	);
	expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
	view.unmount();
	render(<RssSettings />);
	expect(
		((await screen.findByRole("spinbutton")) as HTMLInputElement).value,
	).toBe("60");
});

test("failed RSS interval saves retain the draft", async () => {
	vi.spyOn(api, "request").mockImplementation(async (_path, method) => {
		if (_path === "/api/acquisition/profiles") return profiles;
		if (method === "PUT") throw new Error("unavailable");
		return { resourceRoots: [], rssRefreshIntervalMinutes: 45 };
	});
	const notice = vi.spyOn(toast, "add").mockReturnValue("rss-settings-save");
	render(<RssSettings />);
	const input = await screen.findByRole("spinbutton");
	fireEvent.change(input, { target: { value: "60" } });
	await waitFor(
		() =>
			expect(notice).toHaveBeenCalledWith(
				expect.objectContaining({ type: "error" }),
			),
		{ timeout: 2_000 },
	);
	expect((input as HTMLInputElement).value).toBe("60");
	expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});

test("profile choice is saved directly without a Save action", async () => {
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (path) =>
			path === "/api/acquisition/profiles" ? profiles : { resourceRoots: [] },
		);
	render(<RssSettings />);
	const general = await screen.findByRole("radio", { name: /General/ });
	expect(general.getAttribute("aria-checked")).toBe("true");
	const efficient = screen.getByRole("radio", {
		name: /Efficient codecs preferred/,
	});
	fireEvent.click(efficient);
	await waitFor(() =>
		expect(request).toHaveBeenCalledWith("/api/settings", "PUT", undefined, {
			defaultAcquisitionProfileId: "builtin:efficient",
		}),
	);
	expect(screen.queryByRole("button", { name: "Save release profile" })).toBe(
		null,
	);
});

test("shows a warning when custom acquisition profiles could not be loaded", async () => {
	vi.spyOn(api, "request").mockImplementation(async (path) =>
		path === "/api/acquisition/profiles"
			? {
					...profiles,
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
