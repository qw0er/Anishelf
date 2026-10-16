import {
	ApiClientError,
	isRequestCancelled,
} from "../../../shared/api/client.js";
import { toast } from "../../../shared/components/ui/toast.js";
import i18n from "../../../shared/i18n.js";
import { getErrorTranslationKey } from "../../../shared/lib/error-translation.js";

/** Input, missing-resource and revision conflicts require correction beside the form. */
export function inlineReviewError(error: Error | null): Error | null {
	return error instanceof ApiClientError &&
		error.status !== null &&
		[400, 404, 409, 422].includes(error.status)
		? error
		: null;
}
export function reportReviewFailure(id: string, error: Error): void {
	if (inlineReviewError(error) || isRequestCancelled(error)) return;
	toast.add({
		id,
		type: "error",
		priority: "high",
		title: i18n.t(getErrorTranslationKey(error) ?? "errors.requestFailed"),
	});
}
