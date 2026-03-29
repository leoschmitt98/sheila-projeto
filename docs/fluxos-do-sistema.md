# Fluxos do Sistema

## 1) Fluxo público de acesso
### Objetivo
Permitir que o cliente acesse a empresa correta e inicie atendimento.

### Atores
- Cliente
- Frontend público
- Backend

### Pré-condições
- Empresa existente com `slug` válido.

### Passos
1. Cliente acessa a página pública.
2. Frontend resolve `slug` por subdomínio ou `?empresa=`.
3. Frontend consulta `/api/empresas/:slug`.
4. Renderiza dados da empresa e opções do chat.

### Resultado esperado
- Chat público pronto para interação no contexto da empresa correta.

---

## 2) Fluxo de agendamento público
### Objetivo
Criar agendamento de forma guiada pelo SheilaChat.

### Atores
- Cliente
- SheilaChat
- API de agenda/agendamentos

### Pré-condições
- Serviços ativos cadastrados para a empresa.

### Passos
1. Cliente seleciona “Agendar serviço”.
2. Escolhe serviço.
3. (Quando aplicável) escolhe profissional.
4. Seleciona data e horário disponível.
5. Informa dados do cliente.
6. Confirma envio.
7. Backend valida e cria agendamento.

### Resultado esperado
- Agendamento persistido com retorno de confirmação no chat.

---

## 3) Fluxo de disponibilidade de horários
### Objetivo
Exibir apenas slots realmente válidos.

### Atores
- SheilaChat/DateTimePicker
- API de disponibilidade

### Pré-condições
- Serviço selecionado.

### Passos
1. Frontend consulta `/agenda/disponibilidade` com data/serviço/profissional.
2. Backend aplica regras (jornada, intervalo, conflitos, bloqueio de dia, passado).
3. Retorna lista de horários disponíveis.

### Resultado esperado
- Cliente visualiza slots consistentes com agenda real.

---

## 4) Fluxo de login admin
### Objetivo
Garantir acesso administrativo apenas com autenticação válida.

### Atores
- Admin
- Tela de login
- API de auth/sessão

### Pré-condições
- Empresa com senha administrativa configurada (ou senha master válida).

### Passos
1. Admin abre `/admin/login?empresa=<slug>`.
2. Informa senha.
3. Frontend chama `/api/admin/login`.
4. Recebe token e salva em sessionStorage por empresa.
5. Rotas protegidas validam sessão via `/api/admin/session` antes de renderizar conteúdo.

### Resultado esperado
- Acesso liberado somente com sessão válida.

---

## 5) Fluxo admin de gestão de agendamentos
### Objetivo
Operar agenda diária com ações rápidas.

### Atores
- Admin
- Módulo de agendamentos
- API de agendamentos

### Pré-condições
- Sessão admin ativa.

### Passos
1. Admin lista agendamentos por filtros.
2. Pode criar agendamento rápido manual.
3. Pode confirmar, cancelar, concluir e excluir (quando permitido).
4. Pode abrir mensagem de WhatsApp com texto pronto.

### Resultado esperado
- Agenda atualizada com status e ações operacionais centralizadas.

---

## 6) Fluxo de solicitação de orçamento via chat
### Objetivo
Captar lead de orçamento no canal público e levar para o painel.

### Atores
- Cliente
- SheilaChat
- API de orçamentos
- Admin

### Pré-condições
- Empresa ativa.

### Passos
1. Cliente escolhe “Solicitar orçamento”.
2. Chat coleta dados obrigatórios em etapas.
3. Frontend envia para `/orcamentos/solicitacoes`.
4. Admin visualiza solicitação em “Solicitações de Orçamento”.

### Resultado esperado
- Solicitação registrada e disponível para tratamento operacional.

---

## 7) Fluxo de ordens de serviço (admin)
### Objetivo
Gerenciar entrada, execução e entrega de serviços técnicos.

### Atores
- Admin
- Módulo de OS
- API de ordens de serviço

### Pré-condições
- Sessão admin ativa.

### Passos
1. Admin cria OS com dados do cliente/aparelho/defeito/orçamento.
2. Lista e filtra OS por status/cliente/período.
3. Atualiza status da OS.
4. Visualiza detalhes e utiliza impressão/compartilhamento.

### Resultado esperado
- Controle completo de ciclo da OS dentro do painel.

---

## 8) Fluxo OS -> receita financeira
### Objetivo
Automatizar lançamento financeiro ao concluir atendimento técnico.

### Atores
- Admin
- API de status OS
- Módulo financeiro

### Pré-condições
- OS com valores válidos.

### Passos
1. Admin altera status da OS para `entregue`.
2. Backend valida pré-condições (ex.: mão de obra > 0).
3. Backend tenta gerar receita vinculada à OS.
4. Se já houver vínculo, evita duplicidade.

### Resultado esperado
- Receita financeira consistente e rastreável à OS.

---

## 9) Fluxo de notificações push (admin)
### Objetivo
Notificar operação sobre novos eventos e lembretes.

### Atores
- Admin
- Configurações de notificações
- Backend + Web Push

### Pré-condições
- Dispositivo registrado com permissão de notificação.

### Passos
1. Admin cadastra dispositivo no painel.
2. Configura preferências de recebimento.
3. Sistema envia push em eventos elegíveis.
4. Job periódico processa lembretes automáticos.

### Resultado esperado
- Notificações entregues para dispositivos ativos elegíveis.

---

## 10) Fluxo de consulta de serviço (cliente)
### Objetivo
Permitir ao cliente consultar andamento da OS sem login.

### Atores
- Cliente
- SheilaChat
- API pública de consulta OS

### Pré-condições
- OS existente para nome + telefone na empresa.

### Passos
1. Cliente escolhe “Consultar meu serviço”.
2. Informa nome.
3. Informa telefone.
4. Frontend consulta endpoint público de status.
5. Chat apresenta resumo amigável.

### Resultado esperado
- Cliente recebe status atual do serviço com linguagem simples.
