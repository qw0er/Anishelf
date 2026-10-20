import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Candidate, FeedRecord, Subscription } from "../domain/model.js";

export const acquisitionFeeds = sqliteTable("acquisition_feeds", {
	id: text("id").primaryKey(),
	data: text("data", { mode: "json" }).$type<FeedRecord>().notNull(),
});
export const acquisitionSubscriptions = sqliteTable(
	"acquisition_subscriptions",
	{
		workKey: text("work_key").primaryKey(),
		feedId: text("feed_id")
			.notNull()
			.references(() => acquisitionFeeds.id),
		data: text("data", { mode: "json" }).$type<Subscription>().notNull(),
	},
);
export const acquisitionCandidates = sqliteTable(
	"acquisition_candidates",
	{
		id: text("id").primaryKey(),
		workKey: text("work_key")
			.notNull()
			.references(() => acquisitionSubscriptions.workKey, {
				onDelete: "cascade",
			}),
		data: text("data", { mode: "json" }).$type<Candidate>().notNull(),
	},
	(table) => [index("acquisition_candidates_work").on(table.workKey)],
);
