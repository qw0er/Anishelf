import type { SubtitleAsset, SubtitleFontSet } from "./domain/model.js";
export interface SubtitleStore {
	save(asset: SubtitleAsset): void;
	saveFonts(set: SubtitleFontSet): void;
	listFonts(): SubtitleFontSet[];
	getFonts(id: string): SubtitleFontSet | undefined;
	list(): SubtitleAsset[];
	get(id: string): SubtitleAsset | undefined;
}
