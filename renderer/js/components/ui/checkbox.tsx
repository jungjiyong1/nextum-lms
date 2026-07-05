import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"

import { cn } from "../../lib/utils"

const Checkbox = React.forwardRef<
    React.ElementRef<typeof CheckboxPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
    <CheckboxPrimitive.Root
        ref={ref}
        className={cn(
            // Base: 24px size, white background, thin slate border
            "h-6 w-6 shrink-0 rounded-md border border-slate-300 bg-white",
            // Explicitly no shadow - completely flat
            "shadow-none",
            // Smooth transition
            "transition-all duration-200",
            // Hover: emerald-400 border
            "hover:border-emerald-400",
            // Checked: emerald-600 background and border
            "data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600",
            // Disabled
            "disabled:cursor-not-allowed disabled:opacity-50",
            // Focus: no ring, no shadow, no offset - completely flat
            "focus-visible:outline-none",
            className
        )}
        style={{ boxShadow: 'none', borderStyle: 'solid' }}
        {...props}
    >
        <CheckboxPrimitive.Indicator
            className="flex items-center justify-center text-white"
        >
            <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
            >
                <path d="M0 11l2-2 5 5L18 3l2 2L7 18z" />
            </svg>
        </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
