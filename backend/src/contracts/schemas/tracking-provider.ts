import { Type } from "typebox";
export const TrackingProviderSchema = Type.Object({
	key: Type.String({ minLength: 1 }),
	name: Type.String(),
	authorization: Type.Object({
		kind: Type.Literal("credential"),
		label: Type.String(),
		url: Type.Union([Type.String(), Type.Null()]),
	}),
	capabilities: Type.Object({
		progress: Type.Literal("cumulative-episodes"),
		maximumProgress: Type.Integer({ minimum: 0 }),
		statuses: Type.Array(
			Type.Union([
				Type.Literal("watching"),
				Type.Literal("planned"),
				Type.Literal("completed"),
				Type.Literal("paused"),
				Type.Literal("dropped"),
				Type.Literal("rewatching"),
			]),
		),
	}),
});
