/**
 * Reader iframe often has no AbortController while parent/top does — use native from another global.
 * Fetch() WebIDL validates `signal` against the same realm as `fetch`; polyfilled signals fail.
 * We tag polyfill signals and use fetchWithoutSignal + abortablePromise when needed.
 */

const POLYFILL_CTRL = "__rcPolyfillAbortController";
const POLYFILL_SIG = "__rcPolyfillAbortSignal";

function getGlobalObject(): typeof globalThis {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof self !== "undefined") return self as typeof globalThis;
  if (typeof window !== "undefined") return window as typeof globalThis;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return global as any;
}

type GlobalWithAbort = typeof globalThis & {
  AbortController?: new () => AbortController;
  AbortSignal?: typeof AbortSignal;
};

function collectGlobalCandidates(): Array<typeof globalThis> {
  const candidates: Array<typeof globalThis | undefined> = [];
  const add = (g: typeof globalThis | undefined) => {
    if (g && candidates.indexOf(g) === -1) candidates.push(g);
  };
  try {
    add(typeof parent !== "undefined" ? (parent as unknown as typeof globalThis) : undefined);
  } catch {
    /* cross-origin */
  }
  try {
    add(typeof top !== "undefined" ? (top as unknown as typeof globalThis) : undefined);
  } catch {
    /* cross-origin */
  }
  try {
    add(typeof window !== "undefined" ? window : undefined);
  } catch {
    /* ignore */
  }
  try {
    add(typeof self !== "undefined" ? self : undefined);
  } catch {
    /* ignore */
  }
  try {
    add(typeof globalThis !== "undefined" ? globalThis : undefined);
  } catch {
    /* ignore */
  }
  try {
    add(typeof global !== "undefined" ? (global as typeof globalThis) : undefined);
  } catch {
    /* ignore */
  }
  return candidates.filter(Boolean) as Array<typeof globalThis>;
}

function isPolyfillAbortController(C: unknown): boolean {
  return typeof C === "function" && Boolean((C as { [POLYFILL_CTRL]?: boolean })[POLYFILL_CTRL]);
}

