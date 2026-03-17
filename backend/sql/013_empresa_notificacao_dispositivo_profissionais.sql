IF OBJECT_ID('dbo.EmpresaNotificacaoDispositivoProfissionais', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmpresaNotificacaoDispositivoProfissionais (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpresaId INT NOT NULL,
    DispositivoId INT NOT NULL,
    ProfissionalId INT NOT NULL,
    CriadoEm DATETIME2(0) NOT NULL
      CONSTRAINT DF_EmpresaNotificacaoDispositivoProfissionais_CriadoEm DEFAULT(
        CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'E. South America Standard Time' AS DATETIME2(0))
      )
  );
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_EmpresaNotificacaoDispositivoProfissionais_Empresas'
)
BEGIN
  ALTER TABLE dbo.EmpresaNotificacaoDispositivoProfissionais
  ADD CONSTRAINT FK_EmpresaNotificacaoDispositivoProfissionais_Empresas
    FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_EmpresaNotificacaoDispositivoProfissionais_Dispositivos'
)
BEGIN
  ALTER TABLE dbo.EmpresaNotificacaoDispositivoProfissionais
  ADD CONSTRAINT FK_EmpresaNotificacaoDispositivoProfissionais_Dispositivos
    FOREIGN KEY (DispositivoId) REFERENCES dbo.EmpresaNotificacaoDispositivos(Id);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_EmpresaNotificacaoDispositivoProfissionais_Dispositivo_Profissional'
    AND object_id = OBJECT_ID('dbo.EmpresaNotificacaoDispositivoProfissionais')
)
BEGIN
  CREATE UNIQUE INDEX UX_EmpresaNotificacaoDispositivoProfissionais_Dispositivo_Profissional
    ON dbo.EmpresaNotificacaoDispositivoProfissionais (DispositivoId, ProfissionalId);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_EmpresaNotificacaoDispositivoProfissionais_Empresa_Profissional'
    AND object_id = OBJECT_ID('dbo.EmpresaNotificacaoDispositivoProfissionais')
)
BEGIN
  CREATE INDEX IX_EmpresaNotificacaoDispositivoProfissionais_Empresa_Profissional
    ON dbo.EmpresaNotificacaoDispositivoProfissionais (EmpresaId, ProfissionalId, DispositivoId);
END;
