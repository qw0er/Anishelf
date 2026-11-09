// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { toast } from "../../../src/shared/components/ui/toast.js";
import { useRefreshError } from "../../../src/shared/hooks/use-refresh-error.js";
import { cleanup, renderHook } from "../../support/query-test-utils.js";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

test("polling and navigation deduplicate errors; retry and recovery allow new failures", () => {
	const add = vi.spyOn(toast, "add").mockReturnValue("refresh");
	const close = vi.spyOn(toast, "close");
	const retry = vi.fn();
	const props: { error: unknown; updatedAt: number } = {
		error: new Error("offline"),
		updatedAt: 1,
	};
	const hook = () =>
		renderHook(
			({ error, updatedAt }) =>
				useRefreshError("refresh", error, updatedAt, retry, { scoped: true }),
			{ initialProps: props },
		);
	let view = hook();
	expect(add).toHaveBeenCalledTimes(1);
	view.rerender({ ...props, updatedAt: 2 });
	expect(add).toHaveBeenCalledTimes(1);
	view.unmount();
	expect(close).toHaveBeenCalledWith("refresh");
	view = hook();
	expect(add).toHaveBeenCalledTimes(1);
	const action = add.mock.calls[0]?.[0].actionProps?.onClick;
	if (!action) throw new Error("Missing retry");
	action({} as never);
	expect(retry).toHaveBeenCalledOnce();
	view.rerender(props);
	expect(add).toHaveBeenCalledTimes(1);
	view.rerender({ ...props, updatedAt: 3 });
	expect(add).toHaveBeenCalledTimes(2);
	view.rerender({ error: null, updatedAt: 3 });
	expect(close).toHaveBeenCalledWith("refresh");
	view.rerender({ ...props, updatedAt: 4 });
	expect(add).toHaveBeenCalledTimes(3);
});

test("cancellation produces no failure notification", () => {
	const add = vi.spyOn(toast, "add");
	renderHook(() =>
		useRefreshError(
			"cancelled",
			new DOMException("Cancelled", "AbortError"),
			1,
		),
	);
	expect(add).not.toHaveBeenCalled();
});
