# Regras de Negócio (mapeadas no código)

> Este documento descreve comportamentos identificados no repositório.  
> Quando há variações por ambiente, o texto usa “comportamento identificado no código”.

## 1) Empresa e identificação por slug
- Toda operação de domínio usa empresa identificada por `slug`.
- O backend resolve a empresa por `slug` e utiliza `EmpresaId` nas consultas.
- Frontend resolve `slug` por subdomínio ou query param (`?empresa=`).

## 2) Isolamento multiempresa
- Rotas de negócio são estruturadas como `/api/empresas/:slug/...`.
- Consultas incluem filtro por `EmpresaId`.
- Resultado esperado: dados de uma empresa não devem aparecer em outra.

## 3) Autenticação administrativa
- Login admin exige `slug` + `password`.
- Existem dois caminhos de autenticação:
  - senha master (variável de ambiente)
  - senha específica da empresa (`EmpresaAdminAuth`)
- Sessão válida é obrigatória para acesso administrativo no frontend.
- Sessão expira por tempo (`exp`) e é validada no backend.

## 4) Rate limiting
- Limites de requisição configuráveis para:
  - login admin
  - criação de agendamento
  - rotas públicas de alto volume
- Objetivo: reduzir abuso e brute force.

## 5) Regras de serviços
- Serviço precisa existir e estar ativo para agendamento.
- Duração do serviço impacta diretamente a disponibilidade de slots.
- Comportamento identificado: slots seguem passo fixo de agenda e só são exibidos quando cabem integralmente na janela.

## 6) Regras de disponibilidade de agenda
- Entrada válida exige `servicoId`, `data` e, em cenários com equipe, profissional.
- Não retorna horários para data passada.
- Não retorna horários quando dia está bloqueado.
- Horários respeitam:
  - jornada do profissional
  - intervalo de pausa (quando ativo)
  - conflitos com agendamentos já ativos (pending/confirmed)
- Não exibe disponibilidade ilusória: slot precisa caber do início ao fim.

## 7) Regras de agendamento
- Criação exige data/hora válidas e alinhadas ao passo da agenda.
- Cliente (nome/telefone) é obrigatório na criação.
- Status iniciais e transições seguem fluxo operacional no backend.
- Atualização de status reflete no painel e em cálculos agregados.

## 8) Cancelamento e exclusão de agendamento
- Existe fluxo de solicitação de cancelamento no chat (busca e confirmação).
- No admin há ações de cancelar, confirmar e concluir.
- Exclusão de agendamento é restrita:
  - comportamento identificado: só exclui quando status é `cancelled`.

## 9) Horários de funcionamento por profissional
- Configuração por dia da semana, com:
  - ativo/inativo
  - hora início/fim
  - intervalo opcional (início/fim)
- Validações:
  - início < fim
  - intervalo dentro do expediente
  - intervalo com ordem válida

## 10) Fluxos de chat público
- Opções iniciais configuráveis por empresa.
- Fluxos implementados incluem:
  - agendar serviço
  - solicitar orçamento
  - consultar serviço (OS)
  - consultar registros recentes
  - cancelar agendamento (solicitação)
  - contato com atendente
- Campos obrigatórios são validados em etapas do chat.

## 11) Solicitações de orçamento
- Solicitação pública registra lead no backend por empresa.
- Campos mínimos (nome, telefone, modelo, defeito) com validação.
- Status inicial identificado: `novo`.
- Painel admin lista, filtra e permite contato via WhatsApp.

## 12) Ordens de serviço (OS)
- Módulo separado de agendamentos.
- Campos operacionais de cliente/aparelho/defeito/orçamento/status.
- Cálculo financeiro na OS:
  - valor total é tratado como soma de mão de obra + material (comportamento observado no frontend e scripts de recálculo).
- Status com fluxo operacional (aberta -> ... -> entregue/cancelada/recusada).

## 13) Integração OS -> financeiro
- Quando OS vai para `entregue`, backend tenta gerar receita vinculada.
- Regra anti-duplicidade:
  - se já existe vínculo, não gera novo lançamento automático.
- Regra de validação:
  - exige `valorMaoObra > 0` para finalizar e lançar receita.

## 14) Regras de finanças e despesas
- Há configuração de percentuais por empresa.
- Existe módulo de despesas com CRUD por período.
- Endpoint de insights consolida indicadores de agenda e financeiro.

## 15) Notificações e push
- Dispositivo admin pode ser cadastrado/desativado.
- Preferências por tipo (agendamento/lembrete) e por profissional (quando aplicável).
- Push de lembrete roda em job periódico com janela de envio.
- Registro de envios evita repetição indevida do lembrete.

## 16) Segurança e resiliência operacional
- CORS com validação de origem.
- Headers de segurança básicos.
- Healthcheck da aplicação e do banco.
- Logs por módulo com sanitização de campos sensíveis.
