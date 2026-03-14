IF COL_LENGTH('dbo.EmpresaProfissionais', 'Whatsapp') IS NULL
BEGIN
  ALTER TABLE dbo.EmpresaProfissionais ADD Whatsapp VARCHAR(20) NULL;
END;

UPDATE dbo.EmpresaProfissionais
SET Whatsapp = ISNULL(NULLIF(Whatsapp, ''), '00000000000')
WHERE Whatsapp IS NULL OR LTRIM(RTRIM(Whatsapp)) = '';

IF EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.EmpresaProfissionais')
    AND name = 'Whatsapp'
    AND is_nullable = 1
)
BEGIN
  ALTER TABLE dbo.EmpresaProfissionais ALTER COLUMN Whatsapp VARCHAR(20) NOT NULL;
END;
