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
	extends Pick<MetadataApi, "get" | "snapshot" | "retain" | "release"> {}
export interface CatalogStore extends SourceRegistry {
	transaction<T>(operation: (store: CatalogStore) => T): T;
	publish(
		rootId: string,
		items: { source: RegisteredSource; result: IdentificationResult }[],
	): void;
	review(id: string): ReviewRecord | null;
	reviews(
		rootId: string,
		decision: ReviewRecord["decision"] | undefined,
		page: number,
		perPage: number,
	): Page<ReviewRecord>;
	work(id: string): LocalWork | null;
	link(workId: string): ProviderLink | null;
	findWork(reference: ProviderLink["reference"]): LocalWork | null;
	list(
		rootId: string,
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
		rootId: string,
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
