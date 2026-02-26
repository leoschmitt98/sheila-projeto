# Migração SQL Server -> PostgreSQL

Este documento descreve o plano para migrar o backend atual (Node + `mssql`) para PostgreSQL.

## 1) Criar estrutura no PostgreSQL

Execute:

```bash
psql "$DATABASE_URL" -f backend/migrations/postgres/001_init.sql
```

## 2) Mapeamento de tipos (T-SQL -> PostgreSQL)

- `INT` -> `INT`
- `BIT` -> `BOOLEAN`
- `DECIMAL(10,2)` -> `NUMERIC(10,2)`
- `NVARCHAR/VARCHAR` -> `VARCHAR`/`TEXT`
- `DATETIME2` -> `TIMESTAMP`
- `DATE` -> `DATE`
- `TIME(0)` -> `TIME`

## 3) Reescritas de query necessárias no backend

No arquivo `backend/server.js`, substituir padrões de T-SQL por equivalentes PostgreSQL:

- `SELECT TOP 1 ...` -> `SELECT ... LIMIT 1`
- `SCOPE_IDENTITY()` -> `RETURNING "Id"`
- `@@ROWCOUNT` -> `result.rowCount`
- `ISNULL(x, y)` -> `COALESCE(x, y)`
- `DATEPART(HOUR|MINUTE, col)` -> `EXTRACT(HOUR|MINUTE FROM col)`
- `CONVERT(varchar(10), data, 23)` -> `TO_CHAR(data, 'YYYY-MM-DD')`
- Locks: `WITH (UPDLOCK, HOLDLOCK)` -> `SELECT ... FOR UPDATE`

## 4) Variáveis de ambiente recomendadas

```env
DB_CLIENT=postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5432/sheila
DB_SSL=false
```

## 5) Estratégia segura de corte

1. Subir PostgreSQL com schema novo.
2. Criar camada de acesso a dados (`db/query`) para permitir alternar client.
3. Migrar endpoints por domínio (Empresas -> Serviços -> Agendamentos).
4. Rodar testes E2E/Cypress e smoke API.
5. Fazer cutover e congelar escrita no SQL Server durante janela final.

## 6) Observação

Este commit prepara o projeto com schema e plano de migração. A troca efetiva do driver (`mssql` -> `pg`) deve ser feita em etapas para evitar regressão em produção.
