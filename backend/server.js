import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import sql from "mssql";

dotenv.config();

const app = express();
app.use(cors());
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

async function getPool() {
  return sql.connect(dbConfig);
}

async function getEmpresaBySlug(pool, slug) {
  const result = await pool
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

  return result.recordset[0] || null;
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


function toIsoDateOnly(value) {
  if (!value) return null;
  const str = String(value);
  return str.slice(0, 10);
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

// Descobre quais colunas existem na dbo.Agendamentos (pra não quebrar se teu schema variar)
async function getAgendamentosColumns(pool) {
  const r = await pool.request().query(`
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
    res.json(empresa);
  } catch (err) {
    console.error("GET /api/empresas/:slug error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/empresas/:slug", async (req, res) => {
  const { slug } = req.params;
  const { Nome, MensagemBoasVindas, WhatsappPrestador, NomeProprietario, Endereco } = req.body || {};

  if (!slug) return badRequest(res, "Slug é obrigatório.");
  if (typeof Nome !== "string" || !Nome.trim())
    return badRequest(res, "Nome é obrigatório.");
  if (typeof MensagemBoasVindas !== "string" || !MensagemBoasVindas.trim())
    return badRequest(res, "MensagemBoasVindas é obrigatória.");

  let whatsapp = null;
  if (WhatsappPrestador !== undefined && WhatsappPrestador !== null) {
    if (typeof WhatsappPrestador !== "string")
      return badRequest(res, "WhatsappPrestador deve ser string ou null.");
    whatsapp = WhatsappPrestador.replace(/\D/g, "");
    if (whatsapp.length > 20) whatsapp = whatsapp.slice(0, 20);
  }

  try {
    const pool = await getPool();

    const update = await pool
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

    const empresa = update.recordset[0] || null;
    if (!empresa) {
      return res.status(404).json({ ok: false, error: "Empresa não encontrada." });
    }

    res.json({ ok: true, empresa });
  } catch (err) {
    console.error("PUT /api/empresas/:slug error:", err);
    res.status(500).json({ ok: false, error: err.message });
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
  if (!slug) return badRequest(res, "Slug é obrigatório.");

  try {
    const pool = await getPool();

    const result = await pool
      .request()
      .input("slug", sql.VarChar(80), slug)
      .input("includeAll", sql.Bit, includeAll ? 1 : 0)
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
 *  AGENDA / DISPONIBILIDADE (SQL)
 * ===========================
 */
app.get("/api/empresas/:slug/agenda/disponibilidade", async (req, res) => {
  const { slug } = req.params;
  const { servicoId, data } = req.query;

  if (!slug) return badRequest(res, "Slug é obrigatório.");
  const sid = Number(servicoId);
  if (!Number.isFinite(sid) || sid <= 0) return badRequest(res, "servicoId inválido.");
  if (!isValidDateYYYYMMDD(data)) return badRequest(res, "data inválida (use YYYY-MM-DD).");

  const startHour = req.query.startHour ? Number(req.query.startHour) : 8;
  const endHour = req.query.endHour ? Number(req.query.endHour) : 18;
  const step = req.query.step ? Number(req.query.step) : 30;

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

    // Pega agendamentos do dia em minutos do dia (sem timezone)
    const bookedRes = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("data", sql.Date, data)
      .query(`
        SELECT
          Id,
          DuracaoMin,
          (DATEPART(HOUR, HoraAgendada) * 60 + DATEPART(MINUTE, HoraAgendada)) AS StartMin,
          (DATEPART(HOUR, HoraAgendada) * 60 + DATEPART(MINUTE, HoraAgendada) + DuracaoMin) AS EndMin
        FROM dbo.Agendamentos
        WHERE EmpresaId = @empresaId
          AND DataAgendada = @data
          AND Status IN (N'pending', N'confirmed')
        ORDER BY HoraAgendada ASC;
      `);

    const booked = bookedRes.recordset || [];

    function overlapsMin(aStart, aEnd, bStart, bEnd) {
      return aStart < bEnd && aEnd > bStart;
    }

    const startMin = startHour * 60;
    const endMin = endHour * 60;

    const slots = [];
    for (let t = startMin; t + duracaoMin <= endMin; t += step) {
      const candStart = t;
      const candEnd = t + duracaoMin;

      const hasConflict = booked.some((apt) =>
        overlapsMin(candStart, candEnd, Number(apt.StartMin), Number(apt.EndMin))
      );

      if (!hasConflict) slots.push(minutesToHHMM(t));
    }

    return res.json({
      ok: true,
      empresaId: empresa.Id,
      servico: { Id: servico.Id, Nome: servico.Nome, DuracaoMin: duracaoMin },
      data,
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
  const { servicoId, date, time, clientName, clientPhone, notes, observation } = req.body || {};

  if (!slug) return badRequest(res, "Slug é obrigatório.");

  const sid = Number(servicoId);
  if (!Number.isFinite(sid) || sid <= 0) return badRequest(res, "servicoId inválido.");

  if (!isValidDateYYYYMMDD(date)) return badRequest(res, "date inválida (use YYYY-MM-DD).");
  if (!isValidTimeHHMM(time)) return badRequest(res, "time inválido (use HH:mm).");

  if (typeof clientName !== "string" || !clientName.trim())
    return badRequest(res, "clientName é obrigatório.");
  if (typeof clientPhone !== "string" || !clientPhone.trim())
    return badRequest(res, "clientPhone é obrigatório.");

  const phone = clientPhone.replace(/\D/g, "").slice(0, 20);
  const notaBruta = notes !== undefined ? notes : observation;
  const obs =
    notaBruta !== undefined && notaBruta !== null ? String(notaBruta).trim().slice(0, 1000) : null;

  // Normaliza hora para HH:mm:ss
  const timeHHMMSS = `${time}:00`;

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const servico = await getServicoById(pool, empresa.Id, sid);
    if (!servico) return res.status(404).json({ ok: false, error: "Serviço não encontrado." });
    if (!servico.Ativo) return res.status(400).json({ ok: false, error: "Serviço inativo." });

    const duracaoMin = Number(servico.DuracaoMin);

    // minutos do dia (sem timezone)
    const startMin = timeToMinutes(time);
    const endMin = startMin + duracaoMin;

    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      // 1) valida conflito (pending/confirmed) no mesmo dia
      const conflict = await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("data", sql.Date, date)
        .input("startMin", sql.Int, startMin)
        .input("endMin", sql.Int, endMin)
        .query(`
          SELECT TOP 1 Id
          FROM dbo.Agendamentos WITH (UPDLOCK, HOLDLOCK)
          WHERE EmpresaId = @empresaId
            AND DataAgendada = @data
            AND Status IN (N'pending', N'confirmed')
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
        .query(`
          DECLARE @hora time(0) = CONVERT(time(0), @inicioTxt);

          DECLARE @inicio datetime2(0) = DATEADD(MINUTE, DATEDIFF(MINUTE, 0, @hora), CAST(@data as datetime2(0)));
          DECLARE @fim datetime2(0) = DATEADD(MINUTE, @duracaoMin, @inicio);

          INSERT INTO dbo.Atendimentos
            (EmpresaId, ClienteId, InicioAtendimento, FimAtendimento, Status, Canal)
          VALUES
            (@empresaId, @clienteId, @inicio, @fim, N'pending', N'sheila');

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
      const agendamentoIns = await new sql.Request(tx)
        .input("empresaId", sql.Int, empresa.Id)
        .input("atendimentoId", sql.Int, atendimentoId)
        .input("servicoId", sql.Int, sid)
        .input("servicoNome", sql.NVarChar(200), servico.Nome)
        .input("data", sql.Date, date)
        .input("horaTxt", sql.VarChar(8), timeHHMMSS)
        .input("duracaoMin", sql.Int, duracaoMin)
        .input("inicioEm", sql.DateTime2(0), inicioEm)
        .input("fimEm", sql.DateTime2(0), fimEm)
        .input("status", sql.NVarChar(40), "pending")
        .input("obs", sql.NVarChar(1000), obs)
        .input("clienteNome", sql.NVarChar(120), clientName)
        .input("clienteTelefone", sql.NVarChar(30), clientPhone)
        .query(`
          DECLARE @hora time(0) = CONVERT(time(0), @horaTxt);

           INSERT INTO dbo.Agendamentos
          (EmpresaId, AtendimentoId, ServicoId, Servico, DataAgendada, HoraAgendada, DuracaoMin, InicioEm, FimEm, Status, Observacoes, ClienteNome, ClienteTelefone)
          VALUES
          (@empresaId, @atendimentoId, @servicoId, @servicoNome, @data, @hora, @duracaoMin, @inicioEm, @fimEm, @status, @obs, @clienteNome, @clienteTelefone);
           SELECT TOP 1 *
          FROM dbo.Agendamentos
          WHERE Id = SCOPE_IDENTITY();
          `);


      await tx.commit();

      return res.json({
        ok: true,
        agendamento: agendamentoIns.recordset?.[0] ?? null,
        atendimentoId,
        clienteId,
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

    // Atualiza status do agendamento
    const result = await pool
      .request()
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
    if (rows === 0)
      return res.status(404).json({ ok: false, error: "Agendamento não encontrado." });

    const agendamento = result.recordsets?.[1]?.[0] ?? null;

    // Se existir AtendimentoId, atualiza também
    if (agendamento?.AtendimentoId) {
      await pool
        .request()
        .input("empresaId", sql.Int, empresa.Id)
        .input("atendimentoId", sql.Int, agendamento.AtendimentoId)
        .input("status", sql.NVarChar(40), newStatus)
        .query(`
          UPDATE dbo.Atendimentos
          SET Status = @status
          WHERE Id = @atendimentoId AND EmpresaId = @empresaId;
        `);
    }

    return res.json({ ok: true, agendamento });
  } catch (err) {
    console.error("PUT /api/empresas/:slug/agendamentos/:id/status error:", err);
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
 * GET /api/empresas/:slug/agendamentos?status=todos|pending|confirmed|cancelled
 */
app.get("/api/empresas/:slug/agendamentos", async (req, res) => {
  const { slug } = req.params;
  const status = String(req.query.status || "todos").toLowerCase();

  if (!slug) return badRequest(res, "Slug é obrigatório.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    // filtro de status (opcional)
    let statusWhere = "";
    if (status !== "todos") {
      statusWhere = " AND ag.Status = @status ";
    }

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .input("status", sql.NVarChar(40), status)
      .query(`
        SELECT
          ag.Id              AS AgendamentoId,
          ag.EmpresaId,
          ag.AtendimentoId,
          ag.ServicoId,
          ag.Servico,
          ag.DataAgendada,
          ag.HoraAgendada,
          ag.DuracaoMin,
          ag.InicioEm,
          ag.FimEm,
          ag.Status          AS AgendamentoStatus,
          ag.Observacoes,

          c.Id               AS ClienteId,
          c.Nome             AS ClienteNome,
          c.Whatsapp         AS ClienteWhatsapp
        FROM dbo.Agendamentos ag
        INNER JOIN dbo.Atendimentos a ON a.Id = ag.AtendimentoId
        INNER JOIN dbo.Clientes c     ON c.Id = a.ClienteId
        WHERE ag.EmpresaId = @empresaId
        ${statusWhere}
        ORDER BY ag.InicioEm DESC;
      `);

    return res.json({ ok: true, agendamentos: result.recordset || [] });
  } catch (err) {
    console.error("GET /api/empresas/:slug/agendamentos error:", err);
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

  if (!slug) return badRequest(res, "Slug é obrigatório.");

  try {
    const pool = await getPool();
    const empresa = await getEmpresaBySlug(pool, slug);
    if (!empresa) return res.status(404).json({ ok: false, error: "Empresa não encontrada." });

    const result = await pool
      .request()
      .input("empresaId", sql.Int, empresa.Id)
      .query(`
        SELECT
          ag.Id AS AgendamentoId,
          ag.ServicoId,
          ag.Servico,
          ag.DataAgendada,
          ag.HoraAgendada,
          ag.InicioEm,
          ag.Status AS AgendamentoStatus,
          c.Nome AS ClienteNome,
          ISNULL(es.Preco, 0) AS ServicoPreco
        FROM dbo.Agendamentos ag
        LEFT JOIN dbo.EmpresaServicos es
          ON es.EmpresaId = ag.EmpresaId
         AND es.Id = ag.ServicoId
        LEFT JOIN dbo.Atendimentos at ON at.Id = ag.AtendimentoId
        LEFT JOIN dbo.Clientes c ON c.Id = at.ClienteId
        WHERE ag.EmpresaId = @empresaId;
      `);

    const agendamentos = result.recordset || [];
    const now = new Date();
    const today = toIsoDateOnly(now.toISOString());

    const weekStart = getStartOfWeekDate(now);
    const weekEnd = getEndOfWeekDate(now);
    const monthStart = getStartOfMonthDate(now);
    const monthEnd = getEndOfMonthDate(now);

    const pendingCount = agendamentos.filter((ag) => String(ag.AgendamentoStatus).toLowerCase() === "pending").length;

    const todayAgenda = agendamentos
      .filter((ag) => String(ag.AgendamentoStatus).toLowerCase() !== "cancelled")
      .filter((ag) => toIsoDateOnly(ag.DataAgendada) === today)
      .sort((a, b) => {
        const aTime = String(a.HoraAgendada || a.InicioEm || "");
        const bTime = String(b.HoraAgendada || b.InicioEm || "");
        return aTime.localeCompare(bTime);
      });

    const weekAgendaCount = agendamentos.filter((ag) => {
      const status = String(ag.AgendamentoStatus).toLowerCase();
      if (status === "cancelled") return false;
      const date = new Date(ag.DataAgendada);
      return date >= weekStart && date <= weekEnd;
    }).length;

    const weekRevenue = agendamentos
      .filter((ag) => String(ag.AgendamentoStatus).toLowerCase() === "completed")
      .filter((ag) => {
        const date = new Date(ag.DataAgendada);
        return date >= weekStart && date <= weekEnd;
      })
      .reduce((sum, ag) => sum + (Number(ag.ServicoPreco) || 0), 0);

    const monthRevenue = agendamentos
      .filter((ag) => String(ag.AgendamentoStatus).toLowerCase() === "completed")
      .filter((ag) => {
        const date = new Date(ag.DataAgendada);
        return date >= monthStart && date <= monthEnd;
      })
      .reduce((sum, ag) => sum + (Number(ag.ServicoPreco) || 0), 0);

    return res.json({
      ok: true,
      resumo: {
        pendingCount,
        weekAgendaCount,
        weekRevenue,
        monthRevenue,
        todayAgenda,
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
