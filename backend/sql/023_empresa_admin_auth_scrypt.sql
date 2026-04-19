/*
  Amplia a coluna de senha admin para suportar hashes scrypt com salt.
  Necessario para migrar do legado SHA2_256 hex (64 chars) para:
  scrypt$N$r$p$salt_base64url$hash_base64url
*/

IF COL_LENGTH('dbo.EmpresaAdminAuth', 'PasswordHash') IS NOT NULL
BEGIN
  ALTER TABLE dbo.EmpresaAdminAuth
  ALTER COLUMN PasswordHash NVARCHAR(255) NOT NULL;
END;
GO
