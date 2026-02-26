-- Seed opcional para desenvolvimento local

INSERT INTO "Empresas" ("Nome", "Slug", "MensagemBoasVindas", "WhatsappPrestador", "NomeProprietario", "Endereco")
VALUES
  ('Studio Sheila', 'studio-sheila', 'Bem-vinda! Como posso ajudar hoje?', '5511999999999', 'Sheila', 'Rua Exemplo, 123')
ON CONFLICT ("Slug") DO NOTHING;

INSERT INTO "EmpresaServicos" ("EmpresaId", "Nome", "Descricao", "DuracaoMin", "Preco", "Ativo")
SELECT e."Id", 'Corte Feminino', 'Corte e finalização', 60, 95.00, TRUE
FROM "Empresas" e
WHERE e."Slug" = 'studio-sheila'
  AND NOT EXISTS (
    SELECT 1
    FROM "EmpresaServicos" s
    WHERE s."EmpresaId" = e."Id" AND s."Nome" = 'Corte Feminino'
  );
