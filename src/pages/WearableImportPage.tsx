import { useEffect, useState } from "react";
import { DataQualityBadge } from "../components/DataQualityBadge";
import { UnknownElderState } from "../components/UnknownElderState";
import { WearableDataSourceBadge } from "../components/WearableDataSourceBadge";
import {
  apiImportDailySnapshotsCsv,
  apiGetDailySnapshotsCsvHistory,
  apiPreviewDailySnapshotsCsv,
  type BackendCsvImportResponse,
  type BackendImportRun,
} from "../lib/apiClient";
import {
  chenWearableSevenDayCsv,
  mapBackendSnapshotsToWearable,
  wearableCsvExample,
} from "../lib/wearableImport";
import { useDemo } from "../store/demoStore";
import type { WearableDailySnapshot, WearableDataSource } from "../types";

interface WearableImportPageProps {
  elderId: string;
}

const activeSources: WearableDataSource[] = ["CSV", "Apple Health Export"];
const futureSources = ["Android Health Connect", "Fitbit", "Zepp / Amazfit"];
const maxCsvBytes = 10 * 1024 * 1024;

const displayMetric = (value: number | null) => (value === null ? "缺失" : value);

const responseSnapshots = (response: BackendCsvImportResponse | null) => {
  if (!response) return [];
  if (response.snapshots.length) return response.snapshots;
  return response.preview?.sample_daily_snapshots ?? [];
};

