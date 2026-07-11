import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import multer from "multer";
import {
  getElder,
  insertSnapshot,
  insertSnapshotImport,
  listImportRuns,
} from "../db.js";
import { analyzeAppleHealthXmlFile } from "../importers/appleHealthXml.js";
import { parseDailySnapshotsCsv } from "../importers/csvImporter.js";
import { snapshotSchema } from "../validators.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../..");
const uploadRoot = path.join(backendRoot, "uploads", "apple-health");
fs.mkdirSync(uploadRoot, { recursive: true });

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const xmlUploadMaxBytes =
  Number(process.env.APPLE_HEALTH_XML_UPLOAD_MAX_MB ?? 150) * 1024 * 1024;

const xmlUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadRoot),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname || "export.xml") || ".xml";
      cb(null, `${Date.now()}-${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: xmlUploadMaxBytes },
});

export const importRouter = Router();

const importOptions = (req) => ({
  elderId: req.body.elder_id ?? req.query.elder_id ?? "TEST001",
  startDate: req.body.start_date ?? req.query.start_date,
  endDate: req.body.end_date ?? req.query.end_date,
  limitDays: req.body.limit_days ?? req.query.limit_days ?? 14,
  stepSourceStrategy:
    req.body.step_source_strategy ??
    req.query.step_source_strategy ??
    process.env.APPLE_HEALTH_STEP_SOURCE_STRATEGY ??
    "prefer_watch",
});

const withServerOwnedSnapshotId = (snapshot) => {
  const { snapshot_id: _ignoredClientSnapshotId, ...serverOwned } = snapshot;
  return snapshot.data_source === "Apple Health Export"
    ? { ...serverOwned, snapshot_id: `APPLE-${snapshot.elder_id}-${snapshot.date}` }
    : serverOwned;
};

const csvSourceLabels = new Map([
  ["CSV", "CSV Import"],
  ["CSV Import", "CSV Import"],
  ["Apple Health Export", "Apple Health Export"],
]);

const parseCsvUpload = (req) => {
  if (!req.file) {
    const error = new Error("Please upload a CSV file with multipart field name file.");
    error.statusCode = 400;
    throw error;
  }
  if (!req.file.originalname?.toLowerCase().endsWith(".csv")) {
    const error = new Error("Only .csv files are accepted by this endpoint.");
    error.statusCode = 400;
    throw error;
  }

  const elderId = String(req.body.elder_id ?? "").trim();
  const dataSource = csvSourceLabels.get(String(req.body.source ?? "").trim());
  if (!elderId || !getElder(elderId)) {
    const error = new Error("Please provide a valid elder_id.");
    error.statusCode = 404;
    throw error;
  }
  if (!dataSource) {
    const error = new Error("source must be CSV or Apple Health Export.");
    error.statusCode = 400;
    throw error;
  }

  return {
    elderId,
    dataSource,
    snapshots: parseDailySnapshotsCsv(req.file.buffer.toString("utf8"), {
      elderId,
      dataSource,
    })
      .map(withServerOwnedSnapshotId)
      .map((snapshot) => snapshotSchema.parse(snapshot)),
  };
};

const summarizeCsv = (snapshots) => {
  const dates = snapshots.map((snapshot) => snapshot.date).sort();
  const qualities = snapshots.map((snapshot) => snapshot.data_quality);
  const average = qualities.length
    ? Math.round((qualities.reduce((sum, quality) => sum + quality, 0) / qualities.length) * 10) / 10
    : null;
  const missingMetrics = snapshots.reduce(
    (count, snapshot) =>
      count +
      [
        snapshot.heart_rate_avg,
        snapshot.resting_heart_rate,
        snapshot.steps,
        snapshot.active_minutes,
        snapshot.sleep_duration,
        snapshot.wear_time_hours,
      ].filter((value) => value === null).length,
    0,
  );
  const warnings = [];
  if (missingMetrics) warnings.push(`${missingMetrics} wearable metric values are missing and remain null.`);
  if (qualities.some((quality) => quality < 40)) {
    warnings.push("At least one day has data_quality below 40; it will be treated as insufficient data.");
  }

  return {
    date_range: {
      start: dates[0] ?? null,
      end: dates.at(-1) ?? null,
    },
    quality_summary: {
      scale: "0-100",
      average,
      minimum: qualities.length ? Math.min(...qualities) : null,
      maximum: qualities.length ? Math.max(...qualities) : null,
      missing_metric_values: missingMetrics,
    },
    warnings,
    sample_daily_snapshots: snapshots.slice(-7).map((snapshot) => ({
      snapshot_id: snapshot.snapshot_id ?? `PREVIEW-${snapshot.elder_id}-${snapshot.date}`,
      created_at: "",
      ...snapshot,
    })),
  };
};

const cleanupUpload = async (file) => {
  if (!file?.path) return;
  try {
    await fsp.unlink(file.path);
  } catch {
    // Temp upload cleanup should not hide the import result.
  }
};

const xmlUploadSingle = (req, res, next) => {
  xmlUpload.single("file")(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        ok: false,
        error:
          "Apple Health XML upload is too large for direct HTTP import. Use npm run preview:apple-health and npm run derive:apple-health locally, then import the derived CSV.",
      });
      return;
    }
    if (error) {
      next(error);
      return;
    }
    next();
  });
};

importRouter.post("/daily-snapshots-csv/preview", csvUpload.single("file"), (req, res, next) => {
  try {
    const { snapshots } = parseCsvUpload(req);
    const preview = summarizeCsv(snapshots);

    res.json({
      ok: true,
      count: snapshots.length,
      snapshots: preview.sample_daily_snapshots,
      preview,
    });
  } catch (error) {
    next(error);
  }
});

importRouter.post("/daily-snapshots-csv", csvUpload.single("file"), (req, res, next) => {
  try {
    const { elderId, dataSource, snapshots } = parseCsvUpload(req);
    const preview = summarizeCsv(snapshots);
    const confirmation = insertSnapshotImport({
      snapshots,
      import_run: {
        elder_id: elderId,
        source_type: dataSource,
        file_name: path.basename(req.file.originalname),
        date_start: preview.date_range.start,
        date_end: preview.date_range.end,
        quality_summary: preview.quality_summary,
        warnings: preview.warnings,
      },
    });
    const inserted = confirmation.snapshots;
    const importRun = confirmation.import_run;


    res.status(201).json({
      ok: true,
      import_id: importRun.import_id,
      count: inserted.length,
      snapshots: inserted,
      date_range: preview.date_range,
      quality_summary: preview.quality_summary,
      warnings: preview.warnings,
      preview,
    });
  } catch (error) {
    next(error);
  }
});

importRouter.get("/daily-snapshots-csv/history", (req, res, next) => {
  try {
    const elderId = String(req.query.elder_id ?? "").trim();
    if (!elderId || !getElder(elderId)) {
      res.status(404).json({ ok: false, error: "Please provide a valid elder_id." });
      return;
    }
    res.json({ ok: true, imports: listImportRuns(elderId, req.query.limit) });
  } catch (error) {
    next(error);
  }
});
importRouter.post("/apple-health-xml/preview", xmlUploadSingle, async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ ok: false, error: "Please upload export.xml with multipart field name file." });
      return;
    }

    const { preview } = await analyzeAppleHealthXmlFile(req.file.path, importOptions(req));
    res.json({
      ok: true,
      preview,
    });
  } catch (error) {
    next(error);
  } finally {
    await cleanupUpload(req.file);
  }
});

importRouter.post("/apple-health-xml", xmlUploadSingle, async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ ok: false, error: "Please upload export.xml with multipart field name file." });
      return;
    }

    const options = importOptions(req);
    if (!options.elderId || !getElder(options.elderId)) {
      res.status(404).json({ ok: false, error: "Please provide a valid elder_id." });
      return;
    }

    const { snapshots, preview } = await analyzeAppleHealthXmlFile(req.file.path, options);
    const inserted = snapshots.map((snapshot) => insertSnapshot(snapshotSchema.parse(snapshot)));

    res.status(201).json({
      ok: true,
      count: inserted.length,
      snapshots: inserted,
      preview: {
        ...preview,
        sample_daily_snapshots: preview.sample_daily_snapshots.slice(-3),
      },
    });
  } catch (error) {
    next(error);
  } finally {
    await cleanupUpload(req.file);
  }
});
