# Arquitetura do Sistema

## Visão arquitetural
Arquitetura web full-stack com frontend SPA + API backend + SQL Server, organizada para operação multiempresa.

```text
Cliente/Admin (Browser)
        |
        v
Frontend React (Vite)
        |
        v
Backend Express (Node.js)
        |
        v
SQL Server
```

## Frontend
- Stack: React + TypeScript + Vite.
- Roteamento: `react-router-dom`.
- Estado de dados: `@tanstack/react-query`.
- UI: Tailwind + componentes Radix.
- PWA: `vite-plugin-pwa` com service worker.
- Integração HTTP: wrapper em `src/lib/api.ts`.

### Organização relevante
- `src/pages/Index.tsx`: entrada pública.
- `src/components/chat/SheilaChat.tsx`: fluxos do assistente.
- `src/components/admin/*`: layout, autenticação e navegação admin.
- `src/pages/admin/*`: módulos administrativos.
- `src/lib/getEmpresaSlug.ts`: resolução de tenant por subdomínio/query.

## Backend
- Stack: Node.js + Express 5 + `mssql`.
- Arquivo principal: `backend/server.js`.
- Modelo de API REST por empresa: `/api/empresas/:slug/...`.
- Healthchecks: `/health` e `/health/db`.
- Segurança operacional:
  - CORS com allowlist
  - rate limiter in-memory para rotas críticas
  - headers de segurança
  - autenticação admin via token assinado HMAC

### Módulos observados no backend
- empresas/configurações
- autenticação admin e sessão
- serviços
- profissionais, horários e vínculo profissional-serviço
- agenda/disponibilidade
- agendamentos (criação, status, consulta, exclusão, cancelamento)
- insights e finanças
- despesas
- ordens de serviço
- solicitações de orçamento
- notificações admin e dispositivos push
- job de lembretes push

## Banco de dados
- SGBD: SQL Server.
- Estratégia de evolução: scripts SQL versionados em `backend/sql/*.sql`.
- Estruturas de domínio identificadas:
  - empresas e auth admin por empresa
  - agendamentos/atendimentos
  - profissionais, serviços e horários
  - notificações e dispositivos push
  - financeiro diário e despesas
  - ordens de serviço
  - solicitações de orçamento

## Multiempresa (multi-tenant)
- Identificação de empresa por `slug`.
- No frontend:
  - usa subdomínio quando disponível (`<slug>.sheilasystem.com.br`)
  - fallback local por query (`?empresa=<slug>`)
- No backend:
  - quase todas as rotas de domínio usam `:slug` e resolvem `EmpresaId` internamente.
- Objetivo: isolamento de dados por empresa no fluxo da aplicação.

## Autenticação admin
- Login em `/api/admin/login` com `slug + senha`.
- Sessão baseada em token assinado (não JWT pronto de biblioteca; assinatura HMAC no backend).
- Validação de sessão em `/api/admin/session`.
- Frontend bloqueia rotas `/admin/*` com `AdminRequireAuth`.

## Notificações e push
- Web Push configurável via variáveis de ambiente.
- Registro de dispositivos no painel.
- Envio de push para novo agendamento e lembrete.
- Job automático de lembretes com métricas expostas no `/health`.

## Logs e observabilidade
- Logger local por módulo (`backend/lib/logger.js`).
- Pastas por domínio em `backend/logs/<modulo>/`.
- Níveis `info`, `warn`, `error`.
- Retenção automática de logs antigos (configurável por env).

## Ambientes
### Local
- Frontend Vite (porta 8080 no config).
- Backend Express (porta 3001 por padrão).
- Tenant por query param.

### Homologação/Produção
Comportamento identificado no código:
- suporte explícito a subdomínios `*.sheilasystem.com.br` no CORS.
- healthchecks para monitoramento.
- documentação operacional adicional em `docs/OPERACAO_PRODUCAO.md`.

## Diagramas textuais
```text
Fluxo público:
Cliente -> SheilaChat -> API /api/empresas/:slug/* -> SQL Server
```

```text
Fluxo admin:
Admin -> Login (/api/admin/login) -> Token sessão ->
Painel /admin/* -> API autenticada + API por slug -> SQL Server
```

```text
Push:
Evento de agendamento/job lembrete -> Backend -> Web Push ->
Dispositivo registrado do admin
```
