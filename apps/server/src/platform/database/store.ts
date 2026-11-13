import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { SQLiteTransactionConfig } from "drizzle-orm/sqlite-core";

/** Table-oriented connection capability; adapters own schema and record types. */
export type Store = Pick<
	BetterSQLite3Database,
	"select" | "insert" | "update" | "delete"
> & {
	transaction<T>(
		operation: (transaction: Store) => T,
		config?: SQLiteTransactionConfig,
	): T;
};
