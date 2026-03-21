import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import sql from "mssql";
import crypto from "crypto";
import webpush from "web-push";
import { cleanupOldLogs, createModuleLogger, getLogRootPath } from "./lib/logger.js";

dotenv.config();

const app = express();
app.disable("x-powered-by");

const APP_STARTED_AT = new Date().toISOString();
const TRUST_PROXY = String(process.env.TRUST_PROXY || "true").trim().toLowerCase() !== "false";
if (TRUST_PROXY) {
  app.set("trust proxy", 1);
}

function isAllowedOrigin(origin) {
  if (!origin) return true;

  const normalized = String(origin).trim().toLowerCase();
  if (!normalized) return true;

  const explicitAllowed = String(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (explicitAllowed.includes(normalized)) return true;

  if (normalized === "https://sheilasystem.com.br") return true;
  if (normalized === "http://sheilasystem.com.br") return true;
  if (normalized === "http://localhost:8080") return true;
  if (normalized === "http://localhost:4173") return true;
  if (normalized === "http://localhost:5173") return true;

  return /^https?:\/\/[a-z0-9-]+\.sheilasystem\.com\.br(?::\d+)?$/i.test(normalized);
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error(`CORS bloqueado para origem: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Cache-Control", "Pragma"],
  optionsSuccessStatus: 204,
};

app.use((req, res, next) => {
  const reqOrigin = req.headers.origin;
  if (isAllowedOrigin(reqOrigin)) {
    res.header("Access-Control-Allow-Origin", reqOrigin || "*");
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Cache-Control, Pragma");
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(cors(corsOptions));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "0");
  if (String(process.env.FORCE_HTTPS || "false").trim().toLowerCase() === "true") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use((req, res, next) => {
  const startedAt = Date.now();
  const ip = getClientIp(req);
  res.on("finish", () => {
    const elapsed = Date.now() - startedAt;
    if (res.statusCode >= 500) {
      console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${elapsed}ms) ip=${ip}`);
      appLog.error({
        message: "HTTP 5xx response",
        route: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        elapsedMs: elapsed,
        ip,
      });
    } else if (res.statusCode >= 400) {
      console.warn(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${elapsed}ms) ip=${ip}`);
      appLog.warn({
        message: "HTTP 4xx response",
        route: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        elapsedMs: elapsed,
        ip,
      });
    }
  });
  next();
});

app.use(express.json());

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

// helper simples
function badRequest(res, message) {
  return res.status(400).json({ ok: false, error: message });
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.ip || req.socket?.remoteAddress || "unknown";
  return String(ip).slice(0, 120);
}

function createSimpleRateLimiter({
  windowMs,
  max,
  keyPrefix,
  message = "Muitas requisições. Tente novamente em instantes.",
}) {
  const store = new Map();
  const cleanupEvery = Math.max(windowMs, 30_000);
  let lastCleanupAt = Date.now();

  return (req, res, next) => {
    const now = Date.now();
    if (now - lastCleanupAt > cleanupEvery) {
      for (const [key, entry] of store.entries()) {
        if (!entry || entry.expiresAt <= now) store.delete(key);
      }
      lastCleanupAt = now;
    }

    const key = `${keyPrefix}:${getClientIp(req)}`;
    const current = store.get(key);
    if (!current || current.expiresAt <= now) {
      store.set(key, { count: 1, expiresAt: now + windowMs });
      return next();
    }

    if (current.count >= max) {
      const retrySeconds = Math.max(1, Math.ceil((current.expiresAt - now) / 1000));
      res.setHeader("Retry-After", String(retrySeconds));
      return res.status(429).json({ ok: false, error: message });
    }

    current.count += 1;
    store.set(key, current);
    return next();
  };
}

function parseInitialChatOptions(rawValue) {
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(String(rawValue));
    if (!Array.isArray(parsed)) return null;

    const clean = parsed
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    return [...new Set(clean)];
  } catch {
    return null;
  }
}

function isSqlInvalidColumnError(err, columnName) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("invalid column name") && msg.includes(String(columnName || "").toLowerCase());
}

const ADMIN_TOKEN_SECRET =
  process.env.ADMIN_AUTH_SECRET ||
  process.env.DB_PASSWORD ||
  "sheila-admin-dev-secret";
const WEB_PUSH_PUBLIC_KEY = String(process.env.WEB_PUSH_PUBLIC_KEY || "").trim();
const WEB_PUSH_PRIVATE_KEY = String(process.env.WEB_PUSH_PRIVATE_KEY || "").trim();
const WEB_PUSH_SUBJECT = String(process.env.WEB_PUSH_SUBJECT || "mailto:admin@sheilasystem.local").trim();
const SQL_BRAZIL_NOW =
  "CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'E. South America Standard Time' AS DATETIME2(0))";
const PUSH_REMINDER_ENABLED = String(process.env.PUSH_REMINDER_ENABLED || "true").trim().toLowerCase() !== "false";
const PUSH_REMINDER_MINUTES_BEFORE = Math.max(5, Number(process.env.PUSH_REMINDER_MINUTES_BEFORE || 120));
const PUSH_REMINDER_WINDOW_MINUTES = Math.max(1, Number(process.env.PUSH_REMINDER_WINDOW_MINUTES || 5));
const PUSH_REMINDER_LATE_TOLERANCE_MINUTES = Math.max(0, Number(process.env.PUSH_REMINDER_LATE_TOLERANCE_MINUTES || 15));
const PUSH_REMINDER_POLL_MS = Math.max(30_000, Number(process.env.PUSH_REMINDER_POLL_MS || 120_000));
const RATE_LIMIT_LOGIN_WINDOW_MS = Math.max(30_000, Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || 10 * 60 * 1000));
const RATE_LIMIT_LOGIN_MAX = Math.max(1, Number(process.env.RATE_LIMIT_LOGIN_MAX || 20));
const RATE_LIMIT_BOOKING_WINDOW_MS = Math.max(10_000, Number(process.env.RATE_LIMIT_BOOKING_WINDOW_MS || 60 * 1000));
const RATE_LIMIT_BOOKING_MAX = Math.max(1, Number(process.env.RATE_LIMIT_BOOKING_MAX || 20));
const RATE_LIMIT_PUBLIC_WINDOW_MS = Math.max(10_000, Number(process.env.RATE_LIMIT_PUBLIC_WINDOW_MS || 60 * 1000));
const RATE_LIMIT_PUBLIC_MAX = Math.max(1, Number(process.env.RATE_LIMIT_PUBLIC_MAX || 60));
const ADMIN_NOTIFICACAO_SELECT = `
  Id,
  EmpresaId,
  ProfissionalId,
  Tipo,
  Titulo,
  Mensagem,
  ReferenciaTipo,
  ReferenciaId,
  CONVERT(varchar(19), LidaEm, 120) AS LidaEm,
  CONVERT(varchar(19), CriadaEm, 120) AS CriadaEm
`;
let webPushConfigured = false;
const appLog = createModuleLogger("app");
const authLog = createModuleLogger("auth");
const chatLog = createModuleLogger("chat");
const agendamentosLog = createModuleLogger("agendamentos");
const financeiroLog = createModuleLogger("financeiro");
const ordensServicoLog = createModuleLogger("ordens-servico");
const orcamentosLog = createModuleLogger("orcamentos");
const jobsLog = createModuleLogger("jobs");
const LOG_RETENTION_DAYS = Math.max(1, Number(process.env.LOG_RETENTION_DAYS || 30));
const LOG_RETENTION_INTERVAL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.LOG_RETENTION_INTERVAL_MS || 24 * 60 * 60 * 1000)
);

async function runLogsRetentionSweep() {
  try {
    const stats = await cleanupOldLogs({ retentionDays: LOG_RETENTION_DAYS });
    if (Number(stats.removedFiles || 0) > 0 || Number(stats.failedRemovals || 0) > 0) {
      appLog.info({
        message: "Retencao de logs executada",
        route: "jobs/log-retention",
        logRoot: getLogRootPath(),
        retentionDays: LOG_RETENTION_DAYS,
        scannedFiles: Number(stats.scannedFiles || 0),
        removedFiles: Number(stats.removedFiles || 0),
        failedRemovals: Number(stats.failedRemovals || 0),
        skippedFiles: Number(stats.skippedFiles || 0),
      });
    }
    if (Number(stats.failedRemovals || 0) > 0) {
      appLog.warn({
        message: "Retencao de logs concluiu com falhas de remocao",
        route: "jobs/log-retention",
        logRoot: getLogRootPath(),
        retentionDays: LOG_RETENTION_DAYS,
        failedRemovals: Number(stats.failedRemovals || 0),
      });
    }
  } catch (err) {
    appLog.warn({
      message: "Falha ao executar retencao de logs",
      route: "jobs/log-retention",
      logRoot: getLogRootPath(),
      retentionDays: LOG_RETENTION_DAYS,
      error: { message: err?.message, stack: err?.stack },
    });
  }
}

function validateProductionEnv() {
  const missing = [];
  if (!process.env.DB_SERVER) missing.push("DB_SERVER");
  if (!process.env.DB_DATABASE) missing.push("DB_DATABASE");
  if (!process.env.DB_USER) missing.push("DB_USER");
  if (!process.env.DB_PASSWORD) missing.push("DB_PASSWORD");
  if (!process.env.ADMIN_MASTER_PASSWORD) {
    console.warn("ADMIN_MASTER_PASSWORD não definido. Configure em produção.");
  }
  if (missing.length) {
    console.warn(`Variáveis de banco ausentes: ${missing.join(", ")}`);
  }
  if (!isWebPushEnabled()) {
    console.warn("WEB_PUSH_PUBLIC_KEY/WEB_PUSH_PRIVATE_KEY ausentes. Push ficará desativado.");
  }
}
const loginRateLimiter = createSimpleRateLimiter({
  windowMs: RATE_LIMIT_LOGIN_WINDOW_MS,
  max: RATE_LIMIT_LOGIN_MAX,
  keyPrefix: "rl:admin-login",
  message: "Muitas tentativas de login. Tente novamente em instantes.",
});
const bookingRateLimiter = createSimpleRateLimiter({
  windowMs: RATE_LIMIT_BOOKING_WINDOW_MS,
  max: RATE_LIMIT_BOOKING_MAX,
  keyPrefix: "rl:booking-create",
  message: "Muitas tentativas de agendamento. Aguarde alguns segundos e tente novamente.",
});
const publicRateLimiter = createSimpleRateLimiter({
  windowMs: RATE_LIMIT_PUBLIC_WINDOW_MS,
  max: RATE_LIMIT_PUBLIC_MAX,
  keyPrefix: "rl:public",
  message: "Muitas requisições. Aguarde alguns segundos e tente novamente.",
});

function hashAdminPassword(password) {
  return crypto.createHash("sha256").update(String(password || "")).digest("hex");
}

function createAdminToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${sig}`;
}

function parseAdminToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(encoded)
    .digest("base64url");

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload?.slug || !payload?.exp) return null;
    if (Date.now() > Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

function getAdminSessionPayload(req) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return parseAdminToken(token);
}

function isWebPushEnabled() {
  return Boolean(WEB_PUSH_PUBLIC_KEY && WEB_PUSH_PRIVATE_KEY);
}

function ensureWebPushConfigured() {
  if (!isWebPushEnabled()) return false;
  if (webPushConfigured) return true;

  webpush.setVapidDetails(WEB_PUSH_SUBJECT, WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY);
  webPushConfigured = true;
  return true;
}

async function getPool() {
  return sql.connect(dbConfig);
}

async function getEmpresaBySlug(pool, slug) {
  try {
    const result = await pool
      .request()
      .input("slug", sql.VarChar(80), slug)
      .query(`
        SELECT TOP 1
          Id,
          Nome,
          Slug,
          MensagemBoasVindas,
          OpcoesIniciaisSheila,
          WhatsappPrestador,
          NomeProprietario,
          Endereco
        FROM dbo.Empresas
        WHERE Slug = @slug
      `);

    return result.recordset[0] || null;
  } catch (err) {
    if (!isSqlInvalidColumnError(err, "OpcoesIniciaisSheila")) throw err;

    const fallback = await pool
      .request()
      .input("slug", sql.VarChar(80), slug)
      .query(`
        SELECT TOP 1
          Id,
          Nome,
          Slug,
          MensagemBoasVindas,
          WhatsappPrestador,
          NomeProprietario,
          Endereco
        FROM dbo.Empresas
        WHERE Slug = @slug
      `);

    const empresa = fallback.recordset[0] || null;
    if (!empresa) return null;

    return {
      ...empresa,
      OpcoesIniciaisSheila: null,
    };
  }
}

async function hasTable(pool, tableName) {
  const result = await pool
    .request()
    .input("tableName", sql.NVarChar(200), tableName)
    .query(`SELECT CASE WHEN OBJECT_ID(@tableName, 'U') IS NULL THEN 0 ELSE 1 END AS ok;`);

  return Boolean(result.recordset?.[0]?.ok);
}

async function hasColumn(pool, tableName, columnName) {
  const result = await pool
    .request()
    .input("tableName", sql.NVarChar(200), tableName)
    .input("columnName", sql.NVarChar(200), columnName)
    .query(`
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM sys.columns c
        INNER JOIN sys.objects o ON o.object_id = c.object_id
        WHERE c.name = @columnName
          AND SCHEMA_NAME(o.schema_id) + '.' + o.name = @tableName
      ) THEN 1 ELSE 0 END AS ok;
    `);

  return Boolean(result.recordset?.[0]?.ok);
}

async function ensureEmpresaNotificacoesTable(pool) {
  if (await hasTable(pool, "dbo.EmpresaNotificacoes")) return true;

  try {
    await pool.request().query(`
      CREATE TABLE dbo.EmpresaNotificacoes (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        EmpresaId INT NOT NULL,
        ProfissionalId INT NULL,
        Tipo NVARCHAR(80) NOT NULL,
        Titulo NVARCHAR(160) NOT NULL,
        Mensagem NVARCHAR(1000) NOT NULL,
        ReferenciaTipo NVARCHAR(80) NULL,
        ReferenciaId INT NULL,
        DadosJson NVARCHAR(MAX) NULL,
        LidaEm DATETIME2(0) NULL,
        CriadaEm DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaNotificacoes_CriadaEm DEFAULT(${SQL_BRAZIL_NOW})
      );

      ALTER TABLE dbo.EmpresaNotificacoes
      ADD CONSTRAINT FK_EmpresaNotificacoes_Empresas
      FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);

      CREATE INDEX IX_EmpresaNotificacoes_Empresa_CriadaEm
        ON dbo.EmpresaNotificacoes (EmpresaId, CriadaEm DESC, Id DESC);

      CREATE INDEX IX_EmpresaNotificacoes_Empresa_LidaEm
        ON dbo.EmpresaNotificacoes (EmpresaId, LidaEm, CriadaEm DESC, Id DESC);
    `);

    return true;
  } catch (err) {
    if (await hasTable(pool, "dbo.EmpresaNotificacoes")) return true;
    console.warn("Nao foi possivel garantir a tabela dbo.EmpresaNotificacoes:", err?.message || err);
    return false;
  }
}

async function ensureEmpresaNotificacaoDispositivosTable(pool) {
  if (await hasTable(pool, "dbo.EmpresaNotificacaoDispositivos")) {
    try {
      await pool.request().query(`
        IF COL_LENGTH('dbo.EmpresaNotificacaoDispositivos', 'RecebePushAgendamento') IS NULL
        BEGIN
          ALTER TABLE dbo.EmpresaNotificacaoDispositivos
          ADD RecebePushAgendamento BIT NOT NULL
            CONSTRAINT DF_EmpresaNotificacaoDispositivos_RecebePushAgendamento DEFAULT(1);
        END;

        IF COL_LENGTH('dbo.EmpresaNotificacaoDispositivos', 'RecebePushLembrete') IS NULL
        BEGIN
          ALTER TABLE dbo.EmpresaNotificacaoDispositivos
          ADD RecebePushLembrete BIT NOT NULL
            CONSTRAINT DF_EmpresaNotificacaoDispositivos_RecebePushLembrete DEFAULT(1);
        END;
      `);
      return true;
    } catch (err) {
      console.warn(
        "Nao foi possivel garantir as colunas de preferencia push em dbo.EmpresaNotificacaoDispositivos:",
        err?.message || err
      );
      return false;
    }
  }

  try {
    await pool.request().query(`
      CREATE TABLE dbo.EmpresaNotificacaoDispositivos (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        EmpresaId INT NOT NULL,
        DeviceId NVARCHAR(120) NOT NULL,
        NomeDispositivo NVARCHAR(160) NOT NULL,
        Endpoint NVARCHAR(MAX) NULL,
        Auth NVARCHAR(500) NULL,
        P256dh NVARCHAR(500) NULL,
        RecebePushAgendamento BIT NOT NULL CONSTRAINT DF_EmpresaNotificacaoDispositivos_RecebePushAgendamento DEFAULT(1),
        RecebePushLembrete BIT NOT NULL CONSTRAINT DF_EmpresaNotificacaoDispositivos_RecebePushLembrete DEFAULT(1),
        Ativo BIT NOT NULL CONSTRAINT DF_EmpresaNotificacaoDispositivos_Ativo DEFAULT(1),
        CriadoEm DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaNotificacaoDispositivos_CriadoEm DEFAULT(${SQL_BRAZIL_NOW}),
        AtualizadoEm DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaNotificacaoDispositivos_AtualizadoEm DEFAULT(${SQL_BRAZIL_NOW})
      );

      ALTER TABLE dbo.EmpresaNotificacaoDispositivos
      ADD CONSTRAINT FK_EmpresaNotificacaoDispositivos_Empresas
      FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);

      CREATE UNIQUE INDEX UX_EmpresaNotificacaoDispositivos_Empresa_Device
        ON dbo.EmpresaNotificacaoDispositivos (EmpresaId, DeviceId);

      CREATE INDEX IX_EmpresaNotificacaoDispositivos_Empresa_Ativo
        ON dbo.EmpresaNotificacaoDispositivos (EmpresaId, Ativo, AtualizadoEm DESC, Id DESC);
    `);

    return true;
  } catch (err) {
    if (await hasTable(pool, "dbo.EmpresaNotificacaoDispositivos")) return true;
    console.warn("Nao foi possivel garantir a tabela dbo.EmpresaNotificacaoDispositivos:", err?.message || err);
    return false;
  }
}

async function ensureEmpresaNotificacaoDispositivoProfissionaisTable(pool) {
  if (await hasTable(pool, "dbo.EmpresaNotificacaoDispositivoProfissionais")) return true;

  try {
    await pool.request().query(`
      CREATE TABLE dbo.EmpresaNotificacaoDispositivoProfissionais (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        EmpresaId INT NOT NULL,
        DispositivoId INT NOT NULL,
        ProfissionalId INT NOT NULL,
        CriadoEm DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaNotificacaoDispositivoProfissionais_CriadoEm DEFAULT(${SQL_BRAZIL_NOW})
      );

      ALTER TABLE dbo.EmpresaNotificacaoDispositivoProfissionais
      ADD CONSTRAINT FK_EmpresaNotificacaoDispositivoProfissionais_Empresas
      FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);

      ALTER TABLE dbo.EmpresaNotificacaoDispositivoProfissionais
      ADD CONSTRAINT FK_EmpresaNotificacaoDispositivoProfissionais_Dispositivos
      FOREIGN KEY (DispositivoId) REFERENCES dbo.EmpresaNotificacaoDispositivos(Id);

      CREATE UNIQUE INDEX UX_EmpresaNotificacaoDispositivoProfissionais_Dispositivo_Profissional
        ON dbo.EmpresaNotificacaoDispositivoProfissionais (DispositivoId, ProfissionalId);

      CREATE INDEX IX_EmpresaNotificacaoDispositivoProfissionais_Empresa_Profissional
        ON dbo.EmpresaNotificacaoDispositivoProfissionais (EmpresaId, ProfissionalId, DispositivoId);
    `);

    return true;
  } catch (err) {
    if (await hasTable(pool, "dbo.EmpresaNotificacaoDispositivoProfissionais")) return true;
    console.warn(
      "Nao foi possivel garantir a tabela dbo.EmpresaNotificacaoDispositivoProfissionais:",
      err?.message || err
    );
    return false;
  }
}

async function ensureEmpresaPushLembretesEnviadosTable(pool) {
  if (await hasTable(pool, "dbo.EmpresaPushLembretesEnviados")) return true;

  try {
    await pool.request().query(`
      CREATE TABLE dbo.EmpresaPushLembretesEnviados (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        EmpresaId INT NOT NULL,
        AgendamentoId INT NOT NULL,
        MinutosAntes INT NOT NULL,
        Tipo NVARCHAR(40) NOT NULL CONSTRAINT DF_EmpresaPushLembretesEnviados_Tipo DEFAULT('whatsapp_lembrete'),
        EnviadoEm DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaPushLembretesEnviados_EnviadoEm DEFAULT(${SQL_BRAZIL_NOW})
      );

      ALTER TABLE dbo.EmpresaPushLembretesEnviados
      ADD CONSTRAINT FK_EmpresaPushLembretesEnviados_Empresas
      FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);

      CREATE UNIQUE INDEX UX_EmpresaPushLembretesEnviados_Empresa_Agendamento_Minutos_Tipo
        ON dbo.EmpresaPushLembretesEnviados (EmpresaId, AgendamentoId, MinutosAntes, Tipo);

      CREATE INDEX IX_EmpresaPushLembretesEnviados_Empresa_EnviadoEm
        ON dbo.EmpresaPushLembretesEnviados (EmpresaId, EnviadoEm DESC, Id DESC);
    `);
    return true;
  } catch (err) {
    if (await hasTable(pool, "dbo.EmpresaPushLembretesEnviados")) return true;
    console.warn("Nao foi possivel garantir a tabela dbo.EmpresaPushLembretesEnviados:", err?.message || err);
    return false;
  }
}

const DEFAULT_FINANCE_RULES = {
  owner: 50,
  cash: 30,
  expenses: 20,
};

const EXPENSE_CATEGORIES = [
  "aluguel",
  "manutencao",
  "reposicao_produtos",
  "agua_luz",
  "internet",
  "marketing",
  "outros",
];

const OS_DEVICE_TYPES = ["celular", "tablet", "notebook", "outro"];
const OS_BUDGET_STATUS_VALUES = ["aguardando_aprovacao", "aprovado", "recusado"];
const OS_ORDER_STATUS_VALUES = [
  "aberta",
  "aguardando_aprovacao",
  "aprovada",
  "em_reparo",
  "pronta",
  "entregue",
  "cancelada",
  "recusada",
];
const BUDGET_REQUEST_STATUS_VALUES = ["novo", "em_analise", "respondido", "cancelado"];

async function ensureEmpresaFinanceiroConfiguracaoTable(pool) {
  if (await hasTable(pool, "dbo.EmpresaFinanceiroConfiguracao")) return true;

  try {
    await pool.request().query(`
      CREATE TABLE dbo.EmpresaFinanceiroConfiguracao (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        EmpresaId INT NOT NULL,
        PercentualRetiradaDono DECIMAL(5,2) NOT NULL CONSTRAINT DF_EmpresaFinanceiroConfiguracao_Retirada DEFAULT(50),
        PercentualCaixa DECIMAL(5,2) NOT NULL CONSTRAINT DF_EmpresaFinanceiroConfiguracao_Caixa DEFAULT(30),
        PercentualDespesas DECIMAL(5,2) NOT NULL CONSTRAINT DF_EmpresaFinanceiroConfiguracao_Despesas DEFAULT(20),
        CriadoEm DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaFinanceiroConfiguracao_CriadoEm DEFAULT(${SQL_BRAZIL_NOW}),
        AtualizadoEm DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaFinanceiroConfiguracao_AtualizadoEm DEFAULT(${SQL_BRAZIL_NOW})
      );

      ALTER TABLE dbo.EmpresaFinanceiroConfiguracao
      ADD CONSTRAINT FK_EmpresaFinanceiroConfiguracao_Empresas
      FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);

      CREATE UNIQUE INDEX UX_EmpresaFinanceiroConfiguracao_Empresa
        ON dbo.EmpresaFinanceiroConfiguracao (EmpresaId);
    `);
    return true;
  } catch (err) {
    if (await hasTable(pool, "dbo.EmpresaFinanceiroConfiguracao")) return true;
    console.warn("Nao foi possivel garantir a tabela dbo.EmpresaFinanceiroConfiguracao:", err?.message || err);
    return false;
  }
}

async function ensureEmpresaDespesasTable(pool) {
  if (await hasTable(pool, "dbo.EmpresaDespesas")) return true;

  try {
    await pool.request().query(`
      CREATE TABLE dbo.EmpresaDespesas (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        EmpresaId INT NOT NULL,
        Descricao NVARCHAR(160) NOT NULL,
        Categoria NVARCHAR(60) NOT NULL,
        Valor DECIMAL(12,2) NOT NULL,
        DataDespesa DATE NOT NULL,
        Observacao NVARCHAR(500) NULL,
        CriadoEm DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaDespesas_CriadoEm DEFAULT(${SQL_BRAZIL_NOW}),
        AtualizadoEm DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaDespesas_AtualizadoEm DEFAULT(${SQL_BRAZIL_NOW})
      );

      ALTER TABLE dbo.EmpresaDespesas
      ADD CONSTRAINT FK_EmpresaDespesas_Empresas
      FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);

      CREATE INDEX IX_EmpresaDespesas_Empresa_Data
        ON dbo.EmpresaDespesas (EmpresaId, DataDespesa DESC, Id DESC);
    `);
    return true;
  } catch (err) {
    if (await hasTable(pool, "dbo.EmpresaDespesas")) return true;
    console.warn("Nao foi possivel garantir a tabela dbo.EmpresaDespesas:", err?.message || err);
    return false;
  }
}

function normalizeFinanceRule(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), 100);
}

function normalizeExpenseCategory(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
  return EXPENSE_CATEGORIES.includes(normalized) ? normalized : "outros";
}

function formatExpenseCategoryLabel(value) {
  const map = {
    aluguel: "Aluguel",
    manutencao: "Manutencao",
    reposicao_produtos: "Reposicao de produtos",
    agua_luz: "Agua/luz",
    internet: "Internet",
    marketing: "Marketing",
    outros: "Outros",
  };
  return map[value] || "Outros";
}

function normalizeOsDeviceType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return OS_DEVICE_TYPES.includes(normalized) ? normalized : "outro";
}

function normalizeOsEnumValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

function normalizeOsBudgetStatus(value) {
  const normalized = normalizeOsEnumValue(value);
  return OS_BUDGET_STATUS_VALUES.includes(normalized) ? normalized : "aguardando_aprovacao";
}

function normalizeOsOrderStatus(value) {
  const normalized = normalizeOsEnumValue(value);
  return OS_ORDER_STATUS_VALUES.includes(normalized) ? normalized : "aberta";
}

function getClientFriendlyOsStatus(value) {
  const status = normalizeOsOrderStatus(value);
  if (status === "aberta") return "Recebemos seu aparelho";
  if (status === "aguardando_aprovacao") return "Aguardando aprovacao";
  if (status === "aprovada") return "Aprovada";
  if (status === "em_reparo") return "Em manutencao";
  if (status === "pronta") return "Pronto para retirada";
  if (status === "entregue") return "Servico finalizado";
  if (status === "cancelada" || status === "recusada") return "Atendimento cancelado";
  return "Em andamento";
}

function isValidOsBudgetStatusInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  return OS_BUDGET_STATUS_VALUES.includes(normalizeOsEnumValue(value));
}

function isValidOsOrderStatusInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  return OS_ORDER_STATUS_VALUES.includes(normalizeOsEnumValue(value));
}

function normalizeCurrencyValue(value) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Number(parsed.toFixed(2));
}

function normalizeTextField(value, maxLength, { required = false } = {}) {
  const text = String(value || "").trim();
  if (!text) return required ? "" : null;
  return text.slice(0, maxLength);
}

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 20);
}

function isValidPhoneDigits(value) {
  const digits = normalizePhoneDigits(value);
  return digits.length >= 10;
}

function normalizeBudgetRequestStatus(value) {
  const normalized = normalizeOsEnumValue(value);
  return BUDGET_REQUEST_STATUS_VALUES.includes(normalized) ? normalized : "novo";
}

function isValidBudgetRequestStatusInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  return BUDGET_REQUEST_STATUS_VALUES.includes(normalizeOsEnumValue(value));
}

function mapBudgetRequestRecord(row) {
  if (!row) return null;
  return {
    Id: Number(row.Id || 0),
    EmpresaId: Number(row.EmpresaId || 0),
    Nome: String(row.Nome || ""),
    Telefone: String(row.Telefone || ""),
    TipoItem: row.TipoItem ? String(row.TipoItem) : null,
    Modelo: String(row.Modelo || ""),
    Defeito: String(row.Defeito || ""),
    Observacoes: row.Observacoes ? String(row.Observacoes) : null,
    Status: normalizeBudgetRequestStatus(row.Status),
    CriadoEm: row.CriadoEm ? String(row.CriadoEm) : null,
    AtualizadoEm: row.AtualizadoEm ? String(row.AtualizadoEm) : null,
  };
}

function buildOsNumber(id) {
  const numeric = Number(id || 0);
  const safe = Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  return `OS-${String(safe).padStart(6, "0")}`;
}

function mapOsRecord(row, { includeSensitive = false } = {}) {
  if (!row) return null;
  const valorMaoObra = Number(row.ValorMaoObra || 0);
  const valorMaterial = Number(row.ValorPecas || 0);
  const valorTotalRaw = Number(row.ValorTotal);
  const valorTotal = Number.isFinite(valorTotalRaw)
    ? valorTotalRaw
    : Number((valorMaoObra + valorMaterial).toFixed(2));
  const payload = {
    Id: Number(row.Id || 0),
    NumeroOS: buildOsNumber(row.Id),
    EmpresaId: Number(row.EmpresaId || 0),
    ClienteNome: String(row.ClienteNome || ""),
    ClienteTelefone: String(row.ClienteTelefone || ""),
    ClienteCpf: row.ClienteCpf ? String(row.ClienteCpf) : null,
    TipoAparelho: normalizeOsDeviceType(row.TipoAparelho),
    Marca: String(row.Marca || ""),
    Modelo: String(row.Modelo || ""),
    Cor: row.Cor ? String(row.Cor) : null,
    ImeiSerial: row.ImeiSerial ? String(row.ImeiSerial) : null,
    Acessorios: row.Acessorios ? String(row.Acessorios) : null,
    EstadoEntrada: String(row.EstadoEntrada || ""),
    DefeitoRelatado: String(row.DefeitoRelatado || ""),
    ObservacoesTecnicas: row.ObservacoesTecnicas ? String(row.ObservacoesTecnicas) : null,
    ValorMaoObra: valorMaoObra,
    ValorPecas: valorMaterial,
    ValorMaterial: valorMaterial,
    ValorTotal: valorTotal,
    PrazoEstimado: row.PrazoEstimado ? String(row.PrazoEstimado) : null,
    StatusOrcamento: normalizeOsBudgetStatus(row.StatusOrcamento),
    StatusOrdem: normalizeOsOrderStatus(row.StatusOrdem),
    DataEntrada: String(row.DataEntrada || ""),
    PrevisaoEntrega: row.PrevisaoEntrega ? String(row.PrevisaoEntrega) : null,
    ObservacoesGerais: row.ObservacoesGerais ? String(row.ObservacoesGerais) : null,
    ReceitaGerada: Boolean(row.ReceitaGerada),
    FinanceiroReceitaId: Number(row.FinanceiroReceitaId || 0) || null,
    ReceitaGeradaEm: row.ReceitaGeradaEm ? String(row.ReceitaGeradaEm) : null,
    CriadoEm: row.CriadoEm ? String(row.CriadoEm) : null,
    AtualizadoEm: row.AtualizadoEm ? String(row.AtualizadoEm) : null,
  };
  if (includeSensitive) {
    payload.SenhaPadrao = row.SenhaPadrao ? String(row.SenhaPadrao) : null;
  }
  return payload;
}

async function ensureEmpresaOrdensServicoTable(pool) {
  if (await hasTable(pool, "dbo.EmpresaOrdensServico")) return true;

  try {
    await pool.request().query(`
      CREATE TABLE dbo.EmpresaOrdensServico (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        EmpresaId INT NOT NULL,
        ClienteNome NVARCHAR(160) NOT NULL,
        ClienteTelefone NVARCHAR(30) NOT NULL,
        ClienteCpf NVARCHAR(20) NULL,
        TipoAparelho NVARCHAR(40) NOT NULL,
        Marca NVARCHAR(80) NOT NULL,
        Modelo NVARCHAR(120) NOT NULL,
        Cor NVARCHAR(40) NULL,
        ImeiSerial NVARCHAR(120) NULL,
        Acessorios NVARCHAR(300) NULL,
        SenhaPadrao NVARCHAR(120) NULL,
        EstadoEntrada NVARCHAR(1000) NOT NULL,
        DefeitoRelatado NVARCHAR(2000) NOT NULL,
        ObservacoesTecnicas NVARCHAR(2000) NULL,
        ValorMaoObra DECIMAL(12,2) NOT NULL CONSTRAINT DF_EmpresaOrdensServico_ValorMaoObra DEFAULT(0),
        ValorPecas DECIMAL(12,2) NOT NULL CONSTRAINT DF_EmpresaOrdensServico_ValorPecas DEFAULT(0),
        ValorTotal DECIMAL(12,2) NOT NULL CONSTRAINT DF_EmpresaOrdensServico_ValorTotal DEFAULT(0),
        PrazoEstimado NVARCHAR(120) NULL,
        StatusOrcamento NVARCHAR(40) NOT NULL CONSTRAINT DF_EmpresaOrdensServico_StatusOrcamento DEFAULT('aguardando_aprovacao'),
        StatusOrdem NVARCHAR(40) NOT NULL CONSTRAINT DF_EmpresaOrdensServico_StatusOrdem DEFAULT('aberta'),
        DataEntrada DATE NOT NULL,
        PrevisaoEntrega DATE NULL,
        ObservacoesGerais NVARCHAR(2000) NULL,
        CriadoEm DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaOrdensServico_CriadoEm DEFAULT(${SQL_BRAZIL_NOW}),
        AtualizadoEm DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaOrdensServico_AtualizadoEm DEFAULT(${SQL_BRAZIL_NOW})
      );

      ALTER TABLE dbo.EmpresaOrdensServico
      ADD CONSTRAINT FK_EmpresaOrdensServico_Empresas
      FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);

      CREATE INDEX IX_EmpresaOrdensServico_Empresa_DataEntrada
        ON dbo.EmpresaOrdensServico (EmpresaId, DataEntrada DESC, Id DESC);

      CREATE INDEX IX_EmpresaOrdensServico_Empresa_Status
        ON dbo.EmpresaOrdensServico (EmpresaId, StatusOrdem, Id DESC);
    `);
    await pool.request().query(`
      IF COL_LENGTH('dbo.EmpresaOrdensServico', 'ReceitaGerada') IS NULL
      BEGIN
        ALTER TABLE dbo.EmpresaOrdensServico
        ADD ReceitaGerada BIT NOT NULL
          CONSTRAINT DF_EmpresaOrdensServico_ReceitaGerada DEFAULT(0);
      END;

      IF COL_LENGTH('dbo.EmpresaOrdensServico', 'FinanceiroReceitaId') IS NULL
      BEGIN
        ALTER TABLE dbo.EmpresaOrdensServico
        ADD FinanceiroReceitaId INT NULL;
      END;

      IF COL_LENGTH('dbo.EmpresaOrdensServico', 'ReceitaGeradaEm') IS NULL
      BEGIN
        ALTER TABLE dbo.EmpresaOrdensServico
        ADD ReceitaGeradaEm DATETIME2(0) NULL;
      END;
    `);
    return true;
  } catch (err) {
    if (await hasTable(pool, "dbo.EmpresaOrdensServico")) return true;
    console.warn("Nao foi possivel garantir a tabela dbo.EmpresaOrdensServico:", err?.message || err);
    return false;
  }
}

async function ensureEmpresaOrcamentoSolicitacoesTable(pool) {
  if (await hasTable(pool, "dbo.EmpresaOrcamentoSolicitacoes")) return true;

  try {
    await pool.request().query(`
      CREATE TABLE dbo.EmpresaOrcamentoSolicitacoes (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        EmpresaId INT NOT NULL,
        Nome NVARCHAR(160) NOT NULL,
        Telefone NVARCHAR(30) NOT NULL,
        TipoItem NVARCHAR(120) NULL,
        Modelo NVARCHAR(160) NOT NULL,
        Defeito NVARCHAR(2000) NOT NULL,
        Observacoes NVARCHAR(2000) NULL,
        Status NVARCHAR(40) NOT NULL
          CONSTRAINT DF_EmpresaOrcamentoSolicitacoes_Status DEFAULT('novo'),
        CriadoEm DATETIME2(0) NOT NULL
          CONSTRAINT DF_EmpresaOrcamentoSolicitacoes_CriadoEm DEFAULT(${SQL_BRAZIL_NOW}),
        AtualizadoEm DATETIME2(0) NOT NULL
          CONSTRAINT DF_EmpresaOrcamentoSolicitacoes_AtualizadoEm DEFAULT(${SQL_BRAZIL_NOW})
      );

      ALTER TABLE dbo.EmpresaOrcamentoSolicitacoes
      ADD CONSTRAINT FK_EmpresaOrcamentoSolicitacoes_Empresas
        FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);

      CREATE INDEX IX_EmpresaOrcamentoSolicitacoes_Empresa_Status
        ON dbo.EmpresaOrcamentoSolicitacoes (EmpresaId, Status, CriadoEm DESC, Id DESC);

      CREATE INDEX IX_EmpresaOrcamentoSolicitacoes_Empresa_Data
        ON dbo.EmpresaOrcamentoSolicitacoes (EmpresaId, CriadoEm DESC, Id DESC);
    `);
    return true;
  } catch (err) {
    if (await hasTable(pool, "dbo.EmpresaOrcamentoSolicitacoes")) return true;
    console.warn("Nao foi possivel garantir a tabela dbo.EmpresaOrcamentoSolicitacoes:", err?.message || err);
    return false;
  }
}

