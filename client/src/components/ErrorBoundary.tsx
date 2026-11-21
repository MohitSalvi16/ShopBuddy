import { Component, type ReactNode } from 'react';

/** Keeps one broken panel from blanking the whole demo; shows the error and a retry button. */
export class ErrorBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`[${this.props.name}]`, error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="glass p-5 text-sm">
        <p className="font-semibold text-rose-300">{this.props.name} hit an error</p>
        <p className="mt-1 font-mono text-xs text-slate-400">{this.state.error.message}</p>
        <button className="mt-3 cursor-pointer rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15" onClick={() => this.setState({ error: null })}>Retry</button>
      </div>
    );
  }
}
