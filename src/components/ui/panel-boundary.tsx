"use client";

import { Component, type ReactNode } from "react";

/**
 * Contains a crash to one panel: the rest of the page keeps working and the
 * broken panel renders nothing (the error is still logged). Resets when
 * `resetKey` changes, e.g. a new location.
 */
export class PanelBoundary extends Component<{ children: ReactNode; name: string; resetKey?: string }, { failed: boolean; key?: string }> {
  state: { failed: boolean; key?: string } = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: { resetKey?: string }, state: { failed: boolean; key?: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown) {
    console.error(`[panel] ${this.props.name} failed:`, error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
