import type { ComponentPropsWithRef, MouseEvent } from "react";
import { getClientRuntime } from "../../api/connection.js";
import { isHttpUrl } from "../../lib/url.js";

function isPlainClick(event: MouseEvent<HTMLAnchorElement>) {
	return (
		!event.defaultPrevented &&
		event.button === 0 &&
		!event.ctrlKey &&
		!event.metaKey &&
		!event.shiftKey &&
		!event.altKey
	);
}

export function ExternalLink({
	href,
	onClick,
	...props
}: ComponentPropsWithRef<"a">) {
	const url = href && isHttpUrl(href) ? href : undefined;
	return (
		<a
			{...props}
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			onClick={(event) => {
				onClick?.(event);
				if (!url || !isPlainClick(event)) return;
				event.preventDefault();
				getClientRuntime().platform.openExternal(url);
			}}
		/>
	);
}

/** The caller supplies a URL from the active external-player host. */
export function ExternalPlayerLink({
	href,
	onLaunch,
	onClick,
	...props
}: ComponentPropsWithRef<"a"> & {
	onLaunch?: (() => void) | undefined;
}) {
	return (
		<a
			{...props}
			href={href}
			onClick={(event) => {
				onClick?.(event);
				if (!href || !onLaunch || !isPlainClick(event)) return;
				event.preventDefault();
				onLaunch();
			}}
		/>
	);
}
