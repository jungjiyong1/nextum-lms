import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const buttonVariants = cva(
    "inline-flex appearance-none items-center justify-center whitespace-nowrap rounded-xl border border-transparent text-sm font-semibold ring-offset-background transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-45 active:translate-y-px",
    {
        variants: {
            variant: {
                default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary-strong",
                destructive:
                    "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
                outline:
                    "border-border bg-card text-foreground shadow-sm hover:border-input hover:bg-muted/70",
                secondary:
                    "bg-muted text-foreground hover:bg-muted/80",
                ghost: "border-transparent bg-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                link: "h-auto rounded-none border-transparent bg-transparent p-0 text-primary underline-offset-4 hover:underline",
            },
            size: {
                default: "h-10 px-4 py-2",
                xs: "h-7 px-2.5 text-xs",
                sm: "h-8 px-3 text-xs",
                lg: "h-11 rounded-xl px-5",
                icon: "h-10 w-10",
                "icon-sm": "h-8 w-8",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button"
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        )
    }
)
Button.displayName = "Button"

export { Button, buttonVariants }
