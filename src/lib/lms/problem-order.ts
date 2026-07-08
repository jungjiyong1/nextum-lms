type ProblemOrderLike = {
    id?: unknown;
    pagePrinted?: unknown;
    page_printed?: unknown;
    number?: unknown;
};

const problemNumberCollator = new Intl.Collator('ko', {
    numeric: true,
    sensitivity: 'base',
});

function orderedPage(value: unknown): number {
    if (value === null || value === undefined || value === '') return Number.MAX_SAFE_INTEGER;
    const page = Number(value);
    return Number.isFinite(page) ? page : Number.MAX_SAFE_INTEGER;
}

function orderedText(value: unknown): string {
    return String(value ?? '').trim();
}

export function compareProblemOrder<T extends ProblemOrderLike>(a: T, b: T): number {
    const pageA = orderedPage(a.pagePrinted ?? a.page_printed);
    const pageB = orderedPage(b.pagePrinted ?? b.page_printed);
    if (pageA !== pageB) return pageA - pageB;

    const numberCompare = problemNumberCollator.compare(orderedText(a.number), orderedText(b.number));
    if (numberCompare !== 0) return numberCompare;

    return problemNumberCollator.compare(orderedText(a.id), orderedText(b.id));
}

export function sortByProblemOrder<T extends ProblemOrderLike>(problems: readonly T[]): T[] {
    return [...problems].sort(compareProblemOrder);
}
