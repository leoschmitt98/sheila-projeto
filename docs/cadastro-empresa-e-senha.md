# Cadastro de Empresa e Senha Admin

Este documento reúne scripts prontos para:

- adicionar uma nova empresa na tabela `dbo.Empresas`
- configurar ou atualizar a senha administrativa na tabela `dbo.EmpresaAdminAuth`
- validar `Id`, `Nome` e `Slug` antes do login

## 1) Adicionar uma nova empresa

Escolha um `slug` simples, sem espaços e sem acentos. Esse valor é usado no login e nas URLs do sistema, por exemplo:

```text
/admin/login?empresa=studioic
```

Script base:

```sql
IF NOT EXISTS (SELECT 1 FROM dbo.Empresas WHERE Slug = N'studioic')
BEGIN
  INSERT INTO dbo.Empresas
    (Nome, Slug, MensagemBoasVindas, WhatsappPrestador, NomeProprietario, Endereco)
  VALUES
    (
      N'Studio IC',
      N'studioic',
      N'Ola! Eu sou a Sheila da Studio IC',
      N'',
      N'',
      N''
    );
END
GO
```

## 2) Conferir o `Id` da empresa cadastrada

Antes de configurar a senha por `EmpresaId`, confirme qual registro foi criado:

```sql
SELECT Id, Nome, Slug
FROM dbo.Empresas
WHERE Nome = N'Studio IC'
   OR Slug = N'studioic';
```

## 3) Atualizar a senha de uma empresa que ja tem auth

Se a empresa ja possui linha em `dbo.EmpresaAdminAuth`, voce pode atualizar diretamente:

```sql
UPDATE dbo.EmpresaAdminAuth
SET
    PasswordHash = LOWER(CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', '123456'), 2)),
    IsActive = 1,
    UpdatedAt = SYSUTCDATETIME()
WHERE EmpresaId = 4;
```

Observacao:

- no exemplo acima, a senha configurada e `123456`
- troque o valor de `EmpresaId` pelo `Id` real encontrado na consulta anterior

## 4) Criar ou atualizar a senha com seguranca

Se voce nao souber se a linha ja existe em `dbo.EmpresaAdminAuth`, prefira `MERGE`:

```sql
DECLARE @EmpresaId INT = 4;
DECLARE @Senha NVARCHAR(200) = N'123456';

MERGE dbo.EmpresaAdminAuth AS target
USING (
    SELECT
        @EmpresaId AS EmpresaId,
        LOWER(CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', @Senha), 2)) AS PasswordHash
) AS src
ON target.EmpresaId = src.EmpresaId
WHEN MATCHED THEN
    UPDATE SET
        PasswordHash = src.PasswordHash,
        IsActive = 1,
        UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (EmpresaId, PasswordHash, IsActive, UpdatedAt)
    VALUES (src.EmpresaId, src.PasswordHash, 1, SYSUTCDATETIME());
GO
```

## 5) Script completo de exemplo

Este exemplo adiciona a empresa `Studio IC` e depois configura a senha admin:

```sql
IF NOT EXISTS (SELECT 1 FROM dbo.Empresas WHERE Slug = N'studioic')
BEGIN
  INSERT INTO dbo.Empresas
    (Nome, Slug, MensagemBoasVindas, WhatsappPrestador, NomeProprietario, Endereco)
  VALUES
    (
      N'Studio IC',
      N'studioic',
      N'Ola! Eu sou a Sheila da Studio IC',
      N'',
      N'',
      N''
    );
END
GO

DECLARE @EmpresaId INT;
DECLARE @Senha NVARCHAR(200) = N'123456';

SELECT TOP 1 @EmpresaId = Id
FROM dbo.Empresas
WHERE Slug = N'studioic';

MERGE dbo.EmpresaAdminAuth AS target
USING (
    SELECT
        @EmpresaId AS EmpresaId,
        LOWER(CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', @Senha), 2)) AS PasswordHash
) AS src
ON target.EmpresaId = src.EmpresaId
WHEN MATCHED THEN
    UPDATE SET
        PasswordHash = src.PasswordHash,
        IsActive = 1,
        UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (EmpresaId, PasswordHash, IsActive, UpdatedAt)
    VALUES (src.EmpresaId, src.PasswordHash, 1, SYSUTCDATETIME());
GO
```

## 6) Como fazer login

O login administrativo usa o `slug` da empresa, nao o `Id`.

Exemplo:

```text
/admin/login?empresa=studioic
```

Senha do exemplo:

```text
123456
```

## 7) Checklist rapido quando a senha nao funciona

- confirmar se o `slug` esta correto na URL
- confirmar se o `EmpresaId` usado no script pertence a empresa certa
- confirmar se existe linha em `dbo.EmpresaAdminAuth`
- confirmar se `IsActive = 1`
- confirmar se a senha usada no `HASHBYTES('SHA2_256', '...')` e exatamente a mesma digitada no login
