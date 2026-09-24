"use client";

import { Component, type ReactNode } from "react";

/**
 * Contains a render failure to one panel instead of the whole admin page.
 *
 * The admin page is a dashboard over roughly twenty independent services, any
 * of which can be having a bad day. Before this, one of them throwing while
 * rendering took the entire page with it -- which is the worst possible
 * behaviour for the screen you open *because* something is wrong. It happened
 * for real: a single bad chart prop in #232 blanked the whole page.
 *
 * A class component because that is still the only way to catch a render
 * error in React; there is no hook equivalent.
 *
 * Note what this does and does not cover. It catches errors thrown while
 * rendering its children, including from an async server component streamed
 * in under a Suspense boundary. It cannot catch a rejection from the page's
 * own top-level data fetch, because that happens before any of this renders
 * -- those need a `.catch()` at the call site, which is the other half of
 * this change.
 */
type Props = { name: string; children: ReactNode };
type State = { message: string | null };

export class PanelBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    // Still logged server-side, so a panel quietly degrading does not also
    // mean quietly losing the stack trace that explains why.
    console.error(`[admin] ${this.props.name} panel failed to render:`, error);
  }

  render() {
    if (this.state.message === null) return this.props.children;

    return (
      <div className="rounded border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <p className="text-sm font-medium text-amber-300">
          {this.props.name} is unavailable
        </p>
        <p className="mt-1 text-xs text-white/50">
          This panel failed to load; the rest of the page is unaffected.
        </p>
        {/* The actual error, because the person reading this is the one who
            will fix it. Collapsed so twenty working panels are not pushed
            off screen by one broken one's stack trace. */}
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-white/40 hover:text-white/60">
            Details
          </summary>
          <p className="mt-1 break-words font-mono text-xs text-white/40">
            {this.state.message}
          </p>
        </details>
      </div>
    );
  }
}
