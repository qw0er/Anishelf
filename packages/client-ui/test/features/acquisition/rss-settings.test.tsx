// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { RssSettings } from "../../../src/features/acquisition/rss-settings.js";
import * as api from "../../../src/shared/api/client.js";
import { toast } from "../../../src/shared/components/ui/toast.js";
import { queryClient } from "../../setup.js";
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

test("profile choice is saved directly without a Save action", async () => {
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (path) =>
			path === "/api/acquisition/profiles" ? profiles : { resourceRoots: [] },
		);
	render(<RssSettings />);
	const general = await screen.findByRole("radio", { name: /General/ });
	expect(general.getAttribute("aria-checked")).toBe("true");
	expect(
		screen.queryByRole("spinbutton", { name: "Refresh interval (minutes)" }),
	).toBeNull();
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

test("background profile refresh failures preserve the selection and focus", async () => {
	let failed = false;
	vi.spyOn(api, "request").mockImplementation(async () => {
		if (failed) throw new Error("offline");
		return profiles;
	});
	const add = vi.spyOn(toast, "add").mockReturnValue("acquisition-profiles");
	const close = vi.spyOn(toast, "close");
	render(<RssSettings />);
	const selected = await screen.findByRole("radio", { name: /General/ });
	selected.focus();
	const filters = { queryKey: ["acquisition", "profiles"] };

	failed = true;
	await queryClient.refetchQueries(filters);
	await waitFor(() => expect(add).toHaveBeenCalledOnce());
	expect(screen.getByRole("radio", { name: /General/ })).toBe(selected);
	expect(selected.getAttribute("aria-checked")).toBe("true");
	expect(document.activeElement).toBe(selected);
	await queryClient.refetchQueries(filters);
	expect(add).toHaveBeenCalledOnce();

	failed = false;
	close.mockClear();
	await queryClient.refetchQueries(filters);
	await waitFor(() =>
		expect(close).toHaveBeenCalledWith("acquisition-profiles"),
	);
	expect(document.activeElement).toBe(selected);
});
