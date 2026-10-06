import { QueryClientProvider } from "@tanstack/react-query";
import {
	render as baseRender,
	renderHook as baseRenderHook,
	type RenderHookOptions,
	type RenderOptions,
} from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { queryClient } from "../src/api/query-client.js";

export * from "@testing-library/react";

function provider(Wrapper?: RenderOptions["wrapper"]) {
	return function QueryWrapper({ children }: PropsWithChildren) {
		return (
			<QueryClientProvider client={queryClient}>
				{Wrapper ? <Wrapper>{children}</Wrapper> : children}
			</QueryClientProvider>
		);
	};
}
export function render(ui: ReactElement, options?: RenderOptions) {
	return baseRender(ui, { ...options, wrapper: provider(options?.wrapper) });
}
export function renderHook<Result, Props>(
	hook: (props: Props) => Result,
	options?: RenderHookOptions<Props>,
) {
	return baseRenderHook(hook, {
		...options,
		wrapper: provider(options?.wrapper),
	});
}
