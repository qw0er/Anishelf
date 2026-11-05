import {
	type CachedMetadata,
	type MetadataSnapshot,
	type Page,
	type TitleDisplayPreference,
	type WorkSummary,
	workTitle,
} from "../domain/model.js";

/** Presentation is applied after snapshots are saved, including retained evidence reads. */
export class MetadataTitles {
	constructor(private readonly preference: () => TitleDisplayPreference) {}
	work<T extends WorkSummary>(work: T): T {
		return {
			...work,
			displayTitle: workTitle(
				work.titles,
				work.reference.id,
				this.preference(),
			),
		};
	}
	envelope<T extends WorkSummary>(value: CachedMetadata<T>): CachedMetadata<T> {
		return { ...value, data: this.work(value.data) };
	}
	page<T extends WorkSummary>(
		value: CachedMetadata<Page<T>>,
	): CachedMetadata<Page<T>> {
		return {
			...value,
			data: {
				...value.data,
				items: value.data.items.map((work) => this.work(work)),
			},
		};
	}
	snapshot(value: MetadataSnapshot): MetadataSnapshot {
		switch (value.kind) {
			case "detail":
				return { ...value, ...this.envelope(value) };
			case "search":
				return { ...value, ...this.page(value) };
			case "relations":
				return {
					...value,
					data: {
						...value.data,
						items: value.data.items.map((item) => ({
							...item,
							work: this.work(item.work),
						})),
					},
				};
			default:
				return value;
		}
	}
}
