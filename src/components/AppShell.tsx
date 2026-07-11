import type { ReactNode } from "react";
import { useDemo } from "../store/demoStore";
import { Navigation } from "./Navigation";

interface AppShellProps {
  children: ReactNode;
  currentPath: string;
}

type BackendMode = "local" | "connected" | "unavailable";

export const getRuntimeStatusText = (
  backendMode: BackendMode,
  locationLike?: Pick<Location, "hostname" | "pathname">,
) => {
  const hostname = locationLike?.hostname ?? "";
  const pathname = locationLike?.pathname ?? "";
  const isGitHubPagesPreview =
    hostname.endsWith("github.io") || pathname.includes("/careband-agent-demo/v0.2");
  const backendText =
    backendMode === "connected"
      ? "後端已連接：Express + SQLite"
      : "後端未連接：正在使用本地 mock fallback";

  return {
    isGitHubPagesPreview,
    backendText,
    previewText: isGitHubPagesPreview
      ? "GitHub Pages 靜態預覽版：目前使用 mock fallback；完整 Express + SQLite + Agent 後端需本地或 Node hosting 啟動。"
      : "本地 v0.2 Demo：可連接 Express + SQLite 後端，後端未啟動時使用 mock fallback。",
  };
};

export const AppShell = ({ children, currentPath }: AppShellProps) => {
  const { state } = useDemo();
  const runtime = getRuntimeStatusText(
    state.backend.mode,
    typeof window === "undefined" ? undefined : window.location,
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#/institution">
          <span>智护环</span>
          <strong>CareBand Agent</strong>
        </a>
        <Navigation currentPath={currentPath} />
        <div className="sidebar-note">
          <strong>Demo v0.2 落地验证版</strong>
          <p>后端 fallback + 记忆初始化 + 穿戴导入 + 硬件模拟 + Agent Trace。</p>
          <small>{runtime.backendText}</small>
        </div>
      </aside>
      <main className="main-content">
        <div
          className={
            runtime.isGitHubPagesPreview
              ? "public-preview-banner public-preview-banner--static"
              : "public-preview-banner"
          }
        >
          <strong>{runtime.previewText}</strong>
          <span>{runtime.backendText}</span>
          {state.backend.error ? <span role="alert">{state.backend.error}</span> : null}
        </div>
        {children}
      </main>
    </div>
  );
};
