import { sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	check,
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { FileSourceIdentity } from "../../../resources/public.js";
import type {
	DownloadFileObservation,
	DownloadIntent,
	ManagedFileSelection,
	OneOffAuthorization,
	PendingFileSelection,
} from "../domain/model.js";

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
function destinationColumns() {
	return {
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
	};
}

export const acquisitionRequests = sqliteTable(
	"acquisition_requests",
	{
		id: text("id").primaryKey().notNull(),
		revision: text("revision").notNull(),
		candidateId: text("candidate_id").notNull(),
		title: text("title").notNull(),
		unresolvedHash: text("unresolved_hash"),
		expectedHash: text("expected_hash"),
		source: text("source").notNull(),
		...destinationColumns(),
		origin: text("origin").$type<DownloadIntent["origin"]>().notNull(),
		oneOff: text("one_off", { mode: "json" }).$type<OneOffAuthorization>(),
		subscriptionRevision: text("subscription_revision"),
		state: text("state").$type<DownloadIntent["state"]>().notNull(),
		error: text("error"),
		attempts: integer("attempts").notNull(),
		nextAttemptAt: integer("next_attempt_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
		createdAt: integer("created_at").notNull(),
		lastCommandId: text("last_command_id"),
		lastCommandKind: text("last_command_kind", {
			enum: ["acquisition", "import"],
		}),
	},
	(table) => [
		check(
			"acquisition_request_origin",
			sql`${table.origin} IN ('subscription', 'one-off')`,
		),
		check(
			"acquisition_request_one_off",
			sql`${table.oneOff} IS NULL OR json_valid(${table.oneOff})`,
		),
		check(
			"acquisition_request_state",
			sql`${table.state} IN ('discovering', 'pending', 'submitting', 'unknown', 'bound', 'blocked', 'missing', 'available')`,
		),
		check(
			"acquisition_request_destination_flags",
			sql`${table.destinationValidated} IN (0, 1) AND ${table.destinationVisibilityVerified} IN (0, 1)`,
		),
		check(
			"acquisition_request_times",
			sql`${table.attempts} >= 0 AND ${table.nextAttemptAt} >= 0 AND ${table.createdAt} >= 0 AND ${table.updatedAt} >= 0`,
		),
		check(
			"acquisition_request_last_command",
			sql`(${table.lastCommandId} IS NULL AND ${table.lastCommandKind} IS NULL) OR (${table.lastCommandId} IS NOT NULL AND ${table.lastCommandKind} IS NOT NULL AND ${table.lastCommandKind} IN ('acquisition', 'import'))`,
		),
		index("acquisition_requests_due").on(
			table.state,
			table.nextAttemptAt,
			table.id,
		),
	],
);

export const acquisitionTransfers = sqliteTable(
	"acquisition_transfers",
	{
		id: text("id").primaryKey().notNull(),
		requestId: text("request_id")
			.notNull()
			.references(() => acquisitionRequests.id),
		ownerKey: text("owner_key").notNull(),
		hash: text("hash").notNull(),
		owned: integer("owned", { mode: "boolean" }).notNull(),
		source: text("source").notNull(),
		...destinationColumns(),
		state: text("state"),
		progress: real("progress"),
		observedAt: integer("observed_at"),
		selectionMode: text("selection_mode", { enum: ["all", "files"] })
			.notNull()
			.default("all"),
		selectionRevision: text("selection_revision").notNull(),
		selectionManifest: text("selection_manifest", { mode: "json" }).$type<
			ManagedFileSelection["manifest"]
		>(),
		pendingSelection: text("pending_selection", {
			mode: "json",
		}).$type<PendingFileSelection>(),
		observedSelection: text("observed_selection", { mode: "json" }).$type<
			readonly DownloadFileObservation[]
		>(),
	},
	(table) => [
		check(
			"acquisition_transfer_hash",
			sql`length(${table.hash}) = 40 AND ${table.hash} NOT GLOB '*[^0-9a-f]*'`,
		),
		check(
			"acquisition_transfer_flags",
			sql`${table.owned} IN (0, 1) AND ${table.destinationValidated} IN (0, 1) AND ${table.destinationVisibilityVerified} IN (0, 1)`,
		),
		check(
			"acquisition_transfer_progress",
			sql`${table.progress} BETWEEN 0 AND 1`,
		),
		check(
			"acquisition_transfer_selection_mode",
			sql`${table.selectionMode} IN ('all', 'files')`,
		),
		check(
			"acquisition_transfer_observed_selection",
			sql`${table.observedSelection} IS NULL OR json_valid(${table.observedSelection})`,
		),
		uniqueIndex("acquisition_transfer_ownership")
			.on(table.destinationConnectionGeneration, table.hash)
			.where(sql`${table.owned} = 1`),
		index("acquisition_transfers_request").on(table.requestId),
	],
);

export const acquisitionEpisodeClaims = sqliteTable(
	"acquisition_episode_claims",
	{
		id: text("id").primaryKey().notNull(),
		requestId: text("request_id")
			.notNull()
			.references(() => acquisitionRequests.id),
		workKey: text("work_key").notNull(),
		episode: integer("episode").notNull(),
		live: integer("live", { mode: "boolean" }).notNull(),
		acceptedTarget: text("accepted_target", { mode: "json" }).$type<
			NonNullable<DownloadIntent["acceptedTarget"]>
		>(),
		transferId: text("transfer_id").references(() => acquisitionTransfers.id),
		ingestion: text("ingestion").$type<DownloadIntent["ingestion"]>().notNull(),
		sourceIdentity: text("source_identity", { mode: "json" }).$type<
			NonNullable<DownloadIntent["sourceIdentity"]>
		>(),
		associationReview: text("association_review", { mode: "json" }).$type<
			NonNullable<DownloadIntent["associationReview"]>
		>(),
	},
	(table) => [
		check("acquisition_claim_episode", sql`${table.episode} >= 1`),
		check("acquisition_claim_live", sql`${table.live} IN (0, 1)`),
		check(
			"acquisition_claim_ingestion",
			sql`${table.ingestion} IN ('not-ready', 'pending', 'validating', 'review', 'failed', 'available')`,
		),
		check(
			"acquisition_claim_evidence",
			sql`(${table.acceptedTarget} IS NULL OR json_valid(${table.acceptedTarget})) AND (${table.sourceIdentity} IS NULL OR json_valid(${table.sourceIdentity}))`,
		),
		uniqueIndex("acquisition_live_episode_claim")
			.on(table.workKey, table.episode)
			.where(sql`${table.live} = 1`),
		index("acquisition_claims_work_episode").on(table.workKey, table.episode),
		index("acquisition_claims_transfer").on(table.transferId),
		index("acquisition_claims_request").on(table.requestId),
	],
);

export const acquisitionRequestCommands = sqliteTable(
	"acquisition_request_commands",
	{
		id: text("id").primaryKey().notNull(),
		requestId: text("request_id")
			.notNull()
			.references(() => acquisitionRequests.id),
	},
	(table) => [index("acquisition_commands_request").on(table.requestId)],
);

export const acquisitionTransferFiles = sqliteTable(
	"acquisition_transfer_files",
	{
		id: text("id").primaryKey().notNull(),
		transferId: text("transfer_id")
			.notNull()
			.references(() => acquisitionTransfers.id),
		fileIndex: integer("file_index"),
		path: text("path").notNull(),
		sizeBytes: integer("size_bytes"),
		progress: real("progress"),
		role: text("role", { enum: ["video", "subtitle"] }).notNull(),
		desiredSelected: integer("desired_selected", { mode: "boolean" }).notNull(),
		observedSelected: integer("observed_selected", { mode: "boolean" }),
		videoFileId: text("video_file_id").references(
			(): AnySQLiteColumn => acquisitionTransferFiles.id,
		),
		sourceIdentity: text("source_identity", {
			mode: "json",
		}).$type<FileSourceIdentity>(),
		ingestion: text("ingestion").$type<DownloadIntent["ingestion"]>().notNull(),
	},
	(table) => [
		check("acquisition_file_path", sql`length(${table.path}) > 0`),
		check(
			"acquisition_file_metadata",
			sql`${table.fileIndex} >= 0 AND ${table.sizeBytes} >= 0`,
		),
		check(
			"acquisition_file_role",
			sql`(${table.role} = 'video' AND ${table.videoFileId} IS NULL) OR (${table.role} = 'subtitle' AND ${table.videoFileId} IS NOT NULL)`,
		),
		check(
			"acquisition_file_flags",
			sql`${table.desiredSelected} IN (0, 1) AND (${table.observedSelected} IS NULL OR ${table.observedSelected} IN (0, 1))`,
		),
		check(
			"acquisition_file_ingestion",
			sql`${table.ingestion} IN ('not-ready', 'pending', 'validating', 'review', 'failed', 'available')`,
		),
		check(
			"acquisition_file_source_identity",
			sql`${table.sourceIdentity} IS NULL OR json_valid(${table.sourceIdentity})`,
		),
		uniqueIndex("acquisition_file_path_per_transfer").on(
			table.transferId,
			table.path,
		),
		uniqueIndex("acquisition_file_index_per_transfer").on(
			table.transferId,
			table.fileIndex,
		),
	],
);

export const acquisitionTransferFileTargets = sqliteTable(
	"acquisition_transfer_file_targets",
	{
		declined: integer("declined", { mode: "boolean" }).notNull().default(false),
		fileId: text("file_id")
			.notNull()
			.references(() => acquisitionTransferFiles.id),
		claimId: text("claim_id")
			.notNull()
			.references(() => acquisitionEpisodeClaims.id),
		acceptedTarget: text("accepted_target", { mode: "json" }).$type<
			NonNullable<DownloadIntent["acceptedTarget"]>
		>(),
	},
	(table) => [
		primaryKey({ columns: [table.fileId, table.claimId] }),
		check(
			"acquisition_file_target_evidence",
			sql`${table.acceptedTarget} IS NULL OR json_valid(${table.acceptedTarget})`,
		),
		index("acquisition_file_targets_claim").on(table.claimId),
	],
);
