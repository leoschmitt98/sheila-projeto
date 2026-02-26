-- Migração inicial para PostgreSQL
-- Compatível com os endpoints atuais do backend/server.js

CREATE TABLE IF NOT EXISTS "Empresas" (
  "Id" SERIAL PRIMARY KEY,
  "Nome" VARCHAR(200) NOT NULL,
  "Slug" VARCHAR(80) NOT NULL UNIQUE,
  "MensagemBoasVindas" TEXT NOT NULL,
  "WhatsappPrestador" VARCHAR(20),
  "NomeProprietario" VARCHAR(120),
  "Endereco" VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS "EmpresaServicos" (
  "Id" SERIAL PRIMARY KEY,
  "EmpresaId" INT NOT NULL REFERENCES "Empresas"("Id") ON DELETE CASCADE,
  "Nome" VARCHAR(200) NOT NULL,
  "Descricao" VARCHAR(500) NOT NULL,
  "DuracaoMin" INT NOT NULL,
  "Preco" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "Ativo" BOOLEAN NOT NULL DEFAULT TRUE,
  "CriadoEm" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Clientes" (
  "Id" SERIAL PRIMARY KEY,
  "EmpresaId" INT NOT NULL REFERENCES "Empresas"("Id") ON DELETE CASCADE,
  "Nome" VARCHAR(120) NOT NULL,
  "Whatsapp" VARCHAR(20) NOT NULL,
  UNIQUE ("EmpresaId", "Whatsapp")
);

CREATE TABLE IF NOT EXISTS "Atendimentos" (
  "Id" SERIAL PRIMARY KEY,
  "EmpresaId" INT NOT NULL REFERENCES "Empresas"("Id") ON DELETE CASCADE,
  "ClienteId" INT NOT NULL REFERENCES "Clientes"("Id") ON DELETE RESTRICT,
  "InicioAtendimento" TIMESTAMP NOT NULL,
  "FimAtendimento" TIMESTAMP NOT NULL,
  "Status" VARCHAR(40) NOT NULL,
  "Canal" VARCHAR(40) NOT NULL
);

CREATE TABLE IF NOT EXISTS "Agendamentos" (
  "Id" SERIAL PRIMARY KEY,
  "EmpresaId" INT NOT NULL REFERENCES "Empresas"("Id") ON DELETE CASCADE,
  "AtendimentoId" INT REFERENCES "Atendimentos"("Id") ON DELETE SET NULL,
  "ServicoId" INT REFERENCES "EmpresaServicos"("Id") ON DELETE SET NULL,
  "Servico" VARCHAR(200),
  "DataAgendada" DATE NOT NULL,
  "HoraAgendada" TIME,
  "DuracaoMin" INT NOT NULL,
  "InicioEm" TIMESTAMP,
  "FimEm" TIMESTAMP,
  "Status" VARCHAR(40) NOT NULL,
  "Observacoes" VARCHAR(1000),
  "ClienteNome" VARCHAR(120),
  "ClienteTelefone" VARCHAR(30)
);

CREATE TABLE IF NOT EXISTS "AgendaBloqueios" (
  "Id" SERIAL PRIMARY KEY,
  "EmpresaId" INT NOT NULL REFERENCES "Empresas"("Id") ON DELETE CASCADE,
  "Data" DATE NOT NULL,
  "Motivo" VARCHAR(200),
  UNIQUE ("EmpresaId", "Data")
);

CREATE INDEX IF NOT EXISTS "idx_agendamentos_empresa_data" ON "Agendamentos"("EmpresaId", "DataAgendada");
CREATE INDEX IF NOT EXISTS "idx_agendamentos_status" ON "Agendamentos"("Status");
CREATE INDEX IF NOT EXISTS "idx_servicos_empresa_ativo" ON "EmpresaServicos"("EmpresaId", "Ativo");
