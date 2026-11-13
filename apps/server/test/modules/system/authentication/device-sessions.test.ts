import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { desktopOrigin } from "@anishelf/contracts/defaults";
import Database from "better-sqlite3";
import { expect, test, vi } from "vitest";
import {
	application,
	browser,
	headers,
	setupTestLifecycle,
} from "./support/authentication-fixture.js";

setupTestLifecycle();

const endpoint = "/api/auth/device-sessions";
const httpsHeaders = { ...headers, "x-forwarded-proto": "https" };
const desktopHeaders = {
	...headers,
	origin: desktopOrigin,
	"sec-fetch-site": "cross-site",
};
const bearer = (token: string) => ({
	...httpsHeaders,
	authorization: `Bearer ${token}`,
});

async function signIn(
	app: Awaited<ReturnType<typeof application>>["app"],
	password: string | undefined,
	name: string,
	transportHeaders: Record<string, string> = httpsHeaders,
) {
	const response = await app.inject({
		method: "POST",
		url: endpoint,
		headers: transportHeaders,
		payload: { name, password },
	});
	expect(response.statusCode, response.body).toBe(201);
	expect(response.headers["cache-control"]).toBe("no-store");
	expect(response.headers["set-cookie"]).toBeUndefined();
	return response.json<{
		token: string;
		session: { id: string; name: string; expiresAt: number };
	}>();
}

test("the Electron renderer can preflight, sign in and read protected media without cookies", async () => {
	const { app, password } = await application();
	const preflight = await app.inject({
		method: "OPTIONS",
		url: endpoint,
		headers: {
			...desktopHeaders,
			"access-control-request-method": "POST",
			"access-control-request-headers": "content-type",
		},
	});
	expect(preflight.statusCode, preflight.body).toBe(204);
	expect(preflight.headers["access-control-allow-origin"]).toBe(desktopOrigin);
	expect(preflight.headers["access-control-allow-credentials"]).toBeUndefined();
	expect(preflight.headers["set-cookie"]).toBeUndefined();
	const { token } = await signIn(app, password, "Electron", desktopHeaders);
	const authorization = `Bearer ${token}`;
	const write = await app.inject({
		method: "POST",
		url: "/api/test",
		headers: { ...desktopHeaders, authorization },
	});
	expect(write.statusCode, write.body).toBe(200);
	expect(write.headers["access-control-allow-origin"]).toBe(desktopOrigin);
	const media = await app.inject({
		url: "/api/media/file",
		headers: { ...desktopHeaders, authorization, range: "bytes=0-3" },
	});
	expect(media.statusCode, media.body).toBe(206);
	expect(media.headers["access-control-expose-headers"]).toContain(
		"Content-Range",
	);
	expect(media.headers["content-range"]).toBe("bytes 0-3/10");

	const { cookie, csrf } = await browser(app, password ?? "");
	const cookieWrite = await app.inject({
		method: "POST",
		url: "/api/test",
		headers: { ...desktopHeaders, cookie, "x-csrf-token": csrf },
	});
	expect(cookieWrite.statusCode).toBe(401);
	const unrelated = await app.inject({
		method: "OPTIONS",
		url: endpoint,
		headers: {
			...desktopHeaders,
			origin: "https://unrelated.example",
			"access-control-request-method": "POST",
			"access-control-request-headers": "content-type",
		},
	});
	expect(unrelated.headers["access-control-allow-origin"]).toBeUndefined();
	const page = await app.inject({ url: "/", headers: desktopHeaders });
	expect(page.headers["access-control-allow-origin"]).toBeUndefined();
});

