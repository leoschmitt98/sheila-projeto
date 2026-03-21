import fs from "fs";
import path from "path";

function resolveLogRoot() {
  const cwd = process.cwd();
  const cwdBase = path.basename(cwd).toLowerCase();
  if (cwdBase === "backend") {
    return path.resolve(cwd, "logs");
  }
  return path.resolve(cwd, "backend", "logs");
}

const LOG_ROOT = resolveLogRoot();
const REDACT_KEYS = ["password", "senha", "token", "secret", "authorization", "auth", "padrao"];
const LOG_FILE_RE = /^(info|warn|error)-(\d{4}-\d{2}-\d{2})\.log$/i;

function isSensitiveKey(key) {
  const normalized = String(key || "").trim().toLowerCase();
  return REDACT_KEYS.some((item) => normalized.includes(item));
}

function sanitizeValue(value, depth = 0) {
  if (depth > 4) return "[max-depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? "[redacted]" : sanitizeValue(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

function getDateKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function safeAppend(filePath, line) {
  fs.mkdir(path.dirname(filePath), { recursive: true }, (mkdirErr) => {
    if (mkdirErr) {
      console.warn("[logger] failed to ensure log directory:", mkdirErr.message);
      return;
    }
    fs.appendFile(filePath, `${line}\n`, "utf8", (appendErr) => {
      if (appendErr) {
        console.warn("[logger] failed to append log:", appendErr.message);
      }
    });
  });
}

export function writeModuleLog(moduleName, level, payload) {
  const moduleSafe = String(moduleName || "app").trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-") || "app";
  const levelSafe = String(level || "info").trim().toLowerCase();
  const dateKey = getDateKey();
  const filePath = path.join(LOG_ROOT, moduleSafe, `${levelSafe}-${dateKey}.log`);

  const record = {
    timestamp: new Date().toISOString(),
    module: moduleSafe,
    level: levelSafe,
    ...sanitizeValue(payload),
  };

  safeAppend(filePath, JSON.stringify(record));
}

export function createModuleLogger(moduleName) {
  return {
    info(payload) {
      writeModuleLog(moduleName, "info", payload);
    },
    warn(payload) {
      writeModuleLog(moduleName, "warn", payload);
    },
    error(payload) {
      writeModuleLog(moduleName, "error", payload);
    },
  };
}

function parseFileDateToEpochMs(fileName) {
  const match = LOG_FILE_RE.exec(String(fileName || ""));
  if (!match) return null;
  const datePart = match[2];
  const parsed = Date.parse(`${datePart}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPathInsideRoot(rootPath, targetPath) {
  const rootResolved = path.resolve(rootPath);
  const targetResolved = path.resolve(targetPath);
  const rel = path.relative(rootResolved, targetResolved);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export async function cleanupOldLogs({
  retentionDays = 30,
  logRoot = LOG_ROOT,
} = {}) {
  const safeRetention = Math.max(1, Number(retentionDays) || 30);
  const cutoffMs = Date.now() - safeRetention * 24 * 60 * 60 * 1000;
  const rootResolved = path.resolve(logRoot);
  const stats = {
    scannedFiles: 0,
    removedFiles: 0,
    failedRemovals: 0,
    skippedFiles: 0,
  };

  try {
    const rootEntries = await fs.promises.readdir(rootResolved, { withFileTypes: true });
    for (const moduleEntry of rootEntries) {
      if (!moduleEntry.isDirectory()) continue;
      const moduleDir = path.join(rootResolved, moduleEntry.name);
      if (!isPathInsideRoot(rootResolved, moduleDir)) continue;

      let moduleEntries = [];
      try {
        moduleEntries = await fs.promises.readdir(moduleDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const fileEntry of moduleEntries) {
        if (!fileEntry.isFile()) continue;
        const fileName = fileEntry.name;
        const fileDateMs = parseFileDateToEpochMs(fileName);
        if (!Number.isFinite(fileDateMs)) {
          stats.skippedFiles += 1;
          continue;
        }

        stats.scannedFiles += 1;
        if (fileDateMs >= cutoffMs) continue;

        const filePath = path.join(moduleDir, fileName);
        if (!isPathInsideRoot(rootResolved, filePath)) {
          stats.skippedFiles += 1;
          continue;
        }

        try {
          await fs.promises.unlink(filePath);
          stats.removedFiles += 1;
        } catch {
          stats.failedRemovals += 1;
        }
      }
    }
  } catch {
    return stats;
  }

  return stats;
}

export function getLogRootPath() {
  return LOG_ROOT;
}
