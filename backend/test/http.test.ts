import pino from "pino";
import { afterEach, expect, test } from "vitest";
import { createHttpApp } from "../src/bootstrap/http.js";
import { DomainError } from "../src/shared/errors.js";

const apps: ReturnType<typeof createHttpApp>[] = [];
const headers = { host: "127.0.0.1:3000" };
function application(development = false, host = "127.0.0.1") {
	const app = createHttpApp({
		config: { host, port: 3000 },
		logger: pino({ enabled: false }),
		development,
	});
	app.post(
		"/api/test",
		{
			schema: {
				body: {
					type: "object",
					additionalProperties: false,
					required: ["count"],
					properties: { count: { type: "integer" } },
				},
			},
		},
		async (request) => request.body,
	);
	apps.push(app);
	return app;
}
afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

test("health responds with fresh server-generated request IDs", async () => {
	const app = application();
	const first = await app.inject({
		url: "/api/health",
		headers: { ...headers, "x-request-id": "untrusted-client-id" },
	});
	const second = await app.inject({ url: "/api/health", headers });
	expect(first.statusCode).toBe(200);
	expect(first.json()).toEqual({ status: "ok" });
	expect(first.headers["x-request-id"]).toMatch(/^[\da-f-]{36}$/);
	expect(first.headers["x-request-id"]).not.toBe(
		second.headers["x-request-id"],
	);
});

test("unknown endpoints return the public error contract", async () => {
	const response = await application().inject({ url: "/missing", headers });
	expect(response.statusCode).toBe(404);
	expect(response.json()).toEqual({
		error: {
			code: "ROUTE_NOT_FOUND",
			message: "The requested endpoint was not found.",
			requestId: response.headers["x-request-id"],
		},
	});
});

test.each([
	"evil.example:3000",
	"127.0.0.1:9999",
	"127.0.0.1:3000@evil.example",
	"127.0.0.1:3000/path",
	"[",
])("rejects unexpected or malformed Host: %s", async (host) => {
	const response = await application().inject({
		url: "/api/health",
		headers: { host, "x-forwarded-host": headers.host },
	});
	expect(response.statusCode).toBe(400);
	expect(response.json().error.code).toBe("INVALID_REQUEST");
});

test.each(["127.0.0.1:3000", "localhost:3000"])(
	"accepts expected Host: %s",
	async (host) => {
		expect(
			(await application().inject({ url: "/api/health", headers: { host } }))
				.statusCode,
		).toBe(200);
	},
);

test("accepts configured IPv6 loopback Host", async () => {
	expect(
		(
			await application(false, "::1").inject({
				url: "/api/health",
				headers: { host: "[::1]:3000" },
			})
		).statusCode,
	).toBe(200);
});

test.each([undefined, "http://127.0.0.1:3000"])(
	"accepts a mutation with no Origin or the same Origin: %s",
	async (origin) => {
		const response = await application().inject({
			method: "POST",
			url: "/api/test",
			headers: { ...headers, ...(origin ? { origin } : {}) },
			payload: { count: 1 },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ count: 1 });
	},
);

test.each(["https://evil.example", "null", "http://127.0.0.1:5173"])(
	"rejects untrusted production mutation Origin: %s",
	async (origin) => {
		const response = await application().inject({
			method: "POST",
			url: "/api/test",
			headers: { ...headers, origin },
			payload: { count: 1 },
		});
		expect(response.statusCode).toBe(403);
		expect(response.json().error.code).toBe("REQUEST_FORBIDDEN");
	},
);

test.each(["http://127.0.0.1:5173", "http://localhost:5173"])(
	"accepts the fixed development proxy Origin: %s",
	async (origin) => {
		expect(
			(
				await application(true).inject({
					method: "POST",
					url: "/api/test",
					headers: { ...headers, origin },
					payload: { count: 1 },
				})
			).statusCode,
		).toBe(200);
	},
);

test("rejects browser cross-site mutation metadata even without Origin", async () => {
	const response = await application().inject({
		method: "POST",
		url: "/api/test",
		headers: { ...headers, "sec-fetch-site": "cross-site" },
		payload: { count: 1 },
	});
	expect(response.statusCode).toBe(403);
});

test.each([{ count: "1" }, { count: 1, extra: true }, {}])(
	"validates request bodies without coercing or removing invalid fields: %j",
	async (payload) => {
		const response = await application().inject({
			method: "POST",
			url: "/api/test",
			headers,
			payload,
		});
		expect(response.statusCode).toBe(400);
		expect(response.json().error.code).toBe("INVALID_REQUEST");
	},
);

test("malformed JSON and oversized requests use safe errors", async () => {
	const app = application();
	for (const [payload, status] of [
		["{", 400],
		[JSON.stringify({ secret: "x".repeat(65536) }), 413],
	] as const) {
		const response = await app.inject({
			method: "POST",
			url: "/api/test",
			headers: { ...headers, "content-type": "application/json" },
			payload,
		});
		expect(response.statusCode).toBe(status);
		expect(response.json().error.code).toBe("INVALID_REQUEST");
		expect(response.json().error.requestId).toBe(
			response.headers["x-request-id"],
		);
	}
});

test("maps domain and unexpected errors without exposing internal paths", async () => {
	const app = application();
	app.get("/api/domain", async () => {
		throw new DomainError("RESOURCE_MISSING", "/private/media/video.mp4");
	});
	app.get("/api/failure", async () => {
		throw new Error("/private/settings.json secret");
	});
	for (const [url, status, code] of [
		["/api/domain", 404, "RESOURCE_MISSING"],
		["/api/failure", 500, "INTERNAL_ERROR"],
	] as const) {
		const response = await app.inject({ url, headers });
		expect(response.statusCode).toBe(status);
		expect(response.json().error.code).toBe(code);
		expect(response.body).not.toContain("/private");
		expect(response.body).not.toContain("secret");
	}
});
