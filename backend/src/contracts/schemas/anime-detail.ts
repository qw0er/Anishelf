import { Type } from "typebox";
import { LocalWorkDetailSchema } from "./anime-catalog.js";
import { DownloadActivitySchema } from "./downloads.js";
import {
	MetadataDetailsResponseSchema,
	MetadataReferenceSchema,
} from "./metadata.js";
import { SubscriptionViewSchema } from "./subscriptions.js";
import { TrackingEntrySchema } from "./tracking-list.js";
export const AnimeDetailSchema = Type.Object({
	reference: MetadataReferenceSchema,
	displayTitle: Type.String(),
	metadata: Type.Union([MetadataDetailsResponseSchema, Type.Null()]),
	metadataError: Type.Union([
		Type.Object({
			code: Type.String(),
			message: Type.String(),
			retryAt: Type.Union([Type.Number(), Type.Null()]),
		}),
		Type.Null(),
	]),
	local: Type.Union([LocalWorkDetailSchema, Type.Null()]),
});
export const AnimeStatusSchema = Type.Object({
	viewing: TrackingEntrySchema,
	subscription: Type.Pick(SubscriptionViewSchema, ["subscription"]),
	downloads: Type.Union([
		Type.Pick(DownloadActivitySchema, [
			"total",
			"active",
			"attention",
			"planningError",
		]),
		Type.Null(),
	]),
});
