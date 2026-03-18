IF OBJECT_ID('dbo.EmpresaDespesas', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmpresaDespesas (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpresaId INT NOT NULL,
    Descricao NVARCHAR(160) NOT NULL,
    Categoria NVARCHAR(60) NOT NULL,
    Valor DECIMAL(12,2) NOT NULL,
    DataDespesa DATE NOT NULL,
    Observacao NVARCHAR(500) NULL,
    CriadoEm DATETIME2(0) NOT NULL
      CONSTRAINT DF_EmpresaDespesas_CriadoEm DEFAULT(
        CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'E. South America Standard Time' AS DATETIME2(0))
      ),
    AtualizadoEm DATETIME2(0) NOT NULL
      CONSTRAINT DF_EmpresaDespesas_AtualizadoEm DEFAULT(
        CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'E. South America Standard Time' AS DATETIME2(0))
      )
  );
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_EmpresaDespesas_Empresas'
)
BEGIN
  ALTER TABLE dbo.EmpresaDespesas
  ADD CONSTRAINT FK_EmpresaDespesas_Empresas
    FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_EmpresaDespesas_Empresa_Data'
    AND object_id = OBJECT_ID('dbo.EmpresaDespesas')
)
BEGIN
  CREATE INDEX IX_EmpresaDespesas_Empresa_Data
    ON dbo.EmpresaDespesas (EmpresaId, DataDespesa DESC, Id DESC);
END;
