# QA Exploratorio E2E - Sheila System

## 1. Fluxos identificados

### Fluxos publicos
- Resolucao da empresa por `slug` na URL (`subdominio` ou `?empresa=`).
- Atendimento inicial pelo `SheilaChat`.
- Agendamento guiado: servico -> profissional (quando aplicavel) -> data/hora -> dados do cliente -> confirmacao.
- Consulta de horarios disponiveis sem concluir agendamento.
- Solicitacao de orcamento com captura de lead.
- Consulta de ordem de servico por nome + telefone.
- Consulta de registros recentes por nome + telefone.
- Solicitacao de cancelamento de agendamento com lookup e redirecionamento para WhatsApp.
- Contato direto com atendente/profissional via WhatsApp.

### Fluxos admin
- Login administrativo por empresa (`slug` + senha).
- Protecao de rotas e logout.
- Operacao de agenda: filtro, destaque por ID, confirmacao, cancelamento, conclusao e exclusao restrita.
- Agendamento rapido manual pelo painel.
- Gestao de ordens de servico: criacao, edicao, consulta de detalhes e alteracao de status.
- Integracao OS -> financeiro ao entregar ordem de servico.
- Gestao de solicitacoes de orcamento captadas no chat.
- Planejamento financeiro por percentuais.
- CRUD de despesas.

## 2. Riscos encontrados

### Criticidade alta
- Multi-tenant por `slug`: qualquer falha de isolamento exporia dados de outra empresa.
- Login admin depende de `slug` + sessao por empresa; risco de sessao cruzada ou cache incorreto.
- Disponibilidade de agenda depende de varias regras juntas: jornada, pausa, conflito, passado e encaixe integral do slot.
- Cancelamento publico nao cancela diretamente; ele gera mensagem para WhatsApp. Se o lookup falhar ou o numero estiver errado, o cliente fica sem conclusao.
- Entrega de OS gera receita automatica; regressao aqui pode duplicar lancamento ou deixar o financeiro inconsistente.

### Criticidade media
- Agendamento rapido admin usa muitos campos sem `data-cy`; risco maior de fragilidade em testes e regressao visual/funcional.
- Validacoes de formulario admin estao concentradas em `alert`/`toast`; mudancas de texto podem mascarar quebra de regra.
- Fluxos publicos sem login dependem fortemente de nome + telefone; pequenas divergencias de formato podem gerar falso negativo para o cliente.
- Configuracao financeira exige soma exata de 100%; erro nessa validacao impacta todos os indicadores do modulo.
- CRUD de despesas influencia os cards e graficos; risco de UI atualizar lista mas nao invalidar resumo.

### Criticidade baixa / observacoes
- Notificacoes push existem no dominio, mas nao ha cobertura E2E evidente no repositorio atual.
- Parte da cobertura atual usa API para preparar massa de dados; isso acelera o E2E, mas pode deixar lacunas de UX em alguns formularios.

## 3. Cenarios Gherkin

### Fluxo: Login admin

#### Cenario: Login valido da empresa correta
Dado que eu acesso `/admin/login?empresa=nando`
Quando eu informo a senha administrativa valida
Entao devo ser redirecionado para `/admin?empresa=nando`
E devo visualizar a navegacao administrativa da empresa

#### Cenario: Login invalido permanece bloqueado
Dado que eu acesso `/admin/login?empresa=nando`
Quando eu informo a senha `senha-invalida`
Entao devo continuar na tela de login
E devo visualizar mensagem de erro sobre senha incorreta

#### Cenario: Acesso direto ao admin sem sessao
Dado que nao existe token de sessao para a empresa `nando`
Quando eu acesso `/admin/agendamentos?empresa=nando`
Entao devo ser redirecionado para `/admin/login?empresa=nando`

### Fluxo: Agendamento publico

#### Cenario: Cliente agenda servico com horario real disponivel
Dado que a empresa `nando` possui servicos ativos e profissionais ativos
E que existe slot disponivel para o servico `X` no dia `YYYY-MM-DD` as `HH:mm`
Quando o cliente seleciona `Agendar servico`
E escolhe o servico `X`
E escolhe o profissional aplicavel
E informa nome `Maria Souza` e telefone `51999998888`
Entao o sistema deve criar o agendamento
E o admin deve conseguir localizar esse agendamento no painel

#### Cenario: Cliente tenta agendar em horario invalido
Dado que o horario escolhido nao esta disponivel para o servico e profissional
Quando a requisicao de criacao de agendamento for enviada
Entao o backend deve rejeitar a criacao
E o horario nao deve aparecer como disponivel em nova consulta

### Fluxo: Cancelamento publico

#### Cenario: Cliente localiza agendamento e gera pedido de cancelamento
Dado que existe um agendamento pendente da cliente `Cliente QA Cancelamento`
E o telefone cadastrado e `51999990001`
Quando a cliente acessa o chat publico da empresa `nando`
E escolhe `Cancelar agendamento`
E informa a data correta do agendamento
E informa o nome e telefone usados no cadastro
Entao o sistema deve listar o agendamento correspondente
Quando a cliente seleciona o agendamento localizado
Entao o sistema deve exibir a etapa final de solicitacao de cancelamento
E deve gerar um link de WhatsApp contendo o `AgendamentoId`

#### Cenario: Cliente informa dados que nao correspondem a um agendamento
Dado que nao existe agendamento pendente ou confirmado para `Cliente Inexistente`
Quando a cliente informa data, nome e telefone sem correspondencia
Entao o sistema deve informar que nao encontrou agendamento com esses dados
E deve retornar ao menu principal do chat

