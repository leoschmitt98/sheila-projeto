IF OBJECT_ID('dbo.EmpresaProfissionais', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmpresaProfissionais (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpresaId INT NOT NULL,
    Nome NVARCHAR(120) NOT NULL,
    Whatsapp VARCHAR(20) NOT NULL,
    Ativo BIT NOT NULL CONSTRAINT DF_EmpresaProfissionais_Ativo DEFAULT (1),
    CriadoEm DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaProfissionais_CriadoEm DEFAULT (SYSDATETIME())
  );

  CREATE INDEX IX_EmpresaProfissionais_EmpresaId ON dbo.EmpresaProfissionais (EmpresaId);
END;

IF COL_LENGTH('dbo.Agendamentos', 'ProfissionalId') IS NULL
BEGIN
  ALTER TABLE dbo.Agendamentos ADD ProfissionalId INT NULL;
END;
