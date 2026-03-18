IF OBJECT_ID('dbo.EmpresaProfissionaisHorarios', 'U') IS NOT NULL
BEGIN
  IF COL_LENGTH('dbo.EmpresaProfissionaisHorarios', 'IntervaloAtivo') IS NULL
  BEGIN
    ALTER TABLE dbo.EmpresaProfissionaisHorarios
    ADD IntervaloAtivo BIT NOT NULL
      CONSTRAINT DF_EmpresaProfissionaisHorarios_IntervaloAtivo DEFAULT(0);
  END;

  IF COL_LENGTH('dbo.EmpresaProfissionaisHorarios', 'IntervaloInicio') IS NULL
  BEGIN
    ALTER TABLE dbo.EmpresaProfissionaisHorarios
    ADD IntervaloInicio VARCHAR(5) NULL;
  END;

  IF COL_LENGTH('dbo.EmpresaProfissionaisHorarios', 'IntervaloFim') IS NULL
  BEGIN
    ALTER TABLE dbo.EmpresaProfissionaisHorarios
    ADD IntervaloFim VARCHAR(5) NULL;
  END;
END;
