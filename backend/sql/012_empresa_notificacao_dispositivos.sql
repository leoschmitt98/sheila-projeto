/*
  Base de dispositivos autorizados para notificacoes futuras por empresa.
  Nesta etapa:
  - sem push real
  - sem service worker
  - preparada para endpoint/auth/p256dh no futuro
*/

IF OBJECT_ID('dbo.EmpresaNotificacaoDispositivos', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmpresaNotificacaoDispositivos (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpresaId INT NOT NULL,
    DeviceId NVARCHAR(120) NOT NULL,
    NomeDispositivo NVARCHAR(160) NOT NULL,
    Endpoint NVARCHAR(MAX) NULL,
    Auth NVARCHAR(500) NULL,
    P256dh NVARCHAR(500) NULL,
    RecebePushAgendamento BIT NOT NULL
      CONSTRAINT DF_EmpresaNotificacaoDispositivos_RecebePushAgendamento DEFAULT(1),
    RecebePushLembrete BIT NOT NULL
      CONSTRAINT DF_EmpresaNotificacaoDispositivos_RecebePushLembrete DEFAULT(1),
    Ativo BIT NOT NULL
      CONSTRAINT DF_EmpresaNotificacaoDispositivos_Ativo DEFAULT(1),
    CriadoEm DATETIME2(0) NOT NULL
      CONSTRAINT DF_EmpresaNotificacaoDispositivos_CriadoEm DEFAULT(
        CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'E. South America Standard Time' AS DATETIME2(0))
      ),
    AtualizadoEm DATETIME2(0) NOT NULL
      CONSTRAINT DF_EmpresaNotificacaoDispositivos_AtualizadoEm DEFAULT(
        CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'E. South America Standard Time' AS DATETIME2(0))
      )
  );
END;

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

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_EmpresaNotificacaoDispositivos_Empresas'
)
BEGIN
  ALTER TABLE dbo.EmpresaNotificacaoDispositivos
  ADD CONSTRAINT FK_EmpresaNotificacaoDispositivos_Empresas
    FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_EmpresaNotificacaoDispositivos_Empresa_Device'
    AND object_id = OBJECT_ID('dbo.EmpresaNotificacaoDispositivos')
)
BEGIN
  CREATE UNIQUE INDEX UX_EmpresaNotificacaoDispositivos_Empresa_Device
    ON dbo.EmpresaNotificacaoDispositivos (EmpresaId, DeviceId);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_EmpresaNotificacaoDispositivos_Empresa_Ativo'
    AND object_id = OBJECT_ID('dbo.EmpresaNotificacaoDispositivos')
)
BEGIN
  CREATE INDEX IX_EmpresaNotificacaoDispositivos_Empresa_Ativo
    ON dbo.EmpresaNotificacaoDispositivos (EmpresaId, Ativo, AtualizadoEm DESC, Id DESC);
END;
