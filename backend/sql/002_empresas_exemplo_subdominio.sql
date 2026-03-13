/*
  Empresas de exemplo para uso com subdomínios:
  - meubarbeiro.sheilasystem.com.br
  - minhamanicure.sheilasystem.com.br
  - minhaassistencia.sheilasystem.com.br
*/

IF NOT EXISTS (SELECT 1 FROM dbo.Empresas WHERE Slug = N'meubarbeiro')
BEGIN
  INSERT INTO dbo.Empresas
    (Nome, Slug, MensagemBoasVindas, WhatsappPrestador, NomeProprietario, Endereco)
  VALUES
    (N'Meu Barbeiro', N'meubarbeiro', N'Olá! Eu sou a Sheila da Meu Barbeiro 💈', N'51999990001', N'Rafael', N'Centro');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Empresas WHERE Slug = N'minhamanicure')
BEGIN
  INSERT INTO dbo.Empresas
    (Nome, Slug, MensagemBoasVindas, WhatsappPrestador, NomeProprietario, Endereco)
  VALUES
    (N'Minha Manicure', N'minhamanicure', N'Olá! Eu sou a Sheila da Minha Manicure 💅', N'51999990002', N'Camila', N'Centro');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Empresas WHERE Slug = N'minhaassistencia')
BEGIN
  INSERT INTO dbo.Empresas
    (Nome, Slug, MensagemBoasVindas, WhatsappPrestador, NomeProprietario, Endereco)
  VALUES
    (N'Minha Assistência', N'minhaassistencia', N'Olá! Eu sou a Sheila da Minha Assistência 📱', N'51999990003', N'Diego', N'Centro');
END
GO
