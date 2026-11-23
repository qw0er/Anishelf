import {
	BangumiError,
	type BangumiMetadataApi,
	type BangumiSubject,
} from "../../bangumi/public.js";
import {
	MetadataError,
	type Page,
	type ProviderReference,
	type WorkDetails,
	type WorkRelation,
	type WorkSummary,
} from "../domain/source-model.js";
import type { MetadataProvider, ProviderResult } from "../ports.js";

/** Only explicit Wiki labels establish language; Latin text alone is not evidence. */
function nameKind(label: string): "english" | "romaji" | null {
	switch (label.normalize("NFKC").trim().toLowerCase()) {
		case "英文名":
		case "英语名":
		case "英語名":
		case "english":
			return "english";
		case "罗马字":
		case "羅馬字":
		case "罗马音":
		case "羅馬音":
		case "romaji":
			return "romaji";
		default:
			return null;
	}
}
function infoboxTitles(infobox: unknown): WorkSummary["titles"] {
	const titles: WorkSummary["titles"] = [];
	if (!Array.isArray(infobox)) return titles;
	const add = (value: unknown, kind: "english" | "romaji" | "alias") => {
		if (typeof value !== "string" || !value.trim()) return;
		titles.push({
			value: value.trim(),
			kind,
			language: kind === "english" ? "en" : null,
		});
	};
	for (const entry of infobox) {
		if (!entry || typeof entry !== "object" || typeof entry.key !== "string")
			continue;
		const label = entry.key.normalize("NFKC").trim();
		const kind = nameKind(label);
		if (label !== "别名" && label !== "別名" && !kind) continue;
		if (typeof entry.value === "string") add(entry.value, kind ?? "alias");
		else if (Array.isArray(entry.value)) {
			for (const alias of entry.value) {
				if (!alias || typeof alias !== "object") continue;
				add(
					alias.v,
					(typeof alias.k === "string" ? nameKind(alias.k) : null) ??
						kind ??
						"alias",
				);
			}
		}
	}
	return titles;
}

