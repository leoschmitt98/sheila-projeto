# Testes e Qualidade

## Estratégia de qualidade no projeto
O projeto combina:
- validações de regra de negócio no backend
- proteção de rotas e mensagens amigáveis no frontend
- testes automatizados E2E para os fluxos principais
- observabilidade mínima (healthchecks + logs por módulo)

## Testes automatizados existentes
### Cypress E2E (principal)
Estrutura identificada em `frontend/cypress/` com specs para fluxos críticos:
- `auth.cy.ts`
- `agendamento.cy.ts`
- `orcamentos.cy.ts`
- `ordens-servico.cy.ts`
- `financeiro.cy.ts`
- `sheilachat.cy.ts`

Cobertura funcional observada:
- autenticação admin (acesso, login inválido/válido, logout, proteção de rota)
- criação e verificação de agendamento
- captação de orçamento via chat + validação no admin
- ciclo de OS (criação, edição, status)
- integração OS -> financeiro com verificação de não duplicidade
- consulta e validações do SheilaChat

## Destaque para varredura diária
O repositório já possui suíte Cypress estruturada para execução recorrente dos principais fluxos.  
Isso permite **varredura diária de regressão** (via CI ou rotina operacional), reduzindo risco de quebra silenciosa em funcionalidades críticas.

## Configuração E2E (sem hardcode de segredo)
- `frontend/cypress.config.cjs` lê variáveis de ambiente e suporte a `cypress.env.json` local.
- Senha admin de teste é externa ao código.
- Exemplo de variáveis:
  - `CYPRESS_ADMIN_PASSWORD`
  - `CYPRESS_EMPRESA_SLUG`
  - `CYPRESS_BASE_URL`
  - `CYPRESS_API_BASE_URL`

## Comandos
```bash
cd frontend
npm run test:e2e
```

Modo interativo:
```bash
cd frontend
npm run test:e2e:open
```

## Práticas de qualidade percebidas no código
- Data attributes (`data-cy`) em elementos críticos para testes estáveis.
- Mensagens de erro amigáveis em fluxos de login/chat.
- Rate limit em rotas sensíveis.
- Healthchecks para monitoramento de app e banco.
- Logs estruturados por módulo com sanitização de dados sensíveis.
- Tratamento de exceções de processo (`unhandledRejection`, `uncaughtException`).

## Valor dos testes para prevenção de regressão
- Detectam falhas em jornadas reais de usuário, não apenas funções isoladas.
- Protegem áreas de maior impacto:
  - entrada no admin
  - criação e atualização de agendamento
  - captação de leads (orçamento)
  - operação de ordens de serviço
  - consistência da integração financeira
- Aumentam confiança para deploy em produção/homologação.

## Smoke test e regressão recomendados
### Smoke (rápido)
- `auth.cy.ts`
- `agendamento.cy.ts`
- `financeiro.cy.ts`

### Regressão completa
- execução de toda a suíte `cypress/e2e/**/*.cy.{ts,tsx}`

### Segurança funcional mínima
- manter validação de sessão admin no frontend e backend
- garantir bloqueio de acesso pós-logout

## Pontos de evolução
- Integrar execução Cypress em pipeline CI com gatilho diário.
- Publicar artefatos de execução (screenshots/logs) para auditoria.
- Evoluir matriz de cenários negativos por módulo.
