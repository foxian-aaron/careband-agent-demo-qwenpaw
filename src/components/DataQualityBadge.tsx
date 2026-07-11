import { StatusPill } from "./StatusPill";
import { ratioDataQualityToPercent } from "../lib/dataQuality";

interface DataQualityBadgeProps {
  quality: number;
}

export const DataQualityBadge = ({ quality }: DataQualityBadgeProps) => {
  const percent = ratioDataQualityToPercent(quality);
  const tone = quality < 0.4 ? "muted" : quality < 0.7 ? "attention" : "stable";
  const label = quality < 0.4 ? `数据不足 ${percent}%` : `数据完整度 ${percent}%`;
  return <StatusPill label={label} tone={tone} />;
};
