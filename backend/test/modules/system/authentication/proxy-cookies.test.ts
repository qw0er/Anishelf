import pino from "pino";
import { expect, test } from "vitest";

import {
	application,
	browser,
	headers,
	setupTestLifecycle,
} from "./support/authentication-fixture.js";

setupTestLifecycle();

test("HTTPS proxy uses Secure cookies while untrusted forwarded headers cannot force HTTPS", async () => {
	const { app } = await application("", true);
	const response = await app.inject({
		url: "/api/auth/session",
		headers: { host: "example.com", "x-forwarded-proto": "https" },
		remoteAddress: "127.0.0.1",
	});
	expect(response.headers["set-cookie"]).toContain("Secure");
	const untrusted = await app.inject({
		url: "/api/auth/session",
		headers: { host: "example.com", "x-forwarded-proto": "https" },
		remoteAddress: "10.0.0.2",
	});
	expect(untrusted.headers["set-cookie"]).not.toContain("Secure");
	expect(untrusted.statusCode).toBe(200);
});

test("configured container proxy establishes an HTTPS session and retains Origin/CSRF boundaries", async () => {
	const { app, password } = await application(
		"",
		true,
		pino({ enabled: false }),
		["loopback", "10.89.0.0/24"],
	);
	const proxyHeaders = {
		host: "example.com",
		"x-forwarded-proto": "https",
		origin: "https://example.com",
	};
	const init = await app.inject({
		url: "/api/auth/session",
		headers: proxyHeaders,
		remoteAddress: "10.89.0.2",
	});
	expect(init.statusCode).toBe(200);
	expect(init.headers["set-cookie"]).toContain("Secure");
	expect(init.headers["set-cookie"]).toContain("HttpOnly");
	const cookie = init.cookies
		.map((item) => `${item.name}=${encodeURIComponent(item.value)}`)
		.join("; ");
	const loginHeaders = {
		...proxyHeaders,
		cookie,
		"x-csrf-token": init.json().csrfToken,
	};
	for (const bad of [
		{ origin: "https://evil.example" },
		{ "x-csrf-token": "forged" },
		{ "sec-fetch-site": "cross-site" },
	]) {
		const rejected = await app.inject({
			method: "POST",
			url: "/api/auth/login",
			remoteAddress: "10.89.0.2",
			headers: { ...loginHeaders, ...bad },
			payload: { password },
		});
		expect(rejected.statusCode).toBe(403);
	}
	const login = await app.inject({
		method: "POST",
		url: "/api/auth/login",
		remoteAddress: "10.89.0.2",
		headers: loginHeaders,
		payload: { password },
	});
	expect(login.statusCode, login.body).toBe(200);
	expect(login.headers["set-cookie"]).toContain("Secure");
	const rotated = login.cookies
		.map((item) => `${item.name}=${encodeURIComponent(item.value)}`)
		.join("; ");
	expect(rotated).not.toBe(cookie);
	const authenticated = await app.inject({
		url: "/api/settings",
		remoteAddress: "10.89.0.2",
		headers: { ...proxyHeaders, cookie: rotated },
	});
	expect(authenticated.statusCode).toBe(200);
	const outside = await app.inject({
		url: "/api/auth/session",
		remoteAddress: "10.90.0.2",
		headers: proxyHeaders,
	});
	expect(outside.headers["set-cookie"]).not.toContain("Secure");
});

test.each([
	"192.168.1.20:8787",
	"[fd00::42]:8787",
	"nas.local:8787",
	"anime.example.com:8787",
])("complete login at %s needs no fixed origin", async (host) => {
	const { app, password } = await application();
	const address = { host, origin: `http://${host}` };
	const initial = await app.inject({
		url: "/api/auth/session",
		headers: address,
	});
	expect(initial.statusCode).toBe(200);
	expect(initial.headers["set-cookie"]).not.toContain("Secure");
	const cookie = initial.cookies
		.map((item) => `${item.name}=${encodeURIComponent(item.value)}`)
		.join("; ");
	const rejected = await app.inject({
		method: "POST",
		url: "/api/auth/login",
		headers: { ...address, cookie },
		payload: { password },
	});
	expect(rejected.statusCode).toBe(403);
	const login = await app.inject({
		method: "POST",
		url: "/api/auth/login",
		headers: { ...address, cookie, "x-csrf-token": initial.json().csrfToken },
		payload: { password },
	});
	expect(login.statusCode, login.body).toBe(200);
	const signedIn = login.cookies
		.map((item) => `${item.name}=${encodeURIComponent(item.value)}`)
		.join("; ");
	expect(
		(
			await app.inject({
				url: "/api/settings",
				headers: { ...address, cookie: signedIn },
			})
		).statusCode,
	).toBe(200);
});

test("automatic cookies upgrade existing HTTP sessions on a trusted HTTPS connection", async () => {
	const { app, password } = await application();
	const { cookie } = await browser(app, password ?? "");
	const upgraded = await app.inject({
		url: "/api/auth/session",
		headers: { ...headers, cookie, "x-forwarded-proto": "https" },
		remoteAddress: "127.0.0.1",
	});
	expect(upgraded.statusCode).toBe(200);
	expect(upgraded.json().authenticated).toBe(true);
	expect(upgraded.headers["set-cookie"]).toContain("Secure");
	const direct = await app.inject({
		url: "/api/auth/session",
		headers: { ...headers, "x-forwarded-proto": "https" },
		remoteAddress: "192.168.1.55",
	});
	expect(direct.statusCode).toBe(200);
	expect(direct.headers["set-cookie"]).not.toContain("Secure");
});
