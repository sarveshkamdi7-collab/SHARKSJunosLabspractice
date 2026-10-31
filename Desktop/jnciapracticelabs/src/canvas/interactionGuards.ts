export interface GuardApp {
  cancelPlacement?: () => void;
  selectNode?: (nodeId: string | null) => void;
  setSelectedNodeId?: (nodeId: string | null) => void;
  setStatus?: (status: string) => void;
}

const NODE_SELECTOR = '.node';
const INTERACTIVE_SELECTOR = [
  '.node',
  '.canvas-tools',
  '.canvas-hint',
  '.placement-banner',
  '.link-group',
  '.annotation',
  'button',
  'input',
  'textarea',
  'select',
  'a',
].join(', ');

let activePaletteKey: string | null = null;

function documentRef(): Document | null {
  return typeof document !== 'undefined' ? document : null;
}

function isElement(value: unknown): value is Element {
  if (value === null || typeof value !== 'object') return false;
  if (typeof Element !== 'undefined') return value instanceof Element;
  return 'classList' in value;
}

function appRef(): GuardApp | null {
  const host = globalThis as unknown as {
    JJ?: { app?: GuardApp };
    APP?: GuardApp;
  };
  return host.JJ?.app ?? host.APP ?? null;
}

function elementFrom(target: EventTarget | null): Element | null {
  const candidate = target as unknown as {
    closest?: (selector: string) => Element | null;
    parentElement?: Element | null;
  } | null;
  if (candidate && typeof candidate.closest === 'function') {
    return candidate as unknown as Element;
  }
  return candidate?.parentElement ?? null;
}

function closestElement(target: EventTarget | null, selector: string): Element | null {
  let element = elementFrom(target);
  while (element) {
    if (typeof element.matches === 'function' && element.matches(selector)) return element;
    element = element.parentElement;
  }
  return null;
}

function safelyStop(event: Event): void {
  if (typeof event.stopPropagation === 'function') event.stopPropagation();
}

function safelyPreventDefault(event: Event): void {
  if (typeof event.preventDefault === 'function') event.preventDefault();
}

export function setActivePaletteKey(key: string | null): void {
  activePaletteKey = key;
}

export function isPaletteActive(): boolean {
  if (activePaletteKey !== null) return true;
  const doc = documentRef();
  const canvas = doc?.querySelector('#canvas');
  return isElement(canvas) ? canvas.classList.contains('placing') : false;
}

export function deactivatePalette(cancelPlacement = true): void {
  const wasActive = isPaletteActive();
  activePaletteKey = null;

  const doc = documentRef();
  if (doc) {
    const banner = doc.querySelector('#placementBanner');
    if (isElement(banner)) banner.classList.add('hidden');

    const canvas = doc.querySelector('#canvas');
    if (isElement(canvas)) canvas.classList.remove('placing');

    const items = doc.querySelectorAll('.palette-item');
    items.forEach((item) => {
      if (isElement(item)) {
        item.classList.remove('active');
        if (typeof item.setAttribute === 'function') item.setAttribute('aria-pressed', 'false');
      }
    });
  }

  const app = appRef();
  if (cancelPlacement && wasActive && app?.cancelPlacement) app.cancelPlacement();
  if (wasActive && app?.setStatus) app.setStatus('Ready');
}

export function handleNodeMouseDown(event: MouseEvent, nodeId: string): void {
  if (typeof event.button === 'number' && event.button !== 0) return;

  safelyStop(event);
  safelyPreventDefault(event);
  deactivatePalette();

  const app = appRef();
  if (app?.selectNode) {
    app.selectNode(nodeId);
  } else if (app?.setSelectedNodeId) {
    app.setSelectedNodeId(nodeId);
  }
}

export function handleCanvasClick(event: MouseEvent): void {
  const node = closestElement(event.target, NODE_SELECTOR);
  const interactive = closestElement(event.target, INTERACTIVE_SELECTOR);
  const placing = isPaletteActive();

  if (node) {
    safelyStop(event);
    deactivatePalette();
    return;
  }

  if (interactive) {
    safelyStop(event);
    if (placing) deactivatePalette();
    return;
  }

  if (placing) {
    safelyStop(event);
    deactivatePalette();
  }
}
