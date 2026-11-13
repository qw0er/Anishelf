/** Accept only local destinations and avoid redirecting back into the login page. */
export function loginReturnPath(value: string | null, origin: string) {
	try {
		const url = new URL(value ?? "/", origin);
		if (url.origin !== origin || /^\/login\/?$/.test(url.pathname)) return "/";
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return "/";
	}
}
