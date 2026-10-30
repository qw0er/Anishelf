import { expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../../../../src/app/bootstrap/database.js";
import { SourceMetadataApplication as MetadataApplication } from "../../../../src/modules/anime/metadata/application/source-metadata.js";
import { createMetadataApplication as createPublicMetadata } from "../../../../src/modules/anime/metadata/create.js";
import { MetadataError } from "../../../../src/modules/anime/metadata/public.js";

import {
	cleanups,
	logger,
	reference,
	setup,
	setupTestLifecycle,
	transport,
} from "./support/metadata-fixture.js";

setupTestLifecycle();

test("public metadata uses durable project identities across search, detail, snapshots and restart", async () => {
	const { application, publicMetadata, database, dir, fetcher } = await setup(
		transport(),
		undefined,
		true,
	);
	const search = await publicMetadata.search({ query: "Frieren" });
	const identity = search.data.items[0]?.reference;
	expect(identity).toEqual({ id: expect.any(String) });
	expect(identity?.id).not.toBe(reference.id);
	if (!identity) throw new Error("Missing metadata identity");
	const detail = await publicMetadata.get(identity);
	expect(detail.data.reference).toEqual(identity);
	expect(publicMetadata.current(identity)?.data.reference).toEqual(identity);
	expect(publicMetadata.snapshot(detail.snapshotId).data).toEqual(detail.data);
	expect(detail.data.coverUrl).toBe(
		`/api/metadata/${identity.id}/artwork/cover/image`,
	);
	expect(detail.data).not.toHaveProperty("siteUrl");
	expect(detail.data).not.toHaveProperty("providerUpdatedAt");
	expect(detail.data.unavailableFields).toContain("bannerUrl");
	for (const result of [
		search,
		detail,
		publicMetadata.snapshot(search.snapshotId),
	]) {
		const value = JSON.stringify(result);
		expect(value).not.toContain('"provider"');
		expect(value).not.toContain("anilist");
		expect(value).not.toContain("bannerImage");
	}
	// Identities are not evictable search/snapshot evidence.
	database.metadata.prune(0, 0);
	const reopened = ApplicationDatabase.open(dir);
	try {
		const projection = createPublicMetadata(application, reopened.metadata);
		expect(projection.resolveReference("154587")).toEqual(identity);
		expect(projection.associations.externalReference(identity)).toEqual(
			reference,
		);
	} finally {
		reopened.close();
	}
	expect(fetcher).toHaveBeenCalledTimes(2);
});

test("relations and airing snapshots use project references and episode identities", async () => {
	const { publicMetadata } = await setup();
	const identity = publicMetadata.resolveReference("154587");
	const relations = await publicMetadata.relations(identity);
	const related = relations.data.items[0]?.work.reference;
	expect(related).toEqual(publicMetadata.resolveReference("200"));
	expect(JSON.stringify(relations)).not.toContain("anilist");
	expect(publicMetadata.snapshot(relations.snapshotId).data).toEqual(
		relations.data,
	);
	const airing = await publicMetadata.airing(identity);
	expect(airing.data.items).toEqual([
		{ id: "1", episode: 1, airingAt: 1700000000 },
	]);
	expect(publicMetadata.snapshot(airing.snapshotId).data).toEqual(airing.data);
});

test("public metadata hides source failure messages while preserving retry semantics", async () => {
	const { publicMetadata, application } = await setup();
	vi.spyOn(application, "get").mockRejectedValueOnce(
		new MetadataError({
			code: "rate-limited",
			message: "AniList request failed at https://anilist.co/internal",
			retryAt: 12345,
		}),
	);
	await expect(
		publicMetadata.get(publicMetadata.resolveReference("154587")),
	).rejects.toMatchObject({
		failure: {
			code: "rate-limited",
			retryAt: 12345,
			message: "Metadata could not be loaded. Retry shortly.",
		},
	});
});

test("different configured sources produce the same project contract without source selectors", async () => {
	const { application, database, artwork, provider } = await setup();
	const raw = (await application.get(reference)).data;
	const alternateReference = {
		provider: "alternate",
		mediaType: "anime",
		id: "42",
	} as const;
	const alternateWork = { ...raw, reference: alternateReference };
	const alternate = {
		capabilities: { ...provider.capabilities, key: "alternate" },
		resolveReference: (value: string) =>
			value === "https://example.com/work/42" ? alternateReference : null,
		search: async () => ({
			data: {
				items: [alternateWork],
				page: 1,
				perPage: 10,
				hasNextPage: false,
			},
		}),
		get: async () => ({ data: alternateWork }),
		relations: async () => ({
			data: { items: [], page: 1, perPage: 25, hasNextPage: false },
		}),
		airing: async () => ({
			data: { items: [], page: 1, perPage: 25, hasNextPage: false },
		}),
	};
	const source = new MetadataApplication({
		defaultProvider: "alternate",
		store: database.metadata,
		providers: [alternate, provider],
		artwork,
		logger,
	});
	cleanups.push(() => source.close());
	const api = createPublicMetadata(source, database.metadata);
	const search = await api.search({ query: "Frieren" });
	const found = search.data.items[0]?.reference;
	expect(api.resolveReference("https://example.com/work/42")).toEqual(found);
	if (!found) throw new Error("Missing work");
	const alternateDetail = await api.get(found);
	const other = api.resolveReference("https://anilist.co/anime/154587");
	const otherDetail = await api.get(other);
	expect(found).not.toEqual(other);
	expect(Object.keys(alternateDetail.data).sort()).toEqual(
		Object.keys(otherDetail.data).sort(),
	);
	expect(JSON.stringify(search)).not.toMatch(/anilist|alternate|provider/);
	expect(JSON.stringify(alternateDetail)).not.toMatch(
		/anilist|alternate|provider/,
	);
});
