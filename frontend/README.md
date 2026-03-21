# Sheila System Frontend

## Testes E2E com Cypress

### 1) Variaveis de ambiente para Cypress

Obrigatoria:

- `CYPRESS_ADMIN_PASSWORD` -> senha do admin usada no login dos testes.

Recomendadas:

- `CYPRESS_EMPRESA_SLUG` -> slug da empresa de teste (padrao: `nando`).
- `CYPRESS_BASE_URL` -> URL do frontend (padrao: `http://localhost:5173`).
- `CYPRESS_API_BASE_URL` -> URL da API backend (padrao: `http://localhost:3001`).

Exemplo no PowerShell:

```powershell
$env:CYPRESS_ADMIN_PASSWORD = "sua_senha_admin"
$env:CYPRESS_EMPRESA_SLUG = "nando"
$env:CYPRESS_BASE_URL = "http://localhost:5173"
$env:CYPRESS_API_BASE_URL = "http://localhost:3001"
```

### 2) Rodar testes

Interface:

```bash
npx cypress open
```

Headless:

```bash
npx cypress run
```

### 3) Estrutura da suite

```text
cypress/
  e2e/
    auth.cy.ts
    orcamentos.cy.ts
    ordens-servico.cy.ts
    financeiro.cy.ts
    sheilachat.cy.ts
    agendamento.cy.ts
  support/
    commands.ts
    faker.ts
    e2e.ts
  fixtures/
```

### 4) Observacoes

- A senha de admin **nao** fica hardcoded.
- O comando `cy.loginAdmin()` usa `CYPRESS_ADMIN_PASSWORD`.
- Os dados de teste usam `@faker-js/faker` para reduzir conflito entre execucoes.

