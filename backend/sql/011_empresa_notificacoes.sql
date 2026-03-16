/*
  Base inicial de notificações internas por empresa.
  Escopo desta etapa:
  - notificação geral da empresa
  - preparada para ProfissionalId futuro, sem depender disso agora
*/

IF OBJECT_ID('dbo.EmpresaNotificacoes', 'U') IS NULL
BEGIN
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
    CriadaEm DATETIME2(0) NOT NULL
      CONSTRAINT DF_EmpresaNotificacoes_CriadaEm DEFAULT(
        CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'E. South America Standard Time' AS DATETIME2(0))
      )
  );
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_EmpresaNotificacoes_Empresas'
)
BEGIN
  ALTER TABLE dbo.EmpresaNotificacoes
  ADD CONSTRAINT FK_EmpresaNotificacoes_Empresas
    FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_EmpresaNotificacoes_Empresa_CriadaEm'
    AND object_id = OBJECT_ID('dbo.EmpresaNotificacoes')
)
BEGIN
  CREATE INDEX IX_EmpresaNotificacoes_Empresa_CriadaEm
    ON dbo.EmpresaNotificacoes (EmpresaId, CriadaEm DESC, Id DESC);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_EmpresaNotificacoes_Empresa_LidaEm'
    AND object_id = OBJECT_ID('dbo.EmpresaNotificacoes')
)
BEGIN
  CREATE INDEX IX_EmpresaNotificacoes_Empresa_LidaEm
    ON dbo.EmpresaNotificacoes (EmpresaId, LidaEm, CriadaEm DESC, Id DESC);
END;