test("device sign-in persists only a digest and authorizes API writes and media range reads", async () => {
	const { app, dataDir, password } = await application();
	const { token, session } = await signIn(app, password, "  Desktop  ");
	expect(session.name).toBe("Desktop");
	const digest = createHash("sha256").update(token).digest("hex");
	const current = await app.inject({
		url: `${endpoint}/current`,
		headers: bearer(token),
	});
	expect(current.json()).toEqual(session);
	expect(current.headers["set-cookie"]).toBeUndefined();
	const sqlite = new Database(join(dataDir, "anishelf.sqlite"), {
		readonly: true,
	});
	try {
		const rows = sqlite
			.prepare("SELECT token_hash FROM auth_device_sessions")
			.all();
		expect(rows).toEqual([{ token_hash: digest }]);
	} finally {
		sqlite.close();
	}
	const write = await app.inject({
		url: "/api/test",
		method: "POST",
		headers: bearer(token),
	});
	expect(write.statusCode).toBe(200);
	const media = await app.inject({
		url: "/api/media/file",
		headers: { ...bearer(token), range: "bytes=0-3" },
	});
	expect(media.statusCode).toBe(206);
	expect(media.headers["content-range"]).toBe("bytes 0-3/10");
	const link = await app.inject({
		method: "POST",
		url: "/api/media/file/access-link",
		headers: bearer(token),
	});
	expect(link.statusCode).toBe(200);
	const external = await app.inject({
		url: link.json<{ url: string }>().url,
		headers: { ...httpsHeaders, range: "bytes=0-3" },
	});
	expect(external.statusCode).toBe(206);
});

test("browser or device can revoke a device and an expired token stops authorizing", async () => {
	const { app, password, dataDir } = await application();
	const first = await signIn(app, password, "Desktop");
	const second = await signIn(app, password, "Phone");
	await app.close();
	const { app: restarted } = await application(dataDir);
	const list = await restarted.inject({
		url: endpoint,
		headers: bearer(first.token),
	});
	expect(list.statusCode).toBe(200);
	expect(list.json()).toEqual(
		expect.arrayContaining([first.session, second.session]),
	);
	const { cookie, csrf } = await browser(restarted, password ?? "");
	const revoke = await restarted.inject({
		url: `${endpoint}/${second.session.id}`,
		method: "DELETE",
		headers: { ...headers, cookie, "x-csrf-token": csrf },
	});
	expect(revoke.statusCode).toBe(204);
	expect(
		(
			await restarted.inject({
				url: "/api/settings",
				headers: bearer(second.token),
			})
		).statusCode,
	).toBe(401);

	const third = await signIn(restarted, password, "Tablet");
	const revokeSelf = await restarted.inject({
		url: `${endpoint}/current`,
		method: "DELETE",
		headers: bearer(third.token),
	});
	expect(revokeSelf.statusCode).toBe(204);
	expect(
		(
			await restarted.inject({
				url: "/api/settings",
				headers: bearer(third.token),
			})
		).statusCode,
	).toBe(401);
	expect(
		(
			await restarted.inject({
				url: "/api/settings",
				headers: bearer(first.token),
			})
		).statusCode,
	).toBe(200);

	vi.spyOn(Date, "now").mockReturnValue(first.session.expiresAt);
	expect(
		(
			await restarted.inject({
				url: "/api/settings",
				headers: bearer(first.token),
			})
		).statusCode,
	).toBe(401);
});

test.each([
	["127.0.0.1:3000", "127.0.0.1"],
	["localhost:3000", "::ffff:127.0.0.1"],
	["[::1]:3000", "::1"],
])(
	"supports a full device session on loopback HTTP at %s",
	async (host, remoteAddress) => {
		const { app, password } = await application();
		const login = await app.inject({
			method: "POST",
			url: endpoint,
			headers: { host },
			remoteAddress,
			payload: { name: "Local desktop", password },
		});
		expect(login.statusCode, login.body).toBe(201);
		expect(login.headers["set-cookie"]).toBeUndefined();
		const authorization = `Bearer ${login.json<{ token: string }>().token}`;
		for (const [method, url, status] of [
			["GET", `${endpoint}/current`, 200],
			["POST", "/api/test", 200],
			["GET", "/api/media/file", 206],
			["DELETE", `${endpoint}/current`, 204],
			["GET", "/api/settings", 401],
		] as const) {
			const response = await app.inject({
				method,
				url,
				headers: { host, authorization, range: "bytes=0-3" },
				remoteAddress,
			});
			expect(response.statusCode, response.body).toBe(status);
			expect(response.headers["set-cookie"]).toBeUndefined();
		}
	},
);

