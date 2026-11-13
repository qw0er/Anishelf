import {
	DeviceLoginRequestSchema,
	DeviceLoginResponseSchema,
	DeviceSessionIdSchema,
	DeviceSessionSchema,
} from "@anishelf/contracts/schemas/authentication";
import type { FastifyRequest } from "fastify";
import { Type } from "typebox";
import { DomainError } from "../../../../shared/errors.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { AuthenticationService } from "../application.js";
import type { createDeviceSessions } from "../device-sessions.js";
import type { DeviceSession } from "../ports.js";
import { type createLoginLimits, verifyLogin } from "./login.js";

export const deviceLoginPath = "/api/auth/device-sessions";
const currentDevicePath = `${deviceLoginPath}/current`;

export function registerDeviceRoutes(
	app: HttpInstance,
	service: AuthenticationService,
	sessions: ReturnType<typeof createDeviceSessions>,
	getDevice: (request: FastifyRequest) => DeviceSession | undefined,
	loginLimits: Awaited<ReturnType<typeof createLoginLimits>>,
) {
	app.post(
		deviceLoginPath,
		{
			schema: {
				body: DeviceLoginRequestSchema,
				response: { 201: DeviceLoginResponseSchema },
			},
			preHandler: loginLimits,
		},
		async (request, reply) => {
			const name = request.body.name.trim();
			if (!name || /[\p{Cc}\p{Cf}]/u.test(name))
				throw new DomainError("INVALID_REQUEST", "Invalid device name.");
			const fingerprint = await verifyLogin(
				service,
				request,
				request.body.password,
				"device",
			);
			const login = sessions.create(name, fingerprint);
			request.log.info(
				{ event: "auth.device_session_created", deviceId: login.session.id },
				"Device signed in.",
			);
			return reply.code(201).send(login);
		},
	);
	app.get(
		deviceLoginPath,
		{ schema: { response: { 200: Type.Array(DeviceSessionSchema) } } },
		async () => sessions.list(),
	);
	function currentDevice(request: FastifyRequest) {
		const device = getDevice(request);
		if (!device)
			throw new DomainError("AUTH_REQUIRED", "Sign in with a device session.");
		return device;
	}
	app.get(
		currentDevicePath,
		{ schema: { response: { 200: DeviceSessionSchema } } },
		async (request) => currentDevice(request),
	);
	function revokeDevice(request: FastifyRequest, id: string) {
		if (sessions.revoke(id))
			request.log.info(
				{ event: "auth.device_session_revoked", deviceId: id },
				"Device session revoked.",
			);
	}
	app.delete(currentDevicePath, async (request, reply) => {
		revokeDevice(request, currentDevice(request).id);
		return reply.code(204).send();
	});
	app.delete(
		`${deviceLoginPath}/:id`,
		{ schema: { params: Type.Object({ id: DeviceSessionIdSchema }) } },
		async (request, reply) => {
			revokeDevice(request, request.params.id);
			return reply.code(204).send();
		},
	);
}
