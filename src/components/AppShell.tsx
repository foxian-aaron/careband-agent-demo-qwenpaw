import type { ReactNode } from "react";
import { Navigation } from "./Navigation";
import { useDemo } from "../store/demoStore";

interface AppShellProps {
  children: ReactNode;
  currentPath: string;
}

const statusLabel = (status: string): string =>
  status === "connecting"
    ? "正在连接本地后端"
    : status === "connected"
      ? "本地后端已连接（只读）"
      : "静态或离线 Mock fallback";

const formatSyncedAt = (value: string | null): string => {
  if (!value) return "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
};

const BackendStatusBlock = () => {
  const { state } = useDemo();
  const { status, lastSyncedAt, error, readOnlyNotice } = state.backend;
  return (
    <div className="sidebar-note" role="status" aria-live="polite">
      <strong>{statusLabel(status)}</strong>
      {lastSyncedAt ? <p>最近同步：{formatSyncedAt(lastSyncedAt)}</p> : null}
      {error ? <p>{error.message}</p> : null}
      {readOnlyNotice ? <p>{readOnlyNotice}</p> : null}
    </div>
  );
};

export const AppShell = ({ children, currentPath }: AppShellProps) => (
  <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#/institution">
        <span>智护环</span>
        <strong>CareBand Agent</strong>
      </a>
      <Navigation currentPath={currentPath} />
      <BackendStatusBlock />
      <div className="sidebar-note">
        <strong>Demo v0.1.3</strong>
        <p>模拟数据驱动的长者状态感知与 AI 照护闭环。</p>
      </div>
    </aside>
    <main className="main-content">{children}</main>
  </div>
);
