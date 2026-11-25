import { vi } from "vitest";
import { AnimeCatalogApplication } from "../../../../../src/modules/anime/anime-catalog/application/catalog.js";
import type { CatalogMetadata } from "../../../../../src/modules/anime/anime-catalog/public.js";
import { AnitomyIdentificationParser } from "../../../../../src/modules/anime/identification/infrastructure/parser.js";
import type { AcquisitionTarget } from "../../../../../src/modules/anime/public.js";
import { AcquisitionIngestion } from "../../../../../src/modules/anime/release-assessment/ingestion.js";
import type {
	ResourceAccessApi,
	SourceIdentity,
} from "../../../../../src/modules/resources/public.js";
import { fixtureIdentities } from "../../../../support/metadata-identities.js";
import {
	cleanup,
	type fixture,
	logger,
} from "./acquisition-downloads-fixture.js";

export async function packCatalog(
	f: Awaited<ReturnType<typeof fixture>>,
	target: AcquisitionTarget,
	{
		destination,
		sizeBytes = 100,
	}: { destination?: string; sizeBytes?: number } = {},
) {
	const scopeId = "r".repeat(43);
	f.resources.roots.mockResolvedValue([{ scopeId, name: "Anime" }]);
	await f.configure(scopeId, destination);
	const identities = new Map<string, SourceIdentity>();
	const identityFor = (path: string) => {
		const identity = {
			fileId: path,
			relativePath: path,
			scopeId,
			sourceVersion: "v1",
		};
		identities.set(identity.fileId, identity);
		return identity;
	};
	f.resources.refresh.mockImplementation(async (_scope, path) =>
		identityFor(path),
	);
	const resolveSource: ResourceAccessApi["resolveSource"] = async (id) => {
		const identity = identities.get(id);
		if (!identity) throw new Error("Missing fixture source.");
		return {
			identity,
			file: {
				id,
				name: id,
				kind: "file",
				parentId: "directory",
				sizeBytes,
				modifiedAt: new Date(0).toISOString(),
				mimeType: "video/x-matroska",
			},
			accessRevision: 0,
		};
	};
	const sources: ResourceAccessApi = {
		hasSnapshot: true,
		accessRevision: 0,
		getScope: async () => ({ ids: [scopeId], revision: 0 }),
		resolveSource,
		revalidateSource: ({ identity }) => resolveSource(identity.fileId),
		assertAccessRevision: vi.fn(),
		filePath: vi.fn(),
		getFile: vi.fn(),
		openMedia: vi.fn(),
		openResources: vi.fn(),
	};
	const reference = {
		provider: "metadata",
		mediaType: "anime",
		id: target.work.reference.id,
	} as const;
	const data = {
		...target.work,
		reference,
		provider: "metadata",
		unavailableFields: [],
		titles: [{ value: "Frieren", kind: "romaji" as const, language: "en" }],
		status: "FINISHED" as const,
		nextAiringEpisode: null,
		airingSeason: null,
		coverUrl: null,
		bannerUrl: null,
		description: null,
		startDate: null,
		endDate: null,
		durationMinutes: null,
		country: null,
		source: null,
		genres: [],
		tags: [],
		studios: [],
		averageScore: null,
		siteUrl: null,
		providerUpdatedAt: null,
		streamingEpisodes: [],
		episodeCatalog: "unavailable" as const,
	};
	const snapshot = {
		snapshotId: target.work.snapshotId,
		fetchedAt: Date.now(),
		stale: false,
		refreshing: false,
		refreshError: null,
		data,
	};
	f.db.metadata.save({
		id: snapshot.snapshotId,
		key: `metadata:anime:${reference.id}`,
		kind: "detail",
		data,
		fetchedAt: snapshot.fetchedAt,
		expiresAt: snapshot.fetchedAt + 600000,
		accessedAt: snapshot.fetchedAt,
		failure: null,
	});
	const metadata: CatalogMetadata = {
		current: () => snapshot,
		get: async () => snapshot,
		snapshot: () => ({ kind: "detail", ...snapshot }),
		retain: (id, owner) => f.db.metadata.retain(id, owner),
		release: (id, owner) => f.db.metadata.release(id, owner),
		snapshotArtwork: async () => ({
			status: "missing",
			id: null,
			failure: null,
		}),
		readArtwork: vi.fn(),
	};
	const parser = new AnitomyIdentificationParser();
	function connect() {
		const catalog = new AnimeCatalogApplication({
			store: f.db.catalog,
			metadata,
			sources,
			logger,
		});
		cleanup.push(async () => catalog.close());
		const ingestion = new AcquisitionIngestion(
			metadata,
			fixtureIdentities(),
			parser,
			catalog,
			sources,
		);
		f.ingestion.ingest.mockImplementation(ingestion.ingest.bind(ingestion));
		f.ingestion.reviewAcquisition.mockImplementation(
			ingestion.reviewAcquisition.bind(ingestion),
		);
		return catalog;
	}
	return { connect, identityFor, parser, reference };
}
