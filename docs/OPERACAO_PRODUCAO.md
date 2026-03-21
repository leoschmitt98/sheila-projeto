# Sheila System - Operação de Produção

## 1) Pré-requisitos
- Node.js 20+
- SQL Server acessível pela VPS
- Nginx (ou proxy reverso equivalente)
- PM2 **ou** systemd para manter backend em execução

## 2) Variáveis obrigatórias
Copie `backend/.env.example` para `backend/.env` e preencha:
- `DB_SERVER`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`
- `ADMIN_MASTER_PASSWORD`
- `ADMIN_AUTH_SECRET` (recomendado)
- `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` (se usar push)

## 3) Migrações SQL (ordem)
Executar no banco alvo (`USE sheila;`):
- `backend/sql/011_empresa_notificacoes.sql`
- `backend/sql/012_empresa_notificacao_dispositivos.sql`
- `backend/sql/014_empresa_notificacao_dispositivos_push_preferences.sql`
- `backend/sql/015_empresa_financeiro_configuracao.sql`
- `backend/sql/016_empresa_despesas.sql`
- `backend/sql/017_profissionais_horarios_intervalo.sql`
- `backend/sql/018_empresa_push_lembretes_enviados.sql`

> Scripts são idempotentes; ainda assim, rode primeiro em homologação.

## 4) Build e execução
### Backend
```bash
cd backend
npm ci
node --check server.js
```

### Frontend
```bash
cd frontend
npm ci
npm run build
```

## 5) Execução com PM2 (recomendado)
```bash
cd backend
pm2 start server.js --name sheila-backend
pm2 save
pm2 startup
```

Comandos úteis:
```bash
pm2 status
pm2 logs sheila-backend
pm2 restart sheila-backend
pm2 stop sheila-backend
```

## 6) Execução com systemd (alternativa)
Exemplo de unit:
```ini
[Unit]
Description=Sheila Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/sheila/backend
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Comandos:
```bash
sudo systemctl daemon-reload
sudo systemctl enable sheila-backend
sudo systemctl start sheila-backend
sudo systemctl status sheila-backend
journalctl -u sheila-backend -f
```

## 7) Healthchecks
- App: `GET /health`
- Banco: `GET /health/db`

Exemplo:
```bash
curl -f https://api.seu-dominio.com/health
curl -f https://api.seu-dominio.com/health/db
```

## 8) Logs e observabilidade mínima
- Monitorar erros HTTP 5xx
- Monitorar `/health/db`
- Monitorar no `/health`:
  - `pushReminder.metrics.lastRunAt`
  - `pushReminder.metrics.lastErrorMessage`

## 9) Deploy/redeploy seguro
1. Fazer backup do banco.
2. Atualizar código na VPS.
3. Executar migrações pendentes.
4. Build frontend.
5. Restart backend.
6. Validar `/health` e `/health/db`.
7. Testar fluxo crítico (login, agendamento, confirmação, dashboard, push).

## 10) Rollback
1. Voltar para release anterior (git tag/artefato).
2. Reiniciar serviço backend.
3. Revalidar `/health` e login admin.
4. Se necessário, restaurar backup de banco.

## 11) Backup e restore
### Backup diário (recomendado)
- Backup full diário
- Backup diferencial (se política exigir)
- Testar restore ao menos 1x por mês

Tabelas críticas:
- `Empresas`
- `Agendamentos`
- `Atendimentos`
- `EmpresaNotificacoes`
- `EmpresaNotificacaoDispositivos`
- `EmpresaPushLembretesEnviados`
- `FinanceiroDiario`
- `EmpresaDespesas`
