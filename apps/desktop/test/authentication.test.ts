import { ApiClientError } from "@anishelf/client-core";
import { expect, test, vi } from "vitest";
import type { ServerSignInResult } from "../src/ipc/desktop.js";
import { DesktopAuthentication } from "../src/renderer/server/authentication.js";

test("a stale session check clears its credential before a queued sign-in", async () => {
	const response = Promise.withResolvers<never>();
	const signIn = vi.fn(
		async (): Promise<ServerSignInResult> => ({
			status: "ok",
			origin: "https://anishelf.example.com",
		}),
	);
	const clearDeviceToken = vi.fn(async () => {});
	const authentication = new DesktopAuthentication(
		{ request: () => response.promise },
		{ signIn, clearDeviceToken },
		"https://anishelf.example.com",
	);
	const session = authentication.getSession();
	const login = authentication.signIn("password");
	await Promise.resolve();
	expect(signIn).not.toHaveBeenCalled();

	response.reject(
		new ApiClientError({ kind: "http", status: 401, message: "Unauthorized" }),
	);
	await expect(session).resolves.toEqual({ authenticated: false });
	await login;
	expect(clearDeviceToken).toHaveBeenCalledBefore(signIn);
});

test("a rejected sign-in does not block a retry", async () => {
	const signIn = vi
		.fn(
			async (): Promise<ServerSignInResult> => ({
				status: "ok",
				origin: "https://anishelf.example.com",
			}),
		)
		.mockResolvedValueOnce({ status: "rejected", httpStatus: 429 });
	const authentication = new DesktopAuthentication(
		{ request: vi.fn() },
		{ signIn, clearDeviceToken: vi.fn() },
		"https://anishelf.example.com",
	);
	const rejected = authentication.signIn("password");
	const retry = authentication.signIn("password");
	await expect(rejected).rejects.toMatchObject({ status: 429 });
	await expect(retry).resolves.toBeUndefined();
});
