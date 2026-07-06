export type CsvValue = string | number | boolean | null | undefined;

function isFormulaLikeCell(value: string): boolean {
    return /^[\t\r\n]/.test(value) || /^[\s]*[=+\-@]/.test(value);
}

export function csvEscape(value: CsvValue): string {
    const rawText = value === null || value === undefined ? '' : String(value);
    const text = isFormulaLikeCell(rawText) ? `'${rawText}` : rawText;
    if (!/[",\r\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
}
