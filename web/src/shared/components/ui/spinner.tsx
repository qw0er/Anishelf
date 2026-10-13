import { LoaderCircle } from "lucide-react";
import type * as React from "react";
import { cn } from "../../lib/utils.js";

export function Spinner({
	className,
	...props
}: Omit<React.ComponentProps<typeof LoaderCircle>, "ref">) {
	return (
		<LoaderCircle
			aria-hidden="true"
			className={cn("size-4 animate-spin", className)}
			{...props}
		/>
	);
}
