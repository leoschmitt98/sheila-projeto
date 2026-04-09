# 🚀 Sheila System

Sistema SaaS multiempresa para agendamentos, atendimento automatizado e gestão administrativa.

> 💡 Este projeto representa um sistema real em produção, com arquitetura multiempresa, regras de negócio complexas e automação de processos operacionais.

---

## 🌐 Demonstração do Sistema

👉 https://landingpage.sheilasystem.com.br/

A landing page apresenta o Sheila System em funcionamento, incluindo:

* fluxo completo de agendamento via chat (SheilaChat)
* painel administrativo real
* gestão de ordens de serviço
* controle financeiro integrado
* visão geral do produto em uso

---

## 📌 Resumo do projeto

O Sheila System resolve um problema comum de operação em pequenos negócios de serviços: agenda descentralizada, falta de confirmação de horários, dificuldade de acompanhamento diário e baixa rastreabilidade financeira/operacional.

Este repositório demonstra um sistema real com:

* fluxo público de agendamento orientado por chat (SheilaChat)
* painel admin com autenticação por empresa
* isolamento multiempresa por `slug` (query param ou subdomínio)
* notificações e push web
* módulo de ordens de serviço
* integração de ordens de serviço com financeiro
* suíte de testes E2E com Cypress para validar os principais fluxos

---

## 🏗️ Arquitetura em alto nível

* **Frontend:** React + TypeScript + Vite
* **Backend:** Node.js + Express
* **Banco de Dados:** SQL Server
* **Testes:** Cypress (E2E) + Vitest
* **Infraestrutura:** VPS + Nginx + PM2

---

## 🎯 Problema que o projeto resolve

* Reduz retrabalho no agendamento manual (telefone/WhatsApp sem histórico).
* Estrutura confirmação/cancelamento com regras de negócio reais.
* Organiza operação por empresa, profissional, serviço e status.
* Dá visibilidade operacional e financeira em um único painel.

---

## 👥 Público-alvo

* Negócios de atendimento com agenda (salões, barbearias, estética, assistência técnica e serviços similares).
* Donos/gestores que precisam de controle diário da operação.

---

## ⚙️ Funcionalidades principais

### 👤 Cliente

* Agendamento automático via chat
* Consulta de disponibilidade com regras reais
* Cancelamento inteligente
* Solicitação de orçamento
* Consulta de status de ordem de serviço

### 🧑‍💼 Admin

* Login por empresa (multi-tenant)
* Dashboard operacional
* Gestão de agendamentos
* Cadastro de serviços e profissionais
* Configuração de horários e intervalos
* Controle financeiro e despesas
* Relatórios operacionais
* Gestão de ordens de serviço (com impressão e WhatsApp)
* Gestão de solicitações de orçamento
* Notificações em tempo real

---

## 🧠 Destaques técnicos

* **Multiempresa por slug/subdomínio**
* **Autenticação administrativa por empresa**
* **Rate limiting em rotas críticas**
* **Regras de agenda não triviais**
* **Push notifications com job automático**
* **Healthchecks (`/health` e `/health/db`)**
* **Logs estruturados por módulo**
* **Retenção automática de logs**
* **Testes E2E com Cypress para fluxos críticos**

---

## 📂 Estrutura do projeto

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

---

## 🚀 Como rodar localmente

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

---

## 🧪 Testes automatizados

### E2E (Cypress)

```bash
cd frontend
npm run test:e2e
```

### Modo interativo

```bash
cd frontend
npm run test:e2e:open
```

Os testes utilizam variáveis de ambiente específicas de E2E, evitando hardcode de credenciais no código.

---

## 🌍 Ambientes

* Suporte a multiempresa por subdomínio (`<slug>.sheilasystem.com.br`)
* Fallback por query param (`?empresa=slug`) em ambiente local
* Documentação operacional disponível em:
  👉 [docs/deploy-e-operacao.md](docs/deploy-e-operacao.md)

---

## 🖼️ Screenshots

As imagens do sistema podem ser organizadas em `docs/images/`, incluindo:

* chat público (agendamento)
* dashboard admin
* agendamentos
* ordens de serviço
* finanças

---

## 📚 Aprendizados e desafios

* Implementação consistente de multi-tenant (frontend + backend)
* Tratamento de datas e horários com timezone
* Evolução de regras de negócio em produção
* Segurança básica de acesso administrativo
* Construção de testes E2E para fluxos reais

---

## 🚧 Próximos passos

* Expandir observabilidade (logs, métricas e alertas)
* Pipeline CI com execução automática de testes
* Cobertura de cenários negativos adicionais
* Melhorias de UX em telas operacionais

---

## 📖 Documentação completa

* [Visão Geral](docs/visao-geral.md)
* [Arquitetura](docs/arquitetura.md)
* [Regras de Negócio](docs/regras-de-negocio.md)
* [Fluxos do Sistema](docs/fluxos-do-sistema.md)
* [Testes e Qualidade](docs/testes-e-qualidade.md)
* [Deploy e Operação](docs/deploy-e-operacao.md)
* [Aprendizados e Evolução](docs/aprendizados-e-evolucao.md)
