// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { QbittorrentSettings } from "../../../src/features/acquisition/webui-settings.js";
import * as api from "../../../src/shared/api/client.js";
import { queryClient } from "../../../src/shared/api/query-client.js";
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

test("saves a direct browser address and clearing hides the link", async () => {
	let settings = {
		resourceRoots: ["/media"],
		qbittorrentWebUiUrl: null as string | null,
	};
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (_path, method, _options, payload) => {
			if (_path === "/api/acquisition/downloads/settings")
				return { destination: null, roots: [] };
			if (_path === "/api/acquisition/qbittorrent")
				return {
					generation: "empty",
					state: "unconfigured",
					url: null,
					username: "",
					passwordConfigured: false,
				};
			if (method === "PUT") {
				const url =
					(
						payload as { qbittorrentWebUiUrl: string }
					).qbittorrentWebUiUrl.trim() || null;
				settings = {
					...settings,
					qbittorrentWebUiUrl: url,
				};
			}
			return settings;
		});
	render(<QbittorrentSettings />);
	fireEvent.click(
		await screen.findByRole("button", { name: "WebUI settings" }),
	);
	await screen.findByLabelText("Browser WebUI URL (optional)");
	expect(screen.queryByRole("link")).toBeNull();
	const input = screen.getByLabelText("Browser WebUI URL (optional)");
	fireEvent.change(input, {
		target: { value: "https://downloads.example.com/" },
	});
	expect(request.mock.calls.filter((call) => call[1] === "PUT")).toHaveLength(
		0,
	);
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(screen.getByRole("link").getAttribute("href")).toBe(
			"https://downloads.example.com/",
		),
	);
	expect(screen.getByRole("link").getAttribute("rel")).toBe(
		"noopener noreferrer",
	);
	expect(request.mock.calls.filter((call) => call[1] === "PUT")).toEqual([
		[
			"/api/settings",
			"PUT",
			undefined,
			{ qbittorrentWebUiUrl: "https://downloads.example.com/" },
		],
	]);
	fireEvent.change(input, { target: { value: "" } });
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
	expect(
		request.mock.calls.every((call) =>
			[
				"/api/settings",
				"/api/acquisition/qbittorrent",
				"/api/acquisition/downloads/settings",
			].includes(call[0]),
		),
	).toBe(true);
});
