IF OBJECT_ID('dbo.EmpresaOrcamentoSolicitacoes', 'U') IS NULL
BEGIN
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
      CONSTRAINT DF_EmpresaOrcamentoSolicitacoes_Status DEFAULT(N'novo'),
    CriadoEm DATETIME2(0) NOT NULL
      CONSTRAINT DF_EmpresaOrcamentoSolicitacoes_CriadoEm DEFAULT(
        CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'E. South America Standard Time' AS DATETIME2(0))
      ),
    AtualizadoEm DATETIME2(0) NOT NULL
      CONSTRAINT DF_EmpresaOrcamentoSolicitacoes_AtualizadoEm DEFAULT(
        CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'E. South America Standard Time' AS DATETIME2(0))
      )
  );
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_EmpresaOrcamentoSolicitacoes_Empresas'
)
BEGIN
  ALTER TABLE dbo.EmpresaOrcamentoSolicitacoes
  ADD CONSTRAINT FK_EmpresaOrcamentoSolicitacoes_Empresas
    FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_EmpresaOrcamentoSolicitacoes_Empresa_CriadoEm'
    AND object_id = OBJECT_ID('dbo.EmpresaOrcamentoSolicitacoes')
)
BEGIN
  CREATE INDEX IX_EmpresaOrcamentoSolicitacoes_Empresa_CriadoEm
    ON dbo.EmpresaOrcamentoSolicitacoes (EmpresaId, CriadoEm DESC, Id DESC);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_EmpresaOrcamentoSolicitacoes_Empresa_Status'
    AND object_id = OBJECT_ID('dbo.EmpresaOrcamentoSolicitacoes')
)
BEGIN
  CREATE INDEX IX_EmpresaOrcamentoSolicitacoes_Empresa_Status
    ON dbo.EmpresaOrcamentoSolicitacoes (EmpresaId, Status, CriadoEm DESC, Id DESC);
END;
