import type { createBrowserRouter } from "react-router";

type Router = ReturnType<typeof createBrowserRouter>;

interface LoginLocation {
	pathname: string;
	search: string;
	hash: string;
}

/** Preserve the current route when sending the user to the login page. */
export function loginRedirectPath(location: LoginLocation): string {
	const returnTo = `${location.pathname}${location.search}${location.hash}`;
	return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

interface SessionHost {
	name: "desktop" | "web";
	open(path: string): void;
}

export class ClientSessionLifecycle {
	private state:
		| { phase: "starting"; authRequired: boolean }
		| {
				phase: "ready";
				dispose: () => void;
				router: Router;
				onLoginUnauthorized?: () => void;
		  }
		| { phase: "restarting" } = { phase: "starting", authRequired: false };

	private readonly host: SessionHost;

	constructor(host: SessionHost) {
		this.host = host;
	}

	attach(
		dispose: () => void,
		router: Router,
		onLoginUnauthorized?: () => void,
	): boolean {
		if (this.state.phase !== "starting")
			throw new Error("Client session is already initialized.");
		const { authRequired } = this.state;
		this.state = {
			phase: "ready",
			dispose,
			router,
			...(onLoginUnauthorized ? { onLoginUnauthorized } : {}),
		};
		if (authRequired) this.onAuthRequired();
		return this.state.phase === "ready";
	}

	navigate(path: string): void {
		if (this.state.phase === "ready") void this.state.router.navigate(path);
	}

	onAuthRequired(): void {
		if (this.state.phase === "starting") {
			this.state.authRequired = true;
			return;
		}
		if (this.state.phase !== "ready") return;
		const { pathname, search, hash } = this.state.router.state.location;
		if (pathname === "/login") {
			this.state.onLoginUnauthorized?.();
			return;
		}
		console.debug("auth.session_required", { host: this.host.name });
		this.restart(loginRedirectPath({ pathname, search, hash }));
	}

	restart(path: string): void {
		if (this.state.phase !== "ready") return;
		const { dispose, router } = this.state;
		this.state = { phase: "restarting" };
		router.dispose();
		dispose();
		this.host.open(path);
	}
}
