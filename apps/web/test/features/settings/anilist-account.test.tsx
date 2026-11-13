// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TrackingAccountSettings } from "../../../src/features/anime/tracking/account-settings.js";
import { queryClient } from "../../../src/shared/api/query-client.js";
import { toast } from "../../../src/shared/components/ui/toast.js";
import "../../../src/shared/i18n.js";

import type { TrackingAccountResponse } from "../../../src/shared/api/contracts.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../support/query-test-utils.js";
import { trackingProvider } from "../../support/tracking-fixture.js";

const disconnected: TrackingAccountResponse = {
	provider: trackingProvider,
	generation: "one",
	account: null,
	state: "disconnected",
	connectivity: "unknown",
	checkedAt: null,
};
const connected: TrackingAccountResponse = {
	...disconnected,
	generation: "two",
	provider: trackingProvider,
	account: { id: "anilist:7", name: "Fixture" },
	state: "connected",
	connectivity: "available",
};
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
	fetcher.mockReset();
	vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});

test.each([disconnected, connected])(
	"connects from $state without a dialog and clears former account queries",
	async (initial) => {
		let status = initial;
		const saved = { ...connected, generation: "saved" };
		fetcher.mockImplementation(async (path, options) => {
			if (path === "/api/tracking/account" && options?.method === "GET")
				return json(status);
			if (path === "/api/tracking/account/preview") {
				expect(JSON.parse(String(options?.body))).toEqual({
					credential: "fixture-token",
				});
				return json({
					candidateId: "candidate",
					account: connected.account,
					generation: initial.generation,
					expiresAt: Date.now() + 300000,
				});
			}
			if (path === "/api/tracking/account/confirm") {
				expect(JSON.parse(String(options?.body))).toEqual({
					candidateId: "candidate",
					generation: initial.generation,
				});
				status = saved;
				return json(saved);
			}
			throw new Error(`Unexpected route: ${path}`);
		});
		queryClient.setQueryData(["tracking", "old-account", "list"], {
			private: true,
		});
		const oldLibraryKey = [
			"anime-library",
			"root",
			7,
			"old-generation",
			{ scope: "all" },
		];
		queryClient.setQueryData(oldLibraryKey, { private: true });
		queryClient.setQueryData(
			["catalog", "root", "local-work-detail", "work-1"],
			{
				public: true,
			},
		);
		render(<TrackingAccountSettings metadataProvider="anilist" />);
		const connect = await screen.findByRole("button", {
			name: "Connect AniList",
		});
		const actions = screen.getByRole("group", {
			name: "the tracking service account actions",
		});
		const authorize = within(actions).getByRole("link", { name: "Authorize" });
		expect(authorize.getAttribute("href")).toBe(
			initial.provider.authorization.url,
		);
		expect(actions.lastElementChild).toBe(authorize);
		if (!initial.account) {
			expect(
				within(actions).queryByRole("button", { name: "Check connection" }),
			).toBeNull();
			expect(
				within(actions).queryByRole("button", { name: "Disconnect" }),
			).toBeNull();
		}
		const input = screen.getByLabelText("Access token") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "fixture-token" } });
		expect((connect as HTMLButtonElement).form).toBe(input.form);
		fireEvent.click(connect);
		await waitFor(() =>
			expect(queryClient.getQueryData(["tracking", "account"])).toEqual(saved),
		);
		expect(input.value).toBe("");
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(
			within(actions).getByRole("button", { name: "Check connection" }),
		).toBeTruthy();
		expect(
			within(actions).getByRole("button", { name: "Disconnect" }),
		).toBeTruthy();
		expect(
			queryClient.getQueryData(["tracking", "old-account", "list"]),
		).toBeUndefined();
		expect(queryClient.getQueryData(oldLibraryKey)).toBeUndefined();
		expect(
			queryClient.getQueryData([
				"catalog",
				"root",
				"local-work-detail",
				"work-1",
			]),
		).toEqual({ public: true });
		expect(
			JSON.stringify(
				queryClient
					.getMutationCache()
					.getAll()
					.map((value) => value.state),
			),
		).not.toContain("fixture-token");
	},
);

