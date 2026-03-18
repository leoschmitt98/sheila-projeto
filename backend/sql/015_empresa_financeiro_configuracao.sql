IF OBJECT_ID('dbo.EmpresaFinanceiroConfiguracao', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmpresaFinanceiroConfiguracao (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpresaId INT NOT NULL,
    PercentualRetiradaDono DECIMAL(5,2) NOT NULL
      CONSTRAINT DF_EmpresaFinanceiroConfiguracao_Retirada DEFAULT(50),
    PercentualCaixa DECIMAL(5,2) NOT NULL
      CONSTRAINT DF_EmpresaFinanceiroConfiguracao_Caixa DEFAULT(30),
    PercentualDespesas DECIMAL(5,2) NOT NULL
      CONSTRAINT DF_EmpresaFinanceiroConfiguracao_Despesas DEFAULT(20),
    CriadoEm DATETIME2(0) NOT NULL
      CONSTRAINT DF_EmpresaFinanceiroConfiguracao_CriadoEm DEFAULT(
        CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'E. South America Standard Time' AS DATETIME2(0))
      ),
    AtualizadoEm DATETIME2(0) NOT NULL
      CONSTRAINT DF_EmpresaFinanceiroConfiguracao_AtualizadoEm DEFAULT(
        CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'E. South America Standard Time' AS DATETIME2(0))
      )
  );
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_EmpresaFinanceiroConfiguracao_Empresas'
)
BEGIN
  ALTER TABLE dbo.EmpresaFinanceiroConfiguracao
  ADD CONSTRAINT FK_EmpresaFinanceiroConfiguracao_Empresas
    FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_EmpresaFinanceiroConfiguracao_Empresa'
    AND object_id = OBJECT_ID('dbo.EmpresaFinanceiroConfiguracao')
)
BEGIN
  CREATE UNIQUE INDEX UX_EmpresaFinanceiroConfiguracao_Empresa
    ON dbo.EmpresaFinanceiroConfiguracao (EmpresaId);
END;
