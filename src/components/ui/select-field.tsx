import * as React from "react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"

const EMPTY_VALUE = "__nextum_empty_value__"

type SelectFieldChangeEvent = React.ChangeEvent<HTMLSelectElement>

interface SelectFieldProps {
    value?: string | number | readonly string[]
    defaultValue?: string | number | readonly string[]
    onChange?: (event: SelectFieldChangeEvent) => void
    children: React.ReactNode
    className?: string
    disabled?: boolean
    placeholder?: string
    id?: string
    name?: string
    "aria-label"?: string
}

interface SelectFieldOption {
    value: string
    label: React.ReactNode
    disabled?: boolean
}

function encodeValue(value: unknown): string {
    const next = Array.isArray(value) ? value[0] : value
    const stringValue = next === undefined || next === null ? "" : String(next)
    return stringValue === "" ? EMPTY_VALUE : stringValue
}

function decodeValue(value: string): string {
    return value === EMPTY_VALUE ? "" : value
}

function optionList(children: React.ReactNode): SelectFieldOption[] {
    return React.Children.toArray(children)
        .filter(React.isValidElement)
        .map((child) => {
            const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>
            return {
                value: encodeValue(props.value ?? props.children),
                label: props.children,
                disabled: props.disabled,
            }
        })
}

function SelectField({
    value,
    defaultValue,
    onChange,
    children,
    className,
    disabled,
    placeholder,
    id,
    name,
    "aria-label": ariaLabel,
}: SelectFieldProps) {
    const options = optionList(children)

    return (
        <Select
            value={value === undefined ? undefined : encodeValue(value)}
            defaultValue={defaultValue === undefined ? undefined : encodeValue(defaultValue)}
            disabled={disabled}
            onValueChange={(next) => {
                onChange?.({ target: { value: decodeValue(next), name } } as SelectFieldChangeEvent)
            }}
        >
            <SelectTrigger id={id} className={className} aria-label={ariaLabel}>
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                {options.map((option) => (
                    <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                        {option.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

export { SelectField }