test("switching accounts requires confirmation in a dialog and can be cancelled", async () => {
	let status = connected;
	const replacement = {
		...connected,
		account: { id: "anilist:8", name: "Replacement" },
		generation: "three",
	};
	const confirm = vi.fn(() => {
		status = replacement;
		return json(status);
	});
	fetcher.mockImplementation(async (path) => {
		if (path === "/api/tracking/account") return json(status);
		if (path === "/api/tracking/account/preview")
			return json({
				candidateId: "candidate",
				account: replacement.account,
				generation: connected.generation,
				expiresAt: Date.now() + 300000,
			});
		if (path === "/api/tracking/account/confirm") return confirm();
		throw new Error(`Unexpected route: ${path}`);
	});
	render(<TrackingAccountSettings metadataProvider="anilist" />);
	const connect = await screen.findByRole("button", {
		name: "Connect AniList",
	});
	const input = screen.getByLabelText("Access token") as HTMLInputElement;
	const beginSwitch = async () => {
		fireEvent.change(input, { target: { value: "replacement-token" } });
		fireEvent.click(connect);
		const dialog = await screen.findByRole("dialog", {
			name: "Switch tracking account?",
		});
		await waitFor(() =>
			expect(
				(
					within(dialog).getByRole("button", {
						name: "Cancel",
					}) as HTMLButtonElement
				).disabled,
			).toBe(false),
		);
		return dialog;
	};
	const dialog = await beginSwitch();
	expect(dialog.textContent).toContain(
		"This server will switch from Fixture to Replacement.",
	);
	expect(input.value).toBe("");
	expect(confirm).not.toHaveBeenCalled();
	fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(screen.getByText("Account: Fixture")).toBeTruthy();
	expect(confirm).not.toHaveBeenCalled();

	const reopened = await beginSwitch();
	fireEvent.click(
		within(reopened).getByRole("button", { name: "Switch account" }),
	);
	await screen.findByText("Account: Replacement");
	expect(confirm).toHaveBeenCalledOnce();
});

test("a stale connection view cannot replace another session's account", async () => {
	const add = vi.spyOn(toast, "add");
	const confirm = vi.fn(() => json(connected));
	fetcher.mockImplementation(async (path) => {
		if (path === "/api/tracking/account") return json(disconnected);
		if (path === "/api/tracking/account/preview")
			return json({
				candidateId: "candidate",
				account: connected.account,
				generation: connected.generation,
				expiresAt: Date.now() + 300000,
			});
		if (path === "/api/tracking/account/confirm") return confirm();
		throw new Error(`Unexpected route: ${path}`);
	});
	render(<TrackingAccountSettings metadataProvider="anilist" />);
	const connect = await screen.findByRole("button", {
		name: "Connect AniList",
	});
	const input = screen.getByLabelText("Access token") as HTMLInputElement;
	fireEvent.change(input, { target: { value: "fixture-token" } });
	fireEvent.click(connect);
	await waitFor(() =>
		expect(add).toHaveBeenCalledWith(
			expect.objectContaining({ type: "error" }),
		),
	);
	expect(confirm).not.toHaveBeenCalled();
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(input.value).toBe("fixture-token");
});

