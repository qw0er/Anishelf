import { access } from "node:fs/promises";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { apiError } from "./errors.js";

/** Development-only hosting of the explicit frontend build directory. */
export async function registerFrontend(app: FastifyInstance, root: string) {
	try {
		await access(join(root, "index.html"));
	} catch {
		throw new Error(
			"Frontend build is missing. Run npm run build before starting.",
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
}
