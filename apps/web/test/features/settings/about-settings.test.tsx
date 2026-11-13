// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { AboutSettings } from "../../../src/features/settings/components/about-settings.js";
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
