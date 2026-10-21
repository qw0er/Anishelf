import type {
	RegisteredSource,
	SourceIdentity,
	SourceRegistry,
} from "../../resources/public.js";
import type { IdentificationResult } from "../identification/public.js";
import type { MetadataApi } from "../metadata/public.js";
import type {
	Association,
	CatalogQuery,
	ConfirmationResult,
	LocalEpisode,
	LocalWork,
	Page,
	ProviderLink,
	ReviewRecord,
} from "./domain/model.js";

export interface CatalogMetadata
	extends Pick<
		MetadataApi,
		| "get"
		| "current"
		| "snapshot"
		| "retain"
		| "release"
		| "snapshotArtwork"
		| "readArtwork"
	> {}
export interface CatalogStore extends SourceRegistry {
	transaction<T>(operation: (store: CatalogStore) => T): T;
	publish(
		scopeIds: readonly string[],
		items: { source: RegisteredSource; result: IdentificationResult }[],
		fileIds?: readonly string[],
	): void;
	review(id: string): ReviewRecord | null;
	reviews(
		scopeIds: readonly string[],
		decision: ReviewRecord["decision"] | undefined,
		page: number,
		perPage: number,
		reference?: ProviderLink["reference"],
	): Page<ReviewRecord>;
	work(id: string): LocalWork | null;
	/** Associated works across saved roots, paged by stable ID for background work. */
	refreshWorks(afterId: string, limit: number): LocalWork[];
	link(workId: string): ProviderLink | null;
	findWork(reference: ProviderLink["reference"]): LocalWork | null;
	list(
		scopeIds: readonly string[],
		query: CatalogQuery,
		page: number,
		perPage: number,
	): Page<LocalWork>;
	saveWork(work: LocalWork, link: ProviderLink): void;
	episodes(workId: string): LocalEpisode[];
	saveEpisode(episode: LocalEpisode): void;
	associations(sourceId: string): (Association & { episode: LocalEpisode })[];
	versions(
		episodeId: string,
		scopeIds: readonly string[],
	): { review: ReviewRecord; association: Association }[];
	replaceAssociations(sourceId: string, associations: Association[]): void;
	decide(
		id: string,
		revision: number,
		decision: ReviewRecord["decision"],
		reason: string | null,
	): void;
	operation(
		key: string,
	): { fingerprint: string; result: ConfirmationResult } | null;
	saveOperation(
		key: string,
		fingerprint: string,
		result: ConfirmationResult,
	): void;
	registerSource(identity: SourceIdentity): RegisteredSource;
}
