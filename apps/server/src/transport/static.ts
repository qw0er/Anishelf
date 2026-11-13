import { access } from "node:fs/promises";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import { DomainError } from "../shared/errors.js";
import { apiError } from "./errors.js";
import type { HttpInstance } from "./instance.js";

/** Host the explicit frontend build directory in any runtime mode. */
export async function registerFrontend(app: HttpInstance, root: string) {
	try {
		await access(join(root, "index.html"));
	} catch (cause) {
		throw new DomainError(
			"CONFIG_INVALID",
			"Web build is missing. Run npm run build --workspace @anishelf/web and set ANISHELF_FRONTEND_DIR to the absolute directory containing index.html.",
			{ cause },
		);
	}
	await app.register(fastifyStatic, {
		root,
		serve: false,
		dotfiles: "deny",
		cacheControl: true,
		maxAge: 0,
	});
	app.get("/*", async (request, reply) => {
		const pathname = new URL(request.url, "http://localhost").pathname;
		if (pathname === "/api" || pathname.startsWith("/api/"))
			return reply.code(404).send(apiError("ROUTE_NOT_FOUND", request.id));
		if (
			pathname === "/" ||
			/^\/(directories|files)\/[^/]+\/?$/.test(pathname) ||
			(!pathname.startsWith("/assets/") &&
				!pathname.includes(".") &&
				request.headers.accept?.includes("text/html"))
		) {
			return reply
				.header("Cache-Control", "no-cache")
				.sendFile("index.html", { cacheControl: false });
		}
		return reply.sendFile(decodeURIComponent(pathname.slice(1)));
	});
	app.log.info(
		{ event: "http.frontend_hosting_enabled", root },
		"Web hosting enabled.",
	);
}
