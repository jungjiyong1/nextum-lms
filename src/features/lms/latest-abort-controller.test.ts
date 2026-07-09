import { describe, expect, it } from 'vitest';

import { LatestAbortController } from './latest-abort-controller';

describe('LatestAbortController', () => {
  it('aborts the previous request and keeps a newer request active', () => {
    const requests = new LatestAbortController();
    const first = requests.start();
    const second = requests.start();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);

    requests.clear(first);
    requests.abort();
    expect(second.signal.aborted).toBe(true);
  });

  it('does not abort a completed request after it is cleared', () => {
    const requests = new LatestAbortController();
    const request = requests.start();

    requests.clear(request);
    requests.abort();
    expect(request.signal.aborted).toBe(false);
  });
});
