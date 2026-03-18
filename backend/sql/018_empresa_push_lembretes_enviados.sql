IF OBJECT_ID('dbo.EmpresaPushLembretesEnviados', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmpresaPushLembretesEnviados (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpresaId INT NOT NULL,
    AgendamentoId INT NOT NULL,
    MinutosAntes INT NOT NULL,
    Tipo NVARCHAR(40) NOT NULL
      CONSTRAINT DF_EmpresaPushLembretesEnviados_Tipo DEFAULT('whatsapp_lembrete'),
    EnviadoEm DATETIME2(0) NOT NULL
      CONSTRAINT DF_EmpresaPushLembretesEnviados_EnviadoEm DEFAULT(
        CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'E. South America Standard Time' AS DATETIME2(0))
      )
  );
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_EmpresaPushLembretesEnviados_Empresas'
)
BEGIN
  ALTER TABLE dbo.EmpresaPushLembretesEnviados
  ADD CONSTRAINT FK_EmpresaPushLembretesEnviados_Empresas
    FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_EmpresaPushLembretesEnviados_Empresa_Agendamento_Minutos_Tipo'
    AND object_id = OBJECT_ID('dbo.EmpresaPushLembretesEnviados')
)
BEGIN
  CREATE UNIQUE INDEX UX_EmpresaPushLembretesEnviados_Empresa_Agendamento_Minutos_Tipo
    ON dbo.EmpresaPushLembretesEnviados (EmpresaId, AgendamentoId, MinutosAntes, Tipo);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_EmpresaPushLembretesEnviados_Empresa_EnviadoEm'
    AND object_id = OBJECT_ID('dbo.EmpresaPushLembretesEnviados')
)
BEGIN
  CREATE INDEX IX_EmpresaPushLembretesEnviados_Empresa_EnviadoEm
    ON dbo.EmpresaPushLembretesEnviados (EmpresaId, EnviadoEm DESC, Id DESC);
END;