/** First global with a native (non-polyfill) AbortController — prefer parent over reader sandbox. */
export function findNativeAbortGlobal(): (typeof globalThis & GlobalWithAbort) | null {
  for (const g of collectGlobalCandidates()) {
    try {
      const C = (g as GlobalWithAbort).AbortController;
      if (typeof C !== "function" || isPolyfillAbortController(C)) continue;
      const ctrl = new C();
      if (ctrl?.signal && typeof (ctrl.signal as AbortSignal).aborted === "boolean") {
        return g as typeof globalThis & GlobalWithAbort;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function tagPolyfillController(ctor: new () => AbortController): void {
  (ctor as unknown as { [POLYFILL_CTRL]: boolean })[POLYFILL_CTRL] = true;
}

function tagPolyfillSignal(sig: AbortSignal): void {
  (sig as unknown as { [POLYFILL_SIG]?: boolean })[POLYFILL_SIG] = true;
}

function isPolyfillSignal(sig: AbortSignal | undefined): boolean {
  if (!sig) return false;
  return Boolean((sig as unknown as { [POLYFILL_SIG]?: boolean })[POLYFILL_SIG]);
}

/** Full JS fallback when no native AbortController exists anywhere. */
function installFullPolyfill(g: GlobalWithAbort): void {
  class PolyAbortSignal {
    private _aborted = false;
    reason: unknown = undefined;
    private readonly _listeners: Array<() => void> = [];
    onabort: ((this: AbortSignal, ev: Event) => unknown) | null = null;

    get aborted(): boolean {
      return this._aborted;
    }

    addEventListener(type: string, fn: () => void): void {
      if (type === "abort") this._listeners.push(fn);
    }

    removeEventListener(type: string, fn: () => void): void {
      if (type !== "abort") return;
      const i = this._listeners.indexOf(fn);
      if (i >= 0) this._listeners.splice(i, 1);
    }

    throwIfAborted(): void {
      if (this._aborted) {
        if (typeof DOMException !== "undefined") {
          throw new DOMException("Aborted", "AbortError");
        }
        const err = new Error("Aborted") as Error & { name: string };
        err.name = "AbortError";
        throw err;
      }
    }

    _fireAbort(): void {
      if (this._aborted) return;
      this._aborted = true;
      for (const fn of this._listeners) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }
      if (this.onabort) {
        try {
          const ev =
            typeof Event !== "undefined" ? new Event("abort") : ({ type: "abort" } as Event);
          this.onabort.call(this as unknown as AbortSignal, ev);
        } catch {
          /* ignore */
        }
      }
    }
  }

  class PolyAbortController {
    readonly signal = new PolyAbortSignal();
    constructor() {
      tagPolyfillSignal(this.signal as unknown as AbortSignal);
    }
    abort(reason?: unknown): void {
      this.signal.reason = reason;
      this.signal._fireAbort();
    }
  }

  tagPolyfillController(PolyAbortController as unknown as new () => AbortController);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (g as any).AbortController = PolyAbortController;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (g as any).AbortSignal = PolyAbortSignal;
}

/**
 * No native AbortController on any global, but AbortSignal exists — still tag as polyfill
 * (fetch WebIDL often rejects these signals).
 */
function installControllerOnlyWithNativeAbortSignal(g: GlobalWithAbort): void {
  const NativeAbortSignal = g.AbortSignal!;
  const proto = NativeAbortSignal.prototype as AbortSignal;

  type MutableSignal = AbortSignal & {
    _rcAbort?: (reason?: unknown) => void;
  };

  function createSignal(): AbortSignal {
    const s = Object.create(proto) as MutableSignal;
    let aborted = false;
    let reason: unknown;

    Object.defineProperty(s, "aborted", {
      configurable: true,
      enumerable: true,
      get() {
        return aborted;
      },
    });
    Object.defineProperty(s, "reason", {
      configurable: true,
      enumerable: true,
      get() {
        return reason;
      },
    });

    s.throwIfAborted = function throwIfAbortedPoly() {
      if (aborted) {
        if (typeof DOMException !== "undefined") {
          throw new DOMException("Aborted", "AbortError");
        }
        const err = new Error("Aborted") as Error & { name: string };
        err.name = "AbortError";
        throw err;
      }
    };

    s._rcAbort = (r?: unknown) => {
      if (aborted) return;
      reason = r;
      aborted = true;
      try {
        if (typeof s.dispatchEvent === "function") {
          s.dispatchEvent(new Event("abort"));
        }
      } catch {
        /* ignore */
      }
    };

    tagPolyfillSignal(s);
    return s;
  }

  class PolyAbortController {
    readonly signal: AbortSignal;
    constructor() {
      this.signal = createSignal();
    }
    abort(reason?: unknown): void {
      (this.signal as MutableSignal)._rcAbort?.(reason);
    }
  }

  tagPolyfillController(PolyAbortController as unknown as new () => AbortController);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (g as any).AbortController = PolyAbortController;
}

let installed = false;

export function ensureAbortControllerPolyfill(): void {
  if (installed) return;
  if (findNativeAbortGlobal() !== null) {
    installed = true;
    return;
  }
  const g = getGlobalObject() as GlobalWithAbort;
  if (typeof g.AbortSignal === "function") {
    installControllerOnlyWithNativeAbortSignal(g);
  } else {
    installFullPolyfill(g);
  }
  installed = true;
}

export function createAbortController(): AbortController {
  ensureAbortControllerPolyfill();
  const ng = findNativeAbortGlobal();
  if (ng) {
    return new ng.AbortController!();
  }
  const c = new (getGlobalObject() as GlobalWithAbort).AbortController!();
  tagPolyfillSignal(c.signal);
  return c;
}

function getFetchImpl(): typeof fetch {
  const ng = findNativeAbortGlobal();
  if (ng && typeof ng.fetch === "function") {
    return ng.fetch.bind(ng) as typeof fetch;
  }
  const g = getGlobalObject();
  return g.fetch.bind(g) as typeof fetch;
}

function abortableFetch(
  fetchImpl: typeof fetch,
  url: string | URL,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  const { signal: _omit, ...rest } = init;
  const p = fetchImpl(url as string, rest);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (res) => {
        signal.removeEventListener("abort", onAbort);
        resolve(res);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Use instead of `fetch` whenever `init.signal` may be set — avoids WebIDL errors for polyfill signals.
 * When a native Abort global exists, uses that global's fetch + signal together.
 */
export function fetchWithAbort(url: string | URL, init: RequestInit): Promise<Response> {
  const signal = init.signal;
  const fetchImpl = getFetchImpl();
  if (!signal) {
    return fetchImpl(url as string, init);
  }
  const nativeG = findNativeAbortGlobal();
  if (nativeG && !isPolyfillSignal(signal)) {
    return nativeG.fetch.call(nativeG, url, init);
  }
  if (!isPolyfillSignal(signal)) {
    return fetchImpl(url as string, init);
  }
  return abortableFetch(fetchImpl, url, init, signal);
}

ensureAbortControllerPolyfill();
