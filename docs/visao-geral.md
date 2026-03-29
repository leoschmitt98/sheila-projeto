# Visão Geral do Sheila System

## Visão de produto
O Sheila System é uma aplicação SaaS multiempresa para gestão de atendimento, com dois contextos principais:
- **experiência do cliente final** (interface pública com chat)
- **experiência da empresa/admin** (painel de operação e gestão)

O objetivo é centralizar o ciclo operacional: captação, agendamento, acompanhamento, execução do serviço e visão administrativa.

## Proposta de valor
- Organizar a agenda com regras reais de disponibilidade.
- Reduzir atrito no contato com cliente (chat, WhatsApp, notificações).
- Dar previsibilidade operacional com status, painéis e histórico.
- Integrar operação e financeiro em um único fluxo (incluindo OS).

## Contexto de uso
O sistema atende negócios com agenda e atendimento recorrente:
- atendimento por hora/serviço
- confirmação e acompanhamento de status
- necessidade de gestão por profissionais
- operação diária com foco em rapidez no balcão/admin

## Módulos identificados
- **Atendimento público**
  - SheilaChat
  - catálogo de serviços
  - disponibilidade por data/hora
  - criação de agendamento
  - solicitação de orçamento
  - consulta de serviço (OS)
  - consulta de registros recentes
  - fluxo de cancelamento (solicitação)
- **Admin**
  - autenticação por empresa
  - dashboard
  - agendamentos
  - serviços
  - profissionais
  - horários
  - finanças e despesas
  - relatórios
  - ordens de serviço
  - solicitações de orçamento
  - configurações e notificações
- **Infra/qualidade**
  - logs por módulo
  - healthchecks
  - job de lembrete push
  - suíte E2E com Cypress

## Cliente x Admin
### Cliente (público)
- Jornada guiada por opções no chat.
- Fluxos simplificados para agendar, consultar e solicitar.
- Sem necessidade de login.

### Admin (empresa)
- Jornada autenticada com sessão validada.
- Ferramentas de operação diária (status, agenda, OS, finanças).
- Ações rápidas (ex.: WhatsApp, atualização de status, confirmação/cancelamento).

## Resumo de funcionamento
1. O tenant (empresa) é resolvido por `slug` (subdomínio ou query param).
2. O cliente interage no chat público e dispara ações via API da empresa.
3. O admin acessa painel protegido para operar agenda e módulos internos.
4. O backend aplica regras de negócio (disponibilidade, status, validações, isolamento por empresa).
5. Eventos e erros relevantes são registrados em logs locais por módulo.
