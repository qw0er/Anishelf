export interface LoginLocation {
	pathname: string;
	search: string;
	hash: string;
}

/** Preserve the current route when sending the user to the login page. */
export function loginRedirectPath(location: LoginLocation): string {
	const returnTo = `${location.pathname}${location.search}${location.hash}`;
	return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}
