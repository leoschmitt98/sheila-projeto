IF OBJECT_ID('dbo.EmpresaOrdensServico', 'U') IS NOT NULL
BEGIN
  UPDATE dbo.EmpresaOrdensServico
  SET ValorTotal = ROUND(ISNULL(ValorMaoObra, 0) + ISNULL(ValorPecas, 0), 2)
  WHERE ValorTotal IS NULL
     OR ABS(ISNULL(ValorTotal, 0) - (ISNULL(ValorMaoObra, 0) + ISNULL(ValorPecas, 0))) > 0.009;
END;
