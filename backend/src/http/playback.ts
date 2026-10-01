import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { PlaybackApplication } from "../application/playback.js";
import { DomainError } from "../errors.js";
import type {
	ContinueWatchingResponse,
	OpenPlaybackRequest,
	PlaybackSessionResponse,
	SavePlaybackProgressRequest,
	SavePlaybackProgressResponse,
	StartOverPlaybackRequest,
	StartOverPlaybackResponse,
} from "./contracts.js";
import {
	continueWatchingResponse,
	playbackProgressDto,
	playbackSessionResponse,
} from "./presenters.js";

const safeInteger = {
	type: "integer",
	maximum: Number.MAX_SAFE_INTEGER,
} as const;
const positiveInteger = { ...safeInteger, minimum: 1 } as const;
const identifier = {
	type: "string",
	minLength: 1,
	maxLength: 64,
	pattern: "^[A-Za-z0-9_-]+$",
} as const;
const tokenParams = {
	type: "object",
	additionalProperties: false,
	required: ["token"],
	properties: {
		token: {
			type: "string",
			pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
			minLength: 36,
			maxLength: 36,
		},
	},
} as const;
const progressSchema = {
	type: "object",
	additionalProperties: false,
	required: [
		"positionMs",
		"durationMs",
		"lastViewedAtMs",
		"revision",
		"generation",
		"lastSequence",
	],
	properties: {
		positionMs: { ...safeInteger, minimum: 0 },
		durationMs: { ...positiveInteger, type: ["integer", "null"] },
		lastViewedAtMs: { ...safeInteger, type: ["integer", "null"], minimum: 0 },
		revision: { ...safeInteger, minimum: 0 },
		generation: positiveInteger,
		lastSequence: { ...safeInteger, minimum: 0 },
	},
} as const;
const fileSchema = {
	type: "object",
	additionalProperties: false,
	required: [
		"kind",
		"id",
		"parentId",
		"name",
		"sizeBytes",
		"modifiedAt",
		"mimeType",
	],
	properties: {
		kind: { type: "string", const: "file" },
		id: identifier,
		parentId: identifier,
		name: { type: "string" },
		sizeBytes: { type: "number", minimum: 0 },
		modifiedAt: { type: "string" },
		mimeType: { type: "string" },
	},
} as const;
const sourceVersionSchema = {
	type: "string",
	minLength: 1,
	maxLength: 128,
	pattern: "^[A-Za-z0-9_-]+$",
} as const;
const progressResponseSchema = {
	type: "object",
	additionalProperties: false,
	required: ["progress"],
	properties: { progress: progressSchema },
} as const;

export function registerPlaybackRoutes(
	app: FastifyInstance<
		RawServerDefault,
		IncomingMessage,
		ServerResponse,
		Logger
	>,
	playback: PlaybackApplication,
): void {
	app.register(async (scope) => {
		scope.addHook("onRequest", async (_request, reply) => {
			reply.header("Cache-Control", "no-store");
		});

		scope.post<{ Body: OpenPlaybackRequest }>(
			"/api/playback/sessions",
			{
				schema: {
					body: {
						type: "object",
						additionalProperties: false,
						required: ["fileId"],
						properties: { fileId: identifier },
					},
					response: {
						201: {
							type: "object",
							additionalProperties: false,
							required: [
								"token",
								"generation",
								"sourceVersion",
								"file",
								"plan",
								"progress",
							],
							properties: {
								token: tokenParams.properties.token,
								generation: positiveInteger,
								sourceVersion: sourceVersionSchema,
								file: fileSchema,
								progress: progressSchema,
								plan: {
									type: "object",
									additionalProperties: false,
									required: ["mode", "playbackUrl"],
									properties: {
										mode: { type: "string", const: "direct" },
										playbackUrl: { type: "string" },
									},
								},
							},
						},
					},
				},
			},
			async (request, reply): Promise<PlaybackSessionResponse> => {
				const session = await playback.open(request.body.fileId);
				return reply.code(201).send(playbackSessionResponse(session));
			},
		);

		scope.put<{ Params: { token: string }; Body: SavePlaybackProgressRequest }>(
			"/api/playback/sessions/:token/progress",
			{
				schema: {
					params: tokenParams,
					body: {
						type: "object",
						additionalProperties: false,
						required: [
							"generation",
							"sourceVersion",
							"sequence",
							"positionMs",
							"durationMs",
						],
						properties: {
							generation: positiveInteger,
							sourceVersion: sourceVersionSchema,
							sequence: positiveInteger,
							positionMs: { ...safeInteger, minimum: 0 },
							durationMs: { ...positiveInteger, type: ["integer", "null"] },
						},
					},
					response: {
						200: {
							...progressResponseSchema,
							required: ["status", "progress"],
							properties: {
								progress: progressSchema,
								status: { type: "string", enum: ["saved", "duplicate"] },
							},
						},
					},
				},
			},
			async (request): Promise<SavePlaybackProgressResponse> => {
				const result = await playback.save({
					...request.body,
					token: request.params.token,
				});
				if (result.status === "stale")
					throw new DomainError(
						"PLAYBACK_CONFLICT",
						"The progress update is stale.",
					);
				return {
					status: result.status,
					progress: playbackProgressDto(result.progress),
				};
			},
		);

		scope.post<{ Params: { token: string }; Body: StartOverPlaybackRequest }>(
			"/api/playback/sessions/:token/start-over",
			{
				schema: {
					params: tokenParams,
					body: {
						type: "object",
						additionalProperties: false,
						required: ["generation", "requestId"],
						properties: {
							generation: positiveInteger,
							requestId: { type: "string", minLength: 1, maxLength: 128 },
						},
					},
					response: { 200: progressResponseSchema },
				},
			},
			async (request): Promise<StartOverPlaybackResponse> => ({
				progress: playbackProgressDto(
					await playback.startOver({
						...request.body,
						token: request.params.token,
					}),
				),
			}),
		);

		scope.delete<{ Params: { token: string } }>(
			"/api/playback/sessions/:token",
			{
				schema: { params: tokenParams },
			},
			async (request, reply) => {
				playback.release(request.params.token);
				return reply.code(204).send();
			},
		);

		scope.get<{ Querystring: { limit?: string } }>(
			"/api/continue-watching",
			{
				schema: {
					querystring: {
						type: "object",
						additionalProperties: false,
						properties: {
							limit: { type: "string", pattern: "^[1-9][0-9]{0,2}$" },
						},
					},
					response: {
						200: {
							type: "object",
							additionalProperties: false,
							required: ["availability", "items"],
							properties: {
								availability: { type: "string", enum: ["unknown", "checked"] },
								items: {
									type: "array",
									items: {
										type: "object",
										additionalProperties: false,
										required: ["file", "progress"],
										properties: { file: fileSchema, progress: progressSchema },
									},
								},
							},
						},
					},
				},
			},
			async (request): Promise<ContinueWatchingResponse> =>
				continueWatchingResponse(
					await playback.continueWatching(
						request.query.limit === undefined
							? 20
							: Number(request.query.limit),
					),
				),
		);
	});
}
