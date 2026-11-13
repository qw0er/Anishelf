import {
	type LoaderFunctionArgs,
	type RouteObject,
	redirect,
} from "react-router";
import { loadAuthSession } from "../../shared/api/client.js";

async function requireAuthentication(request: Request) {
	const session = await loadAuthSession();
	if (!session.authenticated) {
		const url = new URL(request.url);
		throw redirect(
			`/login?returnTo=${encodeURIComponent(`${url.pathname}${url.search}${url.hash}`)}`,
		);
	}
}
/** Guard each matched loader: React Router may execute parent and children concurrently. */
export function authenticatedRoute(route: RouteObject): RouteObject {
	const loader = route.loader;
	const action = route.action;
	return {
		...route,
		loader: async (args: LoaderFunctionArgs) => {
			await requireAuthentication(args.request);
			return typeof loader === "function" ? loader(args) : null;
		},
		...(typeof action === "function"
			? {
					action: async (args: LoaderFunctionArgs) => {
						await requireAuthentication(args.request);
						return action(args);
					},
				}
			: {}),
		...(route.children
			? { children: route.children.map(authenticatedRoute) }
			: {}),
	} as RouteObject;
}
