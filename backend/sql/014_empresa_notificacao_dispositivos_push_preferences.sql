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
