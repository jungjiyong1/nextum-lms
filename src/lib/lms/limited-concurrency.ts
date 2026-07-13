export async function mapWithConcurrency<T, R>(
    values: readonly T[],
    concurrency: number,
    mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
        throw new Error('concurrency must be a positive integer.');
    }
    if (values.length === 0) return [];

    const results = new Array<R>(values.length);
    let cursor = 0;
    const worker = async () => {
        while (cursor < values.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await mapper(values[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
    return results;
}
