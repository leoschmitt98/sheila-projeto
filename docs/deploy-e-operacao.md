# Deploy e Operação

## Execução local
### Backend
```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Build
### Frontend
```bash
cd frontend
npm run build
```

### Backend
Comportamento identificado: API Node sem etapa de build/transpilação (execução direta de `server.js`).

## Variáveis de ambiente (visão geral)
No backend, variáveis suportam:
- conexão SQL Server
- autenticação admin
- segurança operacional (proxy/https)
- web push e job de lembretes
- rate limits

No frontend:
- base da API por `VITE_API_BASE`
- variáveis de teste para Cypress (ambiente de E2E)

> Nunca versionar segredos reais em `.env`.

## Healthcheck e monitoramento
Endpoints:
- `GET /health`
- `GET /health/db`

Sinais importantes de operação:
- disponibilidade da API
- conectividade com banco
- status do job de lembrete push
- métricas básicas de execução do job no payload de health

## Logs locais por módulo
Implementação em `backend/lib/logger.js`.

Estrutura:
```text
backend/logs/<modulo>/(info|warn|error)-YYYY-MM-DD.log
```

Módulos identificados:
- app
- auth
- chat
- agendamentos
- financeiro
- ordens-servico
- orcamentos
- jobs

Características:
- sanitização de chaves sensíveis
- criação automática de pastas
- falha de gravação não derruba aplicação
- retenção automática configurável

## Produção/homologação (comportamento identificável)
- CORS contempla domínios locais e subdomínios `*.sheilasystem.com.br`.
- Projeto preparado para execução persistente em gerenciador de processo (ex.: PM2/systemd).
- Documento complementar já existente: `docs/OPERACAO_PRODUCAO.md`.

## Checklist operacional recomendado
1. Validar variáveis de ambiente da instância.
2. Validar conectividade com SQL Server.
3. Rodar scripts SQL pendentes (idempotentes).
4. Build do frontend.
5. Restart do backend.
6. Verificar `/health` e `/health/db`.
7. Rodar smoke E2E dos fluxos críticos.

## Cuidados de operação
- Separar banco e configuração por ambiente.
- Evitar reutilizar credenciais entre homologação e produção.
- Monitorar crescimento de logs e métricas de erro.
- Manter rotina de backup do banco e teste de restore.
