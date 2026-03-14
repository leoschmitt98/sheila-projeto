IF COL_LENGTH('dbo.Empresas', 'OpcoesIniciaisSheila') IS NULL
BEGIN
  ALTER TABLE dbo.Empresas
    ADD OpcoesIniciaisSheila NVARCHAR(500) NULL;
END

UPDATE dbo.Empresas
SET OpcoesIniciaisSheila = '["agendar","orcamento","servicos","horarios","ajuda"]'
WHERE OpcoesIniciaisSheila IS NULL;
