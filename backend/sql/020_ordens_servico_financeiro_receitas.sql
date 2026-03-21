IF OBJECT_ID('dbo.EmpresaFinanceiroReceitas', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmpresaFinanceiroReceitas (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpresaId INT NOT NULL,
    OrigemTipo NVARCHAR(40) NOT NULL,
    OrigemId INT NOT NULL,
    Referencia NVARCHAR(80) NULL,
    Descricao NVARCHAR(300) NOT NULL,
    Valor DECIMAL(12,2) NOT NULL,
    DataRef DATE NOT NULL,
    CriadoEm DATETIME2(0) NOT NULL
      CONSTRAINT DF_EmpresaFinanceiroReceitas_CriadoEm DEFAULT(
        CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'E. South America Standard Time' AS DATETIME2(0))
      )
  );
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_EmpresaFinanceiroReceitas_Empresas'
)
BEGIN
  ALTER TABLE dbo.EmpresaFinanceiroReceitas
  ADD CONSTRAINT FK_EmpresaFinanceiroReceitas_Empresas
    FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_EmpresaFinanceiroReceitas_Origem'
    AND object_id = OBJECT_ID('dbo.EmpresaFinanceiroReceitas')
)
BEGIN
  CREATE UNIQUE INDEX UX_EmpresaFinanceiroReceitas_Origem
    ON dbo.EmpresaFinanceiroReceitas (EmpresaId, OrigemTipo, OrigemId);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_EmpresaFinanceiroReceitas_Empresa_Data'
    AND object_id = OBJECT_ID('dbo.EmpresaFinanceiroReceitas')
)
BEGIN
  CREATE INDEX IX_EmpresaFinanceiroReceitas_Empresa_Data
    ON dbo.EmpresaFinanceiroReceitas (EmpresaId, DataRef DESC, Id DESC);
END;

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

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_EmpresaOrdensServico_FinanceiroReceitas'
)
BEGIN
  ALTER TABLE dbo.EmpresaOrdensServico
  ADD CONSTRAINT FK_EmpresaOrdensServico_FinanceiroReceitas
    FOREIGN KEY (FinanceiroReceitaId) REFERENCES dbo.EmpresaFinanceiroReceitas(Id);
END;
