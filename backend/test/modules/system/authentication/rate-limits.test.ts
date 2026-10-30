import pino from "pino";
import { expect, test } from "vitest";

import {
	application,
	headers,
	setupTestLifecycle,
} from "./support/authentication-fixture.js";

setupTestLifecycle();

test("login attempts are limited and include Retry-After", async () => {
	const output: string[] = [];
	const logger = pino(
		{ level: "info" },
		{
			write(line) {
				output.push(line);
			},
		},
	);
	const { app } = await application("", false, logger);
	const init = await app.inject({ url: "/api/auth/session", headers });
	const cookie = init.cookies
		.map((item) => `${item.name}=${encodeURIComponent(item.value)}`)
		.join("; ");
	let status = 0;
	for (let index = 0; index < 12; index++) {
		const response = await app.inject({
			url: "/api/auth/login",
			method: "POST",
			headers: { ...headers, cookie, "x-csrf-token": init.json().csrfToken },
			payload: { password: "wrong" },
		});
		status = response.statusCode;
		expect([401, 429]).toContain(status);
		if (status === 429) expect(response.headers["retry-after"]).toBeDefined();
	}
	expect(status).toBe(429);
	expect(output.map((line) => JSON.parse(line))).toContainEqual(
		expect.objectContaining({
			event: "auth.login_rate_limited",
			level: 40,
			scope: "source",
		}),
	);
});

test("instance-wide login budget also blocks attempts from a fresh source", async () => {
	const output: string[] = [];
	const logger = pino(
		{ level: "info" },
		{
			write(line) {
				output.push(line);
			},
		},
	);
	const { app } = await application("", false, logger);
	const init = await app.inject({ url: "/api/auth/session", headers });
	const cookie = init.cookies
		.map((item) => `${item.name}=${encodeURIComponent(item.value)}`)
		.join("; ");
	for (let count = 0; count < 100; count++)
		await app.inject({
			url: "/api/auth/login",
			method: "POST",
			headers: { ...headers, cookie, "x-csrf-token": init.json().csrfToken },
			payload: { password: "wrong" },
		});
	const response = await app.inject({
		url: "/api/auth/login",
		method: "POST",
		remoteAddress: "10.0.0.2",
		headers: { ...headers, cookie, "x-csrf-token": init.json().csrfToken },
		payload: { password: "wrong" },
	});
	expect(response.statusCode).toBe(429);
	expect(output.map((line) => JSON.parse(line))).toContainEqual(
		expect.objectContaining({
			event: "auth.login_rate_limited",
			level: 40,
			scope: "instance",
			source: "10.0.0.2",
		}),
	);
	expect(response.json().error.code).toBe("AUTH_RATE_LIMITED");
	expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
});
