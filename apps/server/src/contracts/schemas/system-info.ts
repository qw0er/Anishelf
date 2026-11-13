import { Type } from "typebox";

export const BuildInfoSchema = Type.Object({
	version: Type.String(),
	commit: Type.Union([Type.String(), Type.Null()]),
	channel: Type.Union([
		Type.Literal("stable"),
		Type.Literal("prerelease"),
		Type.Literal("testing"),
		Type.Literal("development"),
	]),
	builtAt: Type.Union([Type.String(), Type.Null()]),
});
export const UpdateCheckSchema = Type.Object({
	status: Type.Union([
		Type.Literal("available"),
		Type.Literal("current"),
		Type.Literal("ahead"),
		Type.Literal("uncomparable"),
		Type.Literal("no-release"),
	]),
	checkedAt: Type.String(),
	latest: Type.Union([
		Type.Object({ version: Type.String(), url: Type.String() }),
		Type.Null(),
	]),
});
