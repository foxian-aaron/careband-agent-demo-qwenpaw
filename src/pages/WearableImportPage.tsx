import { useEffect, useRef, useState } from "react";
import { MedicalDisclaimer } from "../components/MedicalDisclaimer";
import {
  MAX_CSV_BYTES,
  confirmDailySnapshotsCsv,
  decodeUtf8Csv,
  fetchDailySnapshotsCsvHistory,
  formatCsvWarning,
  isLocalCsvBaseUrl,
  previewDailySnapshotsCsv,
  resolveBaseUrl,
  validateCsvText,
  type BackendCsvImportHistory,
  type BackendCsvImportPreview,
  type BackendSyncError,
} from "../lib/apiClient";

interface WearableImportPageProps {
  elderId: string;
}

const safeMessage = (error: BackendSyncError) =>
  `${error.message}（${error.code}${error.status ? ` / ${error.status}` : ""}）`;

const valueText = (value: unknown) => {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(1);
  return typeof value === "string" ? value : "—";
};

export const WearableImportPage = ({ elderId }: WearableImportPageProps) => {
  const baseUrl = resolveBaseUrl();
  const supported = elderId === "TEST001";
  const available = supported && baseUrl !== null && isLocalCsvBaseUrl(baseUrl);
  const [csvText, setCsvText] = useState("");
  const [previewedText, setPreviewedText] = useState("");
  const [preview, setPreview] = useState<BackendCsvImportPreview | null>(null);
  const [history, setHistory] = useState<BackendCsvImportHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState<"preview" | "confirm" | "history" | null>(null);
  const fileSelection = useRef(0);
  const historyRequest = useRef(0);

  const loadHistory = async () => {
    if (!available) return;
    const requestId = ++historyRequest.current;
    setLoading((current) => current ?? "history");
    const result = await fetchDailySnapshotsCsvHistory({ baseUrl });
    if (requestId !== historyRequest.current) return;
    setLoading((current) => current === "history" ? null : current);
    if (result.status === "ok") {
      setHistory(result.data);
      return;
    }
    setError(safeMessage(result.error));
  };

  useEffect(() => {
    let active = true;
    const requestId = ++historyRequest.current;
    if (!available) return () => { active = false; };
    void fetchDailySnapshotsCsvHistory({ baseUrl }).then((result) => {
      if (!active || requestId !== historyRequest.current) return;
      if (result.status === "ok") setHistory(result.data);
      else setError(safeMessage(result.error));
    });
    return () => {
      active = false;
      if (requestId === historyRequest.current) historyRequest.current += 1;
    };
  }, [available, baseUrl]);

  const selectFile = async (file: File | undefined) => {
    const selectionId = ++fileSelection.current;
    setCsvText("");
    setPreviewedText("");
    setPreview(null);
    setError(null);
    setSuccess(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("仅支持 .csv 文件，不会上传或保存本地文件名。");
      return;
    }
    if (file.size > MAX_CSV_BYTES) {
      setError("CSV 文件超过 64 KiB 限制。");
      return;
    }
    try {
      const decoded = decodeUtf8Csv(await file.arrayBuffer());
      if (selectionId !== fileSelection.current) return;
      if (decoded.status === "error") {
        setError(safeMessage(decoded.error));
        return;
      }
      const text = decoded.text;
      const validationError = validateCsvText(text);
      if (validationError) {
        setError(safeMessage(validationError));
        return;
      }
      setCsvText(text);
    } catch {
      if (selectionId !== fileSelection.current) return;
      setError("无法读取 CSV 文件。");
    }
  };

  const requestPreview = async () => {
    setError(null);
    setSuccess(null);
    const validationError = validateCsvText(csvText);
    if (validationError) {
      setError(safeMessage(validationError));
      return;
    }
    setLoading("preview");
    const result = await previewDailySnapshotsCsv(csvText, { baseUrl });
    setLoading(null);
    if (result.status === "error") {
      setError(safeMessage(result.error));
      return;
    }
    setPreview(result.data);
    setPreviewedText(csvText);
  };

  const confirmImport = async () => {
    if (!preview || !previewedText || previewedText !== csvText) {
      setError("文件已变化，请重新预览后再确认导入。");
      return;
    }
    setError(null);
    setSuccess(null);
    setLoading("confirm");
    const result = await confirmDailySnapshotsCsv(previewedText, { baseUrl });
    setLoading(null);
    if (result.status === "error") {
      setError(safeMessage(result.error));
      return;
    }
    setSuccess(`已导入 ${result.data.imported} 天聚合数据。`);
    await loadHistory();
  };

  if (!supported) {
    return (
      <div className="page wearable-import-page">
        <section className="panel import-notice import-notice--warning">
          <h1>该资料不支持 CSV 导入</h1>
          <p>本轮只允许团队测试主体 TEST001 使用合成日聚合数据，不接受真实长者资料。</p>
          <a className="text-button" href="#/demo-control">返回 Demo 控制台</a>
        </section>
      </div>
    );
  }

  return (
    <div className="page wearable-import-page">
      <header className="page-header">
        <div>
          <span>团队测试资料 · TEST001</span>
          <h1>CSV 日聚合数据导入</h1>
          <p>文件只在当前页面内存中读取。必须先预览校验，再由你确认写入。</p>
        </div>
        <a className="text-button" href="#/demo-control">返回 Demo 控制台</a>
      </header>

      {!available ? (
        <section className="panel import-notice import-notice--warning" role="status">
          <strong>静态预览不可导入</strong>
          <p>CSV 仅可发送到本机 Express 服务；静态或远程页面不会发出导入请求。</p>
        </section>
      ) : null}

      <section className="panel wearable-import-form">
        <div className="section-title">
          <span>步骤 1</span>
          <h2>选择并预览 CSV</h2>
        </div>
        <p className="muted-copy">仅支持合成或团队测试数据，最大 64 KiB、366 天；不上传本地文件名。</p>
        <div className="import-actions">
          <label htmlFor="daily-snapshot-csv">CSV 文件</label>
          <input
            id="daily-snapshot-csv"
            aria-label="选择 CSV 文件"
            type="file"
            accept=".csv,text/csv"
            disabled={!available || loading !== null}
            onChange={(event) => void selectFile(event.target.files?.[0])}
          />
          <button
            className="primary"
            disabled={!available || !csvText || loading !== null}
            onClick={() => void requestPreview()}
          >
            {loading === "preview" ? "正在校验…" : "预览并校验"}
          </button>
        </div>
        {error ? <p className="import-feedback import-feedback--error" role="alert">{error}</p> : null}
        {success ? <p className="import-feedback import-feedback--success" role="status">{success}</p> : null}
      </section>

      {preview ? (
        <section className="panel">
          <div className="section-title with-actions">
            <div>
              <span>步骤 2</span>
              <h2>确认 {preview.count} 天 DailySnapshot</h2>
            </div>
            <button
              className="primary"
              disabled={!available || loading !== null || previewedText !== csvText}
              onClick={() => void confirmImport()}
            >
              {loading === "confirm" ? "正在导入…" : "确认导入"}
            </button>
          </div>
          <div className="import-summary-grid">
            <div><span>日期范围</span><strong>{preview.date_range.start} 至 {preview.date_range.end}</strong></div>
            {Object.entries(preview.quality_summary).map(([key, value]) => (
              <div key={key}><span>{key}</span><strong>{valueText(value)}</strong></div>
            ))}
          </div>
          {preview.warnings.length ? (
            <ul className="import-warnings">
              {preview.warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{formatCsvWarning(warning)}</li>
              ))}
            </ul>
          ) : <p className="muted-copy">校验通过，没有导入警告。</p>}
          <div className="table-wrap">
            <table className="heatmap-table import-preview-table">
              <caption>本次 CSV 预览，最多显示 20 行</caption>
              <thead><tr><th scope="col">日期</th><th scope="col">心率</th><th scope="col">步数</th><th scope="col">活动分钟</th><th scope="col">睡眠</th><th scope="col">佩戴</th><th scope="col">质量</th></tr></thead>
              <tbody>
                {preview.snapshots.slice(0, 20).map((row) => (
                  <tr key={row.date}>
                    <td>{row.date}</td>
                    <td>{valueText(row.heart_rate_avg)}</td>
                    <td>{valueText(row.steps)}</td>
                    <td>{valueText(row.active_minutes)}</td>
                    <td>{valueText(row.sleep_duration)}</td>
                    <td>{valueText(row.wear_time_hours)}</td>
                    <td>{valueText(row.data_quality)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.count > 20 ? <p className="muted-copy">页面只展示前 20 行，导入仍以完整预览结果为准。</p> : null}
        </section>
      ) : null}

      <section className="panel">
        <div className="section-title with-actions">
          <div><span>导入记录</span><h2>最近 20 次</h2></div>
          <button disabled={!available || loading !== null} onClick={() => void loadHistory()}>刷新</button>
        </div>
        {history?.runs.length ? (
          <div className="table-wrap">
            <table className="heatmap-table import-history-table">
              <caption>TEST001 最近 20 次导入记录</caption>
              <thead><tr><th scope="col">时间</th><th scope="col">来源</th><th scope="col">行数</th><th scope="col">日期范围</th></tr></thead>
              <tbody>
                {history.runs.map((run) => (
                  <tr key={run.import_run_id}>
                    <td>{new Date(run.created_at).toLocaleString("zh-CN")}</td>
                    <td>{run.source ?? "csv_import"}</td>
                    <td>{run.row_count ?? "—"}</td>
                    <td>{run.date_range ? `${run.date_range.start} 至 ${run.date_range.end}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted-copy">{available ? "暂无导入记录。" : "本地完整模式连接后可查看导入记录。"}</p>}
      </section>

      <MedicalDisclaimer />
    </div>
  );
};
