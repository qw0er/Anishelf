// @vitest-environment happy-dom
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { AboutSettings } from "../../../src/features/settings/components/about-settings.js";
import * as api from "../../../src/shared/api/client.js";
import { toast } from "../../../src/shared/components/ui/toast.js";
import { queryClient, testPlatform } from "../../setup.js";
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

test("shows bundled release notes without fetching them", async () => {
	const request = vi.spyOn(api, "request").mockResolvedValue({
		version: "1.4.1",
		channel: "stable",
		commit: null,
		builtAt: null,
	});
	render(<AboutSettings />);
	await screen.findByText(/Web and Backend builds differ/);
	expect(screen.getByText("Changelog")).toBeTruthy();
	expect(
		screen.getByText("Release notes for this version are not available."),
	).toBeTruthy();
	expect(screen.getByText("1.4.1")).toBeTruthy();
	expect(screen.getByText("1.4.0")).toBeTruthy();
	expect(
		screen.getByText(/Re-identify an individual pending resource/),
	).toBeTruthy();
	expect(request).toHaveBeenCalledTimes(1);
});

test("checks only on demand, shows mismatched builds and retains successful results after failure", async () => {
	vi.spyOn(toast, "add").mockReturnValue("toast");
	let fail = false;
	const request = vi.spyOn(api, "request").mockImplementation(async (path) => {
		if (path === "/api/system/info")
			return {
				version: "1.0.1",
				channel: "stable",
				commit: "other",
				builtAt: null,
			};
		if (fail) throw new Error("offline");
		return {
			status: "available",
			checkedAt: "2026-10-24T00:00:00Z",
			latest: {
				version: "v1.1.0",
				url: "https://github.com/qw0er/Anishelf/releases/tag/v1.1.0",
			},
		};
	});
	render(<AboutSettings />);
	await screen.findByText(/Web and Backend builds differ/);
	expect(request).toHaveBeenCalledTimes(1);
	fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
	await screen.findByText("A new version is available.");
	expect(
		screen.getByRole("link", { name: /v1.1.0/ }).getAttribute("href"),
	).toContain("/releases/tag/v1.1.0");
	fail = true;
	await waitFor(() =>
		expect(
			(
				screen.getByRole("button", {
					name: "Check for updates",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
	await waitFor(() =>
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({ type: "error" }),
		),
	);
	expect(screen.queryByText(/The latest check failed/)).toBeNull();
	expect(screen.getByText("A new version is available.")).toBeTruthy();
	expect(screen.getByText(/Checked/)).toBeTruthy();
});

test("shows the desktop build and uses the desktop updater without backend build info", async () => {
	const request = vi
		.spyOn(api, "request")
		.mockRejectedValue(new Error("offline"));
	const download =
		"https://github.com/qw0er/Anishelf/releases/download/v2.0.0/anishelf-desktop-2.0.0-arm64.dmg";
	const check = vi.fn().mockResolvedValue({
		status: "available",
		checkedAt: "2026-10-24T00:00:00Z",
		latest: {
			version: "v2.0.0",
			url: "https://github.com/qw0er/Anishelf/releases/tag/v2.0.0",
		},
		downloads: [{ name: "dmg", url: download }],
	});
	const updates = testPlatform.updates;
	testPlatform.updates = { kind: "desktop", check };
	onTestFinished(() => {
		testPlatform.updates = updates;
	});
	render(<AboutSettings />);
	expect(screen.getByText("Anishelf Desktop")).toBeTruthy();
	expect(screen.getByText("v1.0.2")).toBeTruthy();
	expect(screen.getByText("Bundled with desktop version 1.0.2.")).toBeTruthy();
	const button = screen.getByRole<HTMLButtonElement>("button", {
		name: "Check for updates",
	});
	expect(button.disabled).toBe(false);
	expect(check).not.toHaveBeenCalled();
	fireEvent.click(button);
	expect(
		(await screen.findByRole("link", { name: "Download dmg" })).getAttribute(
			"href",
		),
	).toBe(download);
	expect(request.mock.calls.map(([path]) => path)).toEqual([
		"/api/system/info",
	]);
});
