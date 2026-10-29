import { useId } from "react";
import { cn } from "../../lib/utils.js";
import { RadioGroup, RadioGroupItem } from "./radio-group.js";

/** Short, finite choices stay visible; descriptive choices use RadioCard instead. */
export function RadioOptions<T extends string>({
	legend,
	value,
	options,
	onChange,
	disabled,
	className,
}: {
	legend: string;
	value: T;
	options: readonly { value: T; label: string }[];
	onChange(value: T): void;
	disabled?: boolean;
	className?: string;
}) {
	const name = useId();
	return (
		<fieldset
			disabled={disabled}
			className={cn("min-w-0 space-y-2", className)}
		>
			<legend className="text-sm font-medium">{legend}</legend>
			<RadioGroup
				name={name}
				value={value}
				disabled={disabled}
				onValueChange={(next) => onChange(next as T)}
				aria-label={legend}
				className="flex flex-wrap gap-x-4 gap-y-2"
			>
				{options.map((option) => (
					<label
						key={option.value}
						htmlFor={`${name}-${option.value}`}
						className="touch-control flex cursor-pointer items-center gap-2 text-sm has-[:disabled]:opacity-50"
					>
						<RadioGroupItem
							id={`${name}-${option.value}`}
							value={option.value}
							className="after:hidden"
						/>
						{option.label}
					</label>
				))}
			</RadioGroup>
		</fieldset>
	);
}