async function ensureEmpresaFinanceiroReceitasTable(pool) {
  if (await hasTable(pool, "dbo.EmpresaFinanceiroReceitas")) return true;

  try {
    await pool.request().query(`
      CREATE TABLE dbo.EmpresaFinanceiroReceitas (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        EmpresaId INT NOT NULL,
        OrigemTipo NVARCHAR(40) NOT NULL,
        OrigemId INT NOT NULL,
        Referencia NVARCHAR(80) NULL,
        Descricao NVARCHAR(300) NOT NULL,
        Valor DECIMAL(12,2) NOT NULL,
        DataRef DATE NOT NULL,
        CriadoEm DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaFinanceiroReceitas_CriadoEm DEFAULT(${SQL_BRAZIL_NOW})
      );

      ALTER TABLE dbo.EmpresaFinanceiroReceitas
      ADD CONSTRAINT FK_EmpresaFinanceiroReceitas_Empresas
      FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);

      CREATE UNIQUE INDEX UX_EmpresaFinanceiroReceitas_Origem
        ON dbo.EmpresaFinanceiroReceitas (EmpresaId, OrigemTipo, OrigemId);

      CREATE INDEX IX_EmpresaFinanceiroReceitas_Empresa_Data
        ON dbo.EmpresaFinanceiroReceitas (EmpresaId, DataRef DESC, Id DESC);
    `);
    return true;
  } catch (err) {
    if (await hasTable(pool, "dbo.EmpresaFinanceiroReceitas")) return true;
    console.warn("Nao foi possivel garantir a tabela dbo.EmpresaFinanceiroReceitas:", err?.message || err);
    return false;
  }
}

async function ensureOsFinancialLinkColumns(pool) {
  const osReady = await ensureEmpresaOrdensServicoTable(pool);
  if (!osReady) return false;

  try {
    await pool.request().query(`
      IF COL_LENGTH('dbo.EmpresaOrdensServico', 'ReceitaGerada') IS NULL
      BEGIN
        ALTER TABLE dbo.EmpresaOrdensServico
        ADD ReceitaGerada BIT NOT NULL
          CONSTRAINT DF_EmpresaOrdensServico_ReceitaGerada DEFAULT(0);
      END;

      IF COL_LENGTH('dbo.EmpresaOrdensServico', 'FinanceiroReceitaId') IS NULL
      BEGIN
        ALTER TABLE dbo.EmpresaOrdensServico
        ADD FinanceiroReceitaId INT NULL;
      END;

      IF COL_LENGTH('dbo.EmpresaOrdensServico', 'ReceitaGeradaEm') IS NULL
      BEGIN
        ALTER TABLE dbo.EmpresaOrdensServico
        ADD ReceitaGeradaEm DATETIME2(0) NULL;
      END;
    `);
    return true;
  } catch (err) {
    console.warn("Nao foi possivel garantir colunas de vinculo OS/financeiro:", err?.message || err);
    return false;
  }
}

function isSqlDuplicateKeyError(err) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("duplicate key") || msg.includes("unique index") || msg.includes("2627") || msg.includes("2601");
}

async function createFinanceRevenueFromOs(txOrPool, orderRow) {
  if (!orderRow) return { ok: false, created: false, reason: "ordem_invalida" };

  const empresaId = Number(orderRow.EmpresaId || 0);
  const ordemId = Number(orderRow.Id || 0);
  const valorMaoObra = Number(orderRow.ValorMaoObra || 0);
  if (!empresaId || !ordemId) return { ok: false, created: false, reason: "ordem_invalida" };
  if (!Number.isFinite(valorMaoObra) || valorMaoObra <= 0) return { ok: false, created: false, reason: "valor_mao_obra_invalido" };

  const ready = await ensureEmpresaFinanceiroReceitasTable(txOrPool);
  const linksReady = await ensureOsFinancialLinkColumns(txOrPool);
  if (!ready || !linksReady) return { ok: false, created: false, reason: "estrutura_indisponivel" };

  const origemTipo = "ordem_servico";
  const referencia = buildOsNumber(ordemId);
  const descricao = `Ordem de Servico ${referencia} - ${String(orderRow.ClienteNome || "").slice(0, 80)} - ${String(orderRow.Marca || "").slice(0, 40)} ${String(orderRow.Modelo || "").slice(0, 40)}`.slice(0, 300);
  const dataRef = getBrazilNowInfo().ymd;

  try {
    const insertResult = await new sql.Request(txOrPool)
      .input("empresaId", sql.Int, empresaId)
      .input("origemTipo", sql.NVarChar(40), origemTipo)
      .input("origemId", sql.Int, ordemId)
      .input("referencia", sql.NVarChar(80), referencia)
      .input("descricao", sql.NVarChar(300), descricao)
      .input("valor", sql.Decimal(12, 2), Number(valorMaoObra.toFixed(2)))
      .input("dataRef", sql.Date, dataRef)
      .query(`
        INSERT INTO dbo.EmpresaFinanceiroReceitas (
          EmpresaId, OrigemTipo, OrigemId, Referencia, Descricao, Valor, DataRef, CriadoEm
        )
        VALUES (
          @empresaId, @origemTipo, @origemId, @referencia, @descricao, @valor, @dataRef, ${SQL_BRAZIL_NOW}
        );

        SELECT TOP 1
          Id,
          EmpresaId,
          OrigemTipo,
          OrigemId,
          Referencia,
          Descricao,
          Valor,
          CONVERT(varchar(10), DataRef, 23) AS DataRef,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm
        FROM dbo.EmpresaFinanceiroReceitas
        WHERE Id = SCOPE_IDENTITY();
      `);

    const receita = insertResult.recordset?.[0] || null;
    const receitaId = Number(receita?.Id || 0);
    if (receitaId > 0) {
      await new sql.Request(txOrPool)
        .input("empresaId", sql.Int, empresaId)
        .input("ordemId", sql.Int, ordemId)
        .input("receitaId", sql.Int, receitaId)
        .query(`
          UPDATE dbo.EmpresaOrdensServico
          SET
            ReceitaGerada = 1,
            FinanceiroReceitaId = @receitaId,
            ReceitaGeradaEm = ${SQL_BRAZIL_NOW},
            AtualizadoEm = ${SQL_BRAZIL_NOW}
          WHERE EmpresaId = @empresaId
            AND Id = @ordemId;
        `);
    }

    return { ok: true, created: true, receitaId: receitaId || null, receita: receita || null };
  } catch (err) {
    if (!isSqlDuplicateKeyError(err)) throw err;

    const existing = await new sql.Request(txOrPool)
      .input("empresaId", sql.Int, empresaId)
      .input("origemTipo", sql.NVarChar(40), origemTipo)
      .input("origemId", sql.Int, ordemId)
      .query(`
        SELECT TOP 1
          Id,
          EmpresaId,
          OrigemTipo,
          OrigemId,
          Referencia,
          Descricao,
          Valor,
          CONVERT(varchar(10), DataRef, 23) AS DataRef,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm
        FROM dbo.EmpresaFinanceiroReceitas
        WHERE EmpresaId = @empresaId
          AND OrigemTipo = @origemTipo
          AND OrigemId = @origemId;
      `);

    const receita = existing.recordset?.[0] || null;
    const receitaId = Number(receita?.Id || 0) || null;

    if (receitaId) {
      await new sql.Request(txOrPool)
        .input("empresaId", sql.Int, empresaId)
        .input("ordemId", sql.Int, ordemId)
        .input("receitaId", sql.Int, receitaId)
        .query(`
          UPDATE dbo.EmpresaOrdensServico
          SET
            ReceitaGerada = 1,
            FinanceiroReceitaId = @receitaId,
            ReceitaGeradaEm = ISNULL(ReceitaGeradaEm, ${SQL_BRAZIL_NOW}),
            AtualizadoEm = ${SQL_BRAZIL_NOW}
          WHERE EmpresaId = @empresaId
            AND Id = @ordemId;
        `);
    }

    return { ok: true, created: false, receitaId, receita };
  }
}

async function getEmpresaFinanceRules(pool, empresaId) {
  const ready = await ensureEmpresaFinanceiroConfiguracaoTable(pool);
  if (!ready) return { ...DEFAULT_FINANCE_RULES };

  const result = await pool
    .request()
    .input("empresaId", sql.Int, empresaId)
    .query(`
      SELECT TOP 1
        PercentualRetiradaDono,
        PercentualCaixa,
        PercentualDespesas
      FROM dbo.EmpresaFinanceiroConfiguracao
      WHERE EmpresaId = @empresaId;
    `);

  const row = result.recordset?.[0];
  if (!row) return { ...DEFAULT_FINANCE_RULES };

  return {
    owner: normalizeFinanceRule(row.PercentualRetiradaDono, DEFAULT_FINANCE_RULES.owner),
    cash: normalizeFinanceRule(row.PercentualCaixa, DEFAULT_FINANCE_RULES.cash),
    expenses: normalizeFinanceRule(row.PercentualDespesas, DEFAULT_FINANCE_RULES.expenses),
  };
}

async function upsertEmpresaFinanceRules(pool, empresaId, rules) {
  const ready = await ensureEmpresaFinanceiroConfiguracaoTable(pool);
  if (!ready) throw new Error("Estrutura de configuracao financeira indisponivel.");

  const owner = normalizeFinanceRule(rules.owner, DEFAULT_FINANCE_RULES.owner);
  const cash = normalizeFinanceRule(rules.cash, DEFAULT_FINANCE_RULES.cash);
  const expenses = normalizeFinanceRule(rules.expenses, DEFAULT_FINANCE_RULES.expenses);

  await pool
    .request()
    .input("empresaId", sql.Int, empresaId)
    .input("owner", sql.Decimal(5, 2), owner)
    .input("cash", sql.Decimal(5, 2), cash)
    .input("expenses", sql.Decimal(5, 2), expenses)
    .query(`
      MERGE dbo.EmpresaFinanceiroConfiguracao AS target
      USING (SELECT @empresaId AS EmpresaId) AS src
      ON target.EmpresaId = src.EmpresaId
      WHEN MATCHED THEN
        UPDATE SET
          PercentualRetiradaDono = @owner,
          PercentualCaixa = @cash,
          PercentualDespesas = @expenses,
          AtualizadoEm = ${SQL_BRAZIL_NOW}
      WHEN NOT MATCHED THEN
        INSERT (
          EmpresaId, PercentualRetiradaDono, PercentualCaixa, PercentualDespesas, CriadoEm, AtualizadoEm
        )
        VALUES (
          @empresaId, @owner, @cash, @expenses, ${SQL_BRAZIL_NOW}, ${SQL_BRAZIL_NOW}
        );
    `);

  return { owner, cash, expenses };
}

function normalizeNotificationProfessionalIds(rawIds) {
  if (!Array.isArray(rawIds)) return [];
  return [...new Set(
    rawIds
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
  )];
}

function parseNotificationBoolean(value, defaultValue = true) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return defaultValue;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return defaultValue;
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
    return defaultValue;
  }
  return defaultValue;
}

async function getValidNotificationProfessionalIds(pool, empresaId, profissionalIds) {
  const ids = normalizeNotificationProfessionalIds(profissionalIds);
  if (ids.length === 0) return [];

  const request = pool.request().input("empresaId", sql.Int, empresaId);
  const valuesSql = ids.map((id, index) => {
    request.input(`profissionalId${index}`, sql.Int, id);
    return `@profissionalId${index}`;
  });

  const result = await request.query(`
    SELECT Id
    FROM dbo.EmpresaProfissionais
    WHERE EmpresaId = @empresaId
      AND Id IN (${valuesSql.join(", ")});
  `);

  return (result.recordset || [])
    .map((row) => Number(row.Id))
    .filter((value) => Number.isFinite(value) && value > 0);
}

async function getNotificationDeviceProfessionalMap(pool, empresaId) {
  const ready = await ensureEmpresaNotificacaoDispositivoProfissionaisTable(pool);
  if (!ready) return new Map();

  const result = await pool
    .request()
    .input("empresaId", sql.Int, empresaId)
    .query(`
      SELECT
        DispositivoId,
        ProfissionalId
      FROM dbo.EmpresaNotificacaoDispositivoProfissionais
      WHERE EmpresaId = @empresaId;
    `);

  const map = new Map();
  for (const row of result.recordset || []) {
    const dispositivoId = Number(row.DispositivoId);
    const profissionalId = Number(row.ProfissionalId);
    if (!Number.isFinite(dispositivoId) || !Number.isFinite(profissionalId)) continue;
    const list = map.get(dispositivoId) || [];
    list.push(profissionalId);
    map.set(dispositivoId, list);
  }
  return map;
}

async function replaceNotificationDeviceProfessionalIds(txOrPool, { empresaId, dispositivoId, profissionalIds }) {
  const ids = normalizeNotificationProfessionalIds(profissionalIds);
  await new sql.Request(txOrPool)
    .input("empresaId", sql.Int, empresaId)
    .input("dispositivoId", sql.Int, dispositivoId)
    .query(`
    DELETE FROM dbo.EmpresaNotificacaoDispositivoProfissionais
    WHERE EmpresaId = @empresaId
      AND DispositivoId = @dispositivoId;
  `);

  if (ids.length === 0) return;

  const request = new sql.Request(txOrPool)
    .input("empresaId", sql.Int, empresaId)
    .input("dispositivoId", sql.Int, dispositivoId);

  const valuesSql = ids.map((id, index) => {
    request.input(`profissionalId${index}`, sql.Int, id);
    return `(@empresaId, @dispositivoId, @profissionalId${index}, ${SQL_BRAZIL_NOW})`;
  });

  await request.query(`
    INSERT INTO dbo.EmpresaNotificacaoDispositivoProfissionais
      (EmpresaId, DispositivoId, ProfissionalId, CriadoEm)
    VALUES
      ${valuesSql.join(",\n      ")};
  `);
}

async function insertEmpresaNotificacao(
  txOrPool,
  {
    empresaId,
    profissionalId = null,
    tipo,
    titulo,
    mensagem,
    referenciaTipo = null,
    referenciaId = null,
    dados = null,
  }
) {
  return new sql.Request(txOrPool)
    .input("empresaId", sql.Int, empresaId)
    .input("profissionalId", sql.Int, Number.isFinite(profissionalId) ? Number(profissionalId) : null)
    .input("tipo", sql.NVarChar(80), String(tipo || "").trim())
    .input("titulo", sql.NVarChar(160), String(titulo || "").trim())
    .input("mensagem", sql.NVarChar(1000), String(mensagem || "").trim())
    .input("referenciaTipo", sql.NVarChar(80), referenciaTipo ? String(referenciaTipo).trim() : null)
    .input("referenciaId", sql.Int, Number.isFinite(referenciaId) ? Number(referenciaId) : null)
    .input("dadosJson", sql.NVarChar(sql.MAX), dados ? JSON.stringify(dados) : null)
    .query(`
      INSERT INTO dbo.EmpresaNotificacoes
        (EmpresaId, ProfissionalId, Tipo, Titulo, Mensagem, ReferenciaTipo, ReferenciaId, DadosJson, CriadaEm)
      VALUES
        (@empresaId, @profissionalId, @tipo, @titulo, @mensagem, @referenciaTipo, @referenciaId, @dadosJson, ${SQL_BRAZIL_NOW});
    `);
}

async function getPreparedPushDevicesByEmpresa(pool, empresaId, profissionalId = null, pushType = "agendamento") {
  const mappingsReady = await ensureEmpresaNotificacaoDispositivoProfissionaisTable(pool);
  const useProfissionalFilter = mappingsReady && Number.isFinite(profissionalId);
  const preferenceColumn =
    String(pushType).trim().toLowerCase() === "lembrete"
      ? "RecebePushLembrete"
      : "RecebePushAgendamento";

  const result = await pool
    .request()
    .input("empresaId", sql.Int, empresaId)
    .input("profissionalId", sql.Int, useProfissionalFilter ? Number(profissionalId) : null)
    .query(`
      SELECT
        Id,
        DeviceId,
        NomeDispositivo,
        Endpoint,
        Auth,
        P256dh
      FROM dbo.EmpresaNotificacaoDispositivos
      WHERE EmpresaId = @empresaId
        AND Ativo = 1
        AND ${preferenceColumn} = 1
        AND NULLIF(LTRIM(RTRIM(Endpoint)), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(Auth)), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(P256dh)), '') IS NOT NULL
        ${useProfissionalFilter ? `
        AND (
          NOT EXISTS (
            SELECT 1
            FROM dbo.EmpresaNotificacaoDispositivoProfissionais dnp
            WHERE dnp.EmpresaId = dbo.EmpresaNotificacaoDispositivos.EmpresaId
              AND dnp.DispositivoId = dbo.EmpresaNotificacaoDispositivos.Id
          )
          OR EXISTS (
            SELECT 1
            FROM dbo.EmpresaNotificacaoDispositivoProfissionais dnp
            WHERE dnp.EmpresaId = dbo.EmpresaNotificacaoDispositivos.EmpresaId
              AND dnp.DispositivoId = dbo.EmpresaNotificacaoDispositivos.Id
              AND dnp.ProfissionalId = @profissionalId
          )
        )` : ""}
      ORDER BY AtualizadoEm DESC, Id DESC;
    `);

  return result.recordset || [];
}

async function deactivatePushDevice(pool, empresaId, deviceRowId) {
  await pool
    .request()
    .input("empresaId", sql.Int, empresaId)
    .input("id", sql.Int, deviceRowId)
    .query(`
      UPDATE dbo.EmpresaNotificacaoDispositivos
      SET
        Ativo = 0,
        AtualizadoEm = ${SQL_BRAZIL_NOW}
      WHERE Id = @id
        AND EmpresaId = @empresaId;
    `);
}

// pushType:
// - "agendamento": novo agendamento recebido
// - "lembrete": base preparada para futuros lembretes da Sheila
async function sendPushToEmpresaDevices(pool, { empresaId, payload, profissionalId = null, pushType = "agendamento" }) {
  if (!ensureWebPushConfigured()) return { eligible: 0, sent: 0 };

  const ready = await ensureEmpresaNotificacaoDispositivosTable(pool);
  if (!ready) return { eligible: 0, sent: 0 };

  const devices = await getPreparedPushDevicesByEmpresa(pool, empresaId, profissionalId, pushType);
  if (devices.length === 0) return { eligible: 0, sent: 0 };

  let sent = 0;

  await Promise.allSettled(
    devices.map(async (device) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: String(device.Endpoint),
            keys: {
              auth: String(device.Auth),
              p256dh: String(device.P256dh),
            },
          },
          JSON.stringify(payload)
        );
        sent += 1;
      } catch (err) {
        const statusCode = Number(err?.statusCode || 0);
        console.warn(
          "Falha ao enviar web push para dispositivo",
          device.Id,
          statusCode || "",
          err?.message || err
        );
        jobsLog.warn({
          message: "Falha no envio de web push",
          route: "jobs/sendPushToEmpresaDevices",
          empresaId,
          dispositivoId: Number(device?.Id || 0) || null,
          pushType,
          statusCode: statusCode || null,
          error: err?.message || String(err || ""),
        });

        if (statusCode === 404 || statusCode === 410) {
          await deactivatePushDevice(pool, empresaId, Number(device.Id));
          jobsLog.info({
            message: "Dispositivo desativado por subscription invalida/expirada",
            route: "jobs/sendPushToEmpresaDevices",
            empresaId,
            dispositivoId: Number(device?.Id || 0) || null,
            statusCode,
          });
        }
      }
    })
  );

  return { eligible: devices.length, sent };
}

async function listDuePushReminderAppointments(pool, { minutesBefore, lowerBoundMinutes, upperBoundMinutes, limit = 60 }) {
  const hasClienteWhatsapp = await hasColumn(pool, "dbo.Agendamentos", "ClienteWhatsapp");
  const hasClienteTelefone = await hasColumn(pool, "dbo.Agendamentos", "ClienteTelefone");
  const clienteContatoExpr = hasClienteWhatsapp
    ? "a.ClienteWhatsapp"
    : hasClienteTelefone
      ? "a.ClienteTelefone"
      : "CAST(NULL AS NVARCHAR(30))";

  const result = await pool
    .request()
    .input("minutesBefore", sql.Int, minutesBefore)
    .input("lowerBoundMinutes", sql.Int, lowerBoundMinutes)
    .input("upperBoundMinutes", sql.Int, upperBoundMinutes)
    .input("limit", sql.Int, limit)
    .query(`
      DECLARE @nowLocal DATETIME2(0) = ${SQL_BRAZIL_NOW};

      ;WITH Base AS (
        SELECT
          a.Id,
          a.EmpresaId,
          a.ProfissionalId,
          a.ClienteNome,
          ${clienteContatoExpr} AS ClienteContato,
          a.Servico,
          a.DataAgendada,
          a.HoraAgendada,
          e.Slug AS EmpresaSlug,
          DATEADD(
            MINUTE,
            DATEDIFF(MINUTE, CAST('00:00:00' AS time), CAST(a.HoraAgendada AS time)),
            CAST(a.DataAgendada AS DATETIME2(0))
          ) AS InicioEm
        FROM dbo.Agendamentos a
        INNER JOIN dbo.Empresas e ON e.Id = a.EmpresaId
        WHERE a.Status = 'confirmed'
      )
      SELECT TOP (@limit)
        b.Id,
        b.EmpresaId,
        b.ProfissionalId,
        b.ClienteNome,
        b.ClienteContato AS ClienteWhatsapp,
        b.Servico,
        CONVERT(varchar(10), b.DataAgendada, 23) AS DataAgendada,
        CONVERT(varchar(5), b.HoraAgendada, 108) AS HoraAgendada,
        b.EmpresaSlug,
        CONVERT(varchar(19), b.InicioEm, 120) AS InicioEm
      FROM Base b
      WHERE DATEDIFF(MINUTE, @nowLocal, b.InicioEm) BETWEEN @lowerBoundMinutes AND @upperBoundMinutes
        AND NOT EXISTS (
          SELECT 1
          FROM dbo.EmpresaPushLembretesEnviados l
          WHERE l.EmpresaId = b.EmpresaId
            AND l.AgendamentoId = b.Id
            AND l.MinutosAntes = @minutesBefore
            AND l.Tipo = 'whatsapp_lembrete'
        )
      ORDER BY b.InicioEm ASC, b.Id ASC;
    `);

  return result.recordset || [];
}

async function registerPushReminderSent(pool, { empresaId, agendamentoId, minutesBefore }) {
  await pool
    .request()
    .input("empresaId", sql.Int, empresaId)
    .input("agendamentoId", sql.Int, agendamentoId)
    .input("minutesBefore", sql.Int, minutesBefore)
    .query(`
      IF NOT EXISTS (
        SELECT 1
        FROM dbo.EmpresaPushLembretesEnviados
        WHERE EmpresaId = @empresaId
          AND AgendamentoId = @agendamentoId
          AND MinutosAntes = @minutesBefore
          AND Tipo = 'whatsapp_lembrete'
      )
      BEGIN
        INSERT INTO dbo.EmpresaPushLembretesEnviados
          (EmpresaId, AgendamentoId, MinutosAntes, Tipo, EnviadoEm)
        VALUES
          (@empresaId, @agendamentoId, @minutesBefore, 'whatsapp_lembrete', ${SQL_BRAZIL_NOW});
      END
    `);
}

let pushReminderJobRunning = false;
const pushReminderMetrics = {
  lastRunAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  lastFoundAppointments: 0,
  lastSentDevices: 0,
};

async function processPushReminderQueue() {
  if (!PUSH_REMINDER_ENABLED) return;
  if (pushReminderJobRunning) return;
  if (!isWebPushEnabled()) return;

  pushReminderJobRunning = true;
  pushReminderMetrics.lastRunAt = new Date().toISOString();
  jobsLog.info({
    message: "Inicio da execucao do job de lembretes push",
    route: "jobs/processPushReminderQueue",
    minutesBefore: PUSH_REMINDER_MINUTES_BEFORE,
    windowMinutes: PUSH_REMINDER_WINDOW_MINUTES,
    lateToleranceMinutes: PUSH_REMINDER_LATE_TOLERANCE_MINUTES,
  });
  try {
    const pool = await getPool();
    const ready = await ensureEmpresaPushLembretesEnviadosTable(pool);
    if (!ready) return;

    const lowerBoundMinutes = Math.max(
      1,
      PUSH_REMINDER_MINUTES_BEFORE - PUSH_REMINDER_WINDOW_MINUTES - PUSH_REMINDER_LATE_TOLERANCE_MINUTES
    );
    const upperBoundMinutes = PUSH_REMINDER_MINUTES_BEFORE + PUSH_REMINDER_WINDOW_MINUTES;
    const dueAppointments = await listDuePushReminderAppointments(pool, {
      minutesBefore: PUSH_REMINDER_MINUTES_BEFORE,
      lowerBoundMinutes,
      upperBoundMinutes,
      limit: 60,
    });
    pushReminderMetrics.lastFoundAppointments = dueAppointments.length;
    jobsLog.info({
      message: "Lembretes elegiveis localizados",
      route: "jobs/processPushReminderQueue",
      foundAppointments: dueAppointments.length,
      lowerBoundMinutes,
      upperBoundMinutes,
    });
    let sentDevicesAccumulator = 0;

    for (const appointment of dueAppointments) {
      const agendamentoId = Number(appointment.Id);
      const empresaId = Number(appointment.EmpresaId);
      if (!Number.isFinite(agendamentoId) || agendamentoId <= 0) continue;
      if (!Number.isFinite(empresaId) || empresaId <= 0) continue;

      const clienteNome = String(appointment.ClienteNome || "cliente").trim() || "cliente";
      const clienteWhatsapp = String(appointment.ClienteWhatsapp || "").trim();
      const servicoNome = String(appointment.Servico || "serviço").trim() || "serviço";
      const dataLabel = String(appointment.DataAgendada || "").trim();
      const horaLabel = String(appointment.HoraAgendada || "").trim();
      const empresaSlug = String(appointment.EmpresaSlug || "").trim();
      const profissionalId = Number(appointment.ProfissionalId);

      const bodyParts = [
        `${clienteNome}`,
        horaLabel ? `às ${horaLabel}` : "",
        dataLabel ? `(${dataLabel})` : "",
        `• ${servicoNome}`,
      ].filter(Boolean);

      const payload = {
        titulo: "Lembrete da Sheila",
        mensagem: `Você tem atendimento ${bodyParts.join(" ")}. Deseja avisar no WhatsApp?`,
        title: "Lembrete da Sheila",
        body: `Você tem atendimento ${bodyParts.join(" ")}. Deseja avisar no WhatsApp?`,
        referenciaTipo: "agendamento",
        referenciaId: agendamentoId,
        empresaId,
        slug: empresaSlug,
        clienteNome,
        clienteWhatsapp,
        tipo: "lembrete_whatsapp",
        url: `/admin/agendamentos?agendamento=${agendamentoId}&empresa=${encodeURIComponent(empresaSlug)}`,
      };

      const pushResult = await sendPushToEmpresaDevices(pool, {
        empresaId,
        payload,
        profissionalId: Number.isFinite(profissionalId) ? profissionalId : null,
        pushType: "lembrete",
      });
      sentDevicesAccumulator += Number(pushResult?.sent || 0);

      if (Number(pushResult?.sent || 0) > 0) {
        await registerPushReminderSent(pool, {
          empresaId,
          agendamentoId,
          minutesBefore: PUSH_REMINDER_MINUTES_BEFORE,
        });
        jobsLog.info({
          message: "Lembrete push registrado como enviado",
          route: "jobs/processPushReminderQueue",
          empresaId,
          agendamentoId,
          sentDevices: Number(pushResult?.sent || 0),
          eligibleDevices: Number(pushResult?.eligible || 0),
          minutesBefore: PUSH_REMINDER_MINUTES_BEFORE,
        });
      }
    }
    pushReminderMetrics.lastSentDevices = sentDevicesAccumulator;
    pushReminderMetrics.lastSuccessAt = new Date().toISOString();
    pushReminderMetrics.lastErrorAt = null;
    pushReminderMetrics.lastErrorMessage = null;
    jobsLog.info({
      message: "Fim da execucao do job de lembretes push",
      route: "jobs/processPushReminderQueue",
      foundAppointments: dueAppointments.length,
      sentDevices: sentDevicesAccumulator,
      success: true,
    });
  } catch (err) {
    console.warn("Falha no job de lembretes push:", err?.message || err);
    jobsLog.error({
      message: "Falha no job de lembretes push",
      route: "jobs/processPushReminderQueue",
      error: { message: err?.message, stack: err?.stack },
    });
    pushReminderMetrics.lastErrorAt = new Date().toISOString();
    pushReminderMetrics.lastErrorMessage = String(err?.message || err || "Erro desconhecido");
  } finally {
    pushReminderJobRunning = false;
  }
}

async function getServicoById(pool, empresaId, servicoId) {
  const result = await pool
    .request()
    .input("empresaId", sql.Int, empresaId)
    .input("servicoId", sql.Int, servicoId)
    .query(`
      SELECT TOP 1
        Id,
        EmpresaId,
        Nome,
        Descricao,
        DuracaoMin,
        Preco,
        Ativo
      FROM dbo.EmpresaServicos
      WHERE EmpresaId = @empresaId
        AND Id = @servicoId
    `);

  return result.recordset[0] || null;
}

async function getProfissionaisByEmpresa(pool, empresaId, onlyActive = false) {
  if (!(await hasTable(pool, "dbo.EmpresaProfissionais"))) return [];

  const hasWhatsapp = await ensureProfissionaisWhatsappColumn(pool);
  const activeWhere = onlyActive ? " AND Ativo = 1 " : "";
  const result = await pool
    .request()
    .input("empresaId", sql.Int, empresaId)
    .query(`
      SELECT
        Id,
        EmpresaId,
        Nome,
        ${hasWhatsapp ? "Whatsapp" : "CAST(NULL AS varchar(20)) AS Whatsapp"},
        Ativo,
        CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm
      FROM dbo.EmpresaProfissionais
      WHERE EmpresaId = @empresaId
      ${activeWhere}
      ORDER BY Nome ASC;
    `);

  return result.recordset || [];
}

async function getProfissionalById(pool, empresaId, profissionalId) {
  if (!(await hasTable(pool, "dbo.EmpresaProfissionais"))) return null;

  const hasWhatsapp = await ensureProfissionaisWhatsappColumn(pool);
  const result = await pool
    .request()
    .input("empresaId", sql.Int, empresaId)
    .input("id", sql.Int, profissionalId)
    .query(`
      SELECT TOP 1
        Id,
        EmpresaId,
        Nome,
        ${hasWhatsapp ? "Whatsapp" : "CAST(NULL AS varchar(20)) AS Whatsapp"},
        Ativo
      FROM dbo.EmpresaProfissionais
      WHERE EmpresaId = @empresaId
        AND Id = @id;
    `);

  return result.recordset?.[0] || null;
}

async function ensureProfissionaisWhatsappColumn(pool) {
  if (!(await hasTable(pool, "dbo.EmpresaProfissionais"))) return false;
  if (await hasColumn(pool, "dbo.EmpresaProfissionais", "Whatsapp")) return true;

  try {
    await pool.request().query(`
      ALTER TABLE dbo.EmpresaProfissionais
      ADD Whatsapp VARCHAR(20) NULL;
    `);
    return true;
  } catch (err) {
    console.warn("Não foi possível criar coluna Whatsapp em dbo.EmpresaProfissionais:", err?.message || err);
    return false;
  }
}


async function getProfissionalServicosIds(pool, empresaId, profissionalId) {
  if (!(await hasTable(pool, "dbo.EmpresaProfissionalServicos"))) return null;

  const result = await pool
    .request()
    .input("empresaId", sql.Int, empresaId)
    .input("profissionalId", sql.Int, profissionalId)
    .query(`
      SELECT ServicoId
      FROM dbo.EmpresaProfissionalServicos
      WHERE EmpresaId = @empresaId
        AND ProfissionalId = @profissionalId;
    `);

  return (result.recordset || []).map((r) => Number(r.ServicoId)).filter((id) => Number.isFinite(id));
}

async function getProfissionalHorarios(pool, empresaId, profissionalId) {
  if (!(await hasTable(pool, "dbo.EmpresaProfissionaisHorarios"))) return [];
  await ensureProfissionaisHorariosIntervalColumns(pool);

  const result = await pool
    .request()
    .input("empresaId", sql.Int, empresaId)
    .input("profissionalId", sql.Int, profissionalId)
    .query(`
      SELECT
        DiaSemana,
        Ativo,
        HoraInicio,
        HoraFim,
        ISNULL(IntervaloAtivo, 0) AS IntervaloAtivo,
        IntervaloInicio,
        IntervaloFim
      FROM dbo.EmpresaProfissionaisHorarios
      WHERE EmpresaId = @empresaId
        AND ProfissionalId = @profissionalId
      ORDER BY DiaSemana ASC;
    `);

  return result.recordset || [];
}

async function updateServicoByEmpresa(pool, empresaId, servicoId, payload) {
  const { Nome, Descricao, DuracaoMin, Preco, Ativo } = payload;

  const dur = Number(DuracaoMin);
  const preco = Number(Preco);
  const ativo = Ativo === false ? 0 : 1;

  if (typeof Nome !== "string" || !Nome.trim()) {
    return { error: "Nome é obrigatório.", code: 400 };
  }
  if (typeof Descricao !== "string" || !Descricao.trim()) {
    return { error: "Descricao é obrigatória.", code: 400 };
  }
  if (!Number.isFinite(dur) || dur <= 0) {
    return { error: "DuracaoMin inválida.", code: 400 };
  }
  if (!isAllowedServiceDuration(dur)) {
    return {
      error: `DuracaoMin inválida. Use apenas: ${getAllowedServiceDurationsLabel()} minutos.`,
      code: 400,
    };
  }
  if (!Number.isFinite(preco) || preco < 0) {
    return { error: "Preco inválido.", code: 400 };
  }

  const result = await pool
    .request()
    .input("id", sql.Int, servicoId)
    .input("empresaId", sql.Int, empresaId)
    .input("nome", sql.NVarChar(200), Nome.trim())
    .input("descricao", sql.NVarChar(500), Descricao.trim())
    .input("dur", sql.Int, dur)
    .input("preco", sql.Decimal(10, 2), preco)
    .input("ativo", sql.Bit, ativo)
    .query(`
      UPDATE dbo.EmpresaServicos
      SET
        Nome = @nome,
        Descricao = @descricao,
        DuracaoMin = @dur,
        Preco = @preco,
        Ativo = @ativo
      WHERE Id = @id
        AND EmpresaId = @empresaId;

      SELECT TOP 1
        Id, EmpresaId, Nome, Descricao, DuracaoMin, Preco, Ativo, CriadoEm
      FROM dbo.EmpresaServicos
      WHERE Id = @id
        AND EmpresaId = @empresaId;
    `);

  return { servico: result.recordset[0] || null };
}

async function deleteServicoByEmpresa(pool, empresaId, servicoId) {
  const del = await pool
    .request()
    .input("id", sql.Int, servicoId)
    .input("empresaId", sql.Int, empresaId)
    .query(`
      DELETE FROM dbo.EmpresaServicos
      WHERE Id = @id
        AND EmpresaId = @empresaId;

      SELECT @@ROWCOUNT AS rows;
    `);

  return Number(del.recordset?.[0]?.rows ?? 0);
}

function isValidDateYYYYMMDD(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTimeHHMM(value) {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value);
}

const APPOINTMENT_SLOT_STEP_MIN = 30;
const ALLOWED_SERVICE_DURATIONS_MIN = new Set([30, 60, 90, 120, 150, 180]);

function getAllowedServiceDurationsLabel() {
  return Array.from(ALLOWED_SERVICE_DURATIONS_MIN).sort((a, b) => a - b).join(", ");
}

function isAllowedServiceDuration(value) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && ALLOWED_SERVICE_DURATIONS_MIN.has(Math.floor(minutes));
}

function isTimeAlignedToSlotStep(hhmm, stepMin = APPOINTMENT_SLOT_STEP_MIN) {
  if (!isValidTimeHHMM(hhmm)) return false;
  const totalMinutes = timeToMinutes(hhmm);
  return totalMinutes % stepMin === 0;
}

