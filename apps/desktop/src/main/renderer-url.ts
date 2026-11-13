import { desktopOrigin } from "@anishelf/contracts/defaults";

export const rendererUrl = new URL(desktopOrigin);
export const desktopScheme = rendererUrl.protocol.slice(0, -1);

export function isDesktopPage(value: string) {
	const url = URL.parse(value);
	return (
		url?.protocol === rendererUrl.protocol &&
		url.host === rendererUrl.host &&
		url.pathname === "/" &&
		!url.username &&
		!url.password &&
		!url.search
	);
}
