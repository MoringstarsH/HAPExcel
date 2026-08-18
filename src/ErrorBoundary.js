import React from "react";
import { clearDrafts } from "./drafts";
import { diagnostics } from "./diagnostics";

export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null, copied: false }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { diagnostics.error("react.render", error, { componentStack: info?.componentStack }); }
  async copyDiagnostics() {
    try { await navigator.clipboard.writeText(diagnostics.export()); this.setState({ copied: true }); }
    catch (error) { diagnostics.error("diagnostics.copy", error); }
  }
  clearAndReload() {
    clearDrafts(this.props.runtimeConfig || {});
    window.location.reload();
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="fatal-error" role="alert">
      <h2>表格运行异常，草稿仍保留在本机</h2>
      <p>{this.state.error.message || "发生未知错误"}</p>
      <div className="fatal-actions">
        <button type="button" onClick={() => window.location.reload()}>重新加载</button>
        <button type="button" onClick={() => this.copyDiagnostics()}>{this.state.copied ? "已复制" : "复制诊断信息"}</button>
        <button type="button" className="danger-button" onClick={() => this.clearAndReload()}>清理草稿并重载</button>
      </div>
    </main>;
  }
}
