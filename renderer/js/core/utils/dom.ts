// DOM 유틸리티 함수

export function $(selector: string): HTMLElement | null {
  return document.querySelector(selector);
}

export function $all(selector: string): NodeListOf<HTMLElement> {
  return document.querySelectorAll(selector);
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: {
    className?: string;
    textContent?: string;
    attributes?: Record<string, string>;
    children?: (HTMLElement | SVGElement | string)[];
  }
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options?.className) {
    element.className = options.className;
  }
  if (options?.textContent) {
    element.textContent = options.textContent;
  }
  if (options?.attributes) {
    Object.entries(options.attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
  }
  if (options?.children) {
    options.children.forEach((child) => {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else {
        element.appendChild(child);
      }
    });
  }
  return element;
}

export function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes?: Record<string, string>
): SVGElementTagNameMap[K] {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attributes) {
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
  }
  return element;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

export function timeLabel(slot: number, startMinutes: number, slotMinutes: number): string {
  const total = startMinutes + slot * slotMinutes;
  const hours = String(Math.floor(total / 60)).padStart(2, '0');
  const minutes = String(total % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
