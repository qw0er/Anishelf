import { expect, test } from "vitest";
import { MetadataError } from "../../../../src/modules/anime/metadata/public.js";
import { createHttpApp } from "../../../support/http.js";

import {
	failure,
	logger,
	png,
	reference,
	setup,
	setupTestLifecycle,
} from "./support/metadata-fixture.js";

setupTestLifecycle();

test("HTTP exposes normalized cache envelopes, refresh, artwork and safe failures", async () => {
	const { application, publicMetadata, fetcher } = await setup();
	const app = createHttpApp({
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
		metadata: publicMetadata,
	});
	try {
		const search = await app.inject({
			url: "/api/metadata/search?query=Frieren",
		});
		expect(search.statusCode).toBe(200);
		expect(search.json()).not.toHaveProperty("raw");
		expect(
			(
				await app.inject({
					url: `/api/metadata/${publicMetadata.resolveReference("154587").id}`,
				})
			).statusCode,
		).toBe(200);
		fetcher.mockImplementationOnce(async () =>
			Response.json({ errors: [{ status: 500, message: "internal secret" }] }),
		);
		const refresh = await app.inject({
			method: "POST",
			url: "/api/metadata/anilist/154587/refresh",
		});
		expect(refresh.statusCode).toBe(404);
		const refreshed = await application.get(
			{ provider: "anilist", mediaType: "anime", id: "154587" },
			{ refresh: true },
		);
		expect(refreshed.refreshError?.code).toBe("unavailable");
		fetcher.mockImplementationOnce(
			async () => new Response(null, { status: 503 }),
		);
		const uncached = await app.inject({
			url: `/api/metadata/${publicMetadata.resolveReference("999").id}`,
		});
		expect(uncached.statusCode).toBe(503);
		expect(uncached.json().error.code).toBe("METADATA_UNAVAILABLE");
		expect(
			(await app.inject({ url: "/api/metadata/search?query=x&perPage=99" }))
				.statusCode,
		).toBe(400);
		expect(
			(
				await app.inject({
					url: `/api/metadata/${publicMetadata.resolveReference("1").id}?cachedOnly=true`,
				})
			).statusCode,
		).toBe(404);
		fetcher.mockImplementationOnce(async () => new Response(png));
		const status = await app.inject({
			url: "/api/metadata/anilist/154587/artwork/cover",
		});
		expect(status.statusCode).toBe(404);
		const artworkId = (
			await application.artwork(
				{ provider: "anilist", mediaType: "anime", id: "154587" },
				"cover",
				{},
			)
		).id;
		const image = await app.inject({
			url: `/api/metadata/artwork/${artworkId}`,
		});
		expect(image.statusCode).toBe(200);
		expect(image.headers["content-type"]).toBe("image/png");
		expect(image.headers["cache-control"]).toBe("private, max-age=604800");
		expect(image.headers.etag).toBe(`"${artworkId}"`);
		expect(image.rawPayload).toEqual(png);
		const revalidated = await app.inject({
			url: `/api/metadata/artwork/${artworkId}`,
			headers: { "if-none-match": image.headers.etag as string },
		});
		expect(revalidated.statusCode).toBe(304);
		expect(revalidated.rawPayload).toHaveLength(0);
		// Provider references resolve the same cached bytes for tracked works.
		const proxied = await app.inject({
			url: `/api/metadata/${publicMetadata.resolveReference("154587").id}/artwork/cover/image`,
		});
		expect(proxied.statusCode).toBe(200);
		expect(proxied.headers["content-type"]).toBe("image/png");
		expect(proxied.headers["cache-control"]).toBe("private, max-age=3600");
		expect(proxied.headers.etag).toBe(`"${artworkId}"`);
		expect(proxied.rawPayload).toEqual(png);
		expect(
			(
				await app.inject({
					url: `/api/metadata/${publicMetadata.resolveReference("154587").id}/artwork/cover/image`,
					headers: { "if-none-match": proxied.headers.etag as string },
				})
			).statusCode,
		).toBe(304);
		expect(
			(
				await app.inject({
					url: `/api/metadata/${publicMetadata.resolveReference("154587").id}/artwork/banner/image`,
				})
			).statusCode,
		).toBe(404);
	} finally {
		await app.close();
	}
});

test("bad input and unsupported references never contact the provider", async () => {
	const { application, fetcher } = await setup();
	expect(() => application.search({ query: " " })).toThrow(MetadataError);
	expect(() => application.search({ query: "title", page: 0 })).toThrow(
		MetadataError,
	);
	expect(() => application.get({ ...reference, provider: "unknown" })).toThrow(
		MetadataError,
	);
	await failure(application.get({ ...reference, id: "01" }), "invalid-request");
	await failure(
		application.get(reference, { refresh: true, cachedOnly: true }),
		"invalid-request",
	);
	expect(fetcher).not.toHaveBeenCalled();
});

test("public metadata rejects unknown search providers and unknown project IDs without upstream requests", async () => {
	const { publicMetadata, fetcher } = await setup();
	const app = createHttpApp({
		config: { host: "localhost", port: 80, publicOrigin: "http://localhost" },
		logger,
		metadata: publicMetadata,
	});
	try {
		for (const url of [
			"/api/metadata/search?query=Frieren&provider=unknown",
			"/api/metadata/reference?value=154587&provider=anilist",
		]) {
			expect((await app.inject({ url })).statusCode).toBe(400);
		}
		expect(
			(await app.inject({ url: "/api/metadata/unknown-work" })).statusCode,
		).toBe(404);
		expect(
			(await app.inject({ url: "/api/metadata/anilist/154587" })).statusCode,
		).toBe(404);
		expect(fetcher).not.toHaveBeenCalled();
	} finally {
		await app.close();
	}
});
