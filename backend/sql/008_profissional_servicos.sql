IF OBJECT_ID('dbo.EmpresaProfissionalServicos', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmpresaProfissionalServicos (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpresaId INT NOT NULL,
    ProfissionalId INT NOT NULL,
    ServicoId INT NOT NULL,
    CriadoEm DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaProfissionalServicos_CriadoEm DEFAULT (SYSDATETIME())
  );

  CREATE UNIQUE INDEX UX_EmpresaProfissionalServicos
    ON dbo.EmpresaProfissionalServicos (EmpresaId, ProfissionalId, ServicoId);

  CREATE INDEX IX_EmpresaProfissionalServicos_Servico
    ON dbo.EmpresaProfissionalServicos (EmpresaId, ServicoId);
END;
