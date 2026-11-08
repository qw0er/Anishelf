// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { AutomaticPreparationSettings } from "../../../src/features/settings/components/automatic-preparation-settings.js";
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
const presets = [
	{
		id: "builtin:web",
		name: "Web",
		description: "Web playback",
		source: "builtin",
		available: true,
	},
	{
		id: "builtin:web-conservative",
		name: "Conservative",
		description: "Conservative playback",
		source: "builtin",
		available: true,
	},
];
test("saves the runtime switch and preset directly as top-level settings", async () => {
	vi.spyOn(toast, "add").mockReturnValue("toast");
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (path, method, _options, body) => {
			if (path === "/api/settings")
				return method === "PUT"
					? { resourceRoots: [], ...(body as object) }
					: { resourceRoots: [] };
			return {
				presets,
				selectedPresetId: "builtin:web",
				selectionAvailable: true,
			};
		});
	render(<AutomaticPreparationSettings />);
	const toggle = screen.getByRole("switch");
	await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
	fireEvent.click(toggle);
	await waitFor(() =>
		expect(
			request.mock.calls.some(
				([path, method, _options, body]) =>
					path === "/api/settings" &&
					method === "PUT" &&
					JSON.stringify(body) ===
						JSON.stringify({ autoPreparationEnabled: true }),
			),
		).toBe(true),
	);
	const conservative = screen.getByRole("radio", { name: /Conservative/ });
	await waitFor(() =>
		expect(conservative.hasAttribute("disabled")).toBe(false),
	);
	fireEvent.click(conservative);
	await waitFor(() =>
		expect(
			request.mock.calls.some(
				([path, method, _options, body]) =>
					path === "/api/settings" &&
					method === "PUT" &&
					JSON.stringify(body) ===
						JSON.stringify({
							autoPreparationPresetId: "builtin:web-conservative",
						}),
			),
		).toBe(true),
	);
	expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});
test("preserves missing selections and displays custom-file issues", async () => {
	vi.spyOn(api, "request").mockImplementation(async (path) =>
		path === "/api/settings"
			? {
					resourceRoots: [],
					autoPreparationEnabled: false,
					autoPreparationPresetId: "custom:missing",
				}
			: {
					presets,
					selectedPresetId: "custom:missing",
					selectionAvailable: false,
					issue: { file: "auto-preparation-presets.yaml" },
				},
	);
	const notice = vi.spyOn(toast, "add").mockReturnValue("toast");
	render(<AutomaticPreparationSettings />);
	await screen.findByText(/Automatic preparation is paused/);
	expect(
		screen
			.getByRole("radio", { name: /Selected preset unavailable/ })
			.getAttribute("aria-checked"),
	).toBe("true");
	expect(screen.getByText(/Could not load custom presets/)).toBeTruthy();
	fireEvent.click(screen.getByRole("switch"));
	await waitFor(() =>
		expect(notice).toHaveBeenCalledWith(
			expect.objectContaining({ type: "error" }),
		),
	);
	expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});
