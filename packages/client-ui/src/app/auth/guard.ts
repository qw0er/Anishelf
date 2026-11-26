import {
	type LoaderFunctionArgs,
	type RouteObject,
	redirect,
} from "react-router";
import { getClientRuntime } from "../../shared/api/connection.js";

async function requireAuthentication(request: Request) {
	const session = await getClientRuntime().authentication.getSession();
	if (!session.authenticated) {
		const url = new URL(request.url);
		throw redirect(
			`/login?returnTo=${encodeURIComponent(`${url.pathname}${url.search}${url.hash}`)}`,
		);
	}
}
/** Guard explicit loaders and actions, which may run independently of the parent. */
export function authenticatedRoute(route: RouteObject): RouteObject {
	const loader = route.loader;
	const action = route.action;
	return {
		...route,
		...(typeof loader === "function"
			? {
					loader: async (args: LoaderFunctionArgs) => {
						await requireAuthentication(args.request);
						args.request.signal.throwIfAborted();
						return loader(args);
					},
				}
			: {}),
		...(typeof action === "function"
			? {
					action: async (args: LoaderFunctionArgs) => {
						await requireAuthentication(args.request);
						args.request.signal.throwIfAborted();
						return action(args);
					},
				}
			: {}),
		...(route.children
			? { children: route.children.map(authenticatedRoute) }
			: {}),
	} as RouteObject;
}
