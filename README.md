# Sheila System

Sistema SaaS multiempresa para agendamentos e gestão administrativa, com experiência pública (cliente) e painel administrativo (empresa) no mesmo produto.

## Visão rápida
O Sheila System resolve um problema comum de operação em pequenos negócios de serviços: agenda descentralizada, falta de confirmação de horários, dificuldade de acompanhamento diário e baixa rastreabilidade financeira/operacional.

Este repositório demonstra um sistema real com:
- fluxo público de agendamento orientado por chat (SheilaChat)
- painel admin com autenticação por empresa
- isolamento multiempresa por `slug` (query param ou subdomínio)
- notificações e push web
- módulo de ordens de serviço
- integração de ordens de serviço com financeiro
- suíte de testes E2E com Cypress para validar os principais fluxos

## Problema que o projeto resolve
- Reduz retrabalho no agendamento manual (telefone/WhatsApp sem histórico).
- Estrutura confirmação/cancelamento com regras de negócio reais.
- Organiza operação por empresa, profissional, serviço e status.
- Dá visibilidade operacional e financeira em um único painel.

## Público-alvo
- Negócios de atendimento com agenda (salões, barbearias, estética, assistência técnica e serviços similares).
- Donos/gestores que precisam de controle diário da operação.

## Funcionalidades principais
- Agendamento público via chat com escolha de serviço, profissional (quando aplicável), data e horário.
- Consulta de disponibilidade com regras de conflito, jornada e intervalo.
- Consulta de registros recentes e solicitação de cancelamento no chat.
- Solicitação de orçamento no chat (lead registrado no painel).
- Consulta pública de status de ordem de serviço por nome + telefone.
- Painel admin com:
  - login por empresa
  - dashboard operacional
  - gestão de agendamentos (status e ações rápidas)
  - serviços e profissionais
  - horários de funcionamento por profissional (incluindo intervalo)
  - finanças e despesas
  - relatórios
  - ordens de serviço (cadastro, atualização, status, impressão e WhatsApp)
  - solicitações de orçamento
  - configurações gerais e notificações no dispositivo
- Push web para novos agendamentos e lembretes automáticos.
- Healthchecks, logs por módulo e rotina de retenção de logs.

## Stack
- Frontend: React 18, TypeScript, Vite, React Router, React Query, Tailwind, Radix UI
- Backend: Node.js, Express, `mssql`, `web-push`
- Banco: SQL Server
- Testes: Cypress (E2E) e Vitest (base)

## Destaques técnicos
- **Multiempresa por slug/subdomínio**: resolução de tenant no frontend e backend.
- **Autenticação administrativa por empresa**: sessão validada via token assinado + endpoint de sessão.
- **Rate limiting** em rotas sensíveis (login e endpoints públicos de alto uso).
- **Regras de agenda não triviais**:
  - grade de slots por passo configurado no backend
  - bloqueio por conflito real de intervalo de atendimento
  - respeito a jornada por profissional e pausa de intervalo
- **Notificações push com job automático** para lembrete.
- **Observabilidade mínima de produção**:
  - `/health` e `/health/db`
  - logs estruturados por módulo
  - retenção automática de logs antigos
- **Cypress E2E cobrindo fluxos críticos**, com estrutura preparada para varredura diária e prevenção de regressões.

## Estrutura resumida
```text
backend/
  server.js
  lib/logger.js
  sql/*.sql
frontend/
  src/
    components/
    pages/
    hooks/
    lib/
  cypress/
    e2e/*.cy.ts
    support/
docs/
  visao-geral.md
  arquitetura.md
  regras-de-negocio.md
  fluxos-do-sistema.md
  testes-e-qualidade.md
  deploy-e-operacao.md
  aprendizados-e-evolucao.md
```

## Como rodar localmente
### 1) Backend
```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

### 2) Frontend
```bash
cd frontend
npm install
npm run dev
```

## Como executar testes automatizados
### E2E (Cypress)
```bash
cd frontend
npm run test:e2e
```

Modo interativo:
```bash
cd frontend
npm run test:e2e:open
```

Observação: os testes usam variáveis de ambiente específicas de E2E (ex.: senha admin e slug da empresa de teste), sem hardcode de segredo no código.

## Ambientes (local/homologação/produção)
- O código suporta operação com domínios por subdomínio (`<slug>.sheilasystem.com.br`) e também fallback por query param (`?empresa=slug`) em ambiente local.
- Há documentação operacional em [docs/OPERACAO_PRODUCAO.md](docs/OPERACAO_PRODUCAO.md).

## Screenshots (sugestão)
Crie uma pasta `docs/images/` para incluir:
- chat público (agendamento)
- dashboard admin
- agendamentos
- ordens de serviço
- finanças

## Aprendizados e desafios
- Implementar multiempresa de forma consistente em frontend + backend.
- Tratar datas/horários com cuidado de timezone e data civil.
- Evoluir regras de negócio sem quebrar produção.
- Garantir segurança básica de acesso admin e estabilidade operacional.
- Construir cobertura E2E para fluxos críticos reais.

## Próximos passos
- Expandir observabilidade (dashboards e alertas de operação).
- Fortalecer pipeline CI com execução E2E agendada.
- Evoluir cobertura de testes para cenários negativos adicionais.
- Refinar UX em telas com maior densidade operacional.

---
Documentação completa:
- [Visão Geral](docs/visao-geral.md)
- [Arquitetura](docs/arquitetura.md)
- [Regras de Negócio](docs/regras-de-negocio.md)
- [Fluxos do Sistema](docs/fluxos-do-sistema.md)
- [Testes e Qualidade](docs/testes-e-qualidade.md)
- [Deploy e Operação](docs/deploy-e-operacao.md)
- [Aprendizados e Evolução](docs/aprendizados-e-evolucao.md)
