IF OBJECT_ID('dbo.EmpresaProfissionaisHorarios', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmpresaProfissionaisHorarios (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpresaId INT NOT NULL,
    ProfissionalId INT NOT NULL,
    DiaSemana INT NOT NULL,
    HoraInicio VARCHAR(5) NOT NULL,
    HoraFim VARCHAR(5) NOT NULL,
    Ativo BIT NOT NULL CONSTRAINT DF_EmpresaProfissionaisHorarios_Ativo DEFAULT (1),
    CriadoEm DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaProfissionaisHorarios_CriadoEm DEFAULT (SYSDATETIME())
  );

  CREATE UNIQUE INDEX UX_EmpresaProfissionaisHorarios
    ON dbo.EmpresaProfissionaisHorarios (EmpresaId, ProfissionalId, DiaSemana);
END;
