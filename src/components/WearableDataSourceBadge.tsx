import type { WearableDataSource } from "../types";
import { StatusPill } from "./StatusPill";

interface WearableDataSourceBadgeProps {
  source?: WearableDataSource;
}

export const WearableDataSourceBadge = ({ source = "Mock Data" }: WearableDataSourceBadgeProps) => {
  const future = ["Apple Health", "Android Health Connect", "Fitbit", "Zepp / Amazfit"].includes(
    source,
  );
  const connected = ["CSV", "CSV Import", "Apple Health Export"].includes(source);
  const suffix = future ? "（未来接入）" : connected ? "（已接入）" : "（模拟）";
  return (
    <StatusPill
      label={`${source}${suffix}`}
      tone={future ? "observation" : "stable"}
    />
  );
};
