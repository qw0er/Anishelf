import { desktopOrigin } from "@anishelf/contracts/defaults";
import { net, type Session, type WebContents } from "electron";

const deviceSessionsPath = "/api/auth/device-sessions";

export async function signInDevice(
	origin: string,
	password: unknown,
	saveToken: (token: unknown) => Promise<void>,
) {
	if (typeof password !== "string" || !password || password.length > 128)
		return { status: 400 };

	let response: Response;
	try {
		response = await net.fetch(new URL(deviceSessionsPath, origin).href, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Anishelf Desktop", password }),
			credentials: "omit",
			redirect: "error",
			signal: AbortSignal.timeout(15000),
		});
	} catch {
		console.warn("desktop.device_sign_in_unreachable");
		return { status: 0 };
	}

	if (!response.ok) {
		await response.body?.cancel();
		console.warn("desktop.device_sign_in_rejected", {
			status: response.status,
		});
		return { status: response.status };
	}

	try {
		const body: unknown = await response.json();
		if (!body || typeof body !== "object" || !("token" in body))
			throw new Error("Missing device token.");
		await saveToken(body.token);
	} catch {
		console.warn("desktop.device_sign_in_invalid_response");
		return { status: 502 };
	}
	console.info("desktop.device_signed_in");
	return { status: 201 };
}

export function attachDeviceCredentials(
	session: Session,
	origin: string,
	authorization: () => string | undefined,
	windows: ReadonlySet<WebContents>,
) {
	session.webRequest.onBeforeSendHeaders(
		{ urls: [`${origin}/api`, `${origin}/api/*`] },
		(request, callback) => {
			if (
				!request.webContents ||
				!windows.has(request.webContents) ||
				request.frame?.origin !== desktopOrigin ||
				new URL(request.url).origin !== origin ||
				request.method === "OPTIONS"
			) {
				callback({});
				return;
			}

			const requestHeaders = request.requestHeaders;
			for (const name of Object.keys(requestHeaders)) {
				if (["authorization", "cookie"].includes(name.toLowerCase()))
					delete requestHeaders[name];
			}
			const url = new URL(request.url);
			const isSignIn =
				request.method === "POST" && url.pathname === deviceSessionsPath;
			const isMediaLink =
				(request.method === "GET" || request.method === "HEAD") &&
				/^\/api\/media\/[A-Za-z0-9_-]+$/.test(url.pathname) &&
				url.searchParams.has("access_token");
			const credential = authorization();
			if (!isSignIn && !isMediaLink && credential)
				requestHeaders.Authorization = credential;
			callback({ requestHeaders });
		},
	);
	return () => session.webRequest.onBeforeSendHeaders(null);
}
