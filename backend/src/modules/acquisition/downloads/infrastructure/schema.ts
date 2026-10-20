import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type {
	DownloadAuthorization,
	DownloadDestination,
	DownloadIntent,
} from "../domain/model.js";
export const acquisitionDestination = sqliteTable("acquisition_destination", {
	id: text("id").primaryKey(),
	data: text("data", { mode: "json" }).$type<DownloadDestination>().notNull(),
});
export const acquisitionAuthorizations = sqliteTable(
	"acquisition_authorizations",
	{
		workKey: text("work_key").primaryKey(),
		data: text("data", { mode: "json" })
			.$type<DownloadAuthorization>()
			.notNull(),
	},
);
export const acquisitionDirectories = sqliteTable("acquisition_directories", {
	workKey: text("work_key").primaryKey(),
	directory: text("directory").notNull().unique(),
});
export const acquisitionIntents = sqliteTable(
	"acquisition_intents",
	{
		id: text("id").primaryKey(),
		workKey: text("work_key").notNull(),
		episode: text("episode").notNull(),
		hash: text("hash").notNull(),
		data: text("data", { mode: "json" }).$type<DownloadIntent>().notNull(),
	},
	(table) => [
		uniqueIndex("acquisition_episode_reservation").on(
			table.workKey,
			table.episode,
		),
		uniqueIndex("acquisition_hash_reservation").on(table.hash),
		index("acquisition_intents_work").on(table.workKey),
	],
);
