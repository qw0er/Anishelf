import { asc, eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import * as s from "./schema.js";

export function readSubtitleFontSets(
	store: Store,
	row: typeof s.subtitleFontSets.$inferSelect,
): {
	id: string;
	sourceId: string;
	status: "pending" | "ready" | "degraded";
	warnings: string[];
} {
	return {
		id: row.id,
		sourceId: row.sourceId,
		status: row.status,
		warnings: store
			.select()
			.from(s.subtitleFontSetsWarnings)
			.where(eq(s.subtitleFontSetsWarnings.parentId, row.id))
			.orderBy(asc(s.subtitleFontSetsWarnings.ordinalIndex))
			.all()
			.map((child) => ({ value: child.value }))
			.map((item) => item.value),
	} as {
		id: string;
		sourceId: string;
		status: "pending" | "ready" | "degraded";
		warnings: string[];
	};
}

export function writeSubtitleFontSets(
	connection: Store,
	value: {
		id: string;
		sourceId: string;
		status: "pending" | "ready" | "degraded";
		warnings: string[];
	},
): void {
	connection.transaction((store) => {
		const row0 = {
			id: value?.id,
			sourceId: value?.sourceId,
			status: value?.status,
		};
		store
			.insert(s.subtitleFontSets)
			.values(row0)
			.onConflictDoUpdate({ target: s.subtitleFontSets.id, set: row0 })
			.run();
		store
			.delete(s.subtitleFontSetsWarnings)
			.where(eq(s.subtitleFontSetsWarnings.parentId, value.id))
			.run();
		for (const [index1, item1] of (value?.warnings ?? []).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				value: { value: item1 }?.value,
			};
			store.insert(s.subtitleFontSetsWarnings).values(row1).run();
		}
	});
}
