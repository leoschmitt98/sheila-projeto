/*
  Suporte a agendamentos avulsos de orçamento (sem depender de EmpresaServicos).
  Esses campos permitem registrar mão de obra/produtos e usar o valor final no faturamento.
*/

IF COL_LENGTH('dbo.Agendamentos', 'IsServicoAvulso') IS NULL
BEGIN
  ALTER TABLE dbo.Agendamentos ADD IsServicoAvulso BIT NOT NULL CONSTRAINT DF_Agendamentos_IsServicoAvulso DEFAULT(0);
END;

IF COL_LENGTH('dbo.Agendamentos', 'ServicoDescricaoAvulsa') IS NULL
BEGIN
  ALTER TABLE dbo.Agendamentos ADD ServicoDescricaoAvulsa NVARCHAR(500) NULL;
END;

IF COL_LENGTH('dbo.Agendamentos', 'ModeloReferencia') IS NULL
BEGIN
  ALTER TABLE dbo.Agendamentos ADD ModeloReferencia NVARCHAR(160) NULL;
END;

IF COL_LENGTH('dbo.Agendamentos', 'ValorMaoObra') IS NULL
BEGIN
  ALTER TABLE dbo.Agendamentos ADD ValorMaoObra DECIMAL(12,2) NULL;
END;

IF COL_LENGTH('dbo.Agendamentos', 'ValorProdutos') IS NULL
BEGIN
  ALTER TABLE dbo.Agendamentos ADD ValorProdutos DECIMAL(12,2) NULL;
END;

IF COL_LENGTH('dbo.Agendamentos', 'ValorFinal') IS NULL
BEGIN
  ALTER TABLE dbo.Agendamentos ADD ValorFinal DECIMAL(12,2) NULL;
END;