### Fluxo: Consulta de ordem de servico pelo cliente

#### Cenario: Cliente consulta uma OS existente
Dado que existe uma OS `OS-1234` para `Cliente E2E Status`
Quando o cliente escolhe `Consultar meu servico`
E informa nome e telefone corretos
Entao o chat deve exibir o numero da OS
E deve exibir modelo e status amigavel

#### Cenario: Cliente consulta OS com telefone incorreto
Dado que existe uma OS para `Cliente E2E Status`
Quando o cliente informa um telefone diferente do cadastrado
Entao o sistema deve informar que nao localizou servico com esses dados
E deve retornar ao menu principal

### Fluxo: Solicitacao de orcamento

#### Cenario: Lead de orcamento captado e visivel no admin
Dado que o cliente informa:
E nome `Joao Teste`
E telefone `51999997777`
E tipo `celular`
E modelo `Modelo-AB12CD`
E defeito `Tela sem imagem`
Quando ele envia a solicitacao pelo chat
Entao a API deve responder com sucesso
E o admin deve localizar o lead em `Solicitacoes de orcamento`

#### Cenario: Campos obrigatorios bloqueiam avanco no chat
Dado que o cliente iniciou o fluxo de orcamento
Quando tenta continuar sem preencher nome ou telefone
Entao o sistema nao deve avancar para a proxima etapa

### Fluxo: Agenda admin

#### Cenario: Admin cria agendamento rapido valido
Dado que estou autenticado no painel da empresa `nando`
Quando eu preencho data, horario, cliente, telefone e servico validos
Entao o sistema deve criar o agendamento rapido com sucesso
E a lista deve destacar o novo agendamento quando houver ID retornado

#### Cenario: Admin tenta criar agendamento rapido sem data
Dado que estou no modulo `Agendamentos`
Quando clico em `Criar agendamento rapido` sem preencher a data
Entao devo ver o alerta `Selecione a data.`

#### Cenario: Exclusao de agendamento nao cancelado
Dado que existe um agendamento com status `confirmed`
Quando o admin tenta excluir esse agendamento
Entao a exclusao deve estar bloqueada
E o sistema deve permitir exclusao apenas para status `cancelled`

### Fluxo: Ordem de servico

#### Cenario: Admin cria e edita uma OS
Dado que estou autenticado no painel
Quando crio uma OS para `Cliente QA OS` com mao de obra `150` e material `40`
Entao devo ver a nova OS na listagem
Quando edito o defeito relatado
Entao o detalhe da OS deve exibir o defeito atualizado

#### Cenario: Entrega de OS gera receita uma unica vez
Dado que existe uma OS com `valorMaoObra > 0`
Quando altero o status para `Entregue`
Entao o backend deve marcar `ReceitaGerada = true`
E deve criar um `FinanceiroReceitaId`
Quando altero novamente para `Entregue`
Entao o sistema nao deve gerar receita duplicada

#### Cenario: OS entregue sem mao de obra valida
Dado que existe uma OS com `valorMaoObra = 0`
Quando tento marcar como `Entregue`
Entao o backend deve bloquear a conclusao financeira
E nenhuma nova receita deve ser criada

### Fluxo: Financeiro

#### Cenario: Configuracao financeira aceita soma exata de 100
Dado que estou no modulo `Financas`
Quando preencho `Retirada do dono = 50`, `Caixa = 30` e `Orcamento para despesas = 20`
E clico em `Salvar configuracao`
Entao devo ver a confirmacao `Configuracao financeira salva com sucesso.`

#### Cenario: Configuracao financeira rejeita soma diferente de 100
Dado que estou no modulo `Financas`
Quando preencho `Retirada do dono = 60`, `Caixa = 30` e `Orcamento para despesas = 20`
E clico em `Salvar configuracao`
Entao devo ver a mensagem `A soma dos percentuais precisa ser exatamente 100%.`

#### Cenario: Cadastro de despesa com sucesso
Dado que estou no modulo `Financas`
Quando clico em `Adicionar despesa`
E informo descricao `Internet QA 2026-03`
E categoria `internet`
E valor `129.90`
E data valida
Entao devo ver a mensagem `Despesa cadastrada.`
E devo ver a despesa na lista do periodo

#### Cenario: Cadastro de despesa sem descricao
Dado que o formulario de despesa esta aberto
Quando clico em `Cadastrar despesa` sem preencher descricao
Entao devo ver a mensagem `Informe a descricao da despesa.`

## 4. Testes Cypress recomendados

### Suite ja existente no repositorio
- `frontend/cypress/e2e/auth.cy.ts`
- `frontend/cypress/e2e/agendamento.cy.ts`
- `frontend/cypress/e2e/orcamentos.cy.ts`
- `frontend/cypress/e2e/ordens-servico.cy.ts`
- `frontend/cypress/e2e/financeiro.cy.ts`
- `frontend/cypress/e2e/sheilachat.cy.ts`

### Suite complementar adicionada nesta analise
- `frontend/cypress/e2e/cancelamento-publico.cy.ts`
- `frontend/cypress/e2e/financeiro-validacoes.cy.ts`

## 5. Cobertura x lacunas

### Bem coberto
- Login admin.
- Captura de orcamento.
- Consulta de OS.
- Criacao e ciclo principal de OS.
- Integracao OS -> financeiro.

### Ainda vale evoluir
- Notificacoes push e preferencias por profissional.
- Fluxo visual completo de agendamento publico sem usar API para setup.
- Regra de isolamento multi-tenant com duas empresas no mesmo run E2E.
- Casos negativos de agenda: conflito, fora da jornada, pausa e data passada.
