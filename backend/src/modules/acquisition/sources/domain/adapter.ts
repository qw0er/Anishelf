import type { SourceRecord } from "./model.js";
export interface SourceRead {
	readonly record: SourceRecord;
	readonly generation: string | null;
	valid(): boolean;
	persist(): void;
}
