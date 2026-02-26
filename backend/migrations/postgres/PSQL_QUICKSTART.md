# PostgreSQL quickstart (manipular banco)

## 1) Subir PostgreSQL (Docker)

```bash
docker run --name sheila-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=sheila \
  -p 5432:5432 \
  -d postgres:16
```

## 2) Configurar conexão

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/sheila"
```

## 3) Aplicar schema e seed

```bash
psql "$DATABASE_URL" -f backend/migrations/postgres/001_init.sql
psql "$DATABASE_URL" -f backend/migrations/postgres/002_seed_example.sql
```

## 4) Entrar no terminal SQL

```bash
psql "$DATABASE_URL"
```

Comandos úteis dentro do `psql`:

```sql
\dt
\d "Empresas"
SELECT * FROM "Empresas";
SELECT * FROM "EmpresaServicos";
```

## 5) CRUD básico (manual)

```sql
-- CREATE
INSERT INTO "Empresas" ("Nome", "Slug", "MensagemBoasVindas")
VALUES ('Nova Empresa', 'nova-empresa', 'Olá!');

-- READ
SELECT "Id", "Nome", "Slug" FROM "Empresas" WHERE "Slug" = 'nova-empresa';

-- UPDATE
UPDATE "Empresas"
SET "Nome" = 'Nova Empresa Atualizada'
WHERE "Slug" = 'nova-empresa';

-- DELETE
DELETE FROM "Empresas"
WHERE "Slug" = 'nova-empresa';
```

## 6) Limpar e recriar tudo

```bash
psql "$DATABASE_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
psql "$DATABASE_URL" -f backend/migrations/postgres/001_init.sql
```
