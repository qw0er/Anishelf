import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";
import { expect, test, vi } from "vitest";
import { createAuthenticationModule } from "../../../../src/modules/system/create.js";

import {
	application,
	browser,
	headers,
	setupTestLifecycle,
} from "./support/authentication-fixture.js";

setupTestLifecycle();

test("authentication lifecycle logs events without credentials or bearer tokens", async () => {
	const output: string[] = [];
	const logger = pino(
		{ level: "trace" },
		{
			write(line) {
				output.push(line);
			},
		},
	);
	const { app, password, dataDir } = await application("", false, logger);
	const credential = JSON.parse(
		await readFile(join(dataDir, "auth.json"), "utf8"),
	);
	const first = await browser(app, password ?? "");
	const wrongPassword = "wrong-password-secret-marker";
	const rejected = await app.inject({
		url: "/api/auth/login",
		method: "POST",
		headers: { ...headers, cookie: first.cookie, "x-csrf-token": first.csrf },
		payload: { password: wrongPassword },
	});
	expect(rejected.statusCode).toBe(401);
	const link = (
		await app.inject({
			url: "/api/media/file/access-link",
			method: "POST",
			headers: { ...headers, cookie: first.cookie, "x-csrf-token": first.csrf },
		})
	).json().url;
	const mediaToken =
		new URL(link, "http://localhost").searchParams.get("access_token") ?? "";
	expect(
		(
			await app.inject({
				url: "/api/auth/logout",
				method: "POST",
				headers: {
					...headers,
					cookie: first.cookie,
					"x-csrf-token": first.csrf,
				},
			})
		).statusCode,
	).toBe(204);
	const second = await browser(app, password ?? "");
	const newPassword = "changed-password-secret-marker";
	const change = (currentPassword: string) =>
		app.inject({
			url: "/api/auth/password",
			method: "PUT",
			headers: {
				...headers,
				cookie: second.cookie,
				"x-csrf-token": second.csrf,
			},
			payload: { currentPassword, password: newPassword },
		});
	expect((await change(wrongPassword)).statusCode).toBe(401);
	expect((await change(password ?? "")).statusCode).toBe(204);
	const records = output.map((line) => JSON.parse(line));
	for (const [event, level] of [
		["auth.credentials_initialized", 30],
		["auth.login_succeeded", 30],
		["auth.login_failed", 40],
		["auth.logout_succeeded", 30],
		["auth.password_change_rejected", 40],
		["auth.password_changed", 30],
	] as const)
		expect(records).toContainEqual(expect.objectContaining({ event, level }));
	expect(
		records
			.filter((record) => record.event === "auth.login_succeeded")
			.map((record) => record.reqId),
	).toEqual([
		first.login.headers["x-request-id"],
		second.login.headers["x-request-id"],
	]);
	const text = output.join("");
	for (const secret of [
		password,
		wrongPassword,
		newPassword,
		first.csrf,
		second.csrf,
		first.login.cookies[0]?.value,
		mediaToken,
		credential.hash,
		credential.salt,
	]) {
		expect(secret).toBeTruthy();
		expect(text).not.toContain(secret);
	}
	expect(
		records.find((record) => record.event === "auth.login_succeeded").reqId,
	).toBeTruthy();
});

test("session storage diagnostics retain error code and operation without SQL parameters", async () => {
	const output: string[] = [];
	const logger = pino(
		{ level: "trace" },
		{
			write(line) {
				output.push(line);
			},
		},
	);
	const { app, database, dataDir } = await application("", false, logger);
	const secret = "injected-session-secret-marker";
	vi.spyOn(database.authentication, "saveSession").mockImplementation(() => {
		throw new Error(`SQL parameters: ${secret}`, {
			cause: Object.assign(new Error(secret), { code: "SQLITE_READONLY" }),
		});
	});
	const response = await app.inject({ url: "/api/auth/session", headers });
	expect(response.statusCode).toBe(500);
	const records = output.map((line) => JSON.parse(line));
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "auth.session_store_failed",
			level: 50,
			operation: "save_session",
			errorType: "Error",
			errorCode: "SQLITE_READONLY",
			path: join(dataDir, "anishelf.sqlite"),
		}),
	);
	expect(output.join("")).not.toContain(secret);
	expect(response.body).not.toContain(secret);
});

test("credential read and write failures include safe paths and diagnostics", async () => {
	const output: string[] = [];
	const logger = pino(
		{ level: "trace" },
		{
			write(line) {
				output.push(line);
			},
		},
	);
	const { app, password, dataDir, database } = await application(
		"",
		false,
		logger,
	);
	const { cookie, csrf } = await browser(app, password ?? "");
	await rm(join(dataDir, "auth.json"));
	const { mkdir } = await import("node:fs/promises");
	await mkdir(join(dataDir, "auth.json"));
	const response = await app.inject({
		url: "/api/auth/password",
		method: "PUT",
		headers: { ...headers, cookie, "x-csrf-token": csrf },
		payload: {
			currentPassword: password,
			password: "next-password-secret-marker",
		},
	});
	expect(response.statusCode).toBe(500);
	expect(output.map((line) => JSON.parse(line))).toContainEqual(
		expect.objectContaining({
			event: "auth.credentials_write_failed",
			level: 50,
			operation: "replace_credentials",
			path: join(dataDir, "auth.json"),
			errorCode: expect.stringMatching(/^E/),
		}),
	);
	await expect(
		createAuthenticationModule({
			dataDir,
			logger,
			store: database.authentication,

			sources: { version: async () => "version" },
		}),
	).rejects.toThrow();
	expect(output.map((line) => JSON.parse(line))).toContainEqual(
		expect.objectContaining({
			event: "auth.credentials_load_failed",
			level: 50,
			credentialPath: join(dataDir, "auth.json"),
			sessionKeyPath: join(dataDir, "auth-session.key"),
		}),
	);
	expect(output.join("")).not.toContain(password);
	expect(output.join("")).not.toContain("next-password-secret-marker");
});
