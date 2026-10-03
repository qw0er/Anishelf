import type { IncomingMessage, ServerResponse } from "node:http";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance, RawServerDefault } from "fastify";
import type { Logger } from "pino";

/** All API route modules retain schema inference across module boundaries. */
export type HttpInstance = FastifyInstance<
	RawServerDefault,
	IncomingMessage,
	ServerResponse,
	Logger,
	TypeBoxTypeProvider
>;