export const WearableImportPage = ({ elderId }: WearableImportPageProps) => {
  const { state, dispatch } = useDemo();
  const profile = state.profiles[elderId];
  const [source, setSource] = useState<WearableDataSource>("CSV");
  const [csv, setCsv] = useState(wearableCsvExample);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BackendCsvImportResponse | null>(null);
  const [importResult, setImportResult] = useState<BackendCsvImportResponse | null>(null);
  const [loading, setLoading] = useState<"preview" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<BackendImportRun[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistoryError(null);
    void apiGetDailySnapshotsCsvHistory(elderId)
      .then((response) => {
        if (!cancelled) setHistory(response.imports);
      })
      .catch((caught) => {
        if (!cancelled) {
          setHistoryError(caught instanceof Error ? caught.message : "无法读取导入历史。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [elderId]);

  if (!profile) return <UnknownElderState elderId={elderId} />;

  const latestImport = state.wearableImports[profile.elderId]?.[0];
  const previewRows = mapBackendSnapshotsToWearable(responseSnapshots(preview));
  const confirmedRows = mapBackendSnapshotsToWearable(responseSnapshots(importResult));
  const displayedRows = confirmedRows.length
    ? confirmedRows
    : previewRows.length
      ? previewRows
      : latestImport?.snapshots ?? [];

  const invalidatePreview = () => {
    setPreview(null);
    setImportResult(null);
    setError(null);
  };

  const currentUpload = () => {
    const file =
      selectedFile ??
      new Blob([csv], {
        type: "text/csv;charset=utf-8",
      });
    if (file.size === 0) throw new Error("请选择 CSV 文件或粘贴 CSV 内容。");
    if (file.size > maxCsvBytes) throw new Error("CSV 文件不能超过 10 MB。");
    return {
      elderId: profile.elderId,
      source,
      file,
      filename: selectedFile?.name ?? `${profile.elderId}-daily-snapshots.csv`,
    };
  };

  const runPreview = async () => {
    setLoading("preview");
    setError(null);
    setImportResult(null);
    try {
      const response = await apiPreviewDailySnapshotsCsv(currentUpload());
      setPreview(response);
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : "CSV 预览失败，请检查格式后重试。");
    } finally {
      setLoading(null);
    }
  };

  const runImport = async () => {
    if (!preview) {
      setError("请先预览并检查数据，再确认导入。");
      return;
    }
    setLoading("confirm");
    setError(null);
    try {
      const response = await apiImportDailySnapshotsCsv(currentUpload());
      const snapshots = mapBackendSnapshotsToWearable(response.snapshots);
      setImportResult(response);
      if (snapshots.length) {
        dispatch({
          type: "IMPORT_WEARABLE_DATA",
          elderId: profile.elderId,
          source,
          snapshots,
        });
      }
      try {
        const historyResponse = await apiGetDailySnapshotsCsvHistory(profile.elderId);
        setHistory(historyResponse.imports);
        setHistoryError(null);
      } catch (caught) {
        setHistoryError(caught instanceof Error ? caught.message : "导入成功，但无法刷新导入历史。");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CSV 导入失败，请稍后重试。");
    } finally {
      setLoading(null);
    }
  };

  const renderRows = (rows: WearableDailySnapshot[]) => (
    <div className="table-wrap">
      <table className="heatmap-table">
        <thead>
          <tr>
            <th>date</th>
            <th>steps</th>
            <th>heart_rate_avg</th>
            <th>resting_heart_rate</th>
            <th>sleep_duration</th>
            <th>active_minutes</th>
            <th>wear_time_hours</th>
            <th>data_quality</th>
            <th>imported_at</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((snapshot) => (
            <tr key={snapshot.id}>
              <td>{snapshot.date}</td>
              <td>{displayMetric(snapshot.steps)}</td>
              <td>{displayMetric(snapshot.heartRateAvg)}</td>
              <td>{displayMetric(snapshot.restingHeartRate)}</td>
              <td>{displayMetric(snapshot.sleepDuration)}</td>
              <td>{displayMetric(snapshot.activeMinutes)}</td>
              <td>{displayMetric(snapshot.wearTimeHours)}</td>
              <td><DataQualityBadge quality={snapshot.dataQuality} /></td>
              <td>{snapshot.importedAt ?? "确认导入后由服务器生成"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span>穿戴数据导入 / Wearable Data Import</span>
          <h1>{profile.name}的 DailySnapshot 导入</h1>
          <p>文件仅发送到本地后端；预览不会写入数据库，确认后按长者与日期幂等导入。</p>
        </div>
        <a className="primary-link" href={`#/elder/${profile.elderId}`}>返回驾驶舱</a>
      </header>

      <section className="panel wearable-import-form">
        <div className="section-title">
          <span>真实 CSV 接入</span>
          <h2>1. 选择数据来源并提供 CSV</h2>
        </div>
        <div className="source-grid">
          {activeSources.map((item) => (
            <button
              className={source === item ? "active" : ""}
              key={item}
              onClick={() => {
                setSource(item);
                invalidatePreview();
              }}
            >
              {item}
            </button>
          ))}
          {futureSources.map((item) => <button disabled key={item}>{item}（未来接入）</button>)}
        </div>
        <WearableDataSourceBadge source={source} />

        <label>
          <strong>选择 CSV 文件</strong>
          <input
            accept=".csv,text/csv"
            type="file"
            onChange={(event) => {
              setSelectedFile(event.target.files?.[0] ?? null);
              invalidatePreview();
            }}
          />
        </label>
        {selectedFile ? (
          <p className="muted-copy">
            已选择：{selectedFile.name}（{Math.ceil(selectedFile.size / 1024)} KB）。预览时优先使用该文件。
          </p>
        ) : null}

        <label>
          <strong>或粘贴 CSV 内容</strong>
          <textarea
            value={csv}
            onChange={(event) => {
              setCsv(event.target.value);
              setSelectedFile(null);
              invalidatePreview();
            }}
          />
        </label>
        <div className="button-row">
          <button className="primary" disabled={loading !== null} onClick={() => void runPreview()}>
            {loading === "preview" ? "正在预览…" : "预览并校验 CSV"}
          </button>
          <button
            disabled={loading !== null}
            onClick={() => {
              setSelectedFile(null);
              setSource("CSV");
              setCsv(chenWearableSevenDayCsv);
              invalidatePreview();
            }}
          >
            填入陈伯 7 天示例
          </button>
        </div>
        {error ? <p className="mock-flow-note" role="alert">{error}</p> : null}
      </section>

      {preview ? (
        <section className="panel">
          <div className="section-title">
            <span>只读预览</span>
            <h2>2. 检查 {preview.count} 条 DailySnapshot</h2>
          </div>
          {preview.preview?.warnings?.length ? (
            <ul className="insight-list">
              {preview.preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : <p className="muted-copy">后端校验通过；空指标仍保持“缺失”，不会补成 0。</p>}
          {previewRows.length ? renderRows(previewRows) : null}
          <div className="button-row">
            <button className="primary" disabled={loading !== null} onClick={() => void runImport()}>
              {loading === "confirm" ? "正在导入…" : "确认写入本地数据库"}
            </button>
          </div>
        </section>
      ) : null}

      {importResult ? (
        <section className="panel">
          <div className="section-title">
            <span>导入完成</span>
            <h2>{importResult.count} 条记录已写入</h2>
          </div>
          <p className="muted-copy">
            import_id：{importResult.import_id ?? "后端未返回"}。驾驶舱会使用后端最近七个不同日期的快照刷新趋势。
          </p>
        </section>
      ) : null}

      {displayedRows.length ? (
        <section className="panel">
          <div className="section-title">
            <span>DailySnapshot 列表</span>
            <h2>{importResult ? "最近一次确认导入" : preview ? "当前预览" : "最近一次本地记录"}</h2>
          </div>
          {renderRows(displayedRows)}
        </section>
      ) : null}

      <section className="panel">
        <div className="section-title">
          <span>Import History</span>
          <h2>导入历史</h2>
        </div>
        {historyError ? <p className="mock-flow-note" role="alert">{historyError}</p> : null}
        {history.length ? (
          <div className="card-stack">
            {history.map((run) => (
              <article className="script-card" key={run.import_id}>
                <strong>{run.source_type} · {run.snapshot_count} 条 DailySnapshot</strong>
                <p>
                  日期范围：{run.date_start ?? "未知"} 至 {run.date_end ?? "未知"}；
                  文件：{run.file_name ?? "未记录"}。
                </p>
                <small>
                  {new Date(run.created_at).toLocaleString("zh-CN")} · import_id：{run.import_id}
                </small>
                {run.warnings.length ? (
                  <ul className="insight-list">
                    {run.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        ) : historyError ? null : <p className="muted-copy">尚无确认导入记录。</p>}
      </section>
    </div>
  );
};
