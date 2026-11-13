import { sql } from "drizzle-orm";
import {
	check,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { WatchingPolicy } from "../domain/model.js";
/** The infrequently edited grant is an immutable configuration snapshot. */
export const acquisitionWatchingPolicy = sqliteTable(
	"acquisition_watching_policy",
	{
		id: text("id").primaryKey().notNull(),
		value: text("value", { mode: "json" }).$type<WatchingPolicy>().notNull(),
	},
	(table) => [
		check(
			"acquisition_watching_policy_singleton",
			sql`${table.id} = 'default'`,
		),
	],
);
/** Frequently checked ownership and override state stays in queryable columns. */
export const acquisitionWatchingMembers = sqliteTable(
	"acquisition_watching_members",
	{
		accountId: text("account_id").notNull(),
		workKey: text("work_key").notNull(),
		revision: text("revision").notNull(),
		title: text("title").notNull(),
		excluded: integer("excluded", { mode: "boolean" }).notNull(),
		paused: integer("paused", { mode: "boolean" }).notNull(),
		subscriptionRevision: text("subscription_revision"),
		grantId: text("grant_id"),
		startEpisode: integer("start_episode"),
		reason: text("reason").notNull(),
		retryAt: integer("retry_at").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.accountId, table.workKey] }),
		uniqueIndex("acquisition_watching_owner")
			.on(table.workKey)
			.where(sql`${table.subscriptionRevision} IS NOT NULL`),
		check("acquisition_watching_excluded", sql`${table.excluded} IN (0,1)`),
		check("acquisition_watching_paused", sql`${table.paused} IN (0,1)`),
		check(
			"acquisition_watching_start",
			sql`${table.startEpisode} IS NULL OR ${table.startEpisode} >= 1`,
		),
	],
);
