/*
  Autenticação admin por empresa.
  Senha por cliente controlada via banco (hash SHA2_256 em hex).
*/

IF OBJECT_ID('dbo.EmpresaAdminAuth', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmpresaAdminAuth (
    EmpresaId INT NOT NULL PRIMARY KEY,
    PasswordHash VARCHAR(64) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_EmpresaAdminAuth_IsActive DEFAULT(1),
    UpdatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_EmpresaAdminAuth_UpdatedAt DEFAULT(SYSUTCDATETIME())
  );

  ALTER TABLE dbo.EmpresaAdminAuth
  ADD CONSTRAINT FK_EmpresaAdminAuth_Empresas
  FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);
END
GO

/*
  Exemplo de definir/alterar senha por slug (rode conforme cada cliente):

  DECLARE @slug NVARCHAR(80) = N'meubarbeiro';
  DECLARE @senha NVARCHAR(200) = N'SenhaForteAqui123!';

  MERGE dbo.EmpresaAdminAuth AS target
  USING (
    SELECT TOP 1
      e.Id AS EmpresaId,
      LOWER(CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', @senha), 2)) AS PasswordHash
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
