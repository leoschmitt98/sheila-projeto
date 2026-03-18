import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import sql from "mssql";
import crypto from "crypto";
import webpush from "web-push";

dotenv.config();

const app = express();

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
  if (!ensureWebPushConfigured()) return;

  const ready = await ensureEmpresaNotificacaoDispositivosTable(pool);
  if (!ready) return;

  const devices = await getPreparedPushDevicesByEmpresa(pool, empresaId, profissionalId, pushType);
  if (devices.length === 0) return;

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
      } catch (err) {
        const statusCode = Number(err?.statusCode || 0);
        console.warn(
          "Falha ao enviar web push para dispositivo",
          device.Id,
          statusCode || "",
          err?.message || err
        );

        if (statusCode === 404 || statusCode === 410) {
          await deactivatePushDevice(pool, empresaId, Number(device.Id));
        }
      }
    })
  );
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
  const slotStepMin = 15;
  const todayYmd = getLocalDateYMD(new Date());
  const isToday = String(data) === todayYmd;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
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
      message: "Perfeito! Vamos iniciar um orcamento. Primeiro, me diga o modelo do item que voce deseja avaliar.",
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
app.post("/api/admin/login", async (req, res) => {
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
      return res.status(401).json({ ok: false, error: "Senha do admin não configurada para esta empresa." });
    }

    const incoming = hashAdminPassword(password);
    const saved = String(row.PasswordHash || "").trim().toLowerCase();
    if (!saved || incoming !== saved) {
      return res.status(401).json({ ok: false, error: "Senha incorreta." });
    }

    const exp = Date.now() + 1000 * 60 * 60 * 8; // 8h
    const token = createAdminToken({ slug, empresaId: empresa.Id, exp });

    return res.json({ ok: true, token, exp, slug });
  } catch (err) {
    console.error("POST /api/admin/login error:", err);
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
app.get("/api/empresas/:slug/agenda/disponibilidade", async (req, res) => {
  const { slug } = req.params;
  const { servicoId, data, profissionalId } = req.query;

  if (!slug) return badRequest(res, "Slug é obrigatório.");
  const sid = Number(servicoId);
  if (!Number.isFinite(sid) || sid <= 0) return badRequest(res, "servicoId inválido.");
  if (!isValidDateYYYYMMDD(data)) return badRequest(res, "data inválida (use YYYY-MM-DD).");

  const startHour = req.query.startHour ? Number(req.query.startHour) : 8;
  const endHour = req.query.endHour ? Number(req.query.endHour) : 18;
  const slotStepMin = 15;
  const pid = profissionalId !== undefined ? Number(profissionalId) : null;

  const todayYmd = getLocalDateYMD(new Date());
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
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
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
app.post("/api/empresas/:slug/agendamentos", async (req, res) => {
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

  const todayYmd = getLocalDateYMD(new Date());
  if (date < todayYmd) return badRequest(res, "Não é possível agendar para datas passadas.");

  if (date === todayYmd) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
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
        });
      }

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
      return res.json({ ok: true, agendamento });
    } catch (errTx) {
      try {
        await tx.rollback();
      } catch {}
      throw errTx;
    }
  } catch (err) {
    console.error("PUT /api/empresas/:slug/agendamentos/:id/status error:", err);
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
    return res.json({ ok: true, config: rules });
  } catch (err) {
    console.error("GET /api/empresas/:slug/financeiro/configuracao error:", err);
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
    return res.json({ ok: true, config });
  } catch (err) {
    console.error("PUT /api/empresas/:slug/financeiro/configuracao error:", err);
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

    return res.status(201).json({ ok: true, despesa });
  } catch (err) {
    console.error("POST /api/empresas/:slug/despesas error:", err);
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

    return res.json({ ok: true, despesa });
  } catch (err) {
    console.error("PUT /api/empresas/:slug/despesas/:id error:", err);
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

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/empresas/:slug/despesas/:id error:", err);
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

    const useFinanceiroDiarioAggregate = !(Number.isFinite(profissionalId) && Number(profissionalId) > 0);

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

        return Number((dailySum + missingFromDaily).toFixed(2));
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
      weekRevenue = Number(weekAgRevenue.toFixed(2));
      prevWeekRevenue = Number(prevWeekAgRevenue.toFixed(2));
      monthRevenue = Number(monthAgRevenue.toFixed(2));
      prevMonthRevenue = Number(prevMonthAgRevenue.toFixed(2));
      customRevenue = Number(customAgRevenue.toFixed(2));
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
      dailyRevenueMap.set(ymd, Number(value || 0));
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

app.listen(port, "0.0.0.0", () => {
  console.log(`API rodando em http://localhost:${port}`);
});
