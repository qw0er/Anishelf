import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const acquisitionDirectories = sqliteTable("acquisition_directories", {
	workKey: text("work_key").primaryKey(),
	directory: text("directory").notNull().unique(),
});

export const acquisitionDestination = sqliteTable(
	"acquisition_destination",
	{
		id: text("id").primaryKey().notNull(),
		revision: text("revision").notNull(),
		scopeId: text("scope_id").notNull(),
		path: text("path").notNull(),
		connectionGeneration: text("connection_generation").notNull(),
		validated: integer("validated", { mode: "boolean" }).notNull(),
		visibilityVerified: integer("visibility_verified", {
			mode: "boolean",
		}).notNull(),
	},
	(table) => [
		check(
			"acquisition_destination_validated_0",
			sql`${table.validated} IN (0, 1)`,
		),
		check(
			"acquisition_destination_visibility_verified_0",
			sql`${table.visibilityVerified} IN (0, 1)`,
		),
		check("acquisition_destination_singleton", sql`${table.id} = 'default'`),
	],
);
export const acquisitionAuthorizations = sqliteTable(
	"acquisition_authorizations",
	{
		workKey: text("work_key").primaryKey().notNull(),
		feedId: text("feed_id").notNull(),
		startEpisode: integer("start_episode").notNull(),
		destinationRevision: text("destination_revision").notNull(),
		connectionGeneration: text("connection_generation").notNull(),
	},
	(table) => [
		check(
			"acquisition_authorizations_start_episode_0",
			sql`${table.startEpisode} >= 1`,
		),
	],
);
export const acquisitionIntents = sqliteTable(
	"acquisition_intents",
	{
		id: text("id").primaryKey().notNull(),
		revision: text("revision").notNull(),
		workKey: text("work_key").notNull(),
		candidateId: text("candidate_id").notNull(),
		episode: integer("episode").notNull(),
		title: text("title").notNull(),
		hash: text("hash").notNull(),
		expectedHash: text("expected_hash"),
		source: text("source").notNull(),
		destinationRevision: text("destination_revision").notNull(),
		destinationScopeId: text("destination_scope_id").notNull(),
		destinationPath: text("destination_path").notNull(),
		destinationConnectionGeneration: text(
			"destination_connection_generation",
		).notNull(),
		destinationValidated: integer("destination_validated", {
			mode: "boolean",
		}).notNull(),
		destinationVisibilityVerified: integer("destination_visibility_verified", {
			mode: "boolean",
		}).notNull(),
		directory: text("directory").notNull(),
		subscriptionRevision: text("subscription_revision").notNull(),
		state: text("state", {
			enum: [
				"pending",
				"submitting",
				"unknown",
				"bound",
				"blocked",
				"missing",
				"available",
			],
		}).notNull(),
		transfer: text("transfer"),
		progress: real("progress"),
		ingestion: text("ingestion", {
			enum: [
				"not-ready",
				"pending",
				"validating",
				"review",
				"failed",
				"available",
			],
		}).notNull(),
		error: text("error"),
		attempts: integer("attempts").notNull(),
		nextAttemptAt: integer("next_attempt_at").notNull(),
		observedAt: integer("observed_at"),
		updatedAt: integer("updated_at").notNull(),
		createdAt: integer("created_at").notNull(),
		sourceIdentityPresent: integer("source_identity_present", {
			mode: "boolean",
		}).notNull(),
		sourceIdentityScopeId: text("source_identity_scope_id"),
		sourceIdentityFileId: text("source_identity_file_id"),
		sourceIdentityRelativePath: text("source_identity_relative_path"),
		sourceIdentitySourceVersion: text("source_identity_source_version"),
		lastCommandPresent: integer("last_command_present", {
			mode: "boolean",
		}).notNull(),
		lastCommandId: text("last_command_id"),
		lastCommandKind: text("last_command_kind", {
			enum: ["acquisition", "import"],
		}),
	},
	(table) => [
		check("acquisition_intents_episode_0", sql`${table.episode} >= 1`),
		check(
			"acquisition_intents_destination_validated_0",
			sql`${table.destinationValidated} IN (0, 1)`,
		),
		check(
			"acquisition_intents_destination_visibility_verified_0",
			sql`${table.destinationVisibilityVerified} IN (0, 1)`,
		),
		check(
			"acquisition_intents_state_0",
			sql`${table.state} IN ('pending', 'submitting', 'unknown', 'bound', 'blocked', 'missing', 'available')`,
		),
		check(
			"acquisition_intents_progress_0",
			sql`${table.progress} BETWEEN 0 AND 1`,
		),
		check(
			"acquisition_intents_ingestion_0",
			sql`${table.ingestion} IN ('not-ready', 'pending', 'validating', 'review', 'failed', 'available')`,
		),
		check("acquisition_intents_attempts_0", sql`${table.attempts} >= 0`),
		check(
			"acquisition_intents_next_attempt_at_0",
			sql`${table.nextAttemptAt} >= 0`,
		),
		check("acquisition_intents_updated_at_0", sql`${table.updatedAt} >= 0`),
		check("acquisition_intents_created_at_0", sql`${table.createdAt} >= 0`),
		check(
			"acquisition_intents_source_identity_present_0",
			sql`${table.sourceIdentityPresent} IN (0, 1)`,
		),
		check(
			"acquisition_intents_last_command_present_0",
			sql`${table.lastCommandPresent} IN (0, 1)`,
		),
		check(
			"acquisition_intents_last_command_kind_0",
			sql`${table.lastCommandKind} IN ('acquisition', 'import')`,
		),
		uniqueIndex("acquisition_episode_reservation").on(
			table.workKey,
			table.episode,
		),
		uniqueIndex("acquisition_hash_reservation").on(table.hash),
		index("acquisition_intents_work").on(
			table.workKey,
			table.createdAt,
			table.id,
		),
		index("acquisition_intents_due").on(
			table.state,
			table.nextAttemptAt,
			table.id,
		),
	],
);
