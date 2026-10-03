import type { drizzle } from "drizzle-orm/better-sqlite3";
import type * as schema from "./schema.js";
export type Store = ReturnType<typeof drizzle<typeof schema>>;
