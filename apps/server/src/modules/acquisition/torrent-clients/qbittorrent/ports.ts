import type { SavedConnection } from "./model.js";
export interface ConnectionStore {
	read(): Promise<SavedConnection | null>;
	write(value: SavedConnection): Promise<void>;
}
