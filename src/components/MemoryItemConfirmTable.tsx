import { useEffect, useState } from "react";
import type { Dispatch } from "react";
import type { DemoAction } from "../store/demoStore";
import type { InitialCareMemory } from "../types";
import { StatusPill } from "./StatusPill";

interface MemoryItemConfirmTableProps {
  draft: InitialCareMemory;
  dispatch: Dispatch<DemoAction>;
}

const statusLabels = {
  pending: "待确认",
  confirmed: "已确认",
  rejected: "已删除",
  needs_more_info: "待补充",
};

export const MemoryItemConfirmTable = ({ draft, dispatch }: MemoryItemConfirmTableProps) => {
  const [draftTexts, setDraftTexts] = useState<Record<string, string>>({});

  useEffect(() => {
    setDraftTexts(
      draft.items.reduce<Record<string, string>>((record, item) => {
        record[item.id] = item.content;
        return record;
      }, {}),
    );
  }, [draft]);

  return (
    <section className="panel">
      <div className="section-title">
        <span>人工确认区</span>
        <h2>逐条确认、修改、删除或标记待补充</h2>
      </div>
      <div className="table-wrap">
        <table className="heatmap-table memory-table">
          <thead>
            <tr>
              <th>类别</th>
              <th>内容</th>
              <th>来源</th>
              <th>置信度</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {draft.items.map((item) => (
              <tr key={item.id}>
                <td>{item.category}</td>
                <td>
                  <textarea
                    aria-label={`编辑${item.category}记忆内容`}
                    value={draftTexts[item.id] ?? item.content}
                    onChange={(event) =>
                      setDraftTexts((current) => ({
                        ...current,
                        [item.id]: event.target.value,
                      }))
                    }
                  />
                </td>
                <td>
                  <strong>{item.sourceDetail}</strong>
                  <span>{item.sourceDate}</span>
                </td>
                <td>{Math.round(item.confidence * 100)}%</td>
                <td>
                  <StatusPill
                    label={statusLabels[item.confirmationStatus]}
                    tone={
                      item.confirmationStatus === "confirmed"
                        ? "stable"
                        : item.confirmationStatus === "rejected"
                          ? "muted"
                          : "observation"
                    }
                  />
                </td>
                <td>
                  <div className="table-actions">
                    <button
                      onClick={() =>
                        dispatch({
                          type: "CONFIRM_MEMORY_ITEM",
                          elderId: draft.elderId,
                          itemId: item.id,
                          status: "confirmed",
                          content: draftTexts[item.id],
                        })
                      }
                    >
                      确认
                    </button>
                    <button
                      onClick={() =>
                        dispatch({
                          type: "CONFIRM_MEMORY_ITEM",
                          elderId: draft.elderId,
                          itemId: item.id,
                          status: "pending",
                          content: draftTexts[item.id],
                        })
                      }
                    >
                      修改
                    </button>
                    <button
                      onClick={() =>
                        dispatch({
                          type: "CONFIRM_MEMORY_ITEM",
                          elderId: draft.elderId,
                          itemId: item.id,
                          status: "rejected",
                        })
                      }
                    >
                      删除
                    </button>
                    <button
                      onClick={() =>
                        dispatch({
                          type: "CONFIRM_MEMORY_ITEM",
                          elderId: draft.elderId,
                          itemId: item.id,
                          status: "needs_more_info",
                          content: draftTexts[item.id],
                        })
                      }
                    >
                      标记待补充
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