function subjectTitles(
	raw: Pick<BangumiSubject, "name" | "name_cn">,
): WorkSummary["titles"] {
	const titles: WorkSummary["titles"] = [];
	if (raw.name.trim())
		titles.push({ value: raw.name.trim(), language: null, kind: "native" });
	if (raw.name_cn.trim())
		titles.push({
			value: raw.name_cn.trim(),
			language: "zh-Hans",
			kind: "alias",
		});
	return titles;
}
function summary(
	raw: Pick<BangumiSubject, "id" | "name" | "name_cn"> &
		Partial<
			Pick<BangumiSubject, "date" | "eps" | "images" | "infobox" | "platform">
		>,
): WorkSummary {
	const titles = subjectTitles(raw);
	for (const title of infoboxTitles(raw.infobox)) {
		// Keep more specific primary fields and avoid repeated labels for the same value.
		const index = titles.findIndex(
			(existing) => existing.value === title.value,
		);
		const existing = titles[index];
		if (!existing) titles.push(title);
		else if (
			existing.kind === "alias" &&
			existing.language === null &&
			title.kind !== "alias"
		)
			titles[index] = title;
	}
	const year = /^(\d{4})-\d{2}-\d{2}$/.exec(raw.date ?? "");
	return {
		reference: { provider: "bangumi", mediaType: "anime", id: String(raw.id) },
		titles,
		year: year ? Number(year[1]) : null,
		format:
			(
				{
					TV: "TV",
					OVA: "OVA",
					OAD: "OVA",
					WEB: "ONA",
					Web: "ONA",
					剧场版: "MOVIE",
				} as Record<string, string>
			)[raw.platform ?? ""] ?? null,
		// Neither the premiere date nor the episode database count proves airing progress.
		status: null,
		episodeCount: raw.eps || null,
		nextAiringEpisode: null,
		airingSeason: null,
		coverUrl: raw.images?.large || raw.images?.common || null,
		unavailableFields: ["status", "nextAiringEpisode", "airingSeason"],
	};
}
export class BangumiProvider implements MetadataProvider {
	readonly capabilities = {
		key: "bangumi",
		version: "bangumi-v0-v2",
		search: true,
		details: true,
		relations: true,
		airing: false,
		streamingLinks: false,
		canonicalEpisodes: false,
	} as const;
	constructor(private readonly client: BangumiMetadataApi) {}
	resolveReference(value: string): ProviderReference | null {
		let id = value;
		if (!/^[1-9]\d*$/.test(id)) {
			try {
				const url = new URL(value);
				if (
					url.protocol !== "https:" ||
					!["bgm.tv", "bangumi.tv", "chii.in"].includes(url.hostname) ||
					url.port ||
					url.username ||
					url.password
				)
					return null;
				id = /^\/subject\/([1-9]\d*)\/?$/.exec(url.pathname)?.[1] ?? "";
			} catch {
				return null;
			}
		}
		return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
			? { provider: "bangumi", mediaType: "anime", id }
			: null;
	}
	private async read<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} catch (cause) {
			if (cause instanceof BangumiError)
				throw new MetadataError(
					{
						...cause.failure,
						code:
							cause.failure.code === "unauthorized" ||
							cause.failure.code === "invalid-request"
								? "unavailable"
								: cause.failure.code,
					},
					{ cause },
				);
			throw cause;
		}
	}
	async search(
		query: string,
		page: number,
		perPage: number,
		signal: AbortSignal,
	) {
		const result = await this.read(() =>
			this.client.search(query, page, perPage, signal),
		);
		return { data: { ...result, items: result.items.map(summary) } };
	}
	private id(reference: ProviderReference): number {
		const resolved = this.resolveReference(reference.id);
		if (
			reference.provider !== "bangumi" ||
			reference.mediaType !== "anime" ||
			!resolved ||
			resolved.id !== reference.id
		)
			throw new MetadataError({
				code: "invalid-request",
				message: "Supply a valid Bangumi anime reference.",
				retryAt: null,
			});
		return Number(reference.id);
	}
	async get(reference: ProviderReference, signal: AbortSignal) {
		const id = this.id(reference);
		const raw = await this.read(() => this.client.get(id, signal));
		const base = summary(raw);
		const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.date ?? "");
		const data: WorkDetails = {
			...base,
			description: raw.summary || null,
			startDate: parts
				? {
						year: Number(parts[1]),
						month: Number(parts[2]),
						day: Number(parts[3]),
					}
				: null,
			bannerUrl: null,
			endDate: null,
			durationMinutes: null,
			country: null,
			source: null,
			genres: [],
			tags: raw.tags.map((tag) => ({
				name: tag.name,
				rank: null,
				spoiler: false,
			})),
			studios: [],
			averageScore:
				raw.rating.score > 0 ? Math.round(raw.rating.score * 10) : null,
			streamingEpisodes: [],
			episodeCatalog: "unavailable",
			siteUrl: `https://bgm.tv/subject/${raw.id}`,
			providerUpdatedAt: null,
			unavailableFields: [
				...base.unavailableFields,
				"bannerUrl",
				"endDate",
				"durationMinutes",
				"country",
				"source",
				"genres",
				"studios",
				"streamingEpisodes",
				"episodeCatalog",
			],
		};
		return { data };
	}
	async relations(
		reference: ProviderReference,
		page: number,
		perPage: number,
		signal: AbortSignal,
	): Promise<ProviderResult<Page<WorkRelation>>> {
		const id = this.id(reference);
		const related = await this.read(() => this.client.relations(id, signal));
		const end = page * perPage;
		const formats: Readonly<Record<number, string>> = {
			1: "BOOK",
			3: "MUSIC",
			4: "GAME",
			6: "LIVE_ACTION",
		};
		const items = related
			.slice(end - perPage, end)
			.map((item): WorkRelation => {
				if (item.type !== 2)
					return {
						type: item.relation,
						external: {
							url: `https://bgm.tv/subject/${item.id}`,
							titles: subjectTitles(item),
							format: formats[item.type] ?? "OTHER",
							year: null,
						},
					};
				const work = summary({
					id: item.id,
					name: item.name,
					name_cn: item.name_cn,
					images: item.images ?? null,
				});
				return {
					type: item.relation,
					work: {
						...work,
						unavailableFields: [
							...work.unavailableFields,
							"year",
							"format",
							"episodeCount",
						],
					},
				};
			});
		return {
			data: { items, page, perPage, hasNextPage: related.length > end },
		};
	}
	airing(): never {
		throw this.unsupported();
	}
	private unsupported() {
		return new MetadataError({
			code: "invalid-request",
			message: "This metadata source capability is unavailable.",
			retryAt: null,
		});
	}
}