test.each([
	{ headers, remoteAddress: "192.0.2.25" },
	{
		headers: { ...headers, "x-forwarded-proto": "https" },
		remoteAddress: "192.0.2.25",
	},
	{ headers: { host: "anime.example.com" }, remoteAddress: "127.0.0.1" },
	{
		headers: { ...headers, "x-forwarded-for": "192.0.2.25" },
		remoteAddress: "127.0.0.1",
	},
	{
		headers: { ...headers, forwarded: "for=192.0.2.25" },
		remoteAddress: "127.0.0.1",
	},
])("rejects insecure device authentication over %j", async (transport) => {
	const { app, password } = await application();
	const { token } = await signIn(app, password, "Desktop");
	const login = await app.inject({
		...transport,
		method: "POST",
		url: endpoint,
		payload: { name: "Other device", password },
	});
	expect(login.statusCode).toBe(403);
	const read = await app.inject({
		...transport,
		url: "/api/settings",
		headers: { ...transport.headers, authorization: `Bearer ${token}` },
	});
	expect(read.statusCode).toBe(403);
});

test("device authentication does not bypass Origin, CSRF or HTTPS checks", async () => {
	const { app, password } = await application();
	const { cookie, csrf } = await browser(app, password ?? "");
	const { token, session } = await signIn(app, password, "Desktop");
	const payload = { name: "Another device", password };
	const rejected = await Promise.all([
		app.inject({
			method: "POST",
			url: endpoint,
			headers: { ...httpsHeaders, origin: "https://other.test" },
			payload,
		}),
		app.inject({
			method: "POST",
			url: endpoint,
			headers: { ...httpsHeaders, "sec-fetch-site": "cross-site" },
			payload,
		}),
		app.inject({
			method: "POST",
			url: endpoint,
			headers: { ...httpsHeaders, cookie, "x-csrf-token": csrf },
			payload,
		}),
		app.inject({
			method: "POST",
			url: "/api/test",
			headers: { ...bearer(token), origin: "https://other.test" },
		}),
		app.inject({
			method: "POST",
			url: "/api/test",
			headers: { ...bearer(token), "sec-fetch-site": "cross-site" },
		}),
		app.inject({
			method: "POST",
			url: "/api/test",
			headers: { ...bearer(token), cookie },
		}),
		app.inject({
			method: "DELETE",
			url: `${endpoint}/${session.id}`,
			headers: { ...headers, cookie },
		}),
		app.inject({
			method: "POST",
			url: "/api/auth/logout",
			headers: bearer(token),
		}),
	]);
	expect(rejected.map(({ statusCode }) => statusCode)).toEqual(
		Array(8).fill(403),
	);

	const wrong = await app.inject({
		method: "POST",
		url: endpoint,
		headers: httpsHeaders,
		payload: { name: "Wrong", password: "wrong" },
	});
	expect(wrong.statusCode).toBe(401);
	const invalid = await app.inject({
		url: "/api/settings",
		headers: { ...bearer(randomBytes(32).toString("base64url")), cookie },
	});
	expect(invalid.statusCode).toBe(401);
	expect(invalid.headers["www-authenticate"]).toContain("Bearer");
	expect(
		(
			await app.inject({
				url: `/api/media/file?access_token=${token}`,
				headers: httpsHeaders,
			})
		).statusCode,
	).toBe(401);
});

test("changing the server password revokes device sessions", async () => {
	const { app, password } = await application();
	const { token } = await signIn(app, password, "Desktop");
	const { cookie, csrf } = await browser(app, password ?? "");
	const change = await app.inject({
		method: "PUT",
		url: "/api/auth/password",
		headers: { ...headers, cookie, "x-csrf-token": csrf },
		payload: { currentPassword: password, password: "replacement password" },
	});
	expect(change.statusCode).toBe(204);
	expect(
		(await app.inject({ url: "/api/settings", headers: bearer(token) }))
			.statusCode,
	).toBe(401);
});

test("a device can change the password and revoke existing credentials without a browser session", async () => {
	const { app, password } = await application();
	const { cookie } = await browser(app, password ?? "");
	const { token } = await signIn(app, password, "Local desktop", headers);
	const other = await signIn(app, password, "Remote phone");
	const change = await app.inject({
		url: "/api/auth/password",
		method: "PUT",
		headers: { ...headers, authorization: `Bearer ${token}` },
		payload: { currentPassword: password, password: "replacement password" },
	});
	expect(change.statusCode, change.body).toBe(204);
	expect(change.headers["set-cookie"]).toBeUndefined();
	for (const credentials of [
		{ ...headers, cookie },
		{ ...headers, authorization: `Bearer ${token}` },
		bearer(other.token),
	]) {
		const response = await app.inject({
			url: "/api/settings",
			headers: credentials,
		});
		expect(response.statusCode).toBe(401);
	}
	await signIn(app, "replacement password", "Local desktop", headers);
});