test("disconnect uses connection generation and authorization failure offers reconnection", async () => {
	vi.spyOn(toast, "add");
	let status: TrackingAccountResponse = connected;
	fetcher.mockImplementation(async (path, options) => {
		if (path === "/api/tracking/account" && options?.method === "DELETE") {
			expect(JSON.parse(String(options.body))).toEqual({ generation: "two" });
			status = disconnected;
			return json(disconnected);
		}
		if (path === "/api/tracking/account/check") {
			status = {
				...connected,
				state: "authorization-required",
				connectivity: "unavailable",
			};
			return json(
				{
					error: {
						code: "TRACKING_AUTHORIZATION_REQUIRED",
						message: "Reconnect your account.",
						requestId: "fixture",
					},
				},
				409,
			);
		}
		return json(status);
	});
	render(<TrackingAccountSettings metadataProvider="anilist" />);
	await screen.findByText("Account: Fixture");
	fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
	await waitFor(() =>
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({ type: "error" }),
		),
	);
	expect(screen.queryByRole("alert")).toBeNull();
	await screen.findByText("Reconnect required");
	expect(screen.getByText("Connection check failed")).toBeTruthy();
	expect(screen.getByRole("link", { name: "Authorize" })).toBeTruthy();
	await waitFor(() =>
		expect(
			(screen.getByRole("button", { name: "Disconnect" }) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
	await screen.findByText("Disconnected");
});

test("connection checks show busy feedback only on the initiating action", async () => {
	let finishCheck: ((response: Response) => void) | undefined;
	fetcher.mockImplementation(async (path) => {
		if (path === "/api/tracking/account/check") {
			return new Promise<Response>((resolve) => {
				finishCheck = resolve;
			});
		}
		if (path === "/api/tracking/account") return json(connected);
		throw new Error(`Unexpected route: ${path}`);
	});
	render(<TrackingAccountSettings metadataProvider="anilist" />);
	const check = await screen.findByRole("button", { name: "Check connection" });
	const disconnect = screen.getByRole("button", { name: "Disconnect" });
	fireEvent.click(check);
	await waitFor(() => expect(check.getAttribute("aria-busy")).toBe("true"));
	expect(check.textContent).toContain("Test");
	expect(check.querySelector(".lucide-loader-circle")).toBeTruthy();
	expect(disconnect.getAttribute("aria-busy")).toBe("false");
	expect(disconnect.querySelector(".lucide-loader-circle")).toBeNull();
	expect(disconnect.hasAttribute("disabled")).toBe(true);
	finishCheck?.(json(connected));
	await waitFor(() => expect(check.getAttribute("aria-busy")).toBe("false"));
});

test("a Bangumi credential is previewed for the selected source before switching", async () => {
	const bangumi = {
		...trackingProvider,
		key: "bangumi",
		name: "Bangumi",
		authorization: {
			...trackingProvider.authorization,
			url: "https://next.bgm.tv/demo/access-token",
		},
	};
	const providers = [trackingProvider, bangumi];
	let status = { ...connected, providers };
	const replacement = { id: "bangumi:7", name: "Bangumi viewer" };
	const confirm = vi.fn(() => {
		status = {
			...status,
			provider: bangumi,
			account: replacement,
			generation: "three",
		};
		return json(status);
	});
	fetcher.mockImplementation(async (path, options) => {
		if (path === "/api/tracking/account") return json(status);
		if (path === "/api/tracking/account/preview") {
			expect(JSON.parse(String(options?.body))).toEqual({
				providerKey: "bangumi",
				credential: "bangumi-token",
			});
			return json({
				candidateId: "bangumi-candidate",
				account: replacement,
				generation: connected.generation,
				expiresAt: Date.now() + 300000,
			});
		}
		if (path === "/api/tracking/account/confirm") return confirm();
		throw new Error(`Unexpected route: ${path}`);
	});
	render(<TrackingAccountSettings metadataProvider="bangumi" />);
	await screen.findByRole("button", { name: "Connect Bangumi" });
	expect(screen.getByRole("heading", { name: "Bangumi" })).toBeTruthy();
	expect(screen.queryByRole("combobox")).toBeNull();
	expect(screen.queryByRole("button", { name: "Connect AniList" })).toBeNull();
	expect(
		screen
			.getByRole("link", { name: "Create Bangumi token" })
			.getAttribute("href"),
	).toBe(bangumi.authorization.url);
	const connect = screen.getByRole("button", { name: "Connect Bangumi" });
	const input = screen.getByLabelText("Personal access token");
	fireEvent.change(input, { target: { value: "bangumi-token" } });
	fireEvent.click(connect);
	const dialog = await screen.findByRole("dialog", {
		name: "Switch tracking account?",
	});
	expect(confirm).not.toHaveBeenCalled();
	fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(screen.getByText("Account: Fixture (AniList)")).toBeTruthy();
	fireEvent.change(input, { target: { value: "bangumi-token" } });
	fireEvent.click(connect);
	const reopened = await screen.findByRole("dialog", {
		name: "Switch tracking account?",
	});
	fireEvent.click(
		within(reopened).getByRole("button", { name: "Switch account" }),
	);
	await screen.findByText("Account: Bangumi viewer");
	expect(confirm).toHaveBeenCalledOnce();
});
