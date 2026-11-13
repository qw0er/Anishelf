import type { ComponentPropsWithRef } from "react";
import { cn } from "../../lib/utils.js";

export function Textarea({
	className,
	...props
}: ComponentPropsWithRef<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"form-control min-h-24 w-full resize-y py-2 font-mono text-sm placeholder:text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}
