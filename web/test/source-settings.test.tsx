// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { SourceSettings } from "../src/features/acquisition/source-settings.js";
import * as api from "../src/shared/api/client.js";
import type { SourceConnectorSettings } from "../src/shared/api/contracts.js";
import { queryClient } from "../src/shared/api/query-client.js";
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
	queryClient.clear();
	vi.restoreAllMocks();
});
function fixture(initial?: Partial<SourceConnectorSettings>) {
	let settings: SourceConnectorSettings = {
		generation: "one",
		url: null,
		origin: null,
		providers: [],
		hasApiKey: false,
		ready: false,
		error: null,
		...initial,
	};
	const request = vi
		.spyOn(api, "request")
		.mockImplementation(async (path, method, _options, body) => {
			if (path.endsWith("/providers"))
				return [
					{ id: "nyaasi", name: "Nyaa.si" },
					{ id: "other", name: "Other" },
				];
			if (path.endsWith("/probe"))
				return {
					generation: settings.generation,
					providerId: "nyaasi",
					searchSupported: true,
					searchVerified: false,
				};
			if (path.endsWith("/test"))
				return {
					source: "nyaasi",
					outcome: "no_match",
					entries: [],
					coverage: {
						limited: true,
						reason: "missing_pagination",
						pages: 1,
						queries: 1,
					},
				};
			if (path.endsWith("/bundled"))
				settings = {
					...settings,
					generation: "bundle",
					url: "http://jackett:9117/",
					origin: "bundled",
					providers: ["nyaasi"],
					hasApiKey: true,
				};
			else if (method === "PUT") {
				const value = body as {
					url: string;
					providers: string[];
					managementUrl: string | null;
				};
				settings = {
					...settings,
					generation: `${settings.generation}-saved`,
					url: value.url,
					origin: "external",
					hasApiKey: true,
					providers: value.providers,
					managementUrl: value.managementUrl,
				};
			} else if (method === "DELETE")
				settings = {
					...settings,
					generation: "cleared",
					url: null,
					origin: null,
					hasApiKey: false,
					providers: [],
				};
			return settings;
		});
	render(<SourceSettings />);
	return { request };
}
test("saves an external connection without retaining the key in UI caches, then checks service and search separately", async () => {
	const f = fixture();
	fireEvent.change(await screen.findByLabelText("Jackett API URL"), {
		target: { value: "http://external:9117/" },
	});
	fireEvent.change(screen.getByLabelText("Jackett API key"), {
		target: { value: "private-key" },
	});
	fireEvent.click(screen.getByText("Save source settings"));
	await waitFor(() =>
		expect(
			screen.getByLabelText<HTMLInputElement>("Jackett API key").value,
		).toBe(""),
	);
	expect(
		JSON.stringify(
			queryClient.getQueryData(["acquisition", "sources", "connector"]),
		),
	).not.toContain("private-key");
	expect(
		JSON.stringify(
			queryClient
				.getMutationCache()
				.getAll()
				.map((m) => m.state.variables),
		),
	).not.toContain("private-key");
	fireEvent.click(screen.getByText("Test connection and load sites"));
	await screen.findByText(/Jackett responded with 2 configured sites/);
	fireEvent.click(screen.getByLabelText("Nyaa.si"));
	fireEvent.click(screen.getByText("Save source settings"));
	await screen.findByRole("option", { name: "nyaasi" });
	fireEvent.click(screen.getByText("Check search support"));
	await screen.findByText(/Run a search to verify upstream access/);
	fireEvent.change(screen.getByLabelText("Title to search"), {
		target: { value: "Frieren" },
	});
	fireEvent.click(screen.getByText("Test search"));
	await screen.findByText("Search completed with no matching releases.");
	expect(screen.getByText(/Results have limited coverage/)).toBeTruthy();
	expect(
		f.request.mock.calls.some(
			(call) =>
				call[0].endsWith("/test") &&
				JSON.stringify(call[3]).includes('"kind":"search"'),
		),
	).toBe(true);
});
test("uses bundled setup explicitly and preserves selected site order on save", async () => {
	const f = fixture({
		bundledAvailable: true,
		url: "http://external:9117/",
		origin: "external",
		providers: ["nyaasi", "other"],
		hasApiKey: true,
	});
	fireEvent.click(
		await screen.findByRole("button", { name: "Move other earlier" }),
	);
	fireEvent.click(screen.getByText("Save source settings"));
	await waitFor(() =>
		expect(
			f.request.mock.calls.some(
				(call) =>
					call[1] === "PUT" &&
					JSON.stringify(call[3]).includes('"providers":["other","nyaasi"]'),
			),
		).toBe(true),
	);
	await waitFor(() =>
		expect(
			screen.getByRole<HTMLButtonElement>("button", {
				name: "Use bundled Jackett",
			}).disabled,
		).toBe(false),
	);
	fireEvent.click(screen.getByText("Use bundled Jackett"));
	await screen.findByText(/Using bundled Jackett/);
	fireEvent.click(screen.getByText("Disconnect Jackett"));
	await screen.findByText(/No source connector configured/);
});

test("an existing bundled installation asks for site review without starting setup from the browser", async () => {
	const f = fixture({
		origin: "bundled",
		url: "http://jackett:9117/",
		hasApiKey: true,
		bundledSetup: "manual",
	});
	await screen.findByText(/Review sites in Jackett or retry adding Nyaa.si/);
	expect(f.request.mock.calls.every(([, method]) => method === "GET")).toBe(
		true,
	);
	fireEvent.click(screen.getByRole("button", { name: "Retry adding Nyaa.si" }));
	await waitFor(() =>
		expect(f.request).toHaveBeenCalledWith(
			"/api/acquisition/sources/connector/bundled",
			"POST",
			{},
			{ generation: "one", initializeSite: true },
		),
	);
});
