export class LatestAbortController {
  private active: AbortController | null = null;

  start(): AbortController {
    this.abort();
    const controller = new AbortController();
    this.active = controller;
    return controller;
  }

  clear(controller: AbortController): void {
    if (this.active === controller) this.active = null;
  }

  abort(): void {
    this.active?.abort();
    this.active = null;
  }
}