async function ensureProfissionaisHorariosIntervalColumns(pool) {
  if (!(await hasTable(pool, "dbo.EmpresaProfissionaisHorarios"))) return false;

  try {
    await pool.request().query(`
      IF COL_LENGTH('dbo.EmpresaProfissionaisHorarios', 'IntervaloAtivo') IS NULL
      BEGIN
        ALTER TABLE dbo.EmpresaProfissionaisHorarios
        ADD IntervaloAtivo BIT NOT NULL
          CONSTRAINT DF_EmpresaProfissionaisHorarios_IntervaloAtivo DEFAULT(0);
      END;

      IF COL_LENGTH('dbo.EmpresaProfissionaisHorarios', 'IntervaloInicio') IS NULL
      BEGIN
        ALTER TABLE dbo.EmpresaProfissionaisHorarios
        ADD IntervaloInicio VARCHAR(5) NULL;
      END;

      IF COL_LENGTH('dbo.EmpresaProfissionaisHorarios', 'IntervaloFim') IS NULL
      BEGIN
        ALTER TABLE dbo.EmpresaProfissionaisHorarios
        ADD IntervaloFim VARCHAR(5) NULL;
      END;
    `);
    return true;
  } catch (err) {
    console.warn(
      "Nao foi possivel garantir colunas de intervalo em dbo.EmpresaProfissionaisHorarios:",
      err?.message || err
    );
    return false;
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function minutesToHHMM(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

function overlapsMin(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function normalizeProfissionalHorarioRow(row) {
  const inicioStr = String(row?.HoraInicio || "09:00").slice(0, 5);
  const fimStr = String(row?.HoraFim || "18:00").slice(0, 5);
  const inicioMin = timeToMinutes(inicioStr);
  const fimMin = timeToMinutes(fimStr);

  const intervaloAtivo = Boolean(row?.IntervaloAtivo);
  const intervaloInicioStr = String(row?.IntervaloInicio || "").slice(0, 5);
  const intervaloFimStr = String(row?.IntervaloFim || "").slice(0, 5);
  const intervaloInicioMin = isValidTimeHHMM(intervaloInicioStr) ? timeToMinutes(intervaloInicioStr) : null;
  const intervaloFimMin = isValidTimeHHMM(intervaloFimStr) ? timeToMinutes(intervaloFimStr) : null;

  const intervaloValido =
    intervaloAtivo &&
    Number.isFinite(intervaloInicioMin) &&
    Number.isFinite(intervaloFimMin) &&
    intervaloInicioMin < intervaloFimMin &&
    intervaloInicioMin >= inicioMin &&
    intervaloFimMin <= fimMin;

  return {
    ativo: Boolean(row?.Ativo),
    inicioStr,
    fimStr,
    inicioMin,
    fimMin,
    intervaloAtivo: Boolean(intervaloValido),
    intervaloInicioStr: intervaloValido ? intervaloInicioStr : null,
    intervaloFimStr: intervaloValido ? intervaloFimStr : null,
    intervaloInicioMin: intervaloValido ? intervaloInicioMin : null,
    intervaloFimMin: intervaloValido ? intervaloFimMin : null,
  };
}

function validateProfissionalHorarioPayload(payload) {
  const dia = Number(payload?.DiaSemana);
  const ativo = payload?.Ativo === false ? 0 : 1;
  const inicio = String(payload?.HoraInicio || "09:00").slice(0, 5);
  const fim = String(payload?.HoraFim || "18:00").slice(0, 5);
  const intervaloAtivo = payload?.IntervaloAtivo === true;
  const intervaloInicioRaw = String(payload?.IntervaloInicio || "").slice(0, 5);
  const intervaloFimRaw = String(payload?.IntervaloFim || "").slice(0, 5);

  if (!Number.isFinite(dia) || dia < 0 || dia > 6) {
    return { ok: false, error: `DiaSemana inválido (${payload?.DiaSemana}).` };
  }
  if (!isValidTimeHHMM(inicio) || !isValidTimeHHMM(fim)) {
    return { ok: false, error: `Horário inválido no dia ${dia}.` };
  }

  const inicioMin = timeToMinutes(inicio);
  const fimMin = timeToMinutes(fim);
  if (fimMin <= inicioMin) {
    return { ok: false, error: `HoraFim deve ser maior que HoraInicio no dia ${dia}.` };
  }

  if (!intervaloAtivo) {
    return {
      ok: true,
      horario: {
        DiaSemana: dia,
        Ativo: ativo,
        HoraInicio: inicio,
        HoraFim: fim,
        IntervaloAtivo: 0,
        IntervaloInicio: null,
        IntervaloFim: null,
      },
    };
  }

  if (!isValidTimeHHMM(intervaloInicioRaw) || !isValidTimeHHMM(intervaloFimRaw)) {
    return { ok: false, error: `Intervalo inválido no dia ${dia}.` };
  }

  const intervaloInicioMin = timeToMinutes(intervaloInicioRaw);
  const intervaloFimMin = timeToMinutes(intervaloFimRaw);
  if (intervaloFimMin <= intervaloInicioMin) {
    return { ok: false, error: `Fim do intervalo deve ser maior que início no dia ${dia}.` };
  }
  if (intervaloInicioMin < inicioMin || intervaloFimMin > fimMin) {
    return { ok: false, error: `Intervalo deve estar dentro do expediente no dia ${dia}.` };
  }

  return {
    ok: true,
    horario: {
      DiaSemana: dia,
      Ativo: ativo,
      HoraInicio: inicio,
      HoraFim: fim,
      IntervaloAtivo: 1,
      IntervaloInicio: intervaloInicioRaw,
      IntervaloFim: intervaloFimRaw,
    },
  };
}


function toIsoDateOnly(value) {
  if (!value) return null;
  const str = String(value);
  return str.slice(0, 10);
}

function getLocalDateYMD(baseDate = new Date()) {
  const y = baseDate.getFullYear();
  const m = String(baseDate.getMonth() + 1).padStart(2, "0");
  const d = String(baseDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getBrazilNowInfo() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const map = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  const ymd = `${map.year}-${map.month}-${map.day}`;
  const hour = Number(map.hour || 0);
  const minute = Number(map.minute || 0);
  return {
    ymd,
    nowMin: hour * 60 + minute,
  };
}

function normalizeVoiceText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTomorrowYMD(baseDate = new Date()) {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + 1);
  return getLocalDateYMD(next);
}

function getDateOffsetYMD(baseDate = new Date(), offsetDays = 0) {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + offsetDays);
  return getLocalDateYMD(next);
}

function parseVoiceDateFromText(text, baseDate = new Date()) {
  const normalizedText = normalizeVoiceText(text);

  if (normalizedText.includes("hoje")) {
    return { date: getDateOffsetYMD(baseDate, 0), label: "hoje" };
  }

  if (normalizedText.includes("amanha")) {
    return { date: getDateOffsetYMD(baseDate, 1), label: "amanha" };
  }

  const monthMap = {
    janeiro: 1,
    fevereiro: 2,
    marco: 3,
    abril: 4,
    maio: 5,
    junho: 6,
    julho: 7,
    agosto: 8,
    setembro: 9,
    outubro: 10,
    novembro: 11,
    dezembro: 12,
  };

  const monthNameMatch = normalizedText.match(/(?:dia\s+)?(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?/);
  if (monthNameMatch) {
    const day = Number(monthNameMatch[1]);
    const month = monthMap[monthNameMatch[2]];
    const year = monthNameMatch[3] ? Number(monthNameMatch[3]) : baseDate.getFullYear();
    const dt = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (!Number.isNaN(dt.getTime()) && dt.getDate() === day && dt.getMonth() === month - 1) {
      return { date: getLocalDateYMD(dt), label: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}` };
    }
  }

  const numericMatch = normalizedText.match(/(?:dia\s+)?(\d{1,2})(?:[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?)?/);
  if (numericMatch) {
    const day = Number(numericMatch[1]);
    const explicitMonth = numericMatch[2] ? Number(numericMatch[2]) : null;
    const explicitYear = numericMatch[3]
      ? Number(numericMatch[3].length === 2 ? `20${numericMatch[3]}` : numericMatch[3])
      : null;

    let month = explicitMonth || baseDate.getMonth() + 1;
    let year = explicitYear || baseDate.getFullYear();

    if (!explicitMonth) {
      const candidate = new Date(year, month - 1, day, 12, 0, 0, 0);
      const today = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 12, 0, 0, 0);
      if (!Number.isNaN(candidate.getTime()) && candidate < today) {
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
    }

    const dt = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (!Number.isNaN(dt.getTime()) && dt.getDate() === day && dt.getMonth() === month - 1) {
      return { date: getLocalDateYMD(dt), label: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}` };
    }
  }

  return null;
}

function detectVoiceIntent(normalizedText) {
  if (
    normalizedText.includes("cancelar") ||
    normalizedText.includes("cancelamento")
  ) {
    return "cancelar_agendamento";
  }

  if (
    normalizedText.includes("meus registros") ||
    normalizedText.includes("registros recentes") ||
    normalizedText.includes("meus agendamentos") ||
    normalizedText.includes("status do meu agendamento") ||
    normalizedText.includes("ver registros")
  ) {
    return "ver_registros";
  }

  if (
    normalizedText.includes("falar com atendente") ||
    normalizedText.includes("falar com prestador") ||
    normalizedText.includes("falar com o prestador") ||
    normalizedText.includes("contato do prestador") ||
    normalizedText.includes("whatsapp do prestador") ||
    normalizedText.includes("whatsapp do atendimento")
  ) {
    return "falar_com_atendente";
  }

  if (normalizedText.includes("orcamento")) {
    return "solicitar_orcamento";
  }

  if (
    normalizedText.includes("servicos") ||
    normalizedText.includes("servico")
  ) {
    const asksAvailability =
      normalizedText.includes("horario") ||
      normalizedText.includes("horarios") ||
      normalizedText.includes("disponivel") ||
      normalizedText.includes("disponiveis") ||
      normalizedText.includes("agendar") ||
      normalizedText.includes("marcar");

    if (!asksAvailability) {
      return "ver_servicos";
    }
  }

  const wantsBooking =
    normalizedText.includes("agendar") ||
    normalizedText.includes("marcar") ||
    normalizedText.includes("reservar");

  const asksAvailability =
    wantsBooking ||
    normalizedText.includes("horario") ||
    normalizedText.includes("horarios") ||
    normalizedText.includes("disponivel") ||
    normalizedText.includes("disponiveis");

  if (asksAvailability) {
    return wantsBooking ? "agendar_servico" : "consultar_horarios";
  }

  return "desconhecido";
}

async function getActiveServicosByEmpresa(pool, empresaId) {
  const result = await pool
    .request()
    .input("empresaId", sql.Int, empresaId)
    .query(`
      SELECT Id, Nome, Descricao, DuracaoMin, Preco, Ativo
      FROM dbo.EmpresaServicos
      WHERE EmpresaId = @empresaId
        AND Ativo = 1
      ORDER BY Nome ASC;
    `);

  return result.recordset || [];
}

function findVoiceMatchedServices(servicos, text) {
  const normalizedText = normalizeVoiceText(text);
  const serviceEntries = servicos.map((servico) => ({
    servico,
    normalizedName: normalizeVoiceText(servico.Nome),
  }));

  const exactMatches = serviceEntries
    .filter((entry) => entry.normalizedName && normalizedText.includes(entry.normalizedName))
    .sort((a, b) => b.normalizedName.length - a.normalizedName.length);

  if (exactMatches.length > 0) {
    const selected = [];
    for (const entry of exactMatches) {
      const covered = selected.some((item) => item.normalizedName.includes(entry.normalizedName));
      if (!covered) selected.push(entry);
    }
    return selected.map((entry) => entry.servico);
  }

  const ignoredWords = new Set(["de", "do", "da", "e", "para", "com", "o", "a"]);
  const scoredMatches = serviceEntries
    .map((entry) => {
      const tokens = entry.normalizedName
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !ignoredWords.has(token));
      const score = tokens.filter((token) => normalizedText.includes(token)).length;
      return { ...entry, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.normalizedName.length - a.normalizedName.length);

  if (scoredMatches.length > 3) {
    return [];
  }

  return scoredMatches.map((entry) => entry.servico);
}

async function getEligibleProfessionalsForServices(pool, empresaId, servicoIds) {
  const profissionaisAtivos = await getProfissionaisByEmpresa(pool, empresaId, true);
  if (profissionaisAtivos.length <= 1) return profissionaisAtivos;
  if (!(await hasTable(pool, "dbo.EmpresaProfissionalServicos"))) return profissionaisAtivos;

  const eligible = [];
  for (const profissional of profissionaisAtivos) {
    const allowedIds = await getProfissionalServicosIds(pool, empresaId, Number(profissional.Id));
    if (Array.isArray(allowedIds) && servicoIds.every((sid) => allowedIds.includes(Number(sid)))) {
      eligible.push(profissional);
    }
  }

  return eligible;
}

async function calculateAvailabilitySlots(
  pool,
  empresa,
  {
    data,
    durationMin,
    profissional = null,
    startHour = 8,
    endHour = 18,
    disableProfissionalFilter = false,
  }
) {
  const bloqueioDia = await pool
    .request()
    .input("empresaId", sql.Int, empresa.Id)
    .input("data", sql.Date, data)
    .query(`
      SELECT TOP 1 Motivo
      FROM dbo.AgendaBloqueios
      WHERE EmpresaId = @empresaId
        AND Data = @data;
    `);

  if (bloqueioDia.recordset?.length) {
    return {
      ok: true,
      empresaId: empresa.Id,
      data,
      blocked: true,
      motivo: bloqueioDia.recordset[0]?.Motivo || null,
      profissional: profissional ? { Id: profissional.Id, Nome: profissional.Nome } : null,
      slots: [],
    };
  }

  let dayStartMin = startHour * 60;
  let dayEndMin = endHour * 60;
  let intervaloInicioMin = null;
  let intervaloFimMin = null;
  let scheduleProfissionalId = null;

  if (profissional) {
    scheduleProfissionalId = Number(profissional.Id);
  } else {
    const ativos = await getProfissionaisByEmpresa(pool, empresa.Id, true);
    if (ativos.length === 0) {
      scheduleProfissionalId = 0;
    }
  }

  if (Number.isFinite(scheduleProfissionalId) && (await hasTable(pool, "dbo.EmpresaProfissionaisHorarios"))) {
    await ensureProfissionaisHorariosIntervalColumns(pool);
    const dateObj = new Date(`${String(data)}T12:00:00`);
    const diaSemana = Number.isNaN(dateObj.getTime()) ? null : dateObj.getDay();
    if (Number.isFinite(diaSemana)) {
      const dayRowRes = await pool
        .request()
        .input("empresaId", sql.Int, empresa.Id)
        .input("profissionalId", sql.Int, Number(scheduleProfissionalId))
        .input("diaSemana", sql.Int, Number(diaSemana))
        .query(`
          SELECT TOP 1 DiaSemana, Ativo, HoraInicio, HoraFim, ISNULL(IntervaloAtivo, 0) AS IntervaloAtivo, IntervaloInicio, IntervaloFim
          FROM dbo.EmpresaProfissionaisHorarios
          WHERE EmpresaId = @empresaId
            AND ProfissionalId = @profissionalId
            AND DiaSemana = @diaSemana;
        `);

      const dayRow = dayRowRes.recordset?.[0];
        if (dayRow) {
          const dayNormalized = normalizeProfissionalHorarioRow(dayRow);
          if (!dayNormalized.ativo) {
            return {
              ok: true,
              empresaId: empresa.Id,
            data,
            profissional: { Id: profissional.Id, Nome: profissional.Nome },
              slots: [],
            };
          }

          dayStartMin = dayNormalized.inicioMin;
          dayEndMin = dayNormalized.fimMin;
          if (dayNormalized.intervaloAtivo) {
            intervaloInicioMin = dayNormalized.intervaloInicioMin;
            intervaloFimMin = dayNormalized.intervaloFimMin;
          }
        }
      }
    }

  const shouldFilterByProfissional =
    !disableProfissionalFilter && profissional ? 1 : 0;

  const bookedReq = pool
    .request()
    .input("empresaId", sql.Int, empresa.Id)
    .input("data", sql.Date, data);

  if (shouldFilterByProfissional) {
    bookedReq.input("profissionalId", sql.Int, Number(profissional.Id));
  }

  const profissionalWhere = shouldFilterByProfissional
    ? "AND ProfissionalId = @profissionalId"
    : "";

  const bookedRes = await bookedReq.query(`
      SELECT
        Id,
        DuracaoMin,
        (DATEPART(HOUR, HoraAgendada) * 60 + DATEPART(MINUTE, HoraAgendada)) AS StartMin,
        (DATEPART(HOUR, HoraAgendada) * 60 + DATEPART(MINUTE, HoraAgendada) + DuracaoMin) AS EndMin
      FROM dbo.Agendamentos
      WHERE EmpresaId = @empresaId
        AND DataAgendada = @data
        AND Status IN (N'pending', N'confirmed')
        ${profissionalWhere}
      ORDER BY HoraAgendada ASC;
  `);

  const booked = bookedRes.recordset || [];
  const startMin = dayStartMin;
  const endMin = dayEndMin;
  const slotStepMin = APPOINTMENT_SLOT_STEP_MIN;
  const brazilNow = getBrazilNowInfo();
  const isToday = String(data) === brazilNow.ymd;
  const nowMin = brazilNow.nowMin;
  const slots = [];

  for (let t = startMin; t + durationMin <= endMin; t += slotStepMin) {
    const candStart = t;
    const candEnd = t + durationMin;

    if (isToday && candStart <= nowMin) continue;

    const hasConflict = booked.some((apt) =>
      overlapsMin(candStart, candEnd, Number(apt.StartMin), Number(apt.EndMin))
    );

    const collidesWithBreak =
      Number.isFinite(intervaloInicioMin) &&
      Number.isFinite(intervaloFimMin) &&
      overlapsMin(candStart, candEnd, Number(intervaloInicioMin), Number(intervaloFimMin));

    if (collidesWithBreak) continue;
    if (!hasConflict) slots.push(minutesToHHMM(t));
  }

  return {
    ok: true,
    empresaId: empresa.Id,
    data,
    profissional: profissional ? { Id: profissional.Id, Nome: profissional.Nome } : null,
    slots,
  };
}

function parseYMDToLocalDate(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function addDaysLocalDate(baseDate, days) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function getInclusiveDaysBetween(startYmd, endYmd) {
  const start = parseYMDToLocalDate(startYmd);
  const end = parseYMDToLocalDate(endYmd);
  if (!start || !end) return 0;
  const startAtMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
  const endAtMidnight = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0);
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.floor((endAtMidnight.getTime() - startAtMidnight.getTime()) / msPerDay) + 1;
  return diff > 0 ? diff : 0;
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function extractHHMM(value) {
  if (!value) return "";
  const str = String(value);
  if (/^\d{2}:\d{2}$/.test(str)) return str;

  const match = str.match(/T(\d{2}:\d{2})/) || str.match(/\s(\d{2}:\d{2})/);
  return match?.[1] || str.slice(11, 16) || "";
}

function getStartOfWeekDate(baseDate) {
  const d = new Date(baseDate);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getEndOfWeekDate(baseDate) {
  const start = getStartOfWeekDate(baseDate);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function getStartOfMonthDate(baseDate) {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getEndOfMonthDate(baseDate) {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}

function isSqlMissingObjectError(err) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("invalid object name") || msg.includes("financeirodiario");
}

async function recomputeFinanceiroDiarioForDate(txOrPool, empresaId, dataRef) {
  if (!empresaId || !dataRef) return;
  const agColumns = await getAgendamentosColumns(txOrPool);
  const receitaExpr = agColumns.has("ValorFinal")
    ? "ISNULL(a.ValorFinal, ISNULL(es.Preco, 0))"
    : "ISNULL(es.Preco, 0)";

  const agg = await new sql.Request(txOrPool)
    .input("empresaId", sql.Int, empresaId)
    .input("dataRef", sql.Date, dataRef)
    .query(`
      SELECT
        CONVERT(varchar(10), a.DataAgendada, 23) AS DataRef,
        COUNT(1) AS QtdConcluidos,
        SUM(${receitaExpr}) AS ReceitaConcluida
      FROM dbo.Agendamentos a
      LEFT JOIN dbo.EmpresaServicos es
        ON es.EmpresaId = a.EmpresaId
       AND es.Id = a.ServicoId
      WHERE a.EmpresaId = @empresaId
        AND a.DataAgendada = @dataRef
        AND LTRIM(RTRIM(a.Status)) = N'completed'
      GROUP BY a.DataAgendada;
    `);

  const row = agg.recordset?.[0];
  const qtdConcluidos = Number(row?.QtdConcluidos || 0);
  const receitaConcluida = Number(row?.ReceitaConcluida || 0);

  if (qtdConcluidos <= 0 && receitaConcluida <= 0) {
    await new sql.Request(txOrPool)
      .input("empresaId", sql.Int, empresaId)
      .input("dataRef", sql.Date, dataRef)
      .query(`
        DELETE FROM dbo.FinanceiroDiario
        WHERE EmpresaId = @empresaId
          AND DataRef = @dataRef;
      `);
    return;
  }

  await new sql.Request(txOrPool)
    .input("empresaId", sql.Int, empresaId)
    .input("dataRef", sql.Date, dataRef)
    .input("qtd", sql.Int, qtdConcluidos)
    .input("receita", sql.Decimal(12, 2), receitaConcluida)
    .query(`
      MERGE dbo.FinanceiroDiario AS target
      USING (SELECT @empresaId AS EmpresaId, @dataRef AS DataRef) AS src
      ON target.EmpresaId = src.EmpresaId AND target.DataRef = src.DataRef
      WHEN MATCHED THEN
        UPDATE SET
          QtdConcluidos = @qtd,
          ReceitaConcluida = @receita,
          AtualizadoEm = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (EmpresaId, DataRef, QtdConcluidos, ReceitaConcluida, AtualizadoEm)
        VALUES (@empresaId, @dataRef, @qtd, @receita, SYSUTCDATETIME());
    `);
}

// Descobre quais colunas existem na dbo.Agendamentos (pra não quebrar se teu schema variar)
async function getAgendamentosColumns(pool) {
  const r = await new sql.Request(pool).query(`
    SELECT c.name
    FROM sys.columns c
    INNER JOIN sys.objects o ON o.object_id = c.object_id
    WHERE o.name = 'Agendamentos' AND SCHEMA_NAME(o.schema_id) = 'dbo'
  `);
  const set = new Set((r.recordset || []).map((x) => String(x.name)));
  return set;
}

// Se o front não mandar atendimentoId, tenta buscar um "padrão" (TOP 1) em dbo.Atendimentos
async function getDefaultAtendimentoId(pool, empresaId) {
  try {
    const exists = await pool.request().query(`
      SELECT CASE WHEN OBJECT_ID('dbo.Atendimentos') IS NULL THEN 0 ELSE 1 END AS ok
    `);
    if (!exists.recordset?.[0]?.ok) return null;

    const r = await pool
      .request()
      .input("empresaId", sql.Int, empresaId)
      .query(`
        SELECT TOP 1 Id
        FROM dbo.Atendimentos
        WHERE EmpresaId = @empresaId
        ORDER BY Id ASC
      `);

    const id = r.recordset?.[0]?.Id;
    return Number.isFinite(Number(id)) ? Number(id) : null;
  } catch {
    return null;
  }
}

app.get("/health", async (req, res) => {
  try {
    await getPool();
    res.json({ ok: true, db: "connected" });
  } catch (err) {
    console.error("DB health error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/voice/interpret", async (req, res) => {
  const text = String(req.body?.text || "").trim();
  const slug = String(req.body?.slug || "").trim();

  if (!text) {
    return badRequest(res, "text e obrigatorio.");
  }
  if (!slug) {
    return badRequest(res, "slug e obrigatorio.");
  }

  const normalizedText = normalizeVoiceText(text);
  const detectedIntent = detectVoiceIntent(normalizedText);
  const wantsBooking = detectedIntent === "agendar_servico";

  if (detectedIntent === "cancelar_agendamento") {
    const parsedDate = parseVoiceDateFromText(text);
    return res.json({
      success: true,
      intent: detectedIntent,
      message: parsedDate
        ? `Vamos cancelar seu agendamento. Ja anotei a data ${parsedDate.label}. Agora me informe o nome usado no agendamento.`
        : "Vamos cancelar seu agendamento. Primeiro, me informe a data do agendamento.",
      date: parsedDate?.date,
      slots: [],
      nextStep: parsedDate ? "go_cancel_with_date" : "go_cancel",
    });
  }

  if (detectedIntent === "ver_registros") {
    return res.json({
      success: true,
      intent: detectedIntent,
      message: "Posso te mostrar seus registros recentes. Primeiro, me informe o nome usado no agendamento.",
      slots: [],
      nextStep: "go_history",
    });
  }

  if (detectedIntent === "falar_com_atendente") {
    return res.json({
      success: true,
      intent: detectedIntent,
      message: "Perfeito. Vou abrir os contatos disponiveis para voce falar diretamente com o prestador.",
      slots: [],
      nextStep: "go_contact",
    });
  }

  if (detectedIntent === "solicitar_orcamento") {
    return res.json({
      success: true,
      intent: detectedIntent,
      message: "Perfeito! Vamos iniciar sua solicitacao de orcamento. Primeiro, me diga seu nome completo.",
      slots: [],
      nextStep: "go_quote",
    });
  }

  if (detectedIntent === "ver_servicos") {
    return res.json({
      success: true,
      intent: detectedIntent,
      message: "Claro! Vou te mostrar os servicos disponiveis.",
      slots: [],
      nextStep: "go_services",
    });
  }

  if (detectedIntent !== "agendar_servico" && detectedIntent !== "consultar_horarios") {
    return res.json({
      success: false,
      intent: detectedIntent,
      message: "Ainda nao consegui entender esse pedido por voz. Tente pedir agendamento, horarios, cancelamento, registros, orcamento ou falar com atendente.",
      slots: [],
      nextStep: "menu",
    });
  }

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ success: false, error: "Empresa nao encontrada." });

    const servicos = await getActiveServicosByEmpresa(pool, empresa.Id);
    const matchedServices = findVoiceMatchedServices(servicos, text);
    const parsedDate = parseVoiceDateFromText(text);

    if (!matchedServices.length) {
      return res.json({
        success: false,
        intent: detectedIntent,
        message: "Nao consegui identificar qual servico voce quer. Pode me dizer o nome do servico?",
        slots: [],
        date: parsedDate?.date,
        nextStep: "ask_service",
      });
    }

    if (!parsedDate?.date) {
      return res.json({
        success: false,
        intent: detectedIntent,
        message: "Entendi o servico, mas ainda preciso saber a data. Voce quer para hoje, amanha ou para qual dia?",
        servicesDetected: matchedServices.map((servico) => ({
          id: Number(servico.Id),
          name: servico.Nome,
          durationMin: Number(servico.DuracaoMin) || 0,
        })),
        slots: [],
        nextStep: "ask_date",
      });
    }

    const durationMin = matchedServices.reduce(
      (sum, servico) => sum + (Number(servico.DuracaoMin) || 0),
      0
    );

    if (!Number.isFinite(durationMin) || durationMin <= 0) {
      return res.json({
        success: false,
        intent: detectedIntent,
        message: "Os servicos encontrados nao possuem uma duracao valida para consultar agenda.",
        slots: [],
        nextStep: "ask_service",
      });
    }

    const profissionaisAtivos = await getProfissionaisByEmpresa(pool, empresa.Id, true);
    let profissionalSelecionado = null;

    if (profissionaisAtivos.length > 1) {
      const eligible = await getEligibleProfessionalsForServices(
        pool,
        empresa.Id,
        matchedServices.map((servico) => Number(servico.Id))
      );

      if (!eligible.length) {
        return res.json({
          success: true,
          intent: detectedIntent,
          message: "Nao encontrei um profissional ativo configurado para todos os servicos pedidos.",
          slots: [],
          nextStep: "ask_service",
        });
      }

      if (eligible.length > 1) {
        return res.json({
          success: true,
          intent: detectedIntent,
          message: "Encontrei os servicos, mas ha mais de um profissional compativel. Para consultar horarios reais, preciso saber qual profissional voce deseja.",
          slots: [],
          nextStep: "ask_professional",
        });
      }

      profissionalSelecionado = eligible[0];
    }

    const data = parsedDate.date;
    const disponibilidade = await calculateAvailabilitySlots(pool, empresa, {
      data,
      durationMin,
      profissional: profissionalSelecionado,
      // Temporario para destravar o fluxo de voz em bases que ainda nao possuem
      // ProfissionalId em Agendamentos. Depois, o filtro por profissional deve
      // ser reintroduzido com o nome real da coluna no banco.
      disableProfissionalFilter: true,
    });

    const slots = Array.isArray(disponibilidade.slots) ? disponibilidade.slots : [];
    const servicesLabel = matchedServices.map((servico) => servico.Nome).join(" + ");

    if (disponibilidade.blocked) {
      return res.json({
        success: true,
        intent: detectedIntent,
        message: `A agenda para ${parsedDate.label || data} esta bloqueada para esse atendimento.`,
        slots: [],
        date: data,
        servicesDetected: matchedServices.map((servico) => ({
          id: Number(servico.Id),
          name: servico.Nome,
          durationMin: Number(servico.DuracaoMin) || 0,
        })),
        nextStep: "ask_date",
      });
    }

    if (!slots.length) {
      return res.json({
        success: true,
        intent: detectedIntent,
        message: `Nao encontrei horarios disponiveis para ${parsedDate.label || data}${servicesLabel ? ` para ${servicesLabel}` : ""}.`,
        slots: [],
        date: data,
        servicesDetected: matchedServices.map((servico) => ({
          id: Number(servico.Id),
          name: servico.Nome,
          durationMin: Number(servico.DuracaoMin) || 0,
        })),
        nextStep: "ask_date",
      });
    }

    return res.json({
      success: true,
      intent: detectedIntent,
      receivedText: text,
      servicesDetected: matchedServices.map((servico) => ({
        id: Number(servico.Id),
        name: servico.Nome,
        durationMin: Number(servico.DuracaoMin) || 0,
      })),
      date: data,
      message: `Encontrei estes horarios disponiveis para ${parsedDate.label || data}${servicesLabel ? ` para ${servicesLabel}` : ""}: ${slots.join(", ")}.`,
      slots,
      nextStep: wantsBooking ? "choose_slot" : "offer_booking",
    });
  } catch (err) {
    console.error("POST /api/voice/interpret error:", err);
    chatLog.error({
      message: "Falha no interpretador de voz",
      route: "/api/voice/interpret",
      slug,
      error: { message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ===========================
 *  EMPRESAS
 * ===========================
 */
app.get("/api/empresas/:slug", async (req, res) => {
  const { slug } = req.params;
  if (!slug) return badRequest(res, "Slug é obrigatório.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    res.json({
      ...empresa,
      OpcoesIniciaisSheila: parseInitialChatOptions(empresa.OpcoesIniciaisSheila),
    });
  } catch (err) {
    console.error("GET /api/empresas/:slug error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/empresas/:slug", async (req, res) => {
  const { slug } = req.params;
  const { Nome, MensagemBoasVindas, OpcoesIniciaisSheila, WhatsappPrestador, NomeProprietario, Endereco } = req.body || {};

  if (!slug) return badRequest(res, "Slug é obrigatório.");
  if (typeof Nome !== "string" || !Nome.trim())
    return badRequest(res, "Nome é obrigatório.");
  if (typeof MensagemBoasVindas !== "string" || !MensagemBoasVindas.trim())
    return badRequest(res, "MensagemBoasVindas é obrigatória.");

  let opcoesIniciais = null;
  if (OpcoesIniciaisSheila !== undefined && OpcoesIniciaisSheila !== null) {
    if (!Array.isArray(OpcoesIniciaisSheila)) {
      return badRequest(res, "OpcoesIniciaisSheila deve ser um array de strings ou null.");
    }

    const opcoes = OpcoesIniciaisSheila
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    const opcoesUnicas = [...new Set(opcoes)];
    opcoesIniciais = JSON.stringify(opcoesUnicas);
  }

  let whatsapp = null;
  if (WhatsappPrestador !== undefined && WhatsappPrestador !== null) {
    if (typeof WhatsappPrestador !== "string")
      return badRequest(res, "WhatsappPrestador deve ser string ou null.");
    whatsapp = WhatsappPrestador.replace(/\D/g, "");
    if (whatsapp.length > 20) whatsapp = whatsapp.slice(0, 20);
  }

  try {
    const pool = await getPool();

    let update;
    try {
      update = await pool
        .request()
        .input("slug", sql.VarChar(80), slug)
        .input("nome", sql.NVarChar(200), Nome.trim())
        .input("msg", sql.NVarChar(sql.MAX), MensagemBoasVindas.trim())
        .input("opcoes", sql.NVarChar(500), opcoesIniciais)
        .input("whats", sql.VarChar(20), whatsapp)
        .input("nomeProp", sql.NVarChar(120), (typeof NomeProprietario === "string" ? NomeProprietario.trim() : null))
        .input("endereco", sql.NVarChar(200), (typeof Endereco === "string" ? Endereco.trim() : null))
        .query(`
         UPDATE dbo.Empresas
          SET
            Nome = @nome,
            MensagemBoasVindas = @msg,
            OpcoesIniciaisSheila = @opcoes,
            WhatsappPrestador = @whats,
            NomeProprietario = @nomeProp,
            Endereco = @endereco
          WHERE Slug = @slug;

          SELECT TOP 1
            Id,
            Nome,
            Slug,
            MensagemBoasVindas,
            OpcoesIniciaisSheila,
            WhatsappPrestador,
            NomeProprietario,
            Endereco
          FROM dbo.Empresas
          WHERE Slug = @slug;
        `);
    } catch (err) {
      if (!isSqlInvalidColumnError(err, "OpcoesIniciaisSheila")) throw err;

      update = await pool
        .request()
        .input("slug", sql.VarChar(80), slug)
        .input("nome", sql.NVarChar(200), Nome.trim())
        .input("msg", sql.NVarChar(sql.MAX), MensagemBoasVindas.trim())
        .input("whats", sql.VarChar(20), whatsapp)
        .input("nomeProp", sql.NVarChar(120), (typeof NomeProprietario === "string" ? NomeProprietario.trim() : null))
        .input("endereco", sql.NVarChar(200), (typeof Endereco === "string" ? Endereco.trim() : null))
        .query(`
         UPDATE dbo.Empresas
          SET
            Nome = @nome,
            MensagemBoasVindas = @msg,
            WhatsappPrestador = @whats,
            NomeProprietario = @nomeProp,
            Endereco = @endereco
          WHERE Slug = @slug;

          SELECT TOP 1
            Id,
            Nome,
            Slug,
            MensagemBoasVindas,
            WhatsappPrestador,
            NomeProprietario,
            Endereco
          FROM dbo.Empresas
          WHERE Slug = @slug;
        `);
    }

    const empresa = update.recordset[0] || null;
    if (!empresa) {
      return res.status(404).json({ ok: false, error: "Empresa não encontrada." });
    }

    res.json({
      ok: true,
      empresa: {
        ...empresa,
        OpcoesIniciaisSheila: parseInitialChatOptions(empresa.OpcoesIniciaisSheila),
      },
    });
  } catch (err) {
    console.error("PUT /api/empresas/:slug error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ===========================
 *  ADMIN AUTH (por empresa)
 * ===========================
 */
app.post("/api/admin/login", loginRateLimiter, async (req, res) => {
  const slug = String(req.body?.slug || "").trim();
  const password = String(req.body?.password || "");
  const masterPassword = String(process.env.ADMIN_MASTER_PASSWORD || "");

  if (!slug) return badRequest(res, "slug é obrigatório.");
  if (!password) return badRequest(res, "password é obrigatório.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const isMasterLogin = Boolean(masterPassword) && password === masterPassword;

    if (isMasterLogin) {
      const exp = Date.now() + 1000 * 60 * 60 * 8; // 8h
      const token = createAdminToken({ slug, empresaId: empresa.Id, exp });
      authLog.info({
        message: "Login admin via senha master",
        route: "/api/admin/login",
        slug,
        empresaId: empresa.Id,
      });
      return res.json({ ok: true, token, exp, slug });
    }

    const auth = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .query(`
        SELECT TOP 1 EmpresaId, PasswordHash, IsActive
        FROM dbo.EmpresaAdminAuth
        WHERE EmpresaId = @empresaId;
      `);

    const row = auth.recordset?.[0];
    if (!row || row.IsActive === false) {
      authLog.warn({
        message: "Tentativa de login sem auth ativa",
        route: "/api/admin/login",
        slug,
        empresaId: empresa.Id,
      });
      return res.status(401).json({ ok: false, error: "Senha do admin não configurada para esta empresa." });
    }

    const incoming = hashAdminPassword(password);
    const saved = String(row.PasswordHash || "").trim().toLowerCase();
    if (!saved || incoming !== saved) {
      authLog.warn({
        message: "Tentativa de login com senha incorreta",
        route: "/api/admin/login",
        slug,
        empresaId: empresa.Id,
      });
      return res.status(401).json({ ok: false, error: "Senha incorreta." });
    }

    const exp = Date.now() + 1000 * 60 * 60 * 8; // 8h
    const token = createAdminToken({ slug, empresaId: empresa.Id, exp });
    authLog.info({
      message: "Login admin realizado com sucesso",
      route: "/api/admin/login",
      slug,
      empresaId: empresa.Id,
    });

    return res.json({ ok: true, token, exp, slug });
  } catch (err) {
    console.error("POST /api/admin/login error:", err);
    authLog.error({
      message: "Falha no login admin",
      route: "/api/admin/login",
      slug,
      error: { message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/admin/session", async (req, res) => {
  const payload = getAdminSessionPayload(req);
  if (!payload) return res.status(401).json({ ok: false, error: "Sessão inválida." });

  return res.json({
    ok: true,
    session: {
      slug: payload.slug,
      empresaId: payload.empresaId,
      exp: payload.exp,
    },
  });
});

app.get("/api/admin/notificacoes", async (req, res) => {
  const payload = getAdminSessionPayload(req);
  if (!payload) return res.status(401).json({ ok: false, error: "SessÃ£o invÃ¡lida." });

  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 100) : 30;
  const unreadOnly = String(req.query.unreadOnly || "0") === "1";

  try {
    const pool = await getPool();
    const ready = await ensureEmpresaNotificacoesTable(pool);
    if (!ready) {
      return res.json({ ok: true, notificacoes: [], unreadCount: 0 });
    }

    const unreadWhere = unreadOnly ? " AND LidaEm IS NULL " : "";
    const result = await pool
      .request()
      .input("empresaId", sql.Int, Number(payload.empresaId))
      .input("limit", sql.Int, limit)
      .query(`
        SELECT TOP (@limit)
          ${ADMIN_NOTIFICACAO_SELECT}
        FROM dbo.EmpresaNotificacoes
        WHERE EmpresaId = @empresaId
          ${unreadWhere}
        ORDER BY CriadaEm DESC, Id DESC;

        SELECT COUNT(1) AS UnreadCount
        FROM dbo.EmpresaNotificacoes
        WHERE EmpresaId = @empresaId
          AND LidaEm IS NULL;
      `);

    return res.json({
      ok: true,
      notificacoes: result.recordsets?.[0] || [],
      unreadCount: Number(result.recordsets?.[1]?.[0]?.UnreadCount || 0),
    });
  } catch (err) {
    console.error("GET /api/admin/notificacoes error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/admin/notificacoes/:id/lida", async (req, res) => {
  const payload = getAdminSessionPayload(req);
  if (!payload) return res.status(401).json({ ok: false, error: "SessÃ£o invÃ¡lida." });

  const notificationId = Number(req.params.id);
  if (!Number.isFinite(notificationId) || notificationId <= 0) {
    return badRequest(res, "id invÃ¡lido.");
  }

  try {
    const pool = await getPool();
    const ready = await ensureEmpresaNotificacoesTable(pool);
    if (!ready) {
      return res.status(503).json({ ok: false, error: "Estrutura de notificaÃ§Ãµes indisponÃ­vel." });
    }

    const result = await pool
      .request()
      .input("empresaId", sql.Int, Number(payload.empresaId))
      .input("id", sql.Int, notificationId)
      .query(`
        UPDATE dbo.EmpresaNotificacoes
        SET LidaEm = ISNULL(LidaEm, ${SQL_BRAZIL_NOW})
        WHERE Id = @id
          AND EmpresaId = @empresaId;

        SELECT @@ROWCOUNT AS rows;

        SELECT TOP 1
          ${ADMIN_NOTIFICACAO_SELECT}
        FROM dbo.EmpresaNotificacoes
        WHERE Id = @id
          AND EmpresaId = @empresaId;
      `);

    const rows = Number(result.recordsets?.[0]?.[0]?.rows || 0);
    if (rows <= 0) {
      return res.status(404).json({ ok: false, error: "NotificaÃ§Ã£o nÃ£o encontrada." });
    }

    return res.json({
      ok: true,
      notificacao: result.recordsets?.[1]?.[0] || null,
    });
  } catch (err) {
    console.error("PUT /api/admin/notificacoes/:id/lida error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/admin/notificacoes/dispositivos", async (req, res) => {
  const payload = getAdminSessionPayload(req);
  if (!payload) return res.status(401).json({ ok: false, error: "Sessão inválida." });

  try {
    const pool = await getPool();
    const ready = await ensureEmpresaNotificacaoDispositivosTable(pool);
    if (!ready) {
      return res.json({ ok: true, dispositivos: [] });
    }
    await ensureEmpresaNotificacaoDispositivoProfissionaisTable(pool);

    const result = await pool
      .request()
      .input("empresaId", sql.Int, Number(payload.empresaId))
      .query(`
        SELECT
          Id,
          EmpresaId,
          DeviceId,
          NomeDispositivo,
          Endpoint,
          Auth,
          P256dh,
          RecebePushAgendamento,
          RecebePushLembrete,
          Ativo,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
          CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
        FROM dbo.EmpresaNotificacaoDispositivos
        WHERE EmpresaId = @empresaId
        ORDER BY Ativo DESC, AtualizadoEm DESC, Id DESC;
      `);

    const profissionalMap = await getNotificationDeviceProfessionalMap(pool, Number(payload.empresaId));

    return res.json({
      ok: true,
      dispositivos: (result.recordset || []).map((device) => ({
        ...device,
        ProfissionalIds: profissionalMap.get(Number(device.Id)) || [],
      })),
    });
  } catch (err) {
    console.error("GET /api/admin/notificacoes/dispositivos error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/notificacoes/dispositivos", async (req, res) => {
  const payload = getAdminSessionPayload(req);
  if (!payload) return res.status(401).json({ ok: false, error: "Sessão inválida." });

  const deviceId = String(req.body?.deviceId || "").trim();
  const nomeDispositivo = String(req.body?.nomeDispositivo || "").trim();
  const endpoint = req.body?.endpoint ? String(req.body.endpoint).trim() : null;
  const auth = req.body?.auth ? String(req.body.auth).trim() : null;
  const p256dh = req.body?.p256dh ? String(req.body.p256dh).trim() : null;
  const profissionalIds = normalizeNotificationProfessionalIds(req.body?.profissionalIds);
  const recebePushAgendamento = parseNotificationBoolean(req.body?.recebePushAgendamento, true);
  const recebePushLembrete = parseNotificationBoolean(req.body?.recebePushLembrete, true);

  if (!deviceId) return badRequest(res, "deviceId é obrigatório.");
  if (!nomeDispositivo) return badRequest(res, "nomeDispositivo é obrigatório.");

  try {
    const pool = await getPool();
    const ready = await ensureEmpresaNotificacaoDispositivosTable(pool);
    if (!ready) {
      return res.status(503).json({ ok: false, error: "Estrutura de dispositivos indisponível." });
    }

    await ensureEmpresaNotificacaoDispositivoProfissionaisTable(pool);
    const validProfissionalIds = await getValidNotificationProfessionalIds(
      pool,
      Number(payload.empresaId),
      profissionalIds
    );

    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const result = await new sql.Request(tx)
        .input("empresaId", sql.Int, Number(payload.empresaId))
        .input("deviceId", sql.NVarChar(120), deviceId.slice(0, 120))
        .input("nomeDispositivo", sql.NVarChar(160), nomeDispositivo.slice(0, 160))
        .input("endpoint", sql.NVarChar(sql.MAX), endpoint || null)
        .input("auth", sql.NVarChar(500), auth || null)
        .input("p256dh", sql.NVarChar(500), p256dh || null)
        .input("recebePushAgendamento", sql.Bit, recebePushAgendamento ? 1 : 0)
        .input("recebePushLembrete", sql.Bit, recebePushLembrete ? 1 : 0)
        .query(`
          MERGE dbo.EmpresaNotificacaoDispositivos AS target
          USING (
            SELECT
              @empresaId AS EmpresaId,
              @deviceId AS DeviceId
          ) AS src
          ON target.EmpresaId = src.EmpresaId
            AND target.DeviceId = src.DeviceId
          WHEN MATCHED THEN
            UPDATE SET
              NomeDispositivo = @nomeDispositivo,
              Endpoint = @endpoint,
              Auth = @auth,
              P256dh = @p256dh,
              RecebePushAgendamento = @recebePushAgendamento,
              RecebePushLembrete = @recebePushLembrete,
              Ativo = 1,
              AtualizadoEm = ${SQL_BRAZIL_NOW}
          WHEN NOT MATCHED THEN
            INSERT (
              EmpresaId, DeviceId, NomeDispositivo, Endpoint, Auth, P256dh,
              RecebePushAgendamento, RecebePushLembrete, Ativo, CriadoEm, AtualizadoEm
            )
            VALUES (
              @empresaId, @deviceId, @nomeDispositivo, @endpoint, @auth, @p256dh,
              @recebePushAgendamento, @recebePushLembrete, 1, ${SQL_BRAZIL_NOW}, ${SQL_BRAZIL_NOW}
            );

          SELECT TOP 1
            Id,
            EmpresaId,
            DeviceId,
            NomeDispositivo,
            Endpoint,
            Auth,
            P256dh,
            RecebePushAgendamento,
            RecebePushLembrete,
            Ativo,
            CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
            CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
          FROM dbo.EmpresaNotificacaoDispositivos
          WHERE EmpresaId = @empresaId
            AND DeviceId = @deviceId;
        `);

      const dispositivo = result.recordset?.[0] || null;
      if (!dispositivo?.Id) {
        await tx.rollback();
        return res.status(500).json({ ok: false, error: "Nao foi possivel salvar o dispositivo." });
      }

      await replaceNotificationDeviceProfessionalIds(tx, {
        empresaId: Number(payload.empresaId),
        dispositivoId: Number(dispositivo.Id),
        profissionalIds: validProfissionalIds,
      });

      await tx.commit();

      return res.json({
        ok: true,
        dispositivo: {
          ...dispositivo,
          ProfissionalIds: validProfissionalIds,
          RecebePushAgendamento: recebePushAgendamento,
          RecebePushLembrete: recebePushLembrete,
        },
      });
    } catch (innerErr) {
      await tx.rollback();
      throw innerErr;
    }
  } catch (err) {
    console.error("POST /api/admin/notificacoes/dispositivos error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/admin/notificacoes/dispositivos/:id/desativar", async (req, res) => {
  const payload = getAdminSessionPayload(req);
  if (!payload) return res.status(401).json({ ok: false, error: "Sessão inválida." });

  const deviceRowId = Number(req.params.id);
  if (!Number.isFinite(deviceRowId) || deviceRowId <= 0) {
    return badRequest(res, "id inválido.");
  }

  try {
    const pool = await getPool();
    const ready = await ensureEmpresaNotificacaoDispositivosTable(pool);
    if (!ready) {
      return res.status(503).json({ ok: false, error: "Estrutura de dispositivos indisponível." });
    }

    const result = await pool
      .request()
      .input("empresaId", sql.Int, Number(payload.empresaId))
      .input("id", sql.Int, deviceRowId)
      .query(`
        UPDATE dbo.EmpresaNotificacaoDispositivos
        SET
          Ativo = 0,
          AtualizadoEm = ${SQL_BRAZIL_NOW}
        WHERE Id = @id
          AND EmpresaId = @empresaId;

        SELECT @@ROWCOUNT AS rows;

        SELECT TOP 1
          Id,
          EmpresaId,
          DeviceId,
          NomeDispositivo,
          Endpoint,
          Auth,
          P256dh,
          RecebePushAgendamento,
          RecebePushLembrete,
          Ativo,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
          CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
        FROM dbo.EmpresaNotificacaoDispositivos
        WHERE Id = @id
          AND EmpresaId = @empresaId;
      `);

    const rows = Number(result.recordsets?.[0]?.[0]?.rows || 0);
    if (rows <= 0) {
      return res.status(404).json({ ok: false, error: "Dispositivo não encontrado." });
    }

    const dispositivo = result.recordsets?.[1]?.[0] || null;
    const profissionalMap = await getNotificationDeviceProfessionalMap(pool, Number(payload.empresaId));

    return res.json({
      ok: true,
      dispositivo: dispositivo
        ? {
            ...dispositivo,
            ProfissionalIds: profissionalMap.get(Number(dispositivo.Id)) || [],
          }
        : null,
    });
  } catch (err) {
    console.error("PUT /api/admin/notificacoes/dispositivos/:id/desativar error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/notificacoes/push-teste", async (req, res) => {
  const session = getAdminSessionPayload(req);
  if (!session) return res.status(401).json({ ok: false, error: "Sessão inválida." });

  const tipoRaw = String(req.body?.tipo || "lembrete").trim().toLowerCase();
  const tipo = tipoRaw === "agendamento" ? "agendamento" : "lembrete";
  const titulo = String(req.body?.titulo || (tipo === "agendamento" ? "Teste de push de agendamento" : "Teste de push de lembrete")).trim();
  const mensagem = String(req.body?.mensagem || "Se você recebeu isso, o push está funcionando neste dispositivo.").trim();
  const profissionalIdRaw = Number(req.body?.profissionalId);
  const profissionalId = Number.isFinite(profissionalIdRaw) && profissionalIdRaw > 0 ? profissionalIdRaw : null;

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, String(session.slug || "").trim());
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const payload = {
      titulo,
      mensagem,
      title: titulo,
      body: mensagem,
      referenciaTipo: "push_teste",
      referenciaId: null,
      empresaId: Number(empresa.Id),
      slug: String(empresa.Slug || session.slug || ""),
      tipo: tipo === "lembrete" ? "lembrete_teste" : "agendamento_teste",
      url: `/admin?empresa=${encodeURIComponent(String(empresa.Slug || session.slug || ""))}`,
    };

    const pushResult = await sendPushToEmpresaDevices(pool, {
      empresaId: Number(empresa.Id),
      payload,
      profissionalId,
      pushType: tipo,
    });

    return res.json({
      ok: true,
      tipo,
      empresaId: Number(empresa.Id),
      profissionalId,
      eligibleDevices: Number(pushResult?.eligible || 0),
      sentDevices: Number(pushResult?.sent || 0),
    });
  } catch (err) {
    console.error("POST /api/admin/notificacoes/push-teste error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ===========================
 *  SERVICOS (SQL)
 * ===========================
 */

// GET /api/empresas/:slug/servicos
app.get("/api/empresas/:slug/servicos", async (req, res) => {
  const { slug } = req.params;
  const includeAll = String(req.query.all || "0") === "1";
  const profissionalId = req.query.profissionalId ? Number(req.query.profissionalId) : null;
  if (!slug) return badRequest(res, "Slug é obrigatório.");

  try {
    const pool = await getPool();

    const hasProfServicos = await hasTable(pool, "dbo.EmpresaProfissionalServicos");

    const result = await pool
      .request()
      .input("slug", sql.VarChar(80), slug)
      .input("includeAll", sql.Bit, includeAll ? 1 : 0)
      .input("profissionalId", sql.Int, Number.isFinite(profissionalId) ? Number(profissionalId) : null)
      .query(`
        SELECT
          s.Id,
          s.EmpresaId,
          s.Nome,
          s.Descricao,
          s.DuracaoMin,
          s.Preco,
          s.Ativo,
          s.CriadoEm
        FROM dbo.EmpresaServicos s
        INNER JOIN dbo.Empresas e ON e.Id = s.EmpresaId
        ${hasProfServicos && Number.isFinite(profissionalId) ? "INNER JOIN dbo.EmpresaProfissionalServicos ps ON ps.EmpresaId = s.EmpresaId AND ps.ServicoId = s.Id AND ps.ProfissionalId = @profissionalId" : ""}
        WHERE e.Slug = @slug
          AND (@includeAll = 1 OR s.Ativo = 1)
        ORDER BY s.Nome ASC;
      `);

    const servicos = (result.recordset || []).map((row) => ({
      Id: row.Id,
      Nome: row.Nome,
      Descricao: row.Descricao ?? "",
      DuracaoMin: row.DuracaoMin,
      Preco: row.Preco,
      Ativo: row.Ativo,
      CriadoEm: row.CriadoEm,
    }));

    return res.json({ ok: true, servicos });
  } catch (err) {
    console.error("GET /api/empresas/:slug/servicos error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/empresas/:slug/servicos
app.post("/api/empresas/:slug/servicos", async (req, res) => {
  const { slug } = req.params;
  const { Nome, Descricao, DuracaoMin, Preco, Ativo } = req.body || {};
  if (!slug) return badRequest(res, "Slug é obrigatório.");

  if (typeof Nome !== "string" || !Nome.trim())
    return badRequest(res, "Nome é obrigatório.");
  if (typeof Descricao !== "string" || !Descricao.trim())
    return badRequest(res, "Descricao é obrigatória.");

  const dur = Number(DuracaoMin);
  const preco = Number(Preco);
  if (!Number.isFinite(dur) || dur <= 0) return badRequest(res, "DuracaoMin inválida.");
  if (!isAllowedServiceDuration(dur)) {
    return badRequest(res, `DuracaoMin inválida. Use apenas: ${getAllowedServiceDurationsLabel()} minutos.`);
  }
  if (!Number.isFinite(preco) || preco < 0) return badRequest(res, "Preco inválido.");

  const ativo = Ativo === false ? 0 : 1;

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("nome", sql.NVarChar(200), Nome.trim())
      .input("descricao", sql.NVarChar(500), Descricao.trim())
      .input("dur", sql.Int, dur)
      .input("preco", sql.Decimal(10, 2), preco)
      .input("ativo", sql.Bit, ativo)
      .query(`
        INSERT INTO dbo.EmpresaServicos (EmpresaId, Nome, Descricao, DuracaoMin, Preco, Ativo)
        VALUES (@empresaId, @nome, @descricao, @dur, @preco, @ativo);

        SELECT TOP 1
          Id, EmpresaId, Nome, Descricao, DuracaoMin, Preco, Ativo, CriadoEm
        FROM dbo.EmpresaServicos
        WHERE Id = SCOPE_IDENTITY();
      `);

    res.json({ ok: true, servico: result.recordset[0] });
  } catch (err) {
    console.error("POST /api/empresas/:slug/servicos error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/empresas/:slug/servicos/:id
app.put("/api/empresas/:slug/servicos/:id", async (req, res) => {
  const { slug, id } = req.params;
  if (!slug) return badRequest(res, "Slug é obrigatório.");

  const servicoId = Number(id);
  if (!Number.isFinite(servicoId) || servicoId <= 0) return badRequest(res, "Id inválido.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const updated = await updateServicoByEmpresa(pool, empresa.Id, servicoId, req.body || {});
    if (updated.error) return res.status(updated.code || 400).json({ ok: false, error: updated.error });

    const servico = updated.servico;
    if (!servico) return res.status(404).json({ ok: false, error: "Serviço não encontrado." });

    res.json({ ok: true, servico });
  } catch (err) {
    console.error("PUT /api/empresas/:slug/servicos/:id error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/empresas/:slug/servicos/:id
app.delete("/api/empresas/:slug/servicos/:id", async (req, res) => {
  const { slug, id } = req.params;

  if (!slug) return badRequest(res, "Slug é obrigatório.");

  const servicoId = Number(id);
  if (!Number.isFinite(servicoId) || servicoId <= 0) return badRequest(res, "Id inválido.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const rows = await deleteServicoByEmpresa(pool, empresa.Id, servicoId);
    if (rows === 0) return res.status(404).json({ ok: false, error: "Serviço não encontrado." });

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/empresas/:slug/servicos/:id error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Compatibilidade legada: mantém endpoints antigos com slug obrigatório em query/body
app.put("/api/servicos/:id", async (req, res) => {
  const { id } = req.params;
  const legacySlug =
    (typeof req.query.slug === "string" && req.query.slug.trim()) ||
    (typeof req.body?.slug === "string" && req.body.slug.trim()) ||
    "";

  if (!legacySlug) {
    return badRequest(res, "slug é obrigatório para atualizar serviço nessa rota legada.");
  }

  const servicoId = Number(id);
  if (!Number.isFinite(servicoId) || servicoId <= 0) return badRequest(res, "Id inválido.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, legacySlug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const updated = await updateServicoByEmpresa(pool, empresa.Id, servicoId, req.body || {});
    if (updated.error) return res.status(updated.code || 400).json({ ok: false, error: updated.error });

    const servico = updated.servico;
    if (!servico) return res.status(404).json({ ok: false, error: "Serviço não encontrado." });

    return res.json({ ok: true, servico });
  } catch (err) {
    console.error("PUT /api/servicos/:id (legacy) error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/servicos/:id", async (req, res) => {
  const { id } = req.params;
  const legacySlug =
    (typeof req.query.slug === "string" && req.query.slug.trim()) ||
    (typeof req.body?.slug === "string" && req.body.slug.trim()) ||
    "";

  if (!legacySlug) {
    return badRequest(res, "slug é obrigatório para excluir serviço nessa rota legada.");
  }

  const servicoId = Number(id);
  if (!Number.isFinite(servicoId) || servicoId <= 0) return badRequest(res, "Id inválido.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, legacySlug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const rows = await deleteServicoByEmpresa(pool, empresa.Id, servicoId);
    if (rows === 0) return res.status(404).json({ ok: false, error: "Serviço não encontrado." });

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/servicos/:id (legacy) error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ===========================
 *  PROFISSIONAIS (opcional multi-atendente)
 * ===========================
 */
app.get("/api/empresas/:slug/profissionais", async (req, res) => {
  const { slug } = req.params;
  const onlyActive = String(req.query.ativos || "0") === "1";
  const servicoId = req.query.servicoId ? Number(req.query.servicoId) : null;
  if (!slug) return badRequest(res, "Slug é obrigatório.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    let profissionais = await getProfissionaisByEmpresa(pool, empresa.Id, onlyActive);

    if (Number.isFinite(servicoId) && Number(servicoId) > 0 && (await hasTable(pool, "dbo.EmpresaProfissionalServicos"))) {
      const result = await pool
        .request()
        .input("empresaId", sql.Int, empresa.Id)
        .input("servicoId", sql.Int, Number(servicoId))
        .query(`
          SELECT DISTINCT ProfissionalId
          FROM dbo.EmpresaProfissionalServicos
          WHERE EmpresaId = @empresaId
            AND ServicoId = @servicoId;
        `);
      const allowed = new Set((result.recordset || []).map((r) => Number(r.ProfissionalId)));
      profissionais = profissionais.filter((p) => allowed.has(Number(p.Id)));
    }

    return res.json({ ok: true, profissionais });
  } catch (err) {
    console.error("GET /api/empresas/:slug/profissionais error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/empresas/:slug/profissionais", async (req, res) => {
  const { slug } = req.params;
  const nome = String(req.body?.Nome || req.body?.nome || "").trim();
  const ativo = req.body?.Ativo === false ? 0 : 1;
  const whatsapp = String(req.body?.Whatsapp || req.body?.whatsapp || "").replace(/\D/g, "").slice(0, 20);

  if (!slug) return badRequest(res, "Slug é obrigatório.");
  if (!nome) return badRequest(res, "Nome é obrigatório.");
  if (!whatsapp) return badRequest(res, "Whatsapp é obrigatório.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    if (!(await hasTable(pool, "dbo.EmpresaProfissionais"))) {
      return res.status(409).json({ ok: false, error: "Tabela de profissionais não encontrada. Execute as migrations." });
    }

    const hasWhatsappCol = await ensureProfissionaisWhatsappColumn(pool);

    if (!hasWhatsappCol) {
      return res.status(409).json({ ok: false, error: "Coluna Whatsapp não encontrada em EmpresaProfissionais. Execute a migration 006_profissionais_whatsapp.sql." });
    }

    const req = pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("nome", sql.NVarChar(120), nome)
      .input("ativo", sql.Bit, ativo);

    if (hasWhatsappCol) {
      req.input("whatsapp", sql.VarChar(20), whatsapp);
    }

    const result = await req.query(`
        INSERT INTO dbo.EmpresaProfissionais (EmpresaId, Nome, ${hasWhatsappCol ? "Whatsapp, " : ""}Ativo)
        VALUES (@empresaId, @nome, ${hasWhatsappCol ? "@whatsapp, " : ""}@ativo);

        SELECT TOP 1 Id, EmpresaId, Nome, ${hasWhatsappCol ? "Whatsapp" : "CAST(NULL AS varchar(20)) AS Whatsapp"}, Ativo, CriadoEm
        FROM dbo.EmpresaProfissionais
        WHERE Id = SCOPE_IDENTITY();
      `);

    return res.status(201).json({ ok: true, profissional: result.recordset?.[0] || null });
  } catch (err) {
    console.error("POST /api/empresas/:slug/profissionais error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/empresas/:slug/profissionais/:id", async (req, res) => {
  const { slug, id } = req.params;
  const profissionalId = Number(id);
  const nomeValue = req.body?.Nome ?? req.body?.nome;
  const ativoValue = req.body?.Ativo;
  const whatsappValue = req.body?.Whatsapp ?? req.body?.whatsapp;

  if (!slug) return badRequest(res, "Slug é obrigatório.");
  if (!Number.isFinite(profissionalId) || profissionalId <= 0) return badRequest(res, "id inválido.");
  if (nomeValue === undefined && ativoValue === undefined && whatsappValue === undefined) {
    return badRequest(res, "Informe Nome, Whatsapp e/ou Ativo para atualizar.");
  }

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const profissional = await getProfissionalById(pool, empresa.Id, profissionalId);
    if (!profissional) return res.status(404).json({ ok: false, error: "Profissional não encontrado." });

    const hasWhatsappCol = await ensureProfissionaisWhatsappColumn(pool);

    if (!hasWhatsappCol) {
      return res.status(409).json({ ok: false, error: "Coluna Whatsapp não encontrada em EmpresaProfissionais. Execute a migration 006_profissionais_whatsapp.sql." });
    }

    const nome =
      nomeValue === undefined ? String(profissional.Nome || "") : String(nomeValue || "").trim();

    if (!nome) return badRequest(res, "Nome é obrigatório.");

    const ativo = ativoValue === undefined ? (profissional.Ativo ? 1 : 0) : (ativoValue === false ? 0 : 1);
    const whatsapp =
      whatsappValue === undefined
        ? String(profissional.Whatsapp || "").replace(/\D/g, "").slice(0, 20)
        : String(whatsappValue || "").replace(/\D/g, "").slice(0, 20);

    if (!whatsapp) return badRequest(res, "Whatsapp é obrigatório.");

    const req = pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("id", sql.Int, profissionalId)
      .input("nome", sql.NVarChar(120), nome)
      .input("ativo", sql.Bit, ativo);

    if (hasWhatsappCol) {
      req.input("whatsapp", sql.VarChar(20), whatsapp);
    }

    const upd = await req.query(`
        UPDATE dbo.EmpresaProfissionais
        SET Nome = @nome, ${hasWhatsappCol ? "Whatsapp = @whatsapp, " : ""}Ativo = @ativo
        WHERE EmpresaId = @empresaId AND Id = @id;

        SELECT TOP 1 Id, EmpresaId, Nome, ${hasWhatsappCol ? "Whatsapp" : "CAST(NULL AS varchar(20)) AS Whatsapp"}, Ativo, CriadoEm
        FROM dbo.EmpresaProfissionais
        WHERE EmpresaId = @empresaId AND Id = @id;
      `);

    return res.json({ ok: true, profissional: upd.recordset?.[0] || null });
  } catch (err) {
    console.error("PUT /api/empresas/:slug/profissionais/:id error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/empresas/:slug/profissionais/:id", async (req, res) => {
  const { slug, id } = req.params;
  const profissionalId = Number(id);
  if (!slug) return badRequest(res, "Slug é obrigatório.");
  if (!Number.isFinite(profissionalId) || profissionalId <= 0) return badRequest(res, "id inválido.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("id", sql.Int, profissionalId)
      .query(`
        IF EXISTS (
          SELECT 1
          FROM dbo.Agendamentos
          WHERE EmpresaId = @empresaId
            AND ProfissionalId = @id
            AND Status IN (N'pending', N'confirmed')
        )
        BEGIN
          SELECT CAST(1 AS bit) AS HasFuture;
        END
        ELSE
        BEGIN
          DELETE FROM dbo.EmpresaProfissionais WHERE EmpresaId = @empresaId AND Id = @id;
          SELECT CAST(0 AS bit) AS HasFuture;
        END
      `);

    if (result.recordset?.[0]?.HasFuture) {
      return res.status(409).json({ ok: false, error: "Não é possível remover profissional com agendamentos ativos." });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/empresas/:slug/profissionais/:id error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});



app.get("/api/empresas/:slug/profissionais/:id/horarios", async (req, res) => {
  const { slug, id } = req.params;
  const profissionalId = Number(id);
  if (!slug) return badRequest(res, "Slug é obrigatório.");
  if (!Number.isFinite(profissionalId) || profissionalId < 0) return badRequest(res, "id inválido.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const horarios = await getProfissionalHorarios(pool, empresa.Id, profissionalId);
    return res.json({ ok: true, horarios });
  } catch (err) {
    console.error("GET /api/empresas/:slug/profissionais/:id/horarios error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/empresas/:slug/profissionais/:id/horarios", async (req, res) => {
  const { slug, id } = req.params;
  const profissionalId = Number(id);
  const horarios = Array.isArray(req.body?.horarios) ? req.body.horarios : null;

  if (!slug) return badRequest(res, "Slug é obrigatório.");
  if (!Number.isFinite(profissionalId) || profissionalId < 0) return badRequest(res, "id inválido.");
  if (!horarios) return badRequest(res, "horarios inválido.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    if (!(await hasTable(pool, "dbo.EmpresaProfissionaisHorarios"))) {
      return res.status(409).json({ ok: false, error: "Tabela de horários por profissional não encontrada. Execute migrations." });
    }

    await ensureProfissionaisHorariosIntervalColumns(pool);

    const parsedHorarios = [];
    for (const h of horarios) {
      const parsed = validateProfissionalHorarioPayload(h);
      if (!parsed.ok) {
        return badRequest(res, parsed.error || "Horario invalido.");
      }
      parsedHorarios.push(parsed.horario);
    }

    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("profissionalId", sql.Int, profissionalId)
        .query(`DELETE FROM dbo.EmpresaProfissionaisHorarios WHERE EmpresaId=@empresaId AND ProfissionalId=@profissionalId;`);

      for (const horario of parsedHorarios) {
        const dia = horario.DiaSemana;
        const ativo = horario.Ativo;
        const inicio = horario.HoraInicio;
        const fim = horario.HoraFim;
        const intervaloAtivo = horario.IntervaloAtivo;
        const intervaloInicio = horario.IntervaloInicio;
        const intervaloFim = horario.IntervaloFim;

        await new sql.Request(tx)
          .input("empresaId", sql.Int, empresa.Id)
          .input("profissionalId", sql.Int, profissionalId)
          .input("dia", sql.Int, dia)
          .input("ativo", sql.Bit, ativo)
          .input("inicio", sql.VarChar(5), inicio)
          .input("fim", sql.VarChar(5), fim)
          .input("intervaloAtivo", sql.Bit, intervaloAtivo)
          .input("intervaloInicio", sql.VarChar(5), intervaloInicio)
          .input("intervaloFim", sql.VarChar(5), intervaloFim)
          .query(`
            INSERT INTO dbo.EmpresaProfissionaisHorarios
              (EmpresaId, ProfissionalId, DiaSemana, HoraInicio, HoraFim, Ativo, IntervaloAtivo, IntervaloInicio, IntervaloFim)
            VALUES
              (@empresaId, @profissionalId, @dia, @inicio, @fim, @ativo, @intervaloAtivo, @intervaloInicio, @intervaloFim);
          `);
      }

      await tx.commit();
      const saved = await getProfissionalHorarios(pool, empresa.Id, profissionalId);
      return res.json({ ok: true, horarios: saved });
    } catch (errTx) {
      try { await tx.rollback(); } catch {}
      throw errTx;
    }
  } catch (err) {
    console.error("PUT /api/empresas/:slug/profissionais/:id/horarios error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/empresas/:slug/profissionais/:id/servicos", async (req, res) => {
  const { slug, id } = req.params;
  const profissionalId = Number(id);
  if (!slug) return badRequest(res, "Slug é obrigatório.");
  if (!Number.isFinite(profissionalId) || profissionalId <= 0) return badRequest(res, "id inválido.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const servicoIds = await getProfissionalServicosIds(pool, empresa.Id, profissionalId);
    return res.json({ ok: true, servicoIds: servicoIds || [] });
  } catch (err) {
    console.error("GET /api/empresas/:slug/profissionais/:id/servicos error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/empresas/:slug/profissionais/:id/servicos", async (req, res) => {
  const { slug, id } = req.params;
  const profissionalId = Number(id);
  const servicoIds = Array.isArray(req.body?.servicoIds) ? req.body.servicoIds.map(Number).filter((n) => Number.isFinite(n) && n > 0) : null;
  if (!slug) return badRequest(res, "Slug é obrigatório.");
  if (!Number.isFinite(profissionalId) || profissionalId <= 0) return badRequest(res, "id inválido.");
  if (!servicoIds) return badRequest(res, "servicoIds inválido.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    if (!(await hasTable(pool, "dbo.EmpresaProfissionalServicos"))) {
      return res.status(409).json({ ok: false, error: "Tabela de vínculo profissional-serviços não encontrada. Execute migrations." });
    }

    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("profissionalId", sql.Int, profissionalId)
        .query(`DELETE FROM dbo.EmpresaProfissionalServicos WHERE EmpresaId=@empresaId AND ProfissionalId=@profissionalId;`);

      for (const sid of servicoIds) {
        await new sql.Request(tx)
          .input("empresaId", sql.Int, empresa.Id)
          .input("profissionalId", sql.Int, profissionalId)
          .input("servicoId", sql.Int, sid)
          .query(`
            INSERT INTO dbo.EmpresaProfissionalServicos (EmpresaId, ProfissionalId, ServicoId)
            VALUES (@empresaId, @profissionalId, @servicoId);
          `);
      }

      await tx.commit();
      return res.json({ ok: true, servicoIds });
    } catch (errTx) {
      try { await tx.rollback(); } catch {}
      throw errTx;
    }
  } catch (err) {
    console.error("PUT /api/empresas/:slug/profissionais/:id/servicos error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ===========================
 *  AGENDA / DISPONIBILIDADE (SQL)
 * ===========================
 */
app.get("/api/empresas/:slug/agenda/disponibilidade", publicRateLimiter, async (req, res) => {
  const { slug } = req.params;
  const { servicoId, data, profissionalId } = req.query;

  if (!slug) return badRequest(res, "Slug é obrigatório.");
  const sid = Number(servicoId);
  if (!Number.isFinite(sid) || sid <= 0) return badRequest(res, "servicoId inválido.");
  if (!isValidDateYYYYMMDD(data)) return badRequest(res, "data inválida (use YYYY-MM-DD).");

  const startHour = req.query.startHour ? Number(req.query.startHour) : 8;
  const endHour = req.query.endHour ? Number(req.query.endHour) : 18;
  const slotStepMin = APPOINTMENT_SLOT_STEP_MIN;
  const pid = profissionalId !== undefined ? Number(profissionalId) : null;

  const brazilNow = getBrazilNowInfo();
  const todayYmd = brazilNow.ymd;
  if (String(data) < todayYmd) {
    return res.json({ ok: true, data, slots: [] });
  }

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    // 🚫 Se o dia estiver bloqueado, não retorna slots
    const bloqueioDia = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("data", sql.Date, data)
      .query(`
        SELECT TOP 1 Motivo
        FROM dbo.AgendaBloqueios
        WHERE EmpresaId = @empresaId
          AND Data = @data;
      `);

    if (bloqueioDia.recordset?.length) {
      return res.json({
        ok: true,
        empresaId: empresa.Id,
        data,
        blocked: true,
        motivo: bloqueioDia.recordset[0]?.Motivo || null,
        slots: [],
      });
    }


    const servico = await getServicoById(pool, empresa.Id, sid);
    if (!servico) return res.status(404).json({ ok: false, error: "Serviço não encontrado." });
    if (!servico.Ativo) return res.status(400).json({ ok: false, error: "Serviço inativo." });

    const profissionaisAtivos = await getProfissionaisByEmpresa(pool, empresa.Id, true);
    const hasMultipleProfessionals = profissionaisAtivos.length > 1;

    let profissional = null;
    if (hasMultipleProfessionals) {
      if (!Number.isFinite(pid) || Number(pid) <= 0) {
        return badRequest(res, "profissionalId é obrigatório para esta empresa.");
      }
      profissional = await getProfissionalById(pool, empresa.Id, Number(pid));
      if (!profissional || !profissional.Ativo) {
        return res.status(404).json({ ok: false, error: "Profissional não encontrado/inativo." });
      }
    } else if (Number.isFinite(pid) && Number(pid) > 0) {
      profissional = await getProfissionalById(pool, empresa.Id, Number(pid));
      if (!profissional || !profissional.Ativo) {
        return res.status(404).json({ ok: false, error: "Profissional não encontrado/inativo." });
      }
    }

    if (profissional && (await hasTable(pool, "dbo.EmpresaProfissionalServicos"))) {
      const allowedIds = await getProfissionalServicosIds(pool, empresa.Id, Number(profissional.Id));
      if (Array.isArray(allowedIds) && allowedIds.length > 0 && !allowedIds.includes(Number(sid))) {
        return res.json({ ok: true, empresaId: empresa.Id, data, profissional: { Id: profissional.Id, Nome: profissional.Nome }, slots: [] });
      }
    }

    let dayStartMin = startHour * 60;
    let dayEndMin = endHour * 60;
    let intervaloInicioMin = null;
    let intervaloFimMin = null;
    const scheduleProfissionalId =
      profissional ? Number(profissional.Id) : profissionaisAtivos.length === 0 ? 0 : null;

    if (Number.isFinite(scheduleProfissionalId) && (await hasTable(pool, "dbo.EmpresaProfissionaisHorarios"))) {
      await ensureProfissionaisHorariosIntervalColumns(pool);
      const dateObj = new Date(`${String(data)}T12:00:00`);
      const diaSemana = Number.isNaN(dateObj.getTime()) ? null : dateObj.getDay();
      if (Number.isFinite(diaSemana)) {
        const dayRowRes = await pool
          .request()
          .input("empresaId", sql.Int, empresa.Id)
          .input("profissionalId", sql.Int, Number(scheduleProfissionalId))
          .input("diaSemana", sql.Int, Number(diaSemana))
          .query(`
            SELECT TOP 1 DiaSemana, Ativo, HoraInicio, HoraFim, ISNULL(IntervaloAtivo, 0) AS IntervaloAtivo, IntervaloInicio, IntervaloFim
            FROM dbo.EmpresaProfissionaisHorarios
            WHERE EmpresaId = @empresaId
              AND ProfissionalId = @profissionalId
              AND DiaSemana = @diaSemana;
          `);

        const dayRow = dayRowRes.recordset?.[0];
        if (dayRow) {
          const dayNormalized = normalizeProfissionalHorarioRow(dayRow);
          if (!dayNormalized.ativo) {
            return res.json({ ok: true, empresaId: empresa.Id, data, profissional: { Id: profissional.Id, Nome: profissional.Nome }, slots: [] });
          }

          dayStartMin = dayNormalized.inicioMin;
          dayEndMin = dayNormalized.fimMin;
          if (dayNormalized.intervaloAtivo) {
            intervaloInicioMin = dayNormalized.intervaloInicioMin;
            intervaloFimMin = dayNormalized.intervaloFimMin;
          }
        }
      }
    }

    // 🚫 Bloqueio de dia: não permite criar agendamento em datas bloqueadas
    const bloqueioDiaAgendamento = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("data", sql.Date, data)
      .query(`
        SELECT TOP 1 Motivo
        FROM dbo.AgendaBloqueios
        WHERE EmpresaId = @empresaId
          AND Data = @data;
      `);

    if (bloqueioDiaAgendamento.recordset?.length) {
      return res.status(409).json({
        ok: false,
        error: "A empresa não atende nesta data. Por favor, escolha outro dia.",
        motivo: bloqueioDia.recordset[0]?.Motivo || null,
      });
    }


    const duracaoMin = Number(servico.DuracaoMin);
    if (!Number.isFinite(duracaoMin) || duracaoMin <= 0) {
      return res.status(400).json({ ok: false, error: "Duração do serviço inválida." });
    }

    // Pega agendamentos do dia em minutos do dia (sem timezone)
    const shouldFilterByProfissional = Boolean(profissional);
    const bookedReq = pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("data", sql.Date, data);

    if (shouldFilterByProfissional) {
      bookedReq.input("profissionalId", sql.Int, Number(profissional.Id));
    }

    const profissionalWhere = shouldFilterByProfissional
      ? "AND ProfissionalId = @profissionalId"
      : "";

    const bookedRes = await bookedReq.query(`
        SELECT
          Id,
          DuracaoMin,
          (DATEPART(HOUR, HoraAgendada) * 60 + DATEPART(MINUTE, HoraAgendada)) AS StartMin,
          (DATEPART(HOUR, HoraAgendada) * 60 + DATEPART(MINUTE, HoraAgendada) + DuracaoMin) AS EndMin
        FROM dbo.Agendamentos
        WHERE EmpresaId = @empresaId
          AND DataAgendada = @data
          AND Status IN (N'pending', N'confirmed')
          ${profissionalWhere}
        ORDER BY HoraAgendada ASC;
      `);

    const booked = bookedRes.recordset || [];

    const startMin = dayStartMin;
    const endMin = dayEndMin;

    const slots = [];
    const nowMin = brazilNow.nowMin;
    const isToday = String(data) === todayYmd;

    for (let t = startMin; t + duracaoMin <= endMin; t += slotStepMin) {
      const candStart = t;
      const candEnd = t + duracaoMin;

      if (isToday && candStart <= nowMin) continue;

      const hasConflict = booked.some((apt) =>
        overlapsMin(candStart, candEnd, Number(apt.StartMin), Number(apt.EndMin))
      );

      const collidesWithBreak =
        Number.isFinite(intervaloInicioMin) &&
        Number.isFinite(intervaloFimMin) &&
        overlapsMin(candStart, candEnd, Number(intervaloInicioMin), Number(intervaloFimMin));

      if (collidesWithBreak) continue;
      if (!hasConflict) slots.push(minutesToHHMM(t));
    }

    return res.json({
      ok: true,
      empresaId: empresa.Id,
      servico: { Id: servico.Id, Nome: servico.Nome, DuracaoMin: duracaoMin },
      data,
      profissional: profissional ? { Id: profissional.Id, Nome: profissional.Nome } : null,
      slots,
    });
  } catch (err) {
    console.error("GET /api/empresas/:slug/agenda/disponibilidade error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ===========================
 *  AGENDAMENTOS (SQL)
 * ===========================
 *
 * - Corrige AtendimentoId NOT NULL
 * - Evita "Invalid time" convertendo dentro do SQL
 * - Evita dupe com SERIALIZABLE + UPDLOCK/HOLDLOCK
 */
app.post("/api/empresas/:slug/agendamentos", bookingRateLimiter, async (req, res) => {
  const { slug } = req.params;
  const {
    servicoId,
    customService,
    date,
    time,
    clientName,
    clientPhone,
    notes,
    observation,
    source,
    profissionalId,
  } = req.body || {};

  if (!slug) return badRequest(res, "Slug é obrigatório.");

  const isCustomService = customService && typeof customService === "object";
  const sid = Number(servicoId);
  if (!isCustomService && (!Number.isFinite(sid) || sid <= 0)) return badRequest(res, "servicoId inválido.");

  if (!isValidDateYYYYMMDD(date)) return badRequest(res, "date inválida (use YYYY-MM-DD).");
  if (!isValidTimeHHMM(time)) return badRequest(res, "time inválido (use HH:mm).");
  if (!isTimeAlignedToSlotStep(time)) {
    return badRequest(res, `time deve respeitar intervalos de ${APPOINTMENT_SLOT_STEP_MIN} minutos (ex: 09:00, 09:30).`);
  }

  const brazilNow = getBrazilNowInfo();
  const todayYmd = brazilNow.ymd;
  if (date < todayYmd) return badRequest(res, "Não é possível agendar para datas passadas.");

  if (date === todayYmd) {
    const nowMin = brazilNow.nowMin;
    const requestedMin = timeToMinutes(time);
    if (requestedMin <= nowMin) {
      return badRequest(res, "Não é possível agendar para horários que já passaram hoje.");
    }
  }

  if (typeof clientName !== "string" || !clientName.trim())
    return badRequest(res, "clientName é obrigatório.");
  const isAdminManual = String(source || "").trim().toLowerCase() === "admin_manual";

  if (!isAdminManual && (typeof clientPhone !== "string" || !clientPhone.trim()))
    return badRequest(res, "clientPhone é obrigatório.");

  const fallbackAdminPhone = `9${Date.now().toString().slice(-10)}`;
  const rawPhone =
    typeof clientPhone === "string" && clientPhone.trim()
      ? clientPhone
      : isAdminManual
        ? fallbackAdminPhone
        : "";
  const phone = rawPhone.replace(/\D/g, "").slice(0, 20);

  if (!phone) {
    return badRequest(
      res,
      isAdminManual
        ? "Não foi possível gerar o telefone do agendamento manual."
        : "clientPhone é obrigatório."
    );
  }

  const safeClientName = String(clientName).trim();
  const notaBruta = notes !== undefined ? notes : observation;
  const obs =
    notaBruta !== undefined && notaBruta !== null ? String(notaBruta).trim().slice(0, 1000) : null;
  const canalAtendimento = isAdminManual ? "admin" : "sheila";

  const requestedProfissionalId = profissionalId !== undefined && profissionalId !== null
    ? Number(profissionalId)
    : null;

  // Normaliza hora para HH:mm:ss
  const timeHHMMSS = `${time}:00`;

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    let servico = null;
    let customServicoPayload = null;

    if (isCustomService) {
      const descricao = String(customService?.descricao || "").trim();
      const modelo = String(customService?.modelo || "").trim();
      const duracaoMin = Number(customService?.duracaoMin);
      const valorMaoObra = Number(customService?.valorMaoObra);
      const valorProdutos = Number(customService?.valorProdutos);

      if (!descricao) return badRequest(res, "customService.descricao é obrigatória.");
      if (!Number.isFinite(duracaoMin) || duracaoMin <= 0) return badRequest(res, "customService.duracaoMin inválida.");
      if (!isAllowedServiceDuration(duracaoMin)) {
        return badRequest(
          res,
          `customService.duracaoMin inválida. Use apenas: ${getAllowedServiceDurationsLabel()} minutos.`
        );
      }
      if (!Number.isFinite(valorMaoObra) || valorMaoObra < 0) return badRequest(res, "customService.valorMaoObra inválido.");
      if (!Number.isFinite(valorProdutos) || valorProdutos < 0) return badRequest(res, "customService.valorProdutos inválido.");

      const valorFinal = Number((valorMaoObra + valorProdutos).toFixed(2));
      customServicoPayload = {
        descricao: descricao.slice(0, 500),
        modelo: modelo.slice(0, 160) || null,
        duracaoMin: Math.floor(duracaoMin),
        valorMaoObra,
        valorProdutos,
        valorFinal,
        nomeExibicao: modelo ? `${descricao} - ${modelo}`.slice(0, 200) : descricao.slice(0, 200),
      };

      servico = {
        Id: null,
        Nome: customServicoPayload.nomeExibicao,
        DuracaoMin: customServicoPayload.duracaoMin,
        Ativo: true,
      };
    } else {
      servico = await getServicoById(pool, empresa.Id, sid);
      if (!servico) return res.status(404).json({ ok: false, error: "Serviço não encontrado." });
      if (!servico.Ativo) return res.status(400).json({ ok: false, error: "Serviço inativo." });
    }

    const profissionaisAtivos = await getProfissionaisByEmpresa(pool, empresa.Id, true);
    const hasMultipleProfessionals = profissionaisAtivos.length > 1;

    let profissionalSelecionado = null;
    if (hasMultipleProfessionals && !Number.isFinite(requestedProfissionalId)) {
      return badRequest(res, "profissionalId é obrigatório para esta empresa.");
    }

    if (Number.isFinite(requestedProfissionalId)) {
      if (Number(requestedProfissionalId) <= 0) return badRequest(res, "profissionalId inválido.");
      profissionalSelecionado = await getProfissionalById(pool, empresa.Id, Number(requestedProfissionalId));
      if (!profissionalSelecionado || !profissionalSelecionado.Ativo) {
        return res.status(404).json({ ok: false, error: "Profissional não encontrado/inativo." });
      }
    } else if (profissionaisAtivos.length === 1) {
      profissionalSelecionado = profissionaisAtivos[0];
    }

    const profissionalIdDb = profissionalSelecionado ? Number(profissionalSelecionado.Id) : null;

    if (!isCustomService && profissionalSelecionado && (await hasTable(pool, "dbo.EmpresaProfissionalServicos"))) {
      const allowedIds = await getProfissionalServicosIds(pool, empresa.Id, profissionalIdDb);
      if (Array.isArray(allowedIds) && allowedIds.length > 0 && !allowedIds.includes(Number(sid))) {
        return res.status(400).json({ ok: false, error: "Este profissional não executa o serviço selecionado." });
      }
    }

    const scheduleProfissionalIdForBooking =
      profissionalSelecionado ? Number(profissionalSelecionado.Id) : profissionaisAtivos.length === 0 ? 0 : null;

    if (Number.isFinite(scheduleProfissionalIdForBooking) && (await hasTable(pool, "dbo.EmpresaProfissionaisHorarios"))) {
      await ensureProfissionaisHorariosIntervalColumns(pool);
      const dateObj = new Date(`${String(date)}T12:00:00`);
      const diaSemana = Number.isNaN(dateObj.getTime()) ? null : dateObj.getDay();
      if (Number.isFinite(diaSemana)) {
        const scheduleRes = await pool
          .request()
          .input("empresaId", sql.Int, empresa.Id)
          .input("profissionalId", sql.Int, Number(scheduleProfissionalIdForBooking))
          .input("diaSemana", sql.Int, Number(diaSemana))
          .query(`
            SELECT TOP 1 Ativo, HoraInicio, HoraFim, ISNULL(IntervaloAtivo, 0) AS IntervaloAtivo, IntervaloInicio, IntervaloFim
            FROM dbo.EmpresaProfissionaisHorarios
            WHERE EmpresaId = @empresaId
              AND ProfissionalId = @profissionalId
              AND DiaSemana = @diaSemana;
          `);

        const row = scheduleRes.recordset?.[0];
        const dayNormalized = row ? normalizeProfissionalHorarioRow(row) : null;
        if (row) {
          if (!dayNormalized?.ativo) {
            return res.status(409).json({ ok: false, error: "Profissional indisponivel nesta data." });
          }

          const reqMinWithDuration = timeToMinutes(time);
          const reqEndMinWithDuration = reqMinWithDuration + Number(servico.DuracaoMin || 0);
          if (reqMinWithDuration < Number(dayNormalized.inicioMin) || reqEndMinWithDuration > Number(dayNormalized.fimMin)) {
            return res.status(409).json({ ok: false, error: "Horario fora da jornada do profissional." });
          }
          if (
            dayNormalized.intervaloAtivo &&
            overlapsMin(
              reqMinWithDuration,
              reqEndMinWithDuration,
              Number(dayNormalized.intervaloInicioMin),
              Number(dayNormalized.intervaloFimMin)
            )
          ) {
            return res.status(409).json({ ok: false, error: "Horario indisponivel por intervalo do profissional." });
          }
          if (!row.Ativo) {
            return res.status(409).json({ ok: false, error: "Profissional indisponível nesta data." });
          }

          const [hIni, mIni] = String(row.HoraInicio || "09:00").slice(0,5).split(":").map(Number);
          const [hFim, mFim] = String(row.HoraFim || "18:00").slice(0,5).split(":").map(Number);
          const iniMin = (Number(hIni)||0)*60 + (Number(mIni)||0);
          const fimMin = (Number(hFim)||0)*60 + (Number(mFim)||0);
          const reqMin = timeToMinutes(time);
          if (reqMin < iniMin || reqMin >= fimMin) {
            return res.status(409).json({ ok: false, error: "Horário fora da jornada do profissional." });
          }
        }
      }
    }

    const duracaoMin = Number(servico.DuracaoMin);

    // minutos do dia (sem timezone)
    const startMin = timeToMinutes(time);
    const endMin = startMin + duracaoMin;
    const notificationsReady = await ensureEmpresaNotificacoesTable(pool);

    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      // 1) valida conflito (pending/confirmed) no mesmo dia
      const shouldFilterConflictByProfissional = Number.isFinite(profissionalIdDb);
      const conflictReq = new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("data", sql.Date, date)
        .input("startMin", sql.Int, startMin)
        .input("endMin", sql.Int, endMin);

      if (shouldFilterConflictByProfissional) {
        conflictReq.input("profissionalId", sql.Int, profissionalIdDb);
      }

      const conflictProfissionalWhere = shouldFilterConflictByProfissional
        ? "AND ProfissionalId = @profissionalId"
        : "";

      const conflict = await conflictReq.query(`
          SELECT TOP 1 Id
          FROM dbo.Agendamentos WITH (UPDLOCK, HOLDLOCK)
          WHERE EmpresaId = @empresaId
            AND DataAgendada = @data
            AND Status IN (N'pending', N'confirmed')
            ${conflictProfissionalWhere}
            AND @startMin < (DATEPART(HOUR, HoraAgendada) * 60 + DATEPART(MINUTE, HoraAgendada) + DuracaoMin)
            AND @endMin > (DATEPART(HOUR, HoraAgendada) * 60 + DATEPART(MINUTE, HoraAgendada));
        `);

      if (conflict.recordset?.length) {
        await tx.rollback();
        return res.status(409).json({
          ok: false,
          error: "Esse horário não está mais disponível.",
        });
      }

      // 2) cria/reutiliza Cliente (dbo.Clientes: Nome + Whatsapp + EmpresaId)
      const clienteUpsert = await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("nome", sql.NVarChar(120), clientName.trim())
        .input("whatsapp", sql.NVarChar(20), phone)
        .query(`
          DECLARE @clienteId int;

          SELECT TOP 1 @clienteId = Id
          FROM dbo.Clientes WITH (UPDLOCK, HOLDLOCK)
          WHERE EmpresaId = @empresaId
            AND Whatsapp = @whatsapp;

          IF @clienteId IS NULL
          BEGIN
            INSERT INTO dbo.Clientes (EmpresaId, Nome, Whatsapp)
            VALUES (@empresaId, @nome, @whatsapp);

            SET @clienteId = SCOPE_IDENTITY();
          END
          ELSE
          BEGIN
            -- opcional: atualiza nome se mudou
            UPDATE dbo.Clientes
            SET Nome = @nome
            WHERE Id = @clienteId;
          END

          SELECT @clienteId AS ClienteId;
        `);

      const clienteId = clienteUpsert.recordset?.[0]?.ClienteId;
      if (!clienteId) {
        await tx.rollback();
        return res.status(500).json({ ok: false, error: "Falha ao obter ClienteId." });
      }

      // 3) cria Atendimento (dbo.Atendimentos) -> gera AtendimentoId
      const atendimentoIns = await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("clienteId", sql.Int, clienteId)
        .input("inicioTxt", sql.VarChar(8), timeHHMMSS)
        .input("data", sql.Date, date)
        .input("duracaoMin", sql.Int, duracaoMin)
        .input("canal", sql.NVarChar(40), canalAtendimento)
        .query(`
          DECLARE @hora time(0) = CONVERT(time(0), @inicioTxt);

          DECLARE @inicio datetime2(0) = DATEADD(MINUTE, DATEDIFF(MINUTE, 0, @hora), CAST(@data as datetime2(0)));
          DECLARE @fim datetime2(0) = DATEADD(MINUTE, @duracaoMin, @inicio);

          INSERT INTO dbo.Atendimentos
            (EmpresaId, ClienteId, InicioAtendimento, FimAtendimento, Status, Canal)
          VALUES
            (@empresaId, @clienteId, @inicio, @fim, N'pending', @canal);

          SELECT SCOPE_IDENTITY() AS AtendimentoId, @inicio AS InicioEm, @fim AS FimEm;
        `);

      const atendimentoId = atendimentoIns.recordset?.[0]?.AtendimentoId;
      const inicioEm = atendimentoIns.recordset?.[0]?.InicioEm;
      const fimEm = atendimentoIns.recordset?.[0]?.FimEm;

      if (!atendimentoId) {
        await tx.rollback();
        return res.status(500).json({ ok: false, error: "Falha ao criar Atendimento." });
      }

      // 4) cria Agendamento vinculado ao AtendimentoId
      const agColumns = await getAgendamentosColumns(pool);
      const hasProfissionalIdColumn = agColumns.has("ProfissionalId");
      const hasIsServicoAvulso = agColumns.has("IsServicoAvulso");
      const hasServicoDescricaoAvulsa = agColumns.has("ServicoDescricaoAvulsa");
      const hasModeloReferencia = agColumns.has("ModeloReferencia");
      const hasValorMaoObra = agColumns.has("ValorMaoObra");
      const hasValorProdutos = agColumns.has("ValorProdutos");
      const hasValorFinal = agColumns.has("ValorFinal");

      const agendamentoReq = new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("atendimentoId", sql.Int, atendimentoId)
        .input("servicoId", sql.Int, isCustomService ? null : sid)
        .input("servicoNome", sql.NVarChar(200), servico.Nome)
        .input("data", sql.Date, date)
        .input("horaTxt", sql.VarChar(8), timeHHMMSS)
        .input("duracaoMin", sql.Int, duracaoMin)
        .input("inicioEm", sql.DateTime2(0), inicioEm)
        .input("fimEm", sql.DateTime2(0), fimEm)
        .input("status", sql.NVarChar(40), "pending")
        .input("obs", sql.NVarChar(1000), obs)
        .input("clienteNome", sql.NVarChar(120), safeClientName)
        .input("clienteTelefone", sql.NVarChar(30), phone);

      if (hasProfissionalIdColumn) {
        agendamentoReq.input("profissionalId", sql.Int, profissionalIdDb);
      }
      if (hasIsServicoAvulso) {
        agendamentoReq.input("isServicoAvulso", sql.Bit, isCustomService ? 1 : 0);
      }
      if (hasServicoDescricaoAvulsa) {
        agendamentoReq.input("servicoDescricaoAvulsa", sql.NVarChar(500), customServicoPayload?.descricao || null);
      }
      if (hasModeloReferencia) {
        agendamentoReq.input("modeloReferencia", sql.NVarChar(160), customServicoPayload?.modelo || null);
      }
      if (hasValorMaoObra) {
        agendamentoReq.input("valorMaoObra", sql.Decimal(12, 2), customServicoPayload?.valorMaoObra ?? null);
      }
      if (hasValorProdutos) {
        agendamentoReq.input("valorProdutos", sql.Decimal(12, 2), customServicoPayload?.valorProdutos ?? null);
      }
      if (hasValorFinal) {
        agendamentoReq.input("valorFinal", sql.Decimal(12, 2), customServicoPayload?.valorFinal ?? null);
      }

      const insertColumns = [
        "EmpresaId",
        "AtendimentoId",
        "ServicoId",
        "Servico",
        "DataAgendada",
        "HoraAgendada",
        "DuracaoMin",
        "InicioEm",
        "FimEm",
        "Status",
        "Observacoes",
        "ClienteNome",
        "ClienteTelefone",
      ];

      const insertValues = [
        "@empresaId",
        "@atendimentoId",
        "@servicoId",
        "@servicoNome",
        "@data",
        "@hora",
        "@duracaoMin",
        "@inicioEm",
        "@fimEm",
        "@status",
        "@obs",
        "@clienteNome",
        "@clienteTelefone",
      ];

      if (hasProfissionalIdColumn) {
        insertColumns.push("ProfissionalId");
        insertValues.push("@profissionalId");
      }
      if (hasIsServicoAvulso) {
        insertColumns.push("IsServicoAvulso");
        insertValues.push("@isServicoAvulso");
      }
      if (hasServicoDescricaoAvulsa) {
        insertColumns.push("ServicoDescricaoAvulsa");
        insertValues.push("@servicoDescricaoAvulsa");
      }
      if (hasModeloReferencia) {
        insertColumns.push("ModeloReferencia");
        insertValues.push("@modeloReferencia");
      }
      if (hasValorMaoObra) {
        insertColumns.push("ValorMaoObra");
        insertValues.push("@valorMaoObra");
      }
      if (hasValorProdutos) {
        insertColumns.push("ValorProdutos");
        insertValues.push("@valorProdutos");
      }
      if (hasValorFinal) {
        insertColumns.push("ValorFinal");
        insertValues.push("@valorFinal");
      }

      const agendamentoIns = await agendamentoReq.query(`
          DECLARE @hora time(0) = CONVERT(time(0), @horaTxt);

           INSERT INTO dbo.Agendamentos
          (${insertColumns.join(", ")})
          VALUES
          (${insertValues.join(", ")});
           SELECT TOP 1 *
          FROM dbo.Agendamentos
          WHERE Id = SCOPE_IDENTITY();
          `);

      const createdAppointment = agendamentoIns.recordset?.[0] ?? null;

      if (!isAdminManual && notificationsReady && createdAppointment?.Id) {
        await insertEmpresaNotificacao(tx, {
          empresaId: empresa.Id,
          profissionalId: profissionalIdDb,
          tipo: "novo_agendamento",
          titulo: "Novo agendamento recebido",
          mensagem: `Novo agendamento de ${safeClientName} para ${servico.Nome} em ${date} às ${time}.`,
          referenciaTipo: "agendamento",
          referenciaId: Number(createdAppointment.Id),
          dados: {
            atendimentoId,
            clienteId,
            servicoId: isCustomService ? null : sid,
            servicoNome: servico.Nome,
            data: date,
            hora: time,
            origem: canalAtendimento,
          },
        });
      }


      await tx.commit();

      if (!isAdminManual && createdAppointment?.Id) {
        const pushPayload = {
          titulo: "Novo agendamento recebido",
          mensagem: `Novo agendamento de ${safeClientName} para ${servico.Nome} em ${date} às ${time}.`,
          title: "Novo agendamento recebido",
          body: `Novo agendamento de ${safeClientName} para ${servico.Nome} em ${date} às ${time}.`,
          referenciaTipo: "agendamento",
          referenciaId: Number(createdAppointment.Id),
          empresaId: Number(empresa.Id),
          slug: String(slug),
          url: `/admin/agendamentos?agendamento=${Number(createdAppointment.Id)}&empresa=${encodeURIComponent(String(slug))}`,
        };

        sendPushToEmpresaDevices(pool, {
          empresaId: Number(empresa.Id),
          payload: pushPayload,
          profissionalId: Number.isFinite(profissionalIdDb) ? Number(profissionalIdDb) : null,
          pushType: "agendamento",
        }).catch((pushErr) => {
          console.warn("Falha ao processar web push do novo agendamento:", pushErr?.message || pushErr);
          jobsLog.warn({
            message: "Falha ao processar web push de novo agendamento",
            route: "/api/empresas/:slug/agendamentos",
            slug,
            empresaId: Number(empresa.Id),
            agendamentoId: Number(createdAppointment?.Id || 0) || null,
            error: pushErr?.message || String(pushErr || ""),
          });
        });
      }

      agendamentosLog.info({
        message: "Agendamento criado",
        route: "/api/empresas/:slug/agendamentos",
        slug,
        empresaId: empresa.Id,
        agendamentoId: Number(createdAppointment?.Id || 0) || null,
        atendimentoId: Number(atendimentoId || 0) || null,
        profissionalId: Number.isFinite(profissionalIdDb) ? Number(profissionalIdDb) : null,
        origem: canalAtendimento,
        data: date,
        horario: time,
      });
      return res.json({
        ok: true,
        agendamento: createdAppointment,
        atendimentoId,
        clienteId,
        profissional: profissionalSelecionado ? { Id: profissionalSelecionado.Id, Nome: profissionalSelecionado.Nome, Whatsapp: profissionalSelecionado.Whatsapp || null } : null,
      });
    } catch (errTx) {
      try {
        await tx.rollback();
      } catch {}
      throw errTx;
    }
  } catch (err) {
    console.error("POST /api/empresas/:slug/agendamentos error:", err);
    agendamentosLog.error({
      message: "Falha ao criar agendamento",
      route: "/api/empresas/:slug/agendamentos",
      slug,
      error: { message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
});
 // ✅ PUT: /api/empresas/:slug/agendamentos/:id/status
// body: { status: "pending" | "confirmed" | "completed" | "cancelled" }
app.put("/api/empresas/:slug/agendamentos/:id/status", async (req, res) => {
  const { slug, id } = req.params;

  const agendamentoId = Number(id);
  if (!slug) return badRequest(res, "Slug é obrigatório.");
  if (!Number.isFinite(agendamentoId) || agendamentoId <= 0)
    return badRequest(res, "id inválido.");

  // ✅ normaliza e valida status
  const allowed = new Set(["pending", "confirmed", "completed", "cancelled"]);
  const newStatus = String(req.body?.status || "").trim().toLowerCase();

  if (!allowed.has(newStatus)) return badRequest(res, "status inválido.");

  try {
    const pool = await getPool();

    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa)
      return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      const currentResult = await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("id", sql.Int, agendamentoId)
        .query(`
          SELECT TOP 1
            Id, EmpresaId, AtendimentoId, ServicoId, DataAgendada, HoraAgendada,
            DuracaoMin, InicioEm, FimEm, Status, Observacoes
          FROM dbo.Agendamentos
          WHERE Id = @id AND EmpresaId = @empresaId;
        `);

      const currentAppointment = currentResult.recordset?.[0] ?? null;
      if (!currentAppointment) {
        await tx.rollback();
        return res.status(404).json({ ok: false, error: "Agendamento não encontrado." });
      }

      if (newStatus === "completed") {
        const appointmentDate = toIsoDateOnly(currentAppointment.DataAgendada);
        const appointmentTime = extractHHMM(currentAppointment.HoraAgendada || currentAppointment.InicioEm);
        const todayYmd = getLocalDateYMD(new Date());

        let isFutureAppointment = false;
        if (currentAppointment.InicioEm) {
          const startDate = new Date(currentAppointment.InicioEm);
          if (!Number.isNaN(startDate.getTime())) {
            isFutureAppointment = startDate.getTime() > Date.now();
          }
        }

        if (!isFutureAppointment && appointmentDate && appointmentTime && /^\d{2}:\d{2}$/.test(appointmentTime)) {
          const [year, month, day] = appointmentDate.split("-").map(Number);
          const [hours, minutes] = appointmentTime.split(":").map(Number);
          const appointmentLocalDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
          if (!Number.isNaN(appointmentLocalDate.getTime())) {
            isFutureAppointment = appointmentLocalDate.getTime() > Date.now();
          }
        }

        if (!isFutureAppointment && appointmentDate && !appointmentTime) {
          isFutureAppointment = appointmentDate > todayYmd;
        }

        if (isFutureAppointment) {
          await tx.rollback();
          return badRequest(res, "Não é possível concluir um agendamento futuro.");
        }
      }

      const result = await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("id", sql.Int, agendamentoId)
        .input("status", sql.NVarChar(40), newStatus)
        .query(`
          UPDATE dbo.Agendamentos
          SET Status = @status
          WHERE Id = @id AND EmpresaId = @empresaId;

          SELECT @@ROWCOUNT AS rows;

          SELECT TOP 1
            Id, EmpresaId, AtendimentoId, ServicoId, DataAgendada, HoraAgendada,
            DuracaoMin, InicioEm, FimEm, Status, Observacoes
          FROM dbo.Agendamentos
          WHERE Id = @id AND EmpresaId = @empresaId;
        `);

      const rows = result.recordsets?.[0]?.[0]?.rows ?? 0;
      if (rows === 0) {
        await tx.rollback();
        return res.status(404).json({ ok: false, error: "Agendamento não encontrado." });
      }

      const agendamento = result.recordsets?.[1]?.[0] ?? null;

      // Se existir AtendimentoId, atualiza também
      if (agendamento?.AtendimentoId) {
        await new sql.Request(tx)
          .input("empresaId", sql.Int, empresa.Id)
          .input("atendimentoId", sql.Int, agendamento.AtendimentoId)
          .input("status", sql.NVarChar(40), newStatus)
          .query(`
            UPDATE dbo.Atendimentos
            SET Status = @status
            WHERE Id = @atendimentoId AND EmpresaId = @empresaId;
          `);
      }

      const dataRef = toIsoDateOnly(agendamento?.DataAgendada);
      if (dataRef) {
        try {
          await recomputeFinanceiroDiarioForDate(tx, empresa.Id, dataRef);
        } catch (aggErr) {
          if (!isSqlMissingObjectError(aggErr)) throw aggErr;
        }
      }

      await tx.commit();
      agendamentosLog.info({
        message: "Status de agendamento atualizado",
        route: "/api/empresas/:slug/agendamentos/:id/status",
        slug,
        empresaId: empresa.Id,
        agendamentoId,
        statusAnterior: normalizeStatus(currentAppointment?.Status),
        statusNovo: newStatus,
      });
      return res.json({ ok: true, agendamento });
    } catch (errTx) {
      try {
        await tx.rollback();
      } catch {}
      throw errTx;
    }
  } catch (err) {
    console.error("PUT /api/empresas/:slug/agendamentos/:id/status error:", err);
    agendamentosLog.error({
      message: "Falha ao atualizar status do agendamento",
      route: "/api/empresas/:slug/agendamentos/:id/status",
      slug,
      agendamentoId,
      error: { message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ POST: /api/empresas/:slug/agendamentos/cancelamento/buscar
// body: { date: "YYYY-MM-DD", phone: "5511999999999" }
app.post("/api/empresas/:slug/agendamentos/cancelamento/buscar", async (req, res) => {
  const { slug } = req.params;
  const { date, phone, name } = req.body || {};

  if (!slug) return badRequest(res, "Slug é obrigatório.");
  if (!isValidDateYYYYMMDD(date)) return badRequest(res, "date inválida (use YYYY-MM-DD).");

  const phoneDigits = String(phone || "").replace(/\D/g, "");
  if (phoneDigits.length < 10) {
    return badRequest(res, "phone inválido.");
  }

  const phoneLocal =
    phoneDigits.length > 11 && phoneDigits.startsWith("55")
      ? phoneDigits.slice(2)
      : phoneDigits;

  const clientName = String(name || "").trim();
  if (!clientName) {
    return badRequest(res, "name é obrigatório.");
  }

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("date", sql.Date, date)
      .input("phone", sql.NVarChar(30), phoneDigits)
      .input("phoneLocal", sql.NVarChar(30), phoneLocal)
      .input("name", sql.NVarChar(120), clientName)
      .query(`
        SELECT
          ag.Id              AS AgendamentoId,
          ag.ServicoId,
          ag.Servico,
          CONVERT(varchar(10), ag.DataAgendada, 23) AS DataAgendada,
          ag.HoraAgendada,
          ag.InicioEm,
          ag.FimEm,
          ag.DuracaoMin,
          LTRIM(RTRIM(ag.Status)) AS AgendamentoStatus,
          ag.ClienteNome,
          ag.ClienteTelefone
        FROM dbo.Agendamentos ag
        WHERE ag.EmpresaId = @empresaId
          AND ag.DataAgendada = @date
          AND (
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(ag.ClienteTelefone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = @phone
            OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(ag.ClienteTelefone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = @phoneLocal
            OR RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(ag.ClienteTelefone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), LEN(@phoneLocal)) = @phoneLocal
          )
          AND LTRIM(RTRIM(ISNULL(ag.ClienteNome, ''))) COLLATE Latin1_General_CI_AI LIKE CONCAT('%', @name, '%') COLLATE Latin1_General_CI_AI
          AND LTRIM(RTRIM(ag.Status)) IN (N'pending', N'confirmed')
        ORDER BY ag.HoraAgendada ASC, ag.InicioEm ASC;
      `);

    return res.json({
      ok: true,
      date,
      total: result.recordset?.length || 0,
      agendamentos: result.recordset || [],
    });
  } catch (err) {
    console.error("POST /api/empresas/:slug/agendamentos/cancelamento/buscar error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ POST: /api/empresas/:slug/agendamentos/cancelamento/confirmar
// body: { appointmentId: number, phone: "5511999999999" }
app.post("/api/empresas/:slug/agendamentos/consultar-recentes", async (req, res) => {
  const { slug } = req.params;
  const phone = String(req.body?.phone || "").replace(/\D/g, "");
  const name = String(req.body?.name || "").trim();

  if (!slug) return badRequest(res, "Slug é obrigatório.");
  if (phone.length < 10) return badRequest(res, "phone inválido.");
  if (!name) return badRequest(res, "name é obrigatório.");

  const phoneLocal =
    phone.length > 11 && phone.startsWith("55")
      ? phone.slice(2)
      : phone;

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const agColumns = await getAgendamentosColumns(pool);
    const hasClienteNome = agColumns.has("ClienteNome");
    const hasClienteTelefone = agColumns.has("ClienteTelefone");

    await ensureEmpresaNotificacaoDispositivoProfissionaisTable(pool);

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("phone", sql.NVarChar(30), phone)
      .input("phoneLocal", sql.NVarChar(30), phoneLocal)
      .input("name", sql.NVarChar(120), name)
      .query(`
        SELECT TOP 10
          ag.Id AS AgendamentoId,
          ag.AtendimentoId,
          ag.ServicoId,
          ag.Servico,
          CONVERT(varchar(10), ag.DataAgendada, 23) AS DataAgendada,
          ag.HoraAgendada,
          ag.InicioEm,
          ag.FimEm,
          LTRIM(RTRIM(ag.Status)) AS AgendamentoStatus,
          ${hasClienteNome ? "ag.ClienteNome" : "c.Nome"} AS ClienteNome,
          ${hasClienteTelefone ? "ag.ClienteTelefone" : "c.Whatsapp"} AS ClienteWhatsapp
        FROM dbo.Agendamentos ag
        INNER JOIN dbo.Atendimentos at ON at.Id = ag.AtendimentoId
        INNER JOIN dbo.Clientes c ON c.Id = at.ClienteId
        WHERE ag.EmpresaId = @empresaId
          AND (
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(${hasClienteTelefone ? "ag.ClienteTelefone" : "c.Whatsapp"}, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = @phone
            OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(${hasClienteTelefone ? "ag.ClienteTelefone" : "c.Whatsapp"}, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = @phoneLocal
            OR RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(${hasClienteTelefone ? "ag.ClienteTelefone" : "c.Whatsapp"}, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), LEN(@phoneLocal)) = @phoneLocal
          )
          AND LTRIM(RTRIM(ISNULL(${hasClienteNome ? "ag.ClienteNome" : "c.Nome"}, ''))) COLLATE Latin1_General_CI_AI LIKE CONCAT('%', @name, '%') COLLATE Latin1_General_CI_AI
        ORDER BY ag.DataAgendada DESC, ag.HoraAgendada DESC, ag.Id DESC;
      `);

    return res.json({
      ok: true,
      total: Number(result.recordset?.length || 0),
      agendamentos: result.recordset || [],
    });
  } catch (err) {
    console.error("POST /api/empresas/:slug/agendamentos/consultar-recentes error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/empresas/:slug/ordens-servico/consultar-status", publicRateLimiter, async (req, res) => {
  const { slug } = req.params;
  const phone = String(req.body?.phone || "").replace(/\D/g, "");
  const name = String(req.body?.name || "").trim();

  if (!slug) return badRequest(res, "Slug e obrigatorio.");
  if (!name) return badRequest(res, "name e obrigatorio.");
  if (phone.length < 10) return badRequest(res, "phone invalido.");

  const phoneLocal = phone.length > 11 && phone.startsWith("55") ? phone.slice(2) : phone;

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa nao encontrada." });

    const ready = await ensureEmpresaOrdensServicoTable(pool);
    if (!ready) return res.status(503).json({ ok: false, error: "Estrutura de ordens de servico indisponivel." });

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("phone", sql.NVarChar(30), phone)
      .input("phoneLocal", sql.NVarChar(30), phoneLocal)
      .input("name", sql.NVarChar(120), name)
      .query(`
        SELECT TOP 1
          os.Id,
          os.Marca,
          os.Modelo,
          os.DefeitoRelatado,
          os.StatusOrdem,
          CONVERT(varchar(10), os.PrevisaoEntrega, 23) AS PrevisaoEntrega,
          os.ValorTotal
        FROM dbo.EmpresaOrdensServico os
        WHERE os.EmpresaId = @empresaId
          AND (
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(os.ClienteTelefone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = @phone
            OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(os.ClienteTelefone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = @phoneLocal
            OR RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(os.ClienteTelefone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), LEN(@phoneLocal)) = @phoneLocal
          )
          AND LTRIM(RTRIM(ISNULL(os.ClienteNome, ''))) COLLATE Latin1_General_CI_AI LIKE CONCAT('%', @name, '%') COLLATE Latin1_General_CI_AI
        ORDER BY
          CASE
            WHEN LTRIM(RTRIM(ISNULL(os.StatusOrdem, ''))) IN (N'pronta', N'em_reparo', N'aguardando_aprovacao', N'aprovada', N'aberta') THEN 0
            ELSE 1
          END,
          os.Id DESC;
      `);

    const order = result.recordset?.[0];
    if (!order) {
      chatLog.warn({
        message: "Consulta publica de OS sem resultado",
        route: "/api/empresas/:slug/ordens-servico/consultar-status",
        slug,
        nomeBusca: name.slice(0, 80),
        telefoneFinal: String(phone || "").slice(-4),
      });
      return res.status(404).json({
        ok: false,
        error: "Nao localizamos servico com os dados informados.",
      });
    }

    const normalizedStatus = normalizeOsOrderStatus(order.StatusOrdem);
    const defeito = String(order.DefeitoRelatado || "").replace(/\s+/g, " ").trim();
    const defeitoResumo = defeito.length > 160 ? `${defeito.slice(0, 157)}...` : defeito;
    const marcaModelo = `${String(order.Marca || "").trim()} ${String(order.Modelo || "").trim()}`.trim();

    return res.json({
      ok: true,
      ordem: {
        NumeroOS: buildOsNumber(order.Id),
        AparelhoModelo: marcaModelo || String(order.Modelo || ""),
        DefeitoResumo: defeitoResumo,
        Status: normalizedStatus,
        StatusAmigavel: getClientFriendlyOsStatus(normalizedStatus),
        PrevisaoEntrega: order.PrevisaoEntrega ? String(order.PrevisaoEntrega) : null,
        ValorTotal: Number(order.ValorTotal || 0),
        ProntoParaRetirada: normalizedStatus === "pronta",
      },
    });
  } catch (err) {
    console.error("POST /api/empresas/:slug/ordens-servico/consultar-status error:", err);
    chatLog.error({
      message: "Falha na consulta publica de OS",
      route: "/api/empresas/:slug/ordens-servico/consultar-status",
      slug,
      error: { message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/empresas/:slug/agendamentos/cancelamento/confirmar", async (req, res) => {
  const { slug } = req.params;
  const { appointmentId, phone } = req.body || {};

  if (!slug) return badRequest(res, "Slug é obrigatório.");

  const agendamentoId = Number(appointmentId);
  if (!Number.isFinite(agendamentoId) || agendamentoId <= 0) {
    return badRequest(res, "appointmentId inválido.");
  }

  const phoneDigits = String(phone || "").replace(/\D/g, "");
  if (phoneDigits.length < 10) {
    return badRequest(res, "phone inválido.");
  }

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      const current = await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("id", sql.Int, agendamentoId)
        .input("phone", sql.NVarChar(30), phoneDigits)
        .query(`
          SELECT TOP 1
            Id, EmpresaId, AtendimentoId,
            CONVERT(varchar(10), DataAgendada, 23) AS DataAgendada,
            HoraAgendada,
            LTRIM(RTRIM(Status)) AS Status,
            Servico,
            ClienteNome,
            ClienteTelefone
          FROM dbo.Agendamentos WITH (UPDLOCK, HOLDLOCK)
          WHERE Id = @id
            AND EmpresaId = @empresaId
            AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(ClienteTelefone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = @phone;
        `);

      const ag = current.recordset?.[0] || null;
      if (!ag) {
        await tx.rollback();
        return res.status(404).json({ ok: false, error: "Agendamento não encontrado para os dados informados." });
      }

      const st = normalizeStatus(ag.Status);
      if (st !== "pending" && st !== "confirmed") {
        await tx.rollback();
        return res.status(409).json({ ok: false, error: "Esse agendamento não pode mais ser cancelado." });
      }

      await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("id", sql.Int, agendamentoId)
        .query(`
          UPDATE dbo.Agendamentos
          SET Status = N'cancelled'
          WHERE Id = @id
            AND EmpresaId = @empresaId;
        `);

      if (ag.AtendimentoId) {
        await new sql.Request(tx)
          .input("empresaId", sql.Int, empresa.Id)
          .input("atendimentoId", sql.Int, ag.AtendimentoId)
          .query(`
            UPDATE dbo.Atendimentos
            SET Status = N'cancelled'
            WHERE Id = @atendimentoId
              AND EmpresaId = @empresaId;
          `);
      }

      if (ag.DataAgendada) {
        try {
          await recomputeFinanceiroDiarioForDate(tx, empresa.Id, ag.DataAgendada);
        } catch (aggErr) {
          if (!isSqlMissingObjectError(aggErr)) throw aggErr;
        }
      }

      await tx.commit();

      return res.json({
        ok: true,
        agendamento: {
          ...ag,
          Status: "cancelled",
        },
      });
    } catch (errTx) {
      try {
        await tx.rollback();
      } catch {}
      throw errTx;
    }
  } catch (err) {
    console.error("POST /api/empresas/:slug/agendamentos/cancelamento/confirmar error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});



// ✅ POST: /api/empresas/:slug/agendamentos/cancelar-dia
// body: { date: "YYYY-MM-DD", reason?: "..." }
app.post("/api/empresas/:slug/agendamentos/cancelar-dia", async (req, res) => {
  const { slug } = req.params;
  const { date, reason } = req.body || {};

  if (!slug) return badRequest(res, "Slug é obrigatório.");
  if (!isValidDateYYYYMMDD(date)) return badRequest(res, "date inválida (use YYYY-MM-DD).");

  const motivo = reason !== undefined && reason !== null ? String(reason).trim().slice(0, 200) : "";

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      // 1) lista agendamentos do dia (pendentes/confirmados) para retorno ao admin
      const q = await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("data", sql.Date, date)
        .query(`
          SELECT
            a.Id           AS AgendamentoId,
            a.AtendimentoId,
            a.ServicoId,
            s.Nome         AS Servico,
            a.DataAgendada,
            a.HoraAgendada,
            a.Status       AS AgendamentoStatus,
            c.Nome         AS ClienteNome,
            c.Whatsapp     AS ClienteWhatsapp
          FROM dbo.Agendamentos a
          LEFT JOIN dbo.EmpresaServicos s ON s.Id = a.ServicoId
          LEFT JOIN dbo.Atendimentos at   ON at.Id = a.AtendimentoId
          LEFT JOIN dbo.Clientes c        ON c.Id = at.ClienteId
          WHERE a.EmpresaId = @empresaId
            AND a.DataAgendada = @data
            AND a.Status IN (N'pending', N'confirmed')
          ORDER BY a.HoraAgendada ASC;
        `);

      const list = q.recordset || [];

      // 2) cancela agendamentos do dia (se houver)
      await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("data", sql.Date, date)
        .query(`
          UPDATE dbo.Agendamentos
          SET Status = N'cancelled'
          WHERE EmpresaId = @empresaId
            AND DataAgendada = @data
            AND Status IN (N'pending', N'confirmed');
        `);

      // 3) cancela atendimentos vinculados (se houver)
      await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("data", sql.Date, date)
        .query(`
          UPDATE at
          SET at.Status = N'cancelled'
          FROM dbo.Atendimentos at
          INNER JOIN dbo.Agendamentos a ON a.AtendimentoId = at.Id
          WHERE a.EmpresaId = @empresaId
            AND a.DataAgendada = @data
            AND a.Status = N'cancelled';
        `);

      // 4) cria bloqueio do dia (pra Sheila não oferecer horários)
      await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("data", sql.Date, date)
        .input("motivo", sql.NVarChar(200), motivo || null)
        .query(`
          IF NOT EXISTS (
            SELECT 1 FROM dbo.AgendaBloqueios
            WHERE EmpresaId = @empresaId AND Data = @data
          )
          BEGIN
            INSERT INTO dbo.AgendaBloqueios (EmpresaId, Data, Motivo)
            VALUES (@empresaId, @data, @motivo);
          END
        `);

      await tx.commit();
      return res.json({ ok: true, cancelled: list.length, reason: motivo, agendamentos: list });
    } catch (errTx) {
      try { await tx.rollback(); } catch {}
      throw errTx;
    }
  } catch (err) {
    console.error("POST /api/empresas/:slug/agendamentos/cancelar-dia error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ===========================
 *  AGENDAMENTOS - LISTAGEM (ADMIN)
 * ===========================
 * GET /api/empresas/:slug/agendamentos?status=todos|pending|confirmed|cancelled&data=YYYY-MM-DD
 */
app.get("/api/empresas/:slug/agendamentos", async (req, res) => {
  const { slug } = req.params;
  const requestedStatus = String(req.query.status || "todos").toLowerCase();
  const status = requestedStatus === "all" ? "todos" : requestedStatus;
  const data = req.query.data ? String(req.query.data) : "";
  const page = Math.max(1, Number(req.query.page || 1));
  const profissionalId = req.query.profissionalId ? Number(req.query.profissionalId) : null;
  const requestedPageSize = Number(req.query.pageSize || 15);
  const maxPageSize = data ? 200 : 50;
  const pageSize = Math.min(maxPageSize, Math.max(1, requestedPageSize));
  const offset = (page - 1) * pageSize;

  if (!slug) return badRequest(res, "Slug é obrigatório.");

  const allowedStatus = new Set(["todos", "pending", "confirmed", "completed", "cancelled"]);
  if (!allowedStatus.has(status)) {
    return badRequest(res, "status inválido.");
  }

  if (Number.isFinite(profissionalId) && Number(profissionalId) <= 0) {
    return badRequest(res, "profissionalId inválido.");
  }

  if (data && !isValidDateYYYYMMDD(data)) {
    return badRequest(res, "data inválida (use YYYY-MM-DD).");
  }

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const retentionEnabled = String(process.env.ENABLE_APPOINTMENTS_RETENTION || "false").toLowerCase() === "true";
    const retentionDays = Math.max(1, Number(process.env.APPOINTMENTS_RETENTION_DAYS || 60));

    // limpeza automática opcional: mantém apenas os últimos N dias
    if (retentionEnabled) {
      await pool
        .request()
        .input("empresaId", sql.Int, empresa.Id)
        .input("retentionDays", sql.Int, retentionDays)
        .query(`
          DELETE FROM dbo.Agendamentos
          WHERE EmpresaId = @empresaId
            AND DataAgendada < DATEADD(DAY, -@retentionDays, CAST(GETDATE() AS date));
        `);
    }

    // filtro de status (opcional)
    let statusWhere = "";
    if (status !== "todos") {
      statusWhere = " AND ag.Status = @status ";
    }

    const dateWhere = data ? " AND ag.DataAgendada = @data " : "";
    const agColumns = await getAgendamentosColumns(pool);
    const hasProfissionalId = agColumns.has("ProfissionalId");
    const hasProfissionaisTable = await hasTable(pool, "dbo.EmpresaProfissionais");
    const hasProfissionalWhatsapp = hasProfissionaisTable && (await hasColumn(pool, "dbo.EmpresaProfissionais", "Whatsapp"));
    const hasValorFinal = agColumns.has("ValorFinal");
    const hasValorMaoObra = agColumns.has("ValorMaoObra");
    const hasValorProdutos = agColumns.has("ValorProdutos");
    const hasIsServicoAvulso = agColumns.has("IsServicoAvulso");
    const hasServicoDescricaoAvulsa = agColumns.has("ServicoDescricaoAvulsa");
    const hasModeloReferencia = agColumns.has("ModeloReferencia");
    const hasClienteNome = agColumns.has("ClienteNome");
    const hasClienteTelefone = agColumns.has("ClienteTelefone");

    const profissionalWhere =
      Number.isFinite(profissionalId) && hasProfissionalId
        ? " AND ag.ProfissionalId = @profissionalId "
        : "";

    const countResult = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("status", sql.NVarChar(40), status)
      .input("data", sql.Date, data || null)
      .input("profissionalId", sql.Int, Number.isFinite(profissionalId) ? Number(profissionalId) : null)
      .query(`
        SELECT COUNT(1) AS Total
        FROM dbo.Agendamentos ag
        WHERE ag.EmpresaId = @empresaId
        ${dateWhere}
        ${statusWhere}
        ${profissionalWhere};
      `);

    const total = Number(countResult.recordset?.[0]?.Total || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const safeOffset = (safePage - 1) * pageSize;

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("status", sql.NVarChar(40), status)
      .input("data", sql.Date, data || null)
      .input("profissionalId", sql.Int, Number.isFinite(profissionalId) ? Number(profissionalId) : null)
      .input("offset", sql.Int, safeOffset)
      .input("pageSize", sql.Int, pageSize)
      .query(`
        SELECT
          ag.Id              AS AgendamentoId,
          ag.EmpresaId,
          ag.AtendimentoId,
          ag.ServicoId,
          ag.Servico,
          CONVERT(varchar(10), ag.DataAgendada, 23) AS DataAgendada,
          ag.HoraAgendada,
          ag.DuracaoMin,
          ag.InicioEm,
          ag.FimEm,
          ${hasIsServicoAvulso ? "ag.IsServicoAvulso" : "CAST(0 AS bit)"} AS IsServicoAvulso,
          ${hasServicoDescricaoAvulsa ? "ag.ServicoDescricaoAvulsa" : "CAST(NULL AS nvarchar(500))"} AS ServicoDescricaoAvulsa,
          ${hasModeloReferencia ? "ag.ModeloReferencia" : "CAST(NULL AS nvarchar(160))"} AS ModeloReferencia,
          ${hasValorMaoObra ? "ag.ValorMaoObra" : "CAST(NULL AS decimal(12,2))"} AS ValorMaoObra,
          ${hasValorProdutos ? "ag.ValorProdutos" : "CAST(NULL AS decimal(12,2))"} AS ValorProdutos,
          ${hasValorFinal ? "ag.ValorFinal" : "CAST(NULL AS decimal(12,2))"} AS ValorFinal,
          LTRIM(RTRIM(ag.Status)) AS AgendamentoStatus,
          ag.Observacoes,

          a.ClienteId        AS ClienteId,
          ${hasClienteNome
            ? "COALESCE(NULLIF(LTRIM(RTRIM(ag.ClienteNome)), ''), c.Nome)"
            : "c.Nome"}      AS ClienteNome,
          ${hasClienteTelefone
            ? "COALESCE(NULLIF(LTRIM(RTRIM(ag.ClienteTelefone)), ''), c.Whatsapp)"
            : "c.Whatsapp"}  AS ClienteWhatsapp,
          ${hasProfissionalId ? "ag.ProfissionalId" : "CAST(NULL AS int)"} AS ProfissionalId,
          ${hasProfissionaisTable ? "p.Nome" : "CAST(NULL AS nvarchar(120))"} AS ProfissionalNome,
          ${hasProfissionaisTable && hasProfissionalWhatsapp ? "p.Whatsapp" : "CAST(NULL AS varchar(20))"} AS ProfissionalWhatsapp
        FROM dbo.Agendamentos ag
        INNER JOIN dbo.Atendimentos a ON a.Id = ag.AtendimentoId
        INNER JOIN dbo.Clientes c     ON c.Id = a.ClienteId
        ${hasProfissionaisTable && hasProfissionalId ? "LEFT JOIN dbo.EmpresaProfissionais p ON p.Id = ag.ProfissionalId" : ""}
        WHERE ag.EmpresaId = @empresaId
        ${statusWhere}
        ${dateWhere}
        ${profissionalWhere}
        ORDER BY ag.InicioEm DESC
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
      `);

    return res.json({
      ok: true,
      agendamentos: result.recordset || [],
      pagination: {
        page: safePage,
        pageSize,
        total,
        totalPages,
      },
      retentionDays,
      retentionEnabled,
    });
  } catch (err) {
    console.error("GET /api/empresas/:slug/agendamentos error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ===========================
 *  AGENDAMENTOS POR DATA (ADMIN)
 * ===========================
 * GET /api/empresas/:slug/agendamentos-por-data?data=YYYY-MM-DD
 */
app.get("/api/empresas/:slug/agendamentos-por-data", async (req, res) => {
  const { slug } = req.params;
  const data = String(req.query.data || "").trim();
  const profissionalId = req.query.profissionalId ? Number(req.query.profissionalId) : null;

  if (!slug) return badRequest(res, "Slug é obrigatório.");
  if (!data || !isValidDateYYYYMMDD(data)) {
    return badRequest(res, "data inválida (use YYYY-MM-DD).");
  }
  if (Number.isFinite(profissionalId) && Number(profissionalId) <= 0) {
    return badRequest(res, "profissionalId inválido.");
  }

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const agColumns = await getAgendamentosColumns(pool);
    const hasProfissionalId = agColumns.has("ProfissionalId");
    const hasClienteNome = agColumns.has("ClienteNome");
    const hasClienteTelefone = agColumns.has("ClienteTelefone");
    const profissionalWhere =
      Number.isFinite(profissionalId) && hasProfissionalId
        ? " AND ag.ProfissionalId = @profissionalId "
        : "";

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("data", sql.Date, data)
      .input("profissionalId", sql.Int, Number.isFinite(profissionalId) ? Number(profissionalId) : null)
      .query(`
        SELECT
          ag.Id AS Id,
          ${hasClienteNome
            ? "COALESCE(NULLIF(LTRIM(RTRIM(ag.ClienteNome)), ''), c.Nome)"
            : "c.Nome"} AS NomeCliente,
          ag.Servico AS Servico,
          CONVERT(varchar(10), ag.DataAgendada, 23) AS DataAgendada,
          CONVERT(varchar(5), CAST(COALESCE(ag.HoraAgendada, ag.InicioEm) AS time), 108) AS Horario,
          LTRIM(RTRIM(ag.Status)) AS Status,
          ${hasClienteTelefone
            ? "COALESCE(NULLIF(LTRIM(RTRIM(ag.ClienteTelefone)), ''), c.Whatsapp)"
            : "c.Whatsapp"} AS Telefone,
          ag.Observacoes AS Observacao
        FROM dbo.Agendamentos ag
        INNER JOIN dbo.Atendimentos a ON a.Id = ag.AtendimentoId
        INNER JOIN dbo.Clientes c ON c.Id = a.ClienteId
        WHERE ag.EmpresaId = @empresaId
          AND ag.DataAgendada = @data
          ${profissionalWhere}
        ORDER BY CAST(COALESCE(ag.HoraAgendada, ag.InicioEm) AS time) ASC, ag.Id ASC;
      `);

    const agendamentos = (result.recordset || []).map((row) => ({
      id: Number(row.Id || 0),
      nomeCliente: String(row.NomeCliente || ""),
      servico: String(row.Servico || ""),
      data: String(row.DataAgendada || ""),
      horario: String(row.Horario || ""),
      status: normalizeStatus(row.Status),
      telefone: String(row.Telefone || ""),
      observacao: String(row.Observacao || ""),
    }));

    return res.json({
      ok: true,
      data,
      totalDia: agendamentos.length,
      agendamentos,
    });
  } catch (err) {
    console.error("GET /api/empresas/:slug/agendamentos-por-data error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ===========================
 *  FINANCAS / DESPESAS
 * ===========================
 */
app.get("/api/empresas/:slug/financeiro/configuracao", async (req, res) => {
  const { slug } = req.params;
  if (!slug) return badRequest(res, "Slug e obrigatorio.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa nao encontrada." });

    const rules = await getEmpresaFinanceRules(pool, empresa.Id);
    financeiroLog.info({
      message: "Configuracao financeira consultada",
      route: "/api/empresas/:slug/financeiro/configuracao",
      slug,
      empresaId: empresa.Id,
    });
    return res.json({ ok: true, config: rules });
  } catch (err) {
    console.error("GET /api/empresas/:slug/financeiro/configuracao error:", err);
    financeiroLog.error({
      message: "Falha ao consultar configuracao financeira",
      route: "/api/empresas/:slug/financeiro/configuracao",
      slug,
      error: { message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/empresas/:slug/financeiro/configuracao", async (req, res) => {
  const { slug } = req.params;
  if (!slug) return badRequest(res, "Slug e obrigatorio.");

  const owner = normalizeFinanceRule(req.body?.owner, DEFAULT_FINANCE_RULES.owner);
  const cash = normalizeFinanceRule(req.body?.cash, DEFAULT_FINANCE_RULES.cash);
  const expenses = normalizeFinanceRule(req.body?.expenses, DEFAULT_FINANCE_RULES.expenses);
  const total = Number((owner + cash + expenses).toFixed(2));

  if (total !== 100) {
    return badRequest(res, "A soma dos percentuais precisa ser exatamente 100.");
  }

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa nao encontrada." });

    const config = await upsertEmpresaFinanceRules(pool, empresa.Id, { owner, cash, expenses });
    financeiroLog.info({
      message: "Configuracao financeira atualizada",
      route: "/api/empresas/:slug/financeiro/configuracao",
      slug,
      empresaId: empresa.Id,
      owner,
      cash,
      expenses,
    });
    return res.json({ ok: true, config });
  } catch (err) {
    console.error("PUT /api/empresas/:slug/financeiro/configuracao error:", err);
    financeiroLog.error({
      message: "Falha ao atualizar configuracao financeira",
      route: "/api/empresas/:slug/financeiro/configuracao",
      slug,
      error: { message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/empresas/:slug/despesas", async (req, res) => {
  const { slug } = req.params;
  const startDateRaw = String(req.query.startDate || "").trim();
  const endDateRaw = String(req.query.endDate || "").trim();
  const hasCustomRange = isValidDateYYYYMMDD(startDateRaw) && isValidDateYYYYMMDD(endDateRaw);
  const startDate = hasCustomRange && startDateRaw > endDateRaw ? endDateRaw : startDateRaw;
  const endDate = hasCustomRange && startDateRaw > endDateRaw ? startDateRaw : endDateRaw;

  if (!slug) return badRequest(res, "Slug e obrigatorio.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa nao encontrada." });

    const ready = await ensureEmpresaDespesasTable(pool);
    if (!ready) return res.json({ ok: true, despesas: [], total: 0 });

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("startDate", sql.Date, hasCustomRange ? startDate : null)
      .input("endDate", sql.Date, hasCustomRange ? endDate : null)
      .query(`
        SELECT
          Id,
          EmpresaId,
          Descricao,
          Categoria,
          Valor,
          CONVERT(varchar(10), DataDespesa, 23) AS DataDespesa,
          Observacao,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
          CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
        FROM dbo.EmpresaDespesas
        WHERE EmpresaId = @empresaId
          ${hasCustomRange ? "AND DataDespesa BETWEEN @startDate AND @endDate" : ""}
        ORDER BY DataDespesa DESC, Id DESC;

        SELECT
          ISNULL(SUM(Valor), 0) AS Total
        FROM dbo.EmpresaDespesas
        WHERE EmpresaId = @empresaId
          ${hasCustomRange ? "AND DataDespesa BETWEEN @startDate AND @endDate" : ""};
      `);

    const despesas = (result.recordsets?.[0] || []).map((item) => ({
      ...item,
      Valor: Number(item.Valor || 0),
      CategoriaLabel: formatExpenseCategoryLabel(String(item.Categoria || "")),
    }));

    return res.json({
      ok: true,
      despesas,
      total: Number(result.recordsets?.[1]?.[0]?.Total || 0),
    });
  } catch (err) {
    console.error("GET /api/empresas/:slug/despesas error:", err);
    financeiroLog.error({
      message: "Falha ao listar despesas",
      route: "/api/empresas/:slug/despesas",
      slug,
      error: { message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/empresas/:slug/despesas", async (req, res) => {
  const { slug } = req.params;
  if (!slug) return badRequest(res, "Slug e obrigatorio.");

  const descricao = String(req.body?.descricao || "").trim();
  const categoria = normalizeExpenseCategory(req.body?.categoria);
  const valor = Number(req.body?.valor);
  const dataDespesa = String(req.body?.dataDespesa || "").trim();
  const observacaoRaw = String(req.body?.observacao || "").trim();

  if (!descricao) return badRequest(res, "Descricao e obrigatoria.");
  if (!Number.isFinite(valor) || valor <= 0) return badRequest(res, "Valor invalido.");
  if (!isValidDateYYYYMMDD(dataDespesa)) return badRequest(res, "Data da despesa invalida.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa nao encontrada." });

    const ready = await ensureEmpresaDespesasTable(pool);
    if (!ready) return res.status(503).json({ ok: false, error: "Estrutura de despesas indisponivel." });

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("descricao", sql.NVarChar(160), descricao.slice(0, 160))
      .input("categoria", sql.NVarChar(60), categoria)
      .input("valor", sql.Decimal(12, 2), Number(valor.toFixed(2)))
      .input("dataDespesa", sql.Date, dataDespesa)
      .input("observacao", sql.NVarChar(500), observacaoRaw ? observacaoRaw.slice(0, 500) : null)
      .query(`
        INSERT INTO dbo.EmpresaDespesas
          (EmpresaId, Descricao, Categoria, Valor, DataDespesa, Observacao, CriadoEm, AtualizadoEm)
        VALUES
          (@empresaId, @descricao, @categoria, @valor, @dataDespesa, @observacao, ${SQL_BRAZIL_NOW}, ${SQL_BRAZIL_NOW});

        SELECT TOP 1
          Id,
          EmpresaId,
          Descricao,
          Categoria,
          Valor,
          CONVERT(varchar(10), DataDespesa, 23) AS DataDespesa,
          Observacao,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
          CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
        FROM dbo.EmpresaDespesas
        WHERE Id = SCOPE_IDENTITY();
      `);

    const despesa = result.recordset?.[0]
      ? {
          ...result.recordset[0],
          Valor: Number(result.recordset[0].Valor || 0),
          CategoriaLabel: formatExpenseCategoryLabel(String(result.recordset[0].Categoria || "")),
        }
      : null;

    financeiroLog.info({
      message: "Despesa criada",
      route: "/api/empresas/:slug/despesas",
      slug,
      empresaId: empresa.Id,
      despesaId: despesa?.Id || null,
      categoria: despesa?.Categoria || categoria,
      valor: despesa?.Valor ?? Number(valor.toFixed(2)),
    });
    return res.status(201).json({ ok: true, despesa });
  } catch (err) {
    console.error("POST /api/empresas/:slug/despesas error:", err);
    financeiroLog.error({
      message: "Falha ao criar despesa",
      route: "/api/empresas/:slug/despesas",
      slug,
      error: { message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/empresas/:slug/despesas/:id", async (req, res) => {
  const { slug, id } = req.params;
  const despesaId = Number(id);
  if (!slug) return badRequest(res, "Slug e obrigatorio.");
  if (!Number.isFinite(despesaId) || despesaId <= 0) return badRequest(res, "id invalido.");

  const descricao = String(req.body?.descricao || "").trim();
  const categoria = normalizeExpenseCategory(req.body?.categoria);
  const valor = Number(req.body?.valor);
  const dataDespesa = String(req.body?.dataDespesa || "").trim();
  const observacaoRaw = String(req.body?.observacao || "").trim();

  if (!descricao) return badRequest(res, "Descricao e obrigatoria.");
  if (!Number.isFinite(valor) || valor <= 0) return badRequest(res, "Valor invalido.");
  if (!isValidDateYYYYMMDD(dataDespesa)) return badRequest(res, "Data da despesa invalida.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa nao encontrada." });

    const ready = await ensureEmpresaDespesasTable(pool);
    if (!ready) return res.status(503).json({ ok: false, error: "Estrutura de despesas indisponivel." });

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("id", sql.Int, despesaId)
      .input("descricao", sql.NVarChar(160), descricao.slice(0, 160))
      .input("categoria", sql.NVarChar(60), categoria)
      .input("valor", sql.Decimal(12, 2), Number(valor.toFixed(2)))
      .input("dataDespesa", sql.Date, dataDespesa)
      .input("observacao", sql.NVarChar(500), observacaoRaw ? observacaoRaw.slice(0, 500) : null)
      .query(`
        UPDATE dbo.EmpresaDespesas
        SET
          Descricao = @descricao,
          Categoria = @categoria,
          Valor = @valor,
          DataDespesa = @dataDespesa,
          Observacao = @observacao,
          AtualizadoEm = ${SQL_BRAZIL_NOW}
        WHERE Id = @id
          AND EmpresaId = @empresaId;

        SELECT @@ROWCOUNT AS rows;

        SELECT TOP 1
          Id,
          EmpresaId,
          Descricao,
          Categoria,
          Valor,
          CONVERT(varchar(10), DataDespesa, 23) AS DataDespesa,
          Observacao,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
          CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
        FROM dbo.EmpresaDespesas
        WHERE Id = @id
          AND EmpresaId = @empresaId;
      `);

    if (Number(result.recordsets?.[0]?.[0]?.rows || 0) <= 0) {
      return res.status(404).json({ ok: false, error: "Despesa nao encontrada." });
    }

    const despesa = result.recordsets?.[1]?.[0]
      ? {
          ...result.recordsets[1][0],
          Valor: Number(result.recordsets[1][0].Valor || 0),
          CategoriaLabel: formatExpenseCategoryLabel(String(result.recordsets[1][0].Categoria || "")),
        }
      : null;

    financeiroLog.info({
      message: "Despesa atualizada",
      route: "/api/empresas/:slug/despesas/:id",
      slug,
      empresaId: empresa.Id,
      despesaId,
      categoria: despesa?.Categoria || categoria,
      valor: despesa?.Valor ?? Number(valor.toFixed(2)),
    });
    return res.json({ ok: true, despesa });
  } catch (err) {
    console.error("PUT /api/empresas/:slug/despesas/:id error:", err);
    financeiroLog.error({
      message: "Falha ao atualizar despesa",
      route: "/api/empresas/:slug/despesas/:id",
      slug,
      despesaId,
      error: { message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/empresas/:slug/despesas/:id", async (req, res) => {
  const { slug, id } = req.params;
  const despesaId = Number(id);
  if (!slug) return badRequest(res, "Slug e obrigatorio.");
  if (!Number.isFinite(despesaId) || despesaId <= 0) return badRequest(res, "id invalido.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa nao encontrada." });

    const ready = await ensureEmpresaDespesasTable(pool);
    if (!ready) return res.status(503).json({ ok: false, error: "Estrutura de despesas indisponivel." });

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("id", sql.Int, despesaId)
      .query(`
        DELETE FROM dbo.EmpresaDespesas
        WHERE Id = @id
          AND EmpresaId = @empresaId;

        SELECT @@ROWCOUNT AS rows;
      `);

    if (Number(result.recordset?.[0]?.rows || 0) <= 0) {
      return res.status(404).json({ ok: false, error: "Despesa nao encontrada." });
    }

    financeiroLog.info({
      message: "Despesa removida",
      route: "/api/empresas/:slug/despesas/:id",
      slug,
      empresaId: empresa.Id,
      despesaId,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/empresas/:slug/despesas/:id error:", err);
    financeiroLog.error({
      message: "Falha ao remover despesa",
      route: "/api/empresas/:slug/despesas/:id",
      slug,
      despesaId,
      error: { message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ======================================
 *  SOLICITACOES DE ORCAMENTO (CHAT/ADMIN)
 * ======================================
 */
app.post("/api/empresas/:slug/orcamentos/solicitacoes", publicRateLimiter, async (req, res) => {
  const { slug } = req.params;
  if (!slug) return badRequest(res, "Slug e obrigatorio.");

  const nome = normalizeTextField(req.body?.nome, 160, { required: true });
  const telefone = normalizePhoneDigits(req.body?.telefone);
  const tipoItem = normalizeTextField(req.body?.tipoItem, 120);
  const modelo = normalizeTextField(req.body?.modelo, 160, { required: true });
  const defeito = normalizeTextField(req.body?.defeito, 2000, { required: true });
  const observacoes = normalizeTextField(req.body?.observacoes, 2000);

  if (!nome) return badRequest(res, "Nome e obrigatorio.");
  if (!isValidPhoneDigits(telefone)) return badRequest(res, "Telefone invalido.");
  if (!modelo) return badRequest(res, "Modelo e obrigatorio.");
  if (!defeito) return badRequest(res, "Defeito e obrigatorio.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa nao encontrada." });

    const ready = await ensureEmpresaOrcamentoSolicitacoesTable(pool);
    if (!ready) return res.status(503).json({ ok: false, error: "Estrutura de solicitacoes de orcamento indisponivel." });

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("nome", sql.NVarChar(160), nome)
      .input("telefone", sql.NVarChar(30), telefone)
      .input("tipoItem", sql.NVarChar(120), tipoItem)
      .input("modelo", sql.NVarChar(160), modelo)
      .input("defeito", sql.NVarChar(2000), defeito)
      .input("observacoes", sql.NVarChar(2000), observacoes)
      .query(`
        INSERT INTO dbo.EmpresaOrcamentoSolicitacoes (
          EmpresaId, Nome, Telefone, TipoItem, Modelo, Defeito, Observacoes, Status, CriadoEm, AtualizadoEm
        )
        VALUES (
          @empresaId, @nome, @telefone, @tipoItem, @modelo, @defeito, @observacoes, N'novo', ${SQL_BRAZIL_NOW}, ${SQL_BRAZIL_NOW}
        );

        SELECT TOP 1
          Id,
          EmpresaId,
          Nome,
          Telefone,
          TipoItem,
          Modelo,
          Defeito,
          Observacoes,
          Status,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
          CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
        FROM dbo.EmpresaOrcamentoSolicitacoes
        WHERE Id = SCOPE_IDENTITY();
      `);

    const solicitacao = mapBudgetRequestRecord(result.recordset?.[0]);
    orcamentosLog.info({
      message: "Solicitacao de orcamento recebida",
      route: "/api/empresas/:slug/orcamentos/solicitacoes",
      slug,
      empresaId: empresa.Id,
      solicitacaoId: solicitacao?.Id || null,
      telefoneFinal: String(telefone || "").slice(-4),
    });
    return res.status(201).json({ ok: true, solicitacao });
  } catch (err) {
    console.error("POST /api/empresas/:slug/orcamentos/solicitacoes error:", err);
    orcamentosLog.error({
      message: "Falha ao registrar solicitacao de orcamento",
      route: "/api/empresas/:slug/orcamentos/solicitacoes",
      slug,
      error: { message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/empresas/:slug/orcamentos/solicitacoes", async (req, res) => {
  const { slug } = req.params;
  if (!slug) return badRequest(res, "Slug e obrigatorio.");

  const statusRaw = String(req.query.status || "").trim();
  if (!isValidBudgetRequestStatusInput(statusRaw)) return badRequest(res, "Status invalido.");
  const status = statusRaw ? normalizeBudgetRequestStatus(statusRaw) : null;
  const search = normalizeTextField(req.query.search, 120);
  const pageRaw = Number(req.query.page || 1);
  const pageSizeRaw = Number(req.query.pageSize || 20);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(100, Math.max(1, Math.floor(pageSizeRaw))) : 20;
  const offset = (page - 1) * pageSize;

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa nao encontrada." });

    const ready = await ensureEmpresaOrcamentoSolicitacoesTable(pool);
    if (!ready) return res.status(503).json({ ok: false, error: "Estrutura de solicitacoes de orcamento indisponivel." });

    const whereParts = ["EmpresaId = @empresaId"];
    if (status) whereParts.push("Status = @status");
    if (search) whereParts.push("(Nome LIKE @search OR Telefone LIKE @search OR Modelo LIKE @search OR Defeito LIKE @search)");
    const whereClause = whereParts.join("\n          AND ");

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("status", sql.NVarChar(40), status)
      .input("search", sql.NVarChar(140), search ? `%${search}%` : null)
      .input("offset", sql.Int, offset)
      .input("pageSize", sql.Int, pageSize)
      .query(`
        SELECT
          Id,
          EmpresaId,
          Nome,
          Telefone,
          TipoItem,
          Modelo,
          Defeito,
          Observacoes,
          Status,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
          CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
        FROM dbo.EmpresaOrcamentoSolicitacoes
        WHERE ${whereClause}
        ORDER BY Id DESC
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

        SELECT COUNT(1) AS Total
        FROM dbo.EmpresaOrcamentoSolicitacoes
        WHERE ${whereClause};
      `);

    const rows = (result.recordsets?.[0] || []).map((row) => mapBudgetRequestRecord(row));
    const total = Number(result.recordsets?.[1]?.[0]?.Total || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return res.json({
      ok: true,
      solicitacoes: rows,
      pagination: { page, pageSize, total, totalPages },
    });
  } catch (err) {
    console.error("GET /api/empresas/:slug/orcamentos/solicitacoes error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/empresas/:slug/orcamentos/solicitacoes/:id", async (req, res) => {
  const { slug, id } = req.params;
  const solicitacaoId = Number(id);
  if (!slug) return badRequest(res, "Slug e obrigatorio.");
  if (!Number.isFinite(solicitacaoId) || solicitacaoId <= 0) return badRequest(res, "id invalido.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa nao encontrada." });

    const ready = await ensureEmpresaOrcamentoSolicitacoesTable(pool);
    if (!ready) return res.status(503).json({ ok: false, error: "Estrutura de solicitacoes de orcamento indisponivel." });

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("id", sql.Int, solicitacaoId)
      .query(`
        SELECT TOP 1
          Id,
          EmpresaId,
          Nome,
          Telefone,
          TipoItem,
          Modelo,
          Defeito,
          Observacoes,
          Status,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
          CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
        FROM dbo.EmpresaOrcamentoSolicitacoes
        WHERE EmpresaId = @empresaId
          AND Id = @id;
      `);

    const solicitacao = mapBudgetRequestRecord(result.recordset?.[0]);
    if (!solicitacao) return res.status(404).json({ ok: false, error: "Solicitacao nao encontrada." });
    return res.json({ ok: true, solicitacao });
  } catch (err) {
    console.error("GET /api/empresas/:slug/orcamentos/solicitacoes/:id error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ===========================
 *  ORDENS DE SERVICO (ADMIN)
 * ===========================
 */
app.get("/api/empresas/:slug/ordens-servico", async (req, res) => {
  const { slug } = req.params;
  if (!slug) return badRequest(res, "Slug e obrigatorio.");

  const statusRaw = String(req.query.status || "").trim();
  const clienteRaw = String(req.query.cliente || "").trim();
  const numeroRaw = String(req.query.numero || "").trim();
  const startDateRaw = String(req.query.startDate || "").trim();
  const endDateRaw = String(req.query.endDate || "").trim();
  const pageRaw = Number(req.query.page || 1);
  const pageSizeRaw = Number(req.query.pageSize || 20);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(Math.max(Math.floor(pageSizeRaw), 5), 50) : 20;
  const offset = (page - 1) * pageSize;

  if (statusRaw && statusRaw !== "all" && !isValidOsOrderStatusInput(statusRaw)) {
    return badRequest(res, "Status invalido.");
  }

  const statusFilter = statusRaw && statusRaw !== "all" ? normalizeOsOrderStatus(statusRaw) : null;

  const hasDateRange = isValidDateYYYYMMDD(startDateRaw) && isValidDateYYYYMMDD(endDateRaw);
  const startDate = hasDateRange && startDateRaw > endDateRaw ? endDateRaw : startDateRaw;
  const endDate = hasDateRange && startDateRaw > endDateRaw ? startDateRaw : endDateRaw;

  const numeroId = Number(String(numeroRaw).replace(/\D/g, ""));
  const hasNumeroFilter = Number.isFinite(numeroId) && numeroId > 0;
  const hasClienteFilter = Boolean(clienteRaw);

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa nao encontrada." });

    const ready = await ensureEmpresaOrdensServicoTable(pool);
    if (!ready) return res.status(503).json({ ok: false, error: "Estrutura de ordens de servico indisponivel." });

    const whereParts = ["EmpresaId = @empresaId"];
    if (statusFilter) whereParts.push("StatusOrdem = @statusOrdem");
    if (hasClienteFilter) whereParts.push("(ClienteNome LIKE @clienteLike OR ClienteTelefone LIKE @clienteLike)");
    if (hasNumeroFilter) whereParts.push("Id = @numeroId");
    if (hasDateRange) whereParts.push("DataEntrada BETWEEN @startDate AND @endDate");
    const whereClause = whereParts.join("\n          AND ");

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("statusOrdem", sql.NVarChar(40), statusFilter)
      .input("clienteLike", sql.NVarChar(180), hasClienteFilter ? `%${clienteRaw}%` : null)
      .input("numeroId", sql.Int, hasNumeroFilter ? numeroId : null)
      .input("startDate", sql.Date, hasDateRange ? startDate : null)
      .input("endDate", sql.Date, hasDateRange ? endDate : null)
      .input("offset", sql.Int, offset)
      .input("pageSize", sql.Int, pageSize)
      .query(`
        SELECT
          Id,
          EmpresaId,
          ClienteNome,
          ClienteTelefone,
          TipoAparelho,
          Marca,
          Modelo,
          DefeitoRelatado,
          ValorTotal,
          StatusOrdem,
          StatusOrcamento,
          ISNULL(ReceitaGerada, 0) AS ReceitaGerada,
          FinanceiroReceitaId,
          CONVERT(varchar(19), ReceitaGeradaEm, 120) AS ReceitaGeradaEm,
          CONVERT(varchar(10), DataEntrada, 23) AS DataEntrada,
          CONVERT(varchar(10), PrevisaoEntrega, 23) AS PrevisaoEntrega,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
          CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
        FROM dbo.EmpresaOrdensServico
        WHERE ${whereClause}
        ORDER BY Id DESC
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

        SELECT COUNT(1) AS Total
        FROM dbo.EmpresaOrdensServico
        WHERE ${whereClause};
      `);

    const rows = (result.recordsets?.[0] || []).map((row) => ({
      ...mapOsRecord(row),
      DefeitoResumo: String(row.DefeitoRelatado || "").slice(0, 120),
    }));
    const total = Number(result.recordsets?.[1]?.[0]?.Total || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return res.json({
      ok: true,
      ordens: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    });
  } catch (err) {
    console.error("GET /api/empresas/:slug/ordens-servico error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/empresas/:slug/ordens-servico", async (req, res) => {
  const { slug } = req.params;
  if (!slug) return badRequest(res, "Slug e obrigatorio.");

  const clienteNome = normalizeTextField(req.body?.clienteNome, 160, { required: true });
  const clienteTelefone = normalizeTextField(req.body?.clienteTelefone, 30, { required: true });
  const clienteCpf = normalizeTextField(req.body?.clienteCpf, 20);
  const tipoAparelho = normalizeOsDeviceType(req.body?.tipoAparelho);
  const marca = normalizeTextField(req.body?.marca, 80, { required: true });
  const modelo = normalizeTextField(req.body?.modelo, 120, { required: true });
  const cor = normalizeTextField(req.body?.cor, 40);
  const imeiSerial = normalizeTextField(req.body?.imeiSerial, 120);
  const acessorios = normalizeTextField(req.body?.acessorios, 300);
  const senhaPadrao = normalizeTextField(req.body?.senhaPadrao, 120);
  const estadoEntrada = normalizeTextField(req.body?.estadoEntrada, 1000, { required: true });
  const defeitoRelatado = normalizeTextField(req.body?.defeitoRelatado, 2000, { required: true });
  const observacoesTecnicas = normalizeTextField(req.body?.observacoesTecnicas, 2000);
  const observacoesGerais = normalizeTextField(req.body?.observacoesGerais, 2000);
  const prazoEstimado = normalizeTextField(req.body?.prazoEstimado, 120);
  const dataEntrada = String(req.body?.dataEntrada || "").trim();
  const previsaoEntregaRaw = String(req.body?.previsaoEntrega || "").trim();
  const previsaoEntrega = previsaoEntregaRaw && isValidDateYYYYMMDD(previsaoEntregaRaw) ? previsaoEntregaRaw : null;
  const valorMaoObra = normalizeCurrencyValue(req.body?.valorMaoObra);
  const valorMaterialRaw = req.body?.valorMaterial ?? req.body?.valorPecas;
  const valorPecas = normalizeCurrencyValue(valorMaterialRaw);
  const valorTotal = Number((valorMaoObra + valorPecas).toFixed(2));

  if (!clienteNome) return badRequest(res, "Nome do cliente e obrigatorio.");
  if (!clienteTelefone) return badRequest(res, "Telefone do cliente e obrigatorio.");
  if (!marca) return badRequest(res, "Marca do aparelho e obrigatoria.");
  if (!modelo) return badRequest(res, "Modelo do aparelho e obrigatorio.");
  if (!estadoEntrada) return badRequest(res, "Estado de entrada e obrigatorio.");
  if (!defeitoRelatado) return badRequest(res, "Defeito relatado e obrigatorio.");
  if (!isValidDateYYYYMMDD(dataEntrada)) return badRequest(res, "Data de entrada invalida.");
  if (previsaoEntregaRaw && !previsaoEntrega) return badRequest(res, "Previsao de entrega invalida.");
  if (!isValidOsBudgetStatusInput(req.body?.statusOrcamento)) return badRequest(res, "Status do orcamento invalido.");
  if (!isValidOsOrderStatusInput(req.body?.statusOrdem)) return badRequest(res, "Status da ordem invalido.");

  const statusOrcamento = normalizeOsBudgetStatus(req.body?.statusOrcamento);
  const statusOrdem = normalizeOsOrderStatus(req.body?.statusOrdem);
  if (statusOrdem === "entregue" && (!Number.isFinite(valorMaoObra) || valorMaoObra <= 0)) {
    return badRequest(res, "Informe o valor da mao de obra antes de finalizar a OS.");
  }

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa nao encontrada." });

    const ready = await ensureEmpresaOrdensServicoTable(pool);
    if (!ready) return res.status(503).json({ ok: false, error: "Estrutura de ordens de servico indisponivel." });

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("clienteNome", sql.NVarChar(160), clienteNome)
      .input("clienteTelefone", sql.NVarChar(30), clienteTelefone)
      .input("clienteCpf", sql.NVarChar(20), clienteCpf)
      .input("tipoAparelho", sql.NVarChar(40), tipoAparelho)
      .input("marca", sql.NVarChar(80), marca)
      .input("modelo", sql.NVarChar(120), modelo)
      .input("cor", sql.NVarChar(40), cor)
      .input("imeiSerial", sql.NVarChar(120), imeiSerial)
      .input("acessorios", sql.NVarChar(300), acessorios)
      .input("senhaPadrao", sql.NVarChar(120), senhaPadrao)
      .input("estadoEntrada", sql.NVarChar(1000), estadoEntrada)
      .input("defeitoRelatado", sql.NVarChar(2000), defeitoRelatado)
      .input("observacoesTecnicas", sql.NVarChar(2000), observacoesTecnicas)
      .input("valorMaoObra", sql.Decimal(12, 2), valorMaoObra)
      .input("valorPecas", sql.Decimal(12, 2), valorPecas)
      .input("valorTotal", sql.Decimal(12, 2), valorTotal)
      .input("prazoEstimado", sql.NVarChar(120), prazoEstimado)
      .input("statusOrcamento", sql.NVarChar(40), statusOrcamento)
      .input("statusOrdem", sql.NVarChar(40), statusOrdem)
      .input("dataEntrada", sql.Date, dataEntrada)
      .input("previsaoEntrega", sql.Date, previsaoEntrega)
      .input("observacoesGerais", sql.NVarChar(2000), observacoesGerais)
      .query(`
        INSERT INTO dbo.EmpresaOrdensServico (
          EmpresaId,
          ClienteNome,
          ClienteTelefone,
          ClienteCpf,
          TipoAparelho,
          Marca,
          Modelo,
          Cor,
          ImeiSerial,
          Acessorios,
          SenhaPadrao,
          EstadoEntrada,
          DefeitoRelatado,
          ObservacoesTecnicas,
          ValorMaoObra,
          ValorPecas,
          ValorTotal,
          PrazoEstimado,
          StatusOrcamento,
          StatusOrdem,
          DataEntrada,
          PrevisaoEntrega,
          ObservacoesGerais,
          CriadoEm,
          AtualizadoEm
        )
        VALUES (
          @empresaId,
          @clienteNome,
          @clienteTelefone,
          @clienteCpf,
          @tipoAparelho,
          @marca,
          @modelo,
          @cor,
          @imeiSerial,
          @acessorios,
          @senhaPadrao,
          @estadoEntrada,
          @defeitoRelatado,
          @observacoesTecnicas,
          @valorMaoObra,
          @valorPecas,
          @valorTotal,
          @prazoEstimado,
          @statusOrcamento,
          @statusOrdem,
          @dataEntrada,
          @previsaoEntrega,
          @observacoesGerais,
          ${SQL_BRAZIL_NOW},
          ${SQL_BRAZIL_NOW}
        );

        SELECT TOP 1
          Id,
          EmpresaId,
          ClienteNome,
          ClienteTelefone,
          ClienteCpf,
          TipoAparelho,
          Marca,
          Modelo,
          Cor,
          ImeiSerial,
          Acessorios,
          SenhaPadrao,
          EstadoEntrada,
          DefeitoRelatado,
          ObservacoesTecnicas,
          ValorMaoObra,
          ValorPecas,
          ValorTotal,
          PrazoEstimado,
          StatusOrcamento,
          StatusOrdem,
          ISNULL(ReceitaGerada, 0) AS ReceitaGerada,
          FinanceiroReceitaId,
          CONVERT(varchar(19), ReceitaGeradaEm, 120) AS ReceitaGeradaEm,
          CONVERT(varchar(10), DataEntrada, 23) AS DataEntrada,
          CONVERT(varchar(10), PrevisaoEntrega, 23) AS PrevisaoEntrega,
          ObservacoesGerais,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
          CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
        FROM dbo.EmpresaOrdensServico
        WHERE Id = SCOPE_IDENTITY();
      `);

    let ordem = mapOsRecord(result.recordset?.[0], { includeSensitive: true });
    let financeiro = null;
    if (ordem?.StatusOrdem === "entregue") {
      const revenueResult = await createFinanceRevenueFromOs(pool, ordem);
      if (!revenueResult.ok) {
        if (revenueResult.reason === "valor_mao_obra_invalido") {
          return badRequest(res, "Informe o valor da mao de obra antes de finalizar a OS.");
        }
        return res.status(500).json({ ok: false, error: "Falha ao gerar receita automatica da OS." });
      }
      financeiro = {
        created: Boolean(revenueResult.created),
        alreadyExisted: !Boolean(revenueResult.created),
        receitaId: revenueResult.receitaId || null,
      };

      const refreshed = await pool
        .request()
        .input("empresaId", sql.Int, empresa.Id)
        .input("id", sql.Int, Number(ordem.Id))
        .query(`
          SELECT TOP 1
            Id,
            EmpresaId,
            ClienteNome,
            ClienteTelefone,
            ClienteCpf,
            TipoAparelho,
            Marca,
            Modelo,
            Cor,
            ImeiSerial,
            Acessorios,
            SenhaPadrao,
            EstadoEntrada,
            DefeitoRelatado,
            ObservacoesTecnicas,
            ValorMaoObra,
            ValorPecas,
            ValorTotal,
            PrazoEstimado,
            StatusOrcamento,
            StatusOrdem,
            ISNULL(ReceitaGerada, 0) AS ReceitaGerada,
            FinanceiroReceitaId,
            CONVERT(varchar(19), ReceitaGeradaEm, 120) AS ReceitaGeradaEm,
            CONVERT(varchar(10), DataEntrada, 23) AS DataEntrada,
            CONVERT(varchar(10), PrevisaoEntrega, 23) AS PrevisaoEntrega,
            ObservacoesGerais,
            CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
            CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
          FROM dbo.EmpresaOrdensServico
          WHERE EmpresaId = @empresaId
            AND Id = @id;
        `);
      ordem = mapOsRecord(refreshed.recordset?.[0], { includeSensitive: true }) || ordem;
    }

    ordensServicoLog.info({
      message: "Ordem de servico criada",
      route: "/api/empresas/:slug/ordens-servico",
      slug,
      empresaId: empresa.Id,
      ordemId: ordem?.Id || null,
      statusOrdem: ordem?.StatusOrdem || null,
      receitaGerada: Boolean(financeiro?.created),
    });
    if (financeiro?.created) {
      financeiroLog.info({
        message: "Receita gerada automaticamente por OS entregue",
        route: "/api/empresas/:slug/ordens-servico",
        slug,
        empresaId: empresa.Id,
        ordemId: ordem?.Id || null,
        receitaId: financeiro?.receitaId || null,
      });
    }
    return res.status(201).json({ ok: true, ordem, financeiro });
  } catch (err) {
    console.error("POST /api/empresas/:slug/ordens-servico error:", err);
    ordensServicoLog.error({
      message: "Falha ao criar ordem de servico",
      route: "/api/empresas/:slug/ordens-servico",
      slug,
      error: { message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/empresas/:slug/ordens-servico/:id", async (req, res) => {
  const { slug, id } = req.params;
  const ordemId = Number(id);
  if (!slug) return badRequest(res, "Slug e obrigatorio.");
  if (!Number.isFinite(ordemId) || ordemId <= 0) return badRequest(res, "id invalido.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa nao encontrada." });

    const ready = await ensureEmpresaOrdensServicoTable(pool);
    if (!ready) return res.status(503).json({ ok: false, error: "Estrutura de ordens de servico indisponivel." });

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("id", sql.Int, ordemId)
      .query(`
        SELECT TOP 1
          Id,
          EmpresaId,
          ClienteNome,
          ClienteTelefone,
          ClienteCpf,
          TipoAparelho,
          Marca,
          Modelo,
          Cor,
          ImeiSerial,
          Acessorios,
          SenhaPadrao,
          EstadoEntrada,
          DefeitoRelatado,
          ObservacoesTecnicas,
          ValorMaoObra,
          ValorPecas,
          ValorTotal,
          PrazoEstimado,
          StatusOrcamento,
          StatusOrdem,
          ISNULL(ReceitaGerada, 0) AS ReceitaGerada,
          FinanceiroReceitaId,
          CONVERT(varchar(19), ReceitaGeradaEm, 120) AS ReceitaGeradaEm,
          CONVERT(varchar(10), DataEntrada, 23) AS DataEntrada,
          CONVERT(varchar(10), PrevisaoEntrega, 23) AS PrevisaoEntrega,
          ObservacoesGerais,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
          CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
        FROM dbo.EmpresaOrdensServico
        WHERE EmpresaId = @empresaId
          AND Id = @id;
      `);

    const ordem = mapOsRecord(result.recordset?.[0], { includeSensitive: true });
    if (!ordem) return res.status(404).json({ ok: false, error: "Ordem de servico nao encontrada." });
    return res.json({ ok: true, ordem });
  } catch (err) {
    console.error("GET /api/empresas/:slug/ordens-servico/:id error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/empresas/:slug/ordens-servico/:id", async (req, res) => {
  const { slug, id } = req.params;
  const ordemId = Number(id);
  if (!slug) return badRequest(res, "Slug e obrigatorio.");
  if (!Number.isFinite(ordemId) || ordemId <= 0) return badRequest(res, "id invalido.");

  const clienteNome = normalizeTextField(req.body?.clienteNome, 160, { required: true });
  const clienteTelefone = normalizeTextField(req.body?.clienteTelefone, 30, { required: true });
  const clienteCpf = normalizeTextField(req.body?.clienteCpf, 20);
  const tipoAparelho = normalizeOsDeviceType(req.body?.tipoAparelho);
  const marca = normalizeTextField(req.body?.marca, 80, { required: true });
  const modelo = normalizeTextField(req.body?.modelo, 120, { required: true });
  const cor = normalizeTextField(req.body?.cor, 40);
  const imeiSerial = normalizeTextField(req.body?.imeiSerial, 120);
  const acessorios = normalizeTextField(req.body?.acessorios, 300);
  const senhaPadrao = normalizeTextField(req.body?.senhaPadrao, 120);
  const estadoEntrada = normalizeTextField(req.body?.estadoEntrada, 1000, { required: true });
  const defeitoRelatado = normalizeTextField(req.body?.defeitoRelatado, 2000, { required: true });
  const observacoesTecnicas = normalizeTextField(req.body?.observacoesTecnicas, 2000);
  const observacoesGerais = normalizeTextField(req.body?.observacoesGerais, 2000);
  const prazoEstimado = normalizeTextField(req.body?.prazoEstimado, 120);
  const dataEntrada = String(req.body?.dataEntrada || "").trim();
  const previsaoEntregaRaw = String(req.body?.previsaoEntrega || "").trim();
  const previsaoEntrega = previsaoEntregaRaw && isValidDateYYYYMMDD(previsaoEntregaRaw) ? previsaoEntregaRaw : null;
  const valorMaoObra = normalizeCurrencyValue(req.body?.valorMaoObra);
  const valorMaterialRaw = req.body?.valorMaterial ?? req.body?.valorPecas;
  const valorPecas = normalizeCurrencyValue(valorMaterialRaw);
  const valorTotal = Number((valorMaoObra + valorPecas).toFixed(2));

  if (!clienteNome) return badRequest(res, "Nome do cliente e obrigatorio.");
  if (!clienteTelefone) return badRequest(res, "Telefone do cliente e obrigatorio.");
  if (!marca) return badRequest(res, "Marca do aparelho e obrigatoria.");
  if (!modelo) return badRequest(res, "Modelo do aparelho e obrigatorio.");
  if (!estadoEntrada) return badRequest(res, "Estado de entrada e obrigatorio.");
  if (!defeitoRelatado) return badRequest(res, "Defeito relatado e obrigatorio.");
  if (!isValidDateYYYYMMDD(dataEntrada)) return badRequest(res, "Data de entrada invalida.");
  if (previsaoEntregaRaw && !previsaoEntrega) return badRequest(res, "Previsao de entrega invalida.");
  if (!isValidOsBudgetStatusInput(req.body?.statusOrcamento)) return badRequest(res, "Status do orcamento invalido.");
  if (!isValidOsOrderStatusInput(req.body?.statusOrdem)) return badRequest(res, "Status da ordem invalido.");

  const statusOrcamento = normalizeOsBudgetStatus(req.body?.statusOrcamento);
  const statusOrdem = normalizeOsOrderStatus(req.body?.statusOrdem);
  if (statusOrdem === "entregue" && (!Number.isFinite(valorMaoObra) || valorMaoObra <= 0)) {
    return badRequest(res, "Informe o valor da mao de obra antes de finalizar a OS.");
  }

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa nao encontrada." });

    const ready = await ensureEmpresaOrdensServicoTable(pool);
    if (!ready) return res.status(503).json({ ok: false, error: "Estrutura de ordens de servico indisponivel." });

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("id", sql.Int, ordemId)
      .input("clienteNome", sql.NVarChar(160), clienteNome)
      .input("clienteTelefone", sql.NVarChar(30), clienteTelefone)
      .input("clienteCpf", sql.NVarChar(20), clienteCpf)
      .input("tipoAparelho", sql.NVarChar(40), tipoAparelho)
      .input("marca", sql.NVarChar(80), marca)
      .input("modelo", sql.NVarChar(120), modelo)
      .input("cor", sql.NVarChar(40), cor)
      .input("imeiSerial", sql.NVarChar(120), imeiSerial)
      .input("acessorios", sql.NVarChar(300), acessorios)
      .input("senhaPadrao", sql.NVarChar(120), senhaPadrao)
      .input("estadoEntrada", sql.NVarChar(1000), estadoEntrada)
      .input("defeitoRelatado", sql.NVarChar(2000), defeitoRelatado)
      .input("observacoesTecnicas", sql.NVarChar(2000), observacoesTecnicas)
      .input("valorMaoObra", sql.Decimal(12, 2), valorMaoObra)
      .input("valorPecas", sql.Decimal(12, 2), valorPecas)
      .input("valorTotal", sql.Decimal(12, 2), valorTotal)
      .input("prazoEstimado", sql.NVarChar(120), prazoEstimado)
      .input("statusOrcamento", sql.NVarChar(40), statusOrcamento)
      .input("statusOrdem", sql.NVarChar(40), statusOrdem)
      .input("dataEntrada", sql.Date, dataEntrada)
      .input("previsaoEntrega", sql.Date, previsaoEntrega)
      .input("observacoesGerais", sql.NVarChar(2000), observacoesGerais)
      .query(`
        UPDATE dbo.EmpresaOrdensServico
        SET
          ClienteNome = @clienteNome,
          ClienteTelefone = @clienteTelefone,
          ClienteCpf = @clienteCpf,
          TipoAparelho = @tipoAparelho,
          Marca = @marca,
          Modelo = @modelo,
          Cor = @cor,
          ImeiSerial = @imeiSerial,
          Acessorios = @acessorios,
          SenhaPadrao = @senhaPadrao,
          EstadoEntrada = @estadoEntrada,
          DefeitoRelatado = @defeitoRelatado,
          ObservacoesTecnicas = @observacoesTecnicas,
          ValorMaoObra = @valorMaoObra,
          ValorPecas = @valorPecas,
          ValorTotal = @valorTotal,
          PrazoEstimado = @prazoEstimado,
          StatusOrcamento = @statusOrcamento,
          StatusOrdem = @statusOrdem,
          DataEntrada = @dataEntrada,
          PrevisaoEntrega = @previsaoEntrega,
          ObservacoesGerais = @observacoesGerais,
          AtualizadoEm = ${SQL_BRAZIL_NOW}
        WHERE Id = @id
          AND EmpresaId = @empresaId;

        SELECT @@ROWCOUNT AS rows;

        SELECT TOP 1
          Id,
          EmpresaId,
          ClienteNome,
          ClienteTelefone,
          ClienteCpf,
          TipoAparelho,
          Marca,
          Modelo,
          Cor,
          ImeiSerial,
          Acessorios,
          SenhaPadrao,
          EstadoEntrada,
          DefeitoRelatado,
          ObservacoesTecnicas,
          ValorMaoObra,
          ValorPecas,
          ValorTotal,
          PrazoEstimado,
          StatusOrcamento,
          StatusOrdem,
          ISNULL(ReceitaGerada, 0) AS ReceitaGerada,
          FinanceiroReceitaId,
          CONVERT(varchar(19), ReceitaGeradaEm, 120) AS ReceitaGeradaEm,
          CONVERT(varchar(10), DataEntrada, 23) AS DataEntrada,
          CONVERT(varchar(10), PrevisaoEntrega, 23) AS PrevisaoEntrega,
          ObservacoesGerais,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
          CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
        FROM dbo.EmpresaOrdensServico
        WHERE Id = @id
          AND EmpresaId = @empresaId;
      `);

    if (Number(result.recordsets?.[0]?.[0]?.rows || 0) <= 0) {
      return res.status(404).json({ ok: false, error: "Ordem de servico nao encontrada." });
    }

    let ordem = mapOsRecord(result.recordsets?.[1]?.[0], { includeSensitive: true });
    let financeiro = null;
    if (ordem?.StatusOrdem === "entregue") {
      const revenueResult = await createFinanceRevenueFromOs(pool, ordem);
      if (!revenueResult.ok) {
        if (revenueResult.reason === "valor_mao_obra_invalido") {
          return badRequest(res, "Informe o valor da mao de obra antes de finalizar a OS.");
        }
        return res.status(500).json({ ok: false, error: "Falha ao gerar receita automatica da OS." });
      }
      financeiro = {
        created: Boolean(revenueResult.created),
        alreadyExisted: !Boolean(revenueResult.created),
        receitaId: revenueResult.receitaId || null,
      };

      const refreshed = await pool
        .request()
        .input("empresaId", sql.Int, empresa.Id)
        .input("id", sql.Int, ordemId)
        .query(`
          SELECT TOP 1
            Id,
            EmpresaId,
            ClienteNome,
            ClienteTelefone,
            ClienteCpf,
            TipoAparelho,
            Marca,
            Modelo,
            Cor,
            ImeiSerial,
            Acessorios,
            SenhaPadrao,
            EstadoEntrada,
            DefeitoRelatado,
            ObservacoesTecnicas,
            ValorMaoObra,
            ValorPecas,
            ValorTotal,
            PrazoEstimado,
            StatusOrcamento,
            StatusOrdem,
            ISNULL(ReceitaGerada, 0) AS ReceitaGerada,
            FinanceiroReceitaId,
            CONVERT(varchar(19), ReceitaGeradaEm, 120) AS ReceitaGeradaEm,
            CONVERT(varchar(10), DataEntrada, 23) AS DataEntrada,
            CONVERT(varchar(10), PrevisaoEntrega, 23) AS PrevisaoEntrega,
            ObservacoesGerais,
            CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
            CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
          FROM dbo.EmpresaOrdensServico
          WHERE Id = @id
            AND EmpresaId = @empresaId;
        `);
      ordem = mapOsRecord(refreshed.recordset?.[0], { includeSensitive: true }) || ordem;
    }

    ordensServicoLog.info({
      message: "Ordem de servico atualizada",
      route: "/api/empresas/:slug/ordens-servico/:id",
      slug,
      empresaId: empresa.Id,
      ordemId,
      statusOrdem: ordem?.StatusOrdem || null,
      receitaGerada: Boolean(financeiro?.created),
      receitaJaExistia: Boolean(financeiro?.alreadyExisted),
    });
    if (financeiro?.created || financeiro?.alreadyExisted) {
      financeiroLog.info({
        message: financeiro?.created
          ? "Receita gerada automaticamente por atualizacao de OS entregue"
          : "Receita de OS entregue ja existia no financeiro",
        route: "/api/empresas/:slug/ordens-servico/:id",
        slug,
        empresaId: empresa.Id,
        ordemId,
        receitaId: financeiro?.receitaId || ordem?.FinanceiroReceitaId || null,
      });
    }
    return res.json({ ok: true, ordem, financeiro });
  } catch (err) {
    console.error("PUT /api/empresas/:slug/ordens-servico/:id error:", err);
    ordensServicoLog.error({
      message: "Falha ao atualizar ordem de servico",
      route: "/api/empresas/:slug/ordens-servico/:id",
      slug,
      ordemId,
      error: { message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/empresas/:slug/ordens-servico/:id/status", async (req, res) => {
  const { slug, id } = req.params;
  const ordemId = Number(id);
  if (!slug) return badRequest(res, "Slug e obrigatorio.");
  if (!Number.isFinite(ordemId) || ordemId <= 0) return badRequest(res, "id invalido.");
  if (!isValidOsOrderStatusInput(req.body?.statusOrdem)) return badRequest(res, "Status da ordem invalido.");
  if (!isValidOsBudgetStatusInput(req.body?.statusOrcamento)) return badRequest(res, "Status do orcamento invalido.");

  const statusOrdemRaw = String(req.body?.statusOrdem || "").trim();
  const statusOrcamentoRaw = String(req.body?.statusOrcamento || "").trim();
  if (!statusOrdemRaw && !statusOrcamentoRaw) {
    return badRequest(res, "Informe pelo menos um status para atualizar.");
  }

  const statusOrdem = statusOrdemRaw ? normalizeOsOrderStatus(statusOrdemRaw) : null;
  const statusOrcamento = statusOrcamentoRaw ? normalizeOsBudgetStatus(statusOrcamentoRaw) : null;

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa nao encontrada." });

    const ready = await ensureEmpresaOrdensServicoTable(pool);
    if (!ready) return res.status(503).json({ ok: false, error: "Estrutura de ordens de servico indisponivel." });

    const currentResult = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("id", sql.Int, ordemId)
      .query(`
        SELECT TOP 1
          Id,
          EmpresaId,
          ClienteNome,
          ClienteTelefone,
          ClienteCpf,
          TipoAparelho,
          Marca,
          Modelo,
          Cor,
          ImeiSerial,
          Acessorios,
          SenhaPadrao,
          EstadoEntrada,
          DefeitoRelatado,
          ObservacoesTecnicas,
          ValorMaoObra,
          ValorPecas,
          ValorTotal,
          PrazoEstimado,
          StatusOrcamento,
          StatusOrdem,
          ISNULL(ReceitaGerada, 0) AS ReceitaGerada,
          FinanceiroReceitaId,
          CONVERT(varchar(19), ReceitaGeradaEm, 120) AS ReceitaGeradaEm,
          CONVERT(varchar(10), DataEntrada, 23) AS DataEntrada,
          CONVERT(varchar(10), PrevisaoEntrega, 23) AS PrevisaoEntrega,
          ObservacoesGerais,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
          CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
        FROM dbo.EmpresaOrdensServico
        WHERE Id = @id
          AND EmpresaId = @empresaId;
      `);

    const currentOrder = mapOsRecord(currentResult.recordset?.[0], { includeSensitive: true });
    if (!currentOrder) {
      return res.status(404).json({ ok: false, error: "Ordem de servico nao encontrada." });
    }

    const effectiveStatusOrdem = statusOrdem || currentOrder.StatusOrdem;
    if (effectiveStatusOrdem === "entregue" && (!Number.isFinite(currentOrder.ValorMaoObra) || Number(currentOrder.ValorMaoObra) <= 0)) {
      return badRequest(res, "Informe o valor da mao de obra antes de finalizar a OS.");
    }

    const sets = [];
    if (statusOrdem) sets.push("StatusOrdem = @statusOrdem");
    if (statusOrcamento) sets.push("StatusOrcamento = @statusOrcamento");
    sets.push(`AtualizadoEm = ${SQL_BRAZIL_NOW}`);

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("id", sql.Int, ordemId)
      .input("statusOrdem", sql.NVarChar(40), statusOrdem)
      .input("statusOrcamento", sql.NVarChar(40), statusOrcamento)
      .query(`
        UPDATE dbo.EmpresaOrdensServico
        SET ${sets.join(", ")}
        WHERE Id = @id
          AND EmpresaId = @empresaId;

        SELECT @@ROWCOUNT AS rows;

        SELECT TOP 1
          Id,
          EmpresaId,
          ClienteNome,
          ClienteTelefone,
          ClienteCpf,
          TipoAparelho,
          Marca,
          Modelo,
          Cor,
          ImeiSerial,
          Acessorios,
          SenhaPadrao,
          EstadoEntrada,
          DefeitoRelatado,
          ObservacoesTecnicas,
          ValorMaoObra,
          ValorPecas,
          ValorTotal,
          PrazoEstimado,
          StatusOrcamento,
          StatusOrdem,
          ISNULL(ReceitaGerada, 0) AS ReceitaGerada,
          FinanceiroReceitaId,
          CONVERT(varchar(19), ReceitaGeradaEm, 120) AS ReceitaGeradaEm,
          CONVERT(varchar(10), DataEntrada, 23) AS DataEntrada,
          CONVERT(varchar(10), PrevisaoEntrega, 23) AS PrevisaoEntrega,
          ObservacoesGerais,
          CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
          CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
        FROM dbo.EmpresaOrdensServico
        WHERE Id = @id
          AND EmpresaId = @empresaId;
      `);

    if (Number(result.recordsets?.[0]?.[0]?.rows || 0) <= 0) {
      return res.status(404).json({ ok: false, error: "Ordem de servico nao encontrada." });
    }

    let ordem = mapOsRecord(result.recordsets?.[1]?.[0], { includeSensitive: true });
    let financeiro = null;
    if (ordem?.StatusOrdem === "entregue") {
      const revenueResult = await createFinanceRevenueFromOs(pool, ordem);
      if (!revenueResult.ok) {
        if (revenueResult.reason === "valor_mao_obra_invalido") {
          return badRequest(res, "Informe o valor da mao de obra antes de finalizar a OS.");
        }
        return res.status(500).json({ ok: false, error: "Falha ao gerar receita automatica da OS." });
      }

      financeiro = {
        created: Boolean(revenueResult.created),
        alreadyExisted: !Boolean(revenueResult.created),
        receitaId: revenueResult.receitaId || null,
      };

      const refreshed = await pool
        .request()
        .input("empresaId", sql.Int, empresa.Id)
        .input("id", sql.Int, ordemId)
        .query(`
          SELECT TOP 1
            Id,
            EmpresaId,
            ClienteNome,
            ClienteTelefone,
            ClienteCpf,
            TipoAparelho,
            Marca,
            Modelo,
            Cor,
            ImeiSerial,
            Acessorios,
            SenhaPadrao,
            EstadoEntrada,
            DefeitoRelatado,
            ObservacoesTecnicas,
            ValorMaoObra,
            ValorPecas,
            ValorTotal,
            PrazoEstimado,
            StatusOrcamento,
            StatusOrdem,
            ISNULL(ReceitaGerada, 0) AS ReceitaGerada,
            FinanceiroReceitaId,
            CONVERT(varchar(19), ReceitaGeradaEm, 120) AS ReceitaGeradaEm,
            CONVERT(varchar(10), DataEntrada, 23) AS DataEntrada,
            CONVERT(varchar(10), PrevisaoEntrega, 23) AS PrevisaoEntrega,
            ObservacoesGerais,
            CONVERT(varchar(19), CriadoEm, 120) AS CriadoEm,
            CONVERT(varchar(19), AtualizadoEm, 120) AS AtualizadoEm
          FROM dbo.EmpresaOrdensServico
          WHERE Id = @id
            AND EmpresaId = @empresaId;
        `);
      ordem = mapOsRecord(refreshed.recordset?.[0], { includeSensitive: true }) || ordem;
    }

    ordensServicoLog.info({
      message: "Status da ordem de servico atualizado",
      route: "/api/empresas/:slug/ordens-servico/:id/status",
      slug,
      empresaId: empresa.Id,
      ordemId,
      statusOrdemAnterior: currentOrder?.StatusOrdem || null,
      statusOrdemNovo: ordem?.StatusOrdem || currentOrder?.StatusOrdem || null,
      statusOrcamentoNovo: ordem?.StatusOrcamento || currentOrder?.StatusOrcamento || null,
      receitaGerada: Boolean(financeiro?.created),
      receitaJaExistia: Boolean(financeiro?.alreadyExisted),
    });
    if (financeiro?.created || financeiro?.alreadyExisted) {
      financeiroLog.info({
        message: financeiro?.created
          ? "Receita gerada automaticamente ao marcar OS como entregue"
          : "Receita da OS ja existia ao marcar como entregue",
        route: "/api/empresas/:slug/ordens-servico/:id/status",
        slug,
        empresaId: empresa.Id,
        ordemId,
        receitaId: financeiro?.receitaId || ordem?.FinanceiroReceitaId || null,
      });
    }
    return res.json({ ok: true, ordem, financeiro });
  } catch (err) {
    console.error("PATCH /api/empresas/:slug/ordens-servico/:id/status error:", err);
    ordensServicoLog.error({
      message: "Falha ao atualizar status da ordem de servico",
      route: "/api/empresas/:slug/ordens-servico/:id/status",
      slug,
      ordemId,
      error: { message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ===========================
 *  INSIGHTS (ADMIN)
 * ===========================
 * GET /api/empresas/:slug/insights/resumo
 */
app.get("/api/empresas/:slug/insights/resumo", async (req, res) => {
  const { slug } = req.params;
  const periodRaw = String(req.query.period || "week").trim().toLowerCase();
  const period = new Set(["week", "month", "next7", "custom"]).has(periodRaw)
    ? periodRaw
    : "week";
  const startDateRaw = String(req.query.startDate || "").trim();
  const profissionalId = req.query.profissionalId ? Number(req.query.profissionalId) : null;
  const endDateRaw = String(req.query.endDate || "").trim();
  const revenueMode = String(req.query.revenueMode || "actual")
    .trim()
    .toLowerCase();
  const isForecastMode = revenueMode === "forecast";
  const hasCustomRange = isValidDateYYYYMMDD(startDateRaw) && isValidDateYYYYMMDD(endDateRaw);
  const startDate = hasCustomRange && startDateRaw > endDateRaw ? endDateRaw : startDateRaw;
  const endDate = hasCustomRange && startDateRaw > endDateRaw ? startDateRaw : endDateRaw;

  if (!slug) return badRequest(res, "Slug é obrigatório.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const financeRules = await getEmpresaFinanceRules(pool, empresa.Id);
    const expensesReady = await ensureEmpresaDespesasTable(pool);
    const agColumns = await getAgendamentosColumns(pool);
    const hasProfissionalId = agColumns.has("ProfissionalId");
    const hasValorFinal = agColumns.has("ValorFinal");
    const profissionalWhere = Number.isFinite(profissionalId) && hasProfissionalId ? " AND ag.ProfissionalId = @profissionalId " : "";

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("profissionalId", sql.Int, Number.isFinite(profissionalId) ? Number(profissionalId) : null)
      .query(`
        SELECT
          ag.Id AS AgendamentoId,
          ag.ServicoId,
          ag.Servico,
          CONVERT(varchar(10), ag.DataAgendada, 23) AS DataAgendada,
          ag.HoraAgendada,
          ag.InicioEm,
          LTRIM(RTRIM(ag.Status)) AS AgendamentoStatus,
          c.Nome AS ClienteNome,
          ${hasValorFinal ? "ISNULL(ag.ValorFinal, ISNULL(es.Preco, 0))" : "ISNULL(es.Preco, 0)"} AS ServicoPreco
        FROM dbo.Agendamentos ag
        LEFT JOIN dbo.EmpresaServicos es
          ON es.EmpresaId = ag.EmpresaId
         AND es.Id = ag.ServicoId
        LEFT JOIN dbo.Atendimentos at ON at.Id = ag.AtendimentoId
        LEFT JOIN dbo.Clientes c ON c.Id = at.ClienteId
        WHERE ag.EmpresaId = @empresaId
        ${profissionalWhere};
      `);

    const agendamentos = result.recordset || [];
    const now = new Date();
    const today = getLocalDateYMD(now);

    const weekStart = getStartOfWeekDate(now);
    const weekEnd = getEndOfWeekDate(now);
    const monthStart = getStartOfMonthDate(now);
    const monthEnd = getEndOfMonthDate(now);
    const prevWeekStart = addDaysLocalDate(weekStart, -7);
    const prevWeekEnd = addDaysLocalDate(weekEnd, -7);
    const prevMonthStart = getStartOfMonthDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const prevMonthEnd = getEndOfMonthDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));

    const pendingCount = agendamentos.filter((ag) => normalizeStatus(ag.AgendamentoStatus) === "pending").length;

    const todayAgenda = agendamentos
      .filter((ag) => normalizeStatus(ag.AgendamentoStatus) !== "cancelled")
      .filter((ag) => toIsoDateOnly(ag.DataAgendada) === today)
      .sort((a, b) => {
        const aTime = extractHHMM(a.HoraAgendada || a.InicioEm);
        const bTime = extractHHMM(b.HoraAgendada || b.InicioEm);
        return aTime.localeCompare(bTime);
      });

    const weekAgendaCount = agendamentos.filter((ag) => {
      const status = normalizeStatus(ag.AgendamentoStatus);
      if (status === "cancelled") return false;
      const date = parseYMDToLocalDate(toIsoDateOnly(ag.DataAgendada));
      if (!date) return false;
      return date >= weekStart && date <= weekEnd;
    }).length;

    const weekStartYmd = getLocalDateYMD(weekStart);
    const weekEndYmd = getLocalDateYMD(weekEnd);
    const monthStartYmd = getLocalDateYMD(monthStart);
    const monthEndYmd = getLocalDateYMD(monthEnd);
    const prevWeekStartYmd = getLocalDateYMD(prevWeekStart);
    const prevWeekEndYmd = getLocalDateYMD(prevWeekEnd);
    const prevMonthStartYmd = getLocalDateYMD(prevMonthStart);
    const prevMonthEndYmd = getLocalDateYMD(prevMonthEnd);
    const next7StartYmd = today;
    const next7EndYmd = getLocalDateYMD(addDaysLocalDate(parseYMDToLocalDate(today), 6));

    let weekRevenue = 0;
    let monthRevenue = 0;
    let customRevenue = 0;
    let prevWeekRevenue = 0;
    let prevMonthRevenue = 0;
    let weekExpensesActual = 0;
    let monthExpensesActual = 0;
    let customExpensesActual = 0;
    let prevWeekExpensesActual = 0;
    let prevMonthExpensesActual = 0;
    let expensesByCategory = [];
    let topExpenses = [];
    let weekAppointmentsCount = 0;
    let monthAppointmentsCount = 0;
    let customAppointmentsCount = 0;
    let weekOsRevenue = 0;
    let prevWeekOsRevenue = 0;
    let monthOsRevenue = 0;
    let prevMonthOsRevenue = 0;
    let customOsRevenue = 0;
    const osRevenueByDay = new Map();

    // Receita hibrida:
    // 1) usa FinanceiroDiario (preserva historico mesmo com limpeza de agendamentos)
    // 2) complementa apenas dias sem agregado usando agendamentos concluidos (cobre backfill pendente)
    const completedByDay = new Map();
    const forecastByDay = new Map();
    for (const ag of agendamentos) {
      const normalizedStatus = normalizeStatus(ag.AgendamentoStatus);
      const ymd = toIsoDateOnly(ag.DataAgendada);
      if (!ymd) continue;
      const valorServico = Number(ag.ServicoPreco) || 0;

      if (normalizedStatus === "completed") {
        completedByDay.set(ymd, (completedByDay.get(ymd) || 0) + valorServico);
      }
      if (normalizedStatus === "pending" || normalizedStatus === "confirmed") {
        forecastByDay.set(ymd, (forecastByDay.get(ymd) || 0) + valorServico);
      }
    }

    const weekAgRevenue = [...completedByDay.entries()]
      .filter(([ymd]) => ymd >= weekStartYmd && ymd <= weekEndYmd)
      .reduce((sum, [, amount]) => sum + amount, 0);
    const prevWeekAgRevenue = [...completedByDay.entries()]
      .filter(([ymd]) => ymd >= prevWeekStartYmd && ymd <= prevWeekEndYmd)
      .reduce((sum, [, amount]) => sum + amount, 0);
    const monthAgRevenue = [...completedByDay.entries()]
      .filter(([ymd]) => ymd >= monthStartYmd && ymd <= monthEndYmd)
      .reduce((sum, [, amount]) => sum + amount, 0);
    const prevMonthAgRevenue = [...completedByDay.entries()]
      .filter(([ymd]) => ymd >= prevMonthStartYmd && ymd <= prevMonthEndYmd)
      .reduce((sum, [, amount]) => sum + amount, 0);
    const customAgRevenue = hasCustomRange
      ? [...completedByDay.entries()]
          .filter(([ymd]) => ymd >= startDate && ymd <= endDate)
          .reduce((sum, [, amount]) => sum + amount, 0)
      : 0;

    for (const ag of agendamentos) {
      if (normalizeStatus(ag.AgendamentoStatus) !== "completed") continue;
      const ymd = toIsoDateOnly(ag.DataAgendada);
      if (!ymd) continue;

      if (ymd >= weekStartYmd && ymd <= weekEndYmd) weekAppointmentsCount += 1;
      if (ymd >= monthStartYmd && ymd <= monthEndYmd) monthAppointmentsCount += 1;
      if (hasCustomRange && ymd >= startDate && ymd <= endDate) customAppointmentsCount += 1;
    }
    const customForecastRevenue = hasCustomRange
      ? [...forecastByDay.entries()]
          .filter(([ymd]) => ymd >= startDate && ymd <= endDate)
          .reduce((sum, [, amount]) => sum + amount, 0)
      : 0;

    function sumMapRange(mapRef, startYmd, endYmd) {
      return [...mapRef.entries()]
        .filter(([ymd]) => ymd >= startYmd && ymd <= endYmd)
        .reduce((sum, [, amount]) => sum + (Number(amount || 0)), 0);
    }

    const useFinanceiroDiarioAggregate = !(Number.isFinite(profissionalId) && Number(profissionalId) > 0);
    if (useFinanceiroDiarioAggregate) {
      try {
        const hasReceitasTable = await hasTable(pool, "dbo.EmpresaFinanceiroReceitas");
        if (hasReceitasTable) {
          const osRevenueWindowStart = [prevWeekStartYmd, prevMonthStartYmd, weekStartYmd, monthStartYmd, hasCustomRange ? startDate : null]
            .filter(Boolean)
            .sort()[0];
          const osRevenueWindowEnd = [weekEndYmd, monthEndYmd, prevWeekEndYmd, prevMonthEndYmd, hasCustomRange ? endDate : null]
            .filter(Boolean)
            .sort()
            .slice(-1)[0];

          const osRevenuesResult = await pool
            .request()
            .input("empresaId", sql.Int, empresa.Id)
            .input("weekStart", sql.Date, weekStartYmd)
            .input("weekEnd", sql.Date, weekEndYmd)
            .input("prevWeekStart", sql.Date, prevWeekStartYmd)
            .input("prevWeekEnd", sql.Date, prevWeekEndYmd)
            .input("monthStart", sql.Date, monthStartYmd)
            .input("monthEnd", sql.Date, monthEndYmd)
            .input("prevMonthStart", sql.Date, prevMonthStartYmd)
            .input("prevMonthEnd", sql.Date, prevMonthEndYmd)
            .input("startDate", sql.Date, hasCustomRange ? startDate : null)
            .input("endDate", sql.Date, hasCustomRange ? endDate : null)
            .input("windowStart", sql.Date, osRevenueWindowStart)
            .input("windowEnd", sql.Date, osRevenueWindowEnd)
            .query(`
              SELECT
                ISNULL(SUM(CASE WHEN DataRef BETWEEN @weekStart AND @weekEnd THEN Valor ELSE 0 END), 0) AS WeekOsRevenue,
                ISNULL(SUM(CASE WHEN DataRef BETWEEN @prevWeekStart AND @prevWeekEnd THEN Valor ELSE 0 END), 0) AS PrevWeekOsRevenue,
                ISNULL(SUM(CASE WHEN DataRef BETWEEN @monthStart AND @monthEnd THEN Valor ELSE 0 END), 0) AS MonthOsRevenue,
                ISNULL(SUM(CASE WHEN DataRef BETWEEN @prevMonthStart AND @prevMonthEnd THEN Valor ELSE 0 END), 0) AS PrevMonthOsRevenue,
                ISNULL(SUM(CASE WHEN @startDate IS NOT NULL AND @endDate IS NOT NULL AND DataRef BETWEEN @startDate AND @endDate THEN Valor ELSE 0 END), 0) AS CustomOsRevenue
              FROM dbo.EmpresaFinanceiroReceitas
              WHERE EmpresaId = @empresaId
                AND OrigemTipo = 'ordem_servico';

              SELECT
                CONVERT(varchar(10), DataRef, 23) AS DataRef,
                ISNULL(SUM(Valor), 0) AS Total
              FROM dbo.EmpresaFinanceiroReceitas
              WHERE EmpresaId = @empresaId
                AND OrigemTipo = 'ordem_servico'
                AND DataRef BETWEEN @windowStart AND @windowEnd
              GROUP BY DataRef
              ORDER BY DataRef ASC;
            `);

          weekOsRevenue = Number(osRevenuesResult.recordsets?.[0]?.[0]?.WeekOsRevenue || 0);
          prevWeekOsRevenue = Number(osRevenuesResult.recordsets?.[0]?.[0]?.PrevWeekOsRevenue || 0);
          monthOsRevenue = Number(osRevenuesResult.recordsets?.[0]?.[0]?.MonthOsRevenue || 0);
          prevMonthOsRevenue = Number(osRevenuesResult.recordsets?.[0]?.[0]?.PrevMonthOsRevenue || 0);
          customOsRevenue = Number(osRevenuesResult.recordsets?.[0]?.[0]?.CustomOsRevenue || 0);

          for (const row of osRevenuesResult.recordsets?.[1] || []) {
            const ymd = toIsoDateOnly(row.DataRef);
            if (!ymd) continue;
            osRevenueByDay.set(ymd, Number(row.Total || 0));
          }
        }
      } catch (osRevenueErr) {
        console.warn("Nao foi possivel agregar receitas de OS no resumo financeiro:", osRevenueErr?.message || osRevenueErr);
      }
    }

    try {
      if (!useFinanceiroDiarioAggregate) {
        throw new Error("FinanceiroDiario desabilitado para filtro por profissional");
      }

      const mergedStartCandidates = [weekStartYmd, monthStartYmd];
      const mergedEndCandidates = [weekEndYmd, monthEndYmd];
      if (hasCustomRange) {
        mergedStartCandidates.push(startDate);
        mergedEndCandidates.push(endDate);
      }
      const mergedStart = mergedStartCandidates.sort()[0];
      const mergedEnd = mergedEndCandidates.sort().slice(-1)[0];

      const financeiroRows = await pool
        .request()
        .input("empresaId", sql.Int, empresa.Id)
        .input("startDate", sql.Date, mergedStart)
        .input("endDate", sql.Date, mergedEnd)
        .query(`
          SELECT
            CONVERT(varchar(10), DataRef, 23) AS DataRef,
            ISNULL(ReceitaConcluida, 0) AS ReceitaConcluida
          FROM dbo.FinanceiroDiario
          WHERE EmpresaId = @empresaId
            AND DataRef BETWEEN @startDate AND @endDate;
        `);

      const dailyByDay = new Map();
      for (const row of financeiroRows.recordset || []) {
        const ymd = toIsoDateOnly(row.DataRef);
        if (!ymd) continue;
        dailyByDay.set(ymd, Number(row.ReceitaConcluida || 0));
      }

      function getHybridRevenue(startYmd, endYmd) {
        const dailyInRange = [...dailyByDay.entries()].filter(([ymd]) => ymd >= startYmd && ymd <= endYmd);
        const dailySum = dailyInRange.reduce((sum, [, amount]) => sum + amount, 0);
        const dailyDays = new Set(dailyInRange.map(([ymd]) => ymd));
        const missingFromDaily = [...completedByDay.entries()]
          .filter(([ymd]) => ymd >= startYmd && ymd <= endYmd && !dailyDays.has(ymd))
          .reduce((sum, [, amount]) => sum + amount, 0);
        const osRangeRevenue = sumMapRange(osRevenueByDay, startYmd, endYmd);
        return Number((dailySum + missingFromDaily + osRangeRevenue).toFixed(2));
      }

      weekRevenue = getHybridRevenue(weekStartYmd, weekEndYmd);
      prevWeekRevenue = getHybridRevenue(prevWeekStartYmd, prevWeekEndYmd);
      monthRevenue = getHybridRevenue(monthStartYmd, monthEndYmd);
      prevMonthRevenue = getHybridRevenue(prevMonthStartYmd, prevMonthEndYmd);
      customRevenue = hasCustomRange ? getHybridRevenue(startDate, endDate) : 0;
    } catch (revenueErr) {
      const isFallbackAllowed =
        !useFinanceiroDiarioAggregate ||
        isSqlMissingObjectError(revenueErr) ||
        String(revenueErr?.message || "").includes("FinanceiroDiario desabilitado para filtro por profissional");
      if (!isFallbackAllowed) throw revenueErr;
      weekRevenue = Number((weekAgRevenue + weekOsRevenue).toFixed(2));
      prevWeekRevenue = Number((prevWeekAgRevenue + prevWeekOsRevenue).toFixed(2));
      monthRevenue = Number((monthAgRevenue + monthOsRevenue).toFixed(2));
      prevMonthRevenue = Number((prevMonthAgRevenue + prevMonthOsRevenue).toFixed(2));
      customRevenue = Number((customAgRevenue + customOsRevenue).toFixed(2));
    }

    if (hasCustomRange && isForecastMode) {
      customRevenue = Number(customForecastRevenue.toFixed(2));
    }

    const selectedRange = (() => {
      if (hasCustomRange) return { start: startDate, end: endDate };
      if (period === "month") return { start: monthStartYmd, end: monthEndYmd };
      if (period === "next7") return { start: next7StartYmd, end: next7EndYmd };
      return { start: weekStartYmd, end: weekEndYmd };
    })();

    const dailyRevenueMap = new Map();
    const dailyExpensesMap = new Map();
    const selectedStartDate = parseYMDToLocalDate(selectedRange.start);
    const selectedEndDate = parseYMDToLocalDate(selectedRange.end);
    for (
      let cursor = new Date(selectedStartDate.getFullYear(), selectedStartDate.getMonth(), selectedStartDate.getDate(), 12, 0, 0, 0);
      cursor <= selectedEndDate;
      cursor = addDaysLocalDate(cursor, 1)
    ) {
      const ymd = getLocalDateYMD(cursor);
      dailyRevenueMap.set(ymd, 0);
      dailyExpensesMap.set(ymd, 0);
    }
    for (const [ymd, value] of completedByDay.entries()) {
      if (ymd < selectedRange.start || ymd > selectedRange.end) continue;
      dailyRevenueMap.set(ymd, Number((dailyRevenueMap.get(ymd) || 0) + Number(value || 0)));
    }
    for (const [ymd, value] of osRevenueByDay.entries()) {
      if (ymd < selectedRange.start || ymd > selectedRange.end) continue;
      dailyRevenueMap.set(ymd, Number((dailyRevenueMap.get(ymd) || 0) + Number(value || 0)));
    }
    const dailyRevenue = [...dailyRevenueMap.entries()].map(([date, value]) => ({
      date,
      value: Number(Number(value || 0).toFixed(2)),
    }));

    if (expensesReady) {
      const expensesResult = await pool
        .request()
        .input("empresaId", sql.Int, empresa.Id)
        .input("weekStart", sql.Date, weekStartYmd)
        .input("weekEnd", sql.Date, weekEndYmd)
        .input("prevWeekStart", sql.Date, prevWeekStartYmd)
        .input("prevWeekEnd", sql.Date, prevWeekEndYmd)
        .input("monthStart", sql.Date, monthStartYmd)
        .input("monthEnd", sql.Date, monthEndYmd)
        .input("prevMonthStart", sql.Date, prevMonthStartYmd)
        .input("prevMonthEnd", sql.Date, prevMonthEndYmd)
        .input("startDate", sql.Date, hasCustomRange ? startDate : null)
        .input("endDate", sql.Date, hasCustomRange ? endDate : null)
        .query(`
          SELECT
            ISNULL(SUM(CASE WHEN DataDespesa BETWEEN @weekStart AND @weekEnd THEN Valor ELSE 0 END), 0) AS WeekExpensesActual,
            ISNULL(SUM(CASE WHEN DataDespesa BETWEEN @prevWeekStart AND @prevWeekEnd THEN Valor ELSE 0 END), 0) AS PrevWeekExpensesActual,
            ISNULL(SUM(CASE WHEN DataDespesa BETWEEN @monthStart AND @monthEnd THEN Valor ELSE 0 END), 0) AS MonthExpensesActual,
            ISNULL(SUM(CASE WHEN DataDespesa BETWEEN @prevMonthStart AND @prevMonthEnd THEN Valor ELSE 0 END), 0) AS PrevMonthExpensesActual,
            ISNULL(SUM(CASE WHEN @startDate IS NOT NULL AND @endDate IS NOT NULL AND DataDespesa BETWEEN @startDate AND @endDate THEN Valor ELSE 0 END), 0) AS CustomExpensesActual
          FROM dbo.EmpresaDespesas
          WHERE EmpresaId = @empresaId;
        `);

      weekExpensesActual = Number(expensesResult.recordset?.[0]?.WeekExpensesActual || 0);
      prevWeekExpensesActual = Number(expensesResult.recordset?.[0]?.PrevWeekExpensesActual || 0);
      monthExpensesActual = Number(expensesResult.recordset?.[0]?.MonthExpensesActual || 0);
      prevMonthExpensesActual = Number(expensesResult.recordset?.[0]?.PrevMonthExpensesActual || 0);
      customExpensesActual = Number(expensesResult.recordset?.[0]?.CustomExpensesActual || 0);

      const detailedExpenses = await pool
        .request()
        .input("empresaId", sql.Int, empresa.Id)
        .input("rangeStart", sql.Date, selectedRange.start)
        .input("rangeEnd", sql.Date, selectedRange.end)
        .query(`
          SELECT
            Categoria,
            ISNULL(SUM(Valor), 0) AS Total
          FROM dbo.EmpresaDespesas
          WHERE EmpresaId = @empresaId
            AND DataDespesa BETWEEN @rangeStart AND @rangeEnd
          GROUP BY Categoria
          ORDER BY Total DESC;

          SELECT TOP 3
            Id,
            Descricao,
            Categoria,
            Valor,
            CONVERT(varchar(10), DataDespesa, 23) AS DataDespesa
          FROM dbo.EmpresaDespesas
          WHERE EmpresaId = @empresaId
            AND DataDespesa BETWEEN @rangeStart AND @rangeEnd
          ORDER BY Valor DESC, DataDespesa DESC, Id DESC;

          SELECT
            CONVERT(varchar(10), DataDespesa, 23) AS DataDespesa,
            ISNULL(SUM(Valor), 0) AS Total
          FROM dbo.EmpresaDespesas
          WHERE EmpresaId = @empresaId
            AND DataDespesa BETWEEN @rangeStart AND @rangeEnd
          GROUP BY DataDespesa
          ORDER BY DataDespesa ASC;
        `);

      expensesByCategory = (detailedExpenses.recordsets?.[0] || []).map((item) => ({
        categoria: String(item.Categoria || "outros"),
        categoriaLabel: formatExpenseCategoryLabel(String(item.Categoria || "outros")),
        total: Number(item.Total || 0),
      }));

      topExpenses = (detailedExpenses.recordsets?.[1] || []).map((item) => ({
        id: Number(item.Id || 0),
        descricao: String(item.Descricao || ""),
        categoria: String(item.Categoria || "outros"),
        categoriaLabel: formatExpenseCategoryLabel(String(item.Categoria || "outros")),
        valor: Number(item.Valor || 0),
        dataDespesa: String(item.DataDespesa || ""),
      }));

      for (const row of detailedExpenses.recordsets?.[2] || []) {
        const ymd = toIsoDateOnly(row.DataDespesa);
        if (!ymd) continue;
        dailyExpensesMap.set(ymd, Number(row.Total || 0));
      }
    }

    const weekExpensesBudget = Number(((weekRevenue * financeRules.expenses) / 100).toFixed(2));
    const monthExpensesBudget = Number(((monthRevenue * financeRules.expenses) / 100).toFixed(2));
    const customExpensesBudget = Number(((customRevenue * financeRules.expenses) / 100).toFixed(2));
    const weekDailyAverageRevenue = Number((weekRevenue / 7).toFixed(2));
    const monthDays = getInclusiveDaysBetween(monthStartYmd, monthEndYmd);
    const monthDailyAverageRevenue = monthDays > 0 ? Number((monthRevenue / monthDays).toFixed(2)) : 0;
    const customDays = hasCustomRange ? getInclusiveDaysBetween(startDate, endDate) : 0;
    const customDailyAverageRevenue = customDays > 0 ? Number((customRevenue / customDays).toFixed(2)) : 0;
    const weekTicketAverage = weekAppointmentsCount > 0 ? Number((weekRevenue / weekAppointmentsCount).toFixed(2)) : 0;
    const monthTicketAverage = monthAppointmentsCount > 0 ? Number((monthRevenue / monthAppointmentsCount).toFixed(2)) : 0;
    const customTicketAverage = customAppointmentsCount > 0 ? Number((customRevenue / customAppointmentsCount).toFixed(2)) : 0;
    const weekNetRevenue = Number((weekRevenue - weekExpensesActual).toFixed(2));
    const prevWeekNetRevenue = Number((prevWeekRevenue - prevWeekExpensesActual).toFixed(2));
    const monthNetRevenue = Number((monthRevenue - monthExpensesActual).toFixed(2));
    const prevMonthNetRevenue = Number((prevMonthRevenue - prevMonthExpensesActual).toFixed(2));
    const customNetRevenue = Number((customRevenue - customExpensesActual).toFixed(2));
    const weekBudgetDifference = Number((weekExpensesBudget - weekExpensesActual).toFixed(2));
    const monthBudgetDifference = Number((monthExpensesBudget - monthExpensesActual).toFixed(2));
    const customBudgetDifference = Number((customExpensesBudget - customExpensesActual).toFixed(2));
    const selectedExpensesBudget = hasCustomRange ? customExpensesBudget : period === "month" ? monthExpensesBudget : weekExpensesBudget;
    const selectedExpensesActual = hasCustomRange ? customExpensesActual : period === "month" ? monthExpensesActual : weekExpensesActual;
    const expenseBudgetUsagePercent = selectedExpensesBudget > 0
      ? Number(((selectedExpensesActual / selectedExpensesBudget) * 100).toFixed(2))
      : selectedExpensesActual > 0
        ? 100
        : 0;
    const expenseBudgetStatus =
      selectedExpensesActual > selectedExpensesBudget
        ? "over"
        : expenseBudgetUsagePercent >= 85
          ? "near"
          : "within";
    const topExpenseCategory = expensesByCategory[0] || null;
    const expensesAsRevenuePercent = (hasCustomRange ? customRevenue : period === "month" ? monthRevenue : weekRevenue) > 0
      ? Number(((selectedExpensesActual / (hasCustomRange ? customRevenue : period === "month" ? monthRevenue : weekRevenue)) * 100).toFixed(2))
      : 0;
    const dailyExpenses = [...dailyExpensesMap.entries()].map(([date, value]) => ({
      date,
      value: Number(Number(value || 0).toFixed(2)),
    }));
    const dailyComparison = [...dailyRevenueMap.entries()].map(([date, revenue]) => ({
      date,
      revenue: Number(Number(revenue || 0).toFixed(2)),
      expenses: Number(Number(dailyExpensesMap.get(date) || 0).toFixed(2)),
    }));

    return res.json({
      ok: true,
      resumo: {
        pendingCount,
        weekAgendaCount,
        weekRevenue,
        prevWeekRevenue,
        monthRevenue,
        prevMonthRevenue,
        customRevenue,
        weekDailyAverageRevenue,
        monthDailyAverageRevenue,
        customDailyAverageRevenue,
        weekAppointmentsCount,
        monthAppointmentsCount,
        customAppointmentsCount,
        weekTicketAverage,
        monthTicketAverage,
        customTicketAverage,
        customRange: hasCustomRange ? { startDate, endDate } : null,
        todayAgenda,
        financeRules,
        weekExpensesBudget,
        monthExpensesBudget,
        customExpensesBudget,
        weekExpensesActual,
        prevWeekExpensesActual,
        monthExpensesActual,
        prevMonthExpensesActual,
        customExpensesActual,
        weekNetRevenue,
        prevWeekNetRevenue,
        monthNetRevenue,
        prevMonthNetRevenue,
        customNetRevenue,
        weekBudgetDifference,
        monthBudgetDifference,
        customBudgetDifference,
        dailyRevenue,
        dailyExpenses,
        dailyComparison,
        expensesByCategory,
        topExpenses,
        expenseBudgetUsagePercent,
        expenseBudgetStatus,
        expenseInsights: {
          topCategory:
            topExpenseCategory
              ? `A maior parte das despesas veio de ${topExpenseCategory.categoriaLabel}.`
              : "Ainda nao ha despesas no periodo selecionado.",
          expensesVsRevenue:
            `As despesas consumiram ${expensesAsRevenuePercent.toFixed(2)}% do faturamento do periodo.`,
          budget:
            expenseBudgetStatus === "within"
              ? "Voce esta dentro do orcamento planejado."
              : expenseBudgetStatus === "near"
                ? "Atencao: as despesas estao proximas do limite do orcamento."
                : "As despesas ultrapassaram o limite do orcamento planejado.",
        },
      },
    });
  } catch (err) {
    console.error("GET /api/empresas/:slug/insights/resumo error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ DELETE: /api/empresas/:slug/agendamentos/:id
// Regra: só permite excluir se Status = 'cancelled'
app.delete("/api/empresas/:slug/agendamentos/:id", async (req, res) => {
  const { slug, id } = req.params;

  const agendamentoId = Number(id);
  if (!slug) return badRequest(res, "Slug é obrigatório.");
  if (!Number.isFinite(agendamentoId) || agendamentoId <= 0)
    return badRequest(res, "id inválido.");

  try {
    const pool = await getPool();

    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      // 1) pega agendamento + trava linha
      const q1 = await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("id", sql.Int, agendamentoId)
        .query(`
          SELECT TOP 1
            Id,
            EmpresaId,
            AtendimentoId,
            Status
          FROM dbo.Agendamentos WITH (UPDLOCK, HOLDLOCK)
          WHERE Id = @id AND EmpresaId = @empresaId;
        `);

      const ag = q1.recordset?.[0];
      if (!ag) {
        await tx.rollback();
        return res.status(404).json({ ok: false, error: "Agendamento não encontrado." });
      }

      if (String(ag.Status).toLowerCase() !== "cancelled") {
        await tx.rollback();
        return res.status(400).json({
          ok: false,
          error: "Só é possível excluir agendamentos com status 'cancelled'.",
        });
      }

      // 2) deleta agendamento
      await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("id", sql.Int, agendamentoId)
        .query(`
          DELETE FROM dbo.Agendamentos
          WHERE Id = @id AND EmpresaId = @empresaId;
        `);

      // 3) opcional: se existir atendimento vinculado, deleta também (mantém base limpa)
      if (ag.AtendimentoId) {
        await new sql.Request(tx)
          .input("empresaId", sql.Int, empresa.Id)
          .input("atendimentoId", sql.Int, ag.AtendimentoId)
          .query(`
            DELETE FROM dbo.Atendimentos
            WHERE Id = @atendimentoId AND EmpresaId = @empresaId;
          `);
      }

      await tx.commit();
      return res.json({ ok: true });
    } catch (errTx) {
      try { await tx.rollback(); } catch {}
      throw errTx;
    }
  } catch (err) {
    console.error("DELETE /api/empresas/:slug/agendamentos/:id error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ===========================
 *  HEALTHCHECK
 * ===========================
 */
app.get("/health", async (req, res) => {
  return res.json({
    ok: true,
    service: "sheila-backend",
    startedAt: APP_STARTED_AT,
    now: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    webPushEnabled: isWebPushEnabled(),
    pushReminder: {
      enabled: PUSH_REMINDER_ENABLED,
      running: pushReminderJobRunning,
      minutesBefore: PUSH_REMINDER_MINUTES_BEFORE,
      windowMinutes: PUSH_REMINDER_WINDOW_MINUTES,
      lateToleranceMinutes: PUSH_REMINDER_LATE_TOLERANCE_MINUTES,
      pollMs: PUSH_REMINDER_POLL_MS,
      metrics: pushReminderMetrics,
    },
  });
});

app.get("/health/db", async (req, res) => {
  const startedAt = Date.now();
  try {
    const pool = await getPool();
    await pool.request().query("SELECT 1 AS ok;");
    return res.json({
      ok: true,
      db: "up",
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      db: "down",
      latencyMs: Date.now() - startedAt,
      error: String(err?.message || err || "Erro de banco"),
    });
  }
});

/**
 * ===========================
 *  DEBUG
 * ===========================
 */
app.get("/debug/ping", (req, res) => {
  res.json({ ok: true, msg: "server.js atualizado e rodando" });
});

app.get("/__routes", (req, res) => {
  const routes = [];
  const stack = app._router?.stack || app.router?.stack || [];
  stack.forEach((m) => {
    if (m.route && m.route.path) {
      const methods = Object.keys(m.route.methods).map((x) => x.toUpperCase());
      routes.push({ path: m.route.path, methods });
    }
  });
  res.json({ ok: true, routes });
});

/**
 * ===========================
 *  START SERVER
 * ===========================
 */
const port = process.env.PORT ? Number(process.env.PORT) : 3001;
validateProductionEnv();
setTimeout(() => {
  runLogsRetentionSweep().catch(() => {});
}, 5_000).unref();
setInterval(() => {
  runLogsRetentionSweep().catch(() => {});
}, LOG_RETENTION_INTERVAL_MS).unref();

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`API rodando em http://localhost:${port}`);
  if (PUSH_REMINDER_ENABLED) {
    setTimeout(() => {
      processPushReminderQueue().catch((err) => {
        console.warn("Falha na execução inicial do job de lembretes push:", err?.message || err);
      });
    }, 8_000);

    setInterval(() => {
      processPushReminderQueue().catch((err) => {
        console.warn("Falha no intervalo do job de lembretes push:", err?.message || err);
      });
    }, PUSH_REMINDER_POLL_MS);
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
  appLog.error({
    message: "Unhandled promise rejection",
    route: "process/unhandledRejection",
    error: String(reason || ""),
  });
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  appLog.error({
    message: "Uncaught exception",
    route: "process/uncaughtException",
    error: { message: err?.message, stack: err?.stack },
  });
});

function gracefulShutdown(signal) {
  console.log(`Recebido ${signal}. Encerrando servidor...`);
  server.close(() => {
    console.log("Servidor HTTP encerrado.");
    sql.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
