import { ChangePasswordRequestSchema } from "@anishelf/contracts/schemas/authentication";
import type { FastifyRequest } from "fastify";
import { DomainError } from "../../../../shared/errors.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { AuthenticationService } from "../application.js";
import type { AuthenticationStore, DeviceSession } from "../ports.js";
import type { createLoginLimits } from "./login.js";
import { clearWebSession } from "./web-sessions.js";

export function registerPasswordRoute(
	app: HttpInstance,
	service: AuthenticationService,
	store: AuthenticationStore,
	getDevice: (request: FastifyRequest) => DeviceSession | undefined,
	loginLimits: Awaited<ReturnType<typeof createLoginLimits>>,
) {
	app.put(
		"/api/auth/password",
		{
			schema: { body: ChangePasswordRequestSchema },
			preHandler: loginLimits,
		},
		async function changePassword(request, reply) {
			const method = getDevice(request) ? "device" : "cookie";
			try {
				await service.change(
					request.body.currentPassword,
					request.body.password,
				);
			} catch (error) {
				if (error instanceof DomainError && error.code === "AUTH_REQUIRED")
					request.log.warn(
						{
							event: "auth.password_change_rejected",
							reason: "invalid_current_password",
							method,
							source: request.ip,
						},
						"Password change rejected.",
					);
				throw error;
			}
			store.clear();
			if (method === "cookie") await clearWebSession(request, reply);
			request.log.info(
				{ event: "auth.password_changed", method },
				"Password changed and all browser sessions, device sessions and media links were revoked.",
			);
			return reply.code(204).send();
		},
	);
}
