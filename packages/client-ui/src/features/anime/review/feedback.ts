import { isRequestCancelled } from "../../../shared/api/client.js";
import { toast } from "../../../shared/components/ui/toast.js";
import i18n from "../../../shared/i18n.js";
import { getErrorTranslationKey } from "../../../shared/lib/error-translation.js";

export function reportReviewFailure(id: string, error: Error): void {
	if (isRequestCancelled(error)) return;
	console.warn("[Review] Operation failed.", { operation: id });
	toast.add({
		id,
		type: "error",
		priority: "high",
		title: i18n.t(getErrorTranslationKey(error) ?? "errors.requestFailed"),
	});
}
