import { Type } from "typebox";

const bytes = Type.Number({ minimum: 0 });
const progress = Type.Number({ minimum: 0, maximum: 1 });
const hash = Type.String({ pattern: "^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$" });
const optionalHash = Type.Optional(Type.Union([hash, Type.Literal("")]));
export const tasksSchema = Type.Array(
	Type.Object({
		hash,
		infohash_v1: optionalHash,
		infohash_v2: optionalHash,
		name: Type.String(),
		state: Type.String({ minLength: 1 }),
		progress,
		amount_left: bytes,
		size: bytes,
		dlspeed: bytes,
		upspeed: bytes,
		save_path: Type.String(),
		content_path: Type.String(),
		category: Type.String(),
		tags: Type.String(),
	}),
);
export const filesSchema = Type.Array(
	Type.Object({
		index: Type.Integer({ minimum: 0 }),
		name: Type.String({ minLength: 1 }),
		size: bytes,
		progress,
		priority: Type.Union([
			Type.Literal(0),
			Type.Literal(1),
			Type.Literal(6),
			Type.Literal(7),
		]),
	}),
);
export const preferencesSchema = Type.Object({
	temp_path_enabled: Type.Boolean(),
	temp_path: Type.String(),
});
