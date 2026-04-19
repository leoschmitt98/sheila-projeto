/*
  Autenticação admin por empresa.
  Senha por cliente controlada via banco.
  Formato recomendado: scrypt com salt gerado pelo backend.
*/

IF OBJECT_ID('dbo.EmpresaAdminAuth', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmpresaAdminAuth (
    EmpresaId INT NOT NULL PRIMARY KEY,
    PasswordHash NVARCHAR(255) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_EmpresaAdminAuth_IsActive DEFAULT(1),
    UpdatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaAdminAuth_UpdatedAt DEFAULT(SYSUTCDATETIME())
  );

  ALTER TABLE dbo.EmpresaAdminAuth
  ADD CONSTRAINT FK_EmpresaAdminAuth_Empresas
  FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);
END
GO

IF COL_LENGTH('dbo.EmpresaAdminAuth', 'PasswordHash') IS NOT NULL
BEGIN
  ALTER TABLE dbo.EmpresaAdminAuth
  ALTER COLUMN PasswordHash NVARCHAR(255) NOT NULL;
END
GO

/*
  Exemplo de definir/alterar senha por slug (rode conforme cada cliente):

  DECLARE @slug NVARCHAR(80) = N'meubarbeiro';
  DECLARE @passwordHash NVARCHAR(255) = N'scrypt$16384$8$1$...';

  Gere o hash no backend:
    npm run hash-admin-password -- "SenhaForteAqui123!"

  MERGE dbo.EmpresaAdminAuth AS target
  USING (
    SELECT TOP 1
      e.Id AS EmpresaId,
      @passwordHash AS PasswordHash
    FROM dbo.Empresas e
    WHERE e.Slug = @slug
  ) AS src
  ON target.EmpresaId = src.EmpresaId
  WHEN MATCHED THEN
    UPDATE SET
      target.PasswordHash = src.PasswordHash,
      target.IsActive = 1,
      target.UpdatedAt = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (EmpresaId, PasswordHash, IsActive, UpdatedAt)
    VALUES (src.EmpresaId, src.PasswordHash, 1, SYSUTCDATETIME());
*/
