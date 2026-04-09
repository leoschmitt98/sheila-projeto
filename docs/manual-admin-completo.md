# Manual de Uso do Painel Admin

Este documento foi preparado para apresentar o Sheila System de forma clara e profissional, com foco no uso do painel administrativo no dia a dia.

O objetivo deste material e ajudar uma pessoa a:

- entender para que serve o sistema
- localizar cada area do painel
- saber onde encontrar as configuracoes mais importantes
- aprender o fluxo basico de operacao sem precisar de conhecimento tecnico

## 1. Apresentacao do Sistema

O Sheila System e uma plataforma de atendimento e gestao para empresas que trabalham com agendamentos, servicos, atendimento ao cliente e controle operacional.

O sistema foi organizado em dois ambientes:

- area publica, usada pelo cliente final
- area administrativa, usada pela empresa

Na area administrativa, a empresa pode controlar agenda, servicos, horarios, equipe, financeiro, ordens de servico, solicitacoes de orcamento e notificacoes.

## 2. Como Entrar no Painel

O acesso ao painel administrativo e feito pela tela de login da empresa.

Exemplo:

```text
/admin/login?empresa=studioic
```

Para entrar, a pessoa precisa informar:

- a empresa correta
- a senha administrativa

Depois do login, o painel abre com o menu lateral, que da acesso a todas as areas de operacao.

## 3. Visao Geral do Menu Lateral

O menu lateral do painel possui as seguintes secoes:

1. Dashboard
2. Agenda
3. Agendamentos
4. Ordens de Servico
5. Solicitacoes de Orcamento
6. Servicos
7. Horarios
8. Relatorios
9. Configuracoes
10. Financas
11. Secretaria

Cada uma dessas telas tem uma funcao especifica dentro da rotina da empresa.

## 4. Fluxo Recomendado de Uso no Dia a Dia

Uma forma simples de operar o sistema e seguir esta ordem:

1. Abrir o `Dashboard` no inicio do dia.
2. Entrar em `Agenda` para consultar o dia, visualizar brechas e verificar horarios livres.
3. Entrar em `Agendamentos` para confirmar, cancelar ou concluir atendimentos.
4. Usar `Servicos` e `Horarios` quando precisar ajustar a agenda.
5. Entrar em `Configuracoes` quando for atualizar dados da empresa, equipe ou notificacoes.
6. Usar `Ordens de Servico` para atendimentos tecnicos.
7. Consultar `Financas` e `Relatorios` para acompanhar os resultados.
8. Usar a `Secretaria` para perguntas rapidas sobre agenda e faturamento.

## 5. Manual das Telas do Painel

### 5.1 Dashboard

Finalidade:

- mostrar um resumo rapido da operacao
- dar visibilidade da agenda do dia
- ajudar a equipe a acompanhar o movimento

O que a pessoa encontra nessa tela:

- total de agendamentos do dia
- quantidade de pendentes
- total de clientes atendidos
- atendimentos concluidos
- lista de agendamentos do dia ou da semana
- proximos agendamentos

O que pode ser feito:

- ver agenda de hoje
- ver agenda de amanha
- ver agenda da semana
- escolher uma data especifica
- confirmar agendamento
- cancelar agendamento

Quando usar:

- no inicio do expediente
- ao longo do dia para acompanhamento rapido
- para consultar os proximos atendimentos

### 5.2 Agendamentos

Finalidade:

- controlar a agenda da empresa
- atualizar o status dos atendimentos
- criar agendamentos manuais

O que a pessoa encontra nessa tela:

- lista de agendamentos
- filtro por status
- filtro por profissional
- formulario de agendamento rapido
- mensagens prontas para contato por WhatsApp

Filtros da tela:

- todos
- pendentes
- confirmados
- concluidos
- cancelados
- profissional especifico

Acoes disponiveis:

- confirmar agendamento
- cancelar agendamento
- finalizar atendimento
- excluir agendamento cancelado
- abrir mensagem de lembrete para o cliente

Onde criar um novo atendimento manual:

- na propria tela `Agendamentos`
- na area de `agendamento rapido`

Essa funcao e util quando:

- o horario foi combinado fora do chat
- a recepcao precisa registrar um novo atendimento
- a empresa quer incluir um encaixe manualmente

### 5.3 Agenda

Finalidade:

- visualizar os agendamentos do dia em formato de quadro
- identificar brechas entre os horarios ocupados
- consultar rapidamente horarios livres para encaixe

O que a pessoa encontra nessa tela:

- filtro por data
- filtro por servico
- filtro por profissional
- resumo do dia
- quadro visual da agenda
- lista de horarios livres para encaixe

Como funciona:

- a tela mostra os agendamentos ja existentes no dia selecionado
- quando um servico e escolhido, o sistema consulta os horarios livres para aquele tipo de atendimento
- em empresas com mais de um profissional, a consulta exata de disponibilidade depende da escolha do profissional

Quando usar:

- quando o cliente pergunta se ha horario disponivel
- para localizar brechas rapidamente
- para analisar encaixes antes de registrar o agendamento manual

### 5.4 Ordens de Servico

Finalidade:

- registrar e acompanhar atendimentos tecnicos
- manter historico de entrada, andamento e entrega

O que a pessoa encontra nessa tela:

- lista de ordens de servico
- busca por cliente
- busca por numero da ordem
- filtro por status
- formulario completo de cadastro
- visualizacao de detalhes
- impressao
- envio por WhatsApp

Informacoes que podem ser registradas:

- nome e telefone do cliente
- aparelho
- marca e modelo
- defeito relatado
- estado do aparelho na entrada
- acessorios
- senha ou padrao
- valor de mao de obra
- valor de material
- prazo estimado
- status do orcamento
- status da ordem

Onde alterar o andamento da OS:

- na propria listagem de `Ordens de Servico`
- no seletor de status de cada ordem

Quando usar:

- assistencia tecnica
- servicos com retirada e entrega
- atendimentos que exigem comprovante e acompanhamento

### 5.5 Solicitacoes de Orcamento

Finalidade:

- organizar os pedidos recebidos pelo chat
- concentrar os leads em um lugar facil de consultar

O que a pessoa encontra nessa tela:

- lista de solicitacoes
- campo de busca
- filtro por status
- botao para abrir detalhes
- botao para responder no WhatsApp

Onde responder um cliente:

- dentro da tela `Solicitacoes de Orcamento`
- pelo botao `Responder no WhatsApp`

Quando usar:

- para acompanhar novos pedidos
- para responder clientes que pediram orcamento
- para organizar o atendimento comercial

### 5.6 Servicos

Finalidade:

- cadastrar e organizar os servicos oferecidos pela empresa

O que pode ser configurado:

- nome do servico
- descricao
- preco
- duracao
- ativo ou inativo
- se o sistema deve pedir descricao do problema no agendamento

Onde cadastrar um servico:

- na tela `Servicos`
- no botao `Novo Servico`

Onde editar um servico:

- na lista de servicos
- no icone de edicao do card

Onde desativar um servico:

- ao editar o servico
- no campo `Servico Ativo`

Quando usar:

- no inicio da implantacao
- quando a empresa incluir um novo servico
- quando for necessario pausar ou ajustar um servico existente

### 5.7 Horarios

Finalidade:

- definir os horarios de atendimento da empresa
- controlar a disponibilidade por profissional

O que pode ser configurado:

- dias ativos
- dias fechados
- horario de inicio
- horario de fim
- intervalo

Onde escolher o profissional:

- no topo da tela `Horarios`
- no campo `Profissional`

Onde alterar o expediente:

- na lista de dias da semana
- em cada linha de horario

Onde configurar pausa ou intervalo:

- dentro do dia selecionado
- na secao `Intervalo`

Acao especial dessa tela:

- `Cancelar atendimentos do dia`

Quando usar:

- para ajustar horario comercial
- para cadastrar a rotina de cada profissional
- para bloquear um dia em caso de imprevisto

### 5.8 Relatorios

Finalidade:

- mostrar o desempenho da operacao em um formato visual e facil de apresentar

O que a pessoa encontra nessa tela:

- atendimentos concluidos
- clientes atendidos
- servicos prestados
- volume no periodo
- grafico de movimento
- distribuicao por status
- top servicos
- top clientes
- insights resumidos

Periodos que podem ser escolhidos:

- hoje
- ultimos 7 dias
- proximos 7 dias
- ultimos 30 dias
- mes
- periodo personalizado

Quando usar:

- em reunioes
- para acompanhar desempenho
- para apresentar a operacao da empresa

### 5.9 Configuracoes

Finalidade:

- centralizar as informacoes mais importantes da empresa
- ajustar o comportamento do chat
- cadastrar a equipe
- configurar notificacoes no dispositivo

Essa e uma das telas mais importantes do painel.

#### 5.8.1 Dados da empresa

Onde fica:

- `Configuracoes`

Campos principais:

- nome da empresa
- mensagem de boas-vindas da Sheila
- WhatsApp do prestador
- nome do proprietario
- endereco

Essas informacoes sao usadas para personalizar o atendimento e identificar a empresa no sistema.

#### 5.8.2 Opcoes iniciais do chat

Onde fica:

- `Configuracoes`
- secao `Opcoes iniciais do chat`

Aqui a empresa escolhe quais botoes aparecem para o cliente no inicio da conversa.

As opcoes disponiveis incluem:

- agendar servico
- solicitar orcamento
- ver servicos
- horarios disponiveis
- cancelar agendamento
- falar com atendente

Essa configuracao e importante porque define como o cliente inicia o atendimento.

#### 5.8.3 Cadastro de profissionais

Onde fica:

- `Configuracoes`
- secao `Profissionais`

O que pode ser feito:

- adicionar profissional
- informar nome
- informar WhatsApp
- ativar ou desativar profissional
- remover profissional

Quando usar:

- empresas com mais de um atendente
- negocios que trabalham com agenda por profissional

#### 5.8.4 Servicos por profissional

Onde fica:

- `Configuracoes`
- secao `Configuracao por profissional`

O que pode ser feito:

- selecionar um profissional
- marcar quais servicos ele executa
- salvar a configuracao

Essa area ajuda a evitar agendamentos com a pessoa errada.

#### 5.8.5 Notificacoes neste aparelho

Onde fica:

- `Configuracoes`
- secao `Notificacoes neste aparelho`

O que pode ser feito:

- dar nome ao dispositivo
- ativar notificacoes
- preparar o navegador para push
- escolher quais alertas deseja receber
- definir profissionais vinculados ao aparelho
- desativar aparelhos cadastrados

Quando usar:

- para configurar o computador da recepcao
- para configurar o notebook do gestor
- para configurar o celular de atendimento

### 5.10 Financas

Finalidade:

- acompanhar faturamento
- planejar despesas
- registrar gastos reais
- comparar o planejado com o realizado

O que a pessoa encontra nessa tela:

- faturamento bruto
- media diaria
- ticket medio
- despesas reais
- lucro liquido
- grafico de faturamento
- comparativo do orcamento
- despesas por categoria
- cadastro de despesas

#### 5.9.1 Configuracao financeira

Onde fica:

- `Financas`
- secao de configuracao

O que pode ser definido:

- percentual do dono
- percentual de caixa
- percentual reservado para despesas

Essa configuracao ajuda a empresa a ter uma referencia clara do quanto pode gastar no periodo.

#### 5.9.2 Cadastro de despesas

Onde fica:

- `Financas`
- secao `Despesas da empresa`

O que pode ser registrado:

- descricao
- categoria
- valor
- data
- observacao

Essa parte e importante para manter o controle real das saidas da empresa.

### 5.11 Secretaria

Finalidade:

- permitir consultas rapidas sem precisar navegar por varias telas

O que a pessoa pode perguntar:

- como esta a agenda de hoje
- como esta a agenda da semana
- quanto faturamos na semana
- quanto faturamos no mes
- quantos agendamentos estao pendentes

Onde fica:

- `Secretaria`

Como usar:

- escolher um dos botoes prontos
- ou digitar a pergunta diretamente no campo de conversa

Essa tela e muito util para donos e gestores que querem respostas rapidas.

## 6. Onde Encontrar Cada Configuracao

### Dados principais da empresa

Menu:

- `Configuracoes`

Campos encontrados:

- nome da empresa
- mensagem de boas-vindas
- WhatsApp do prestador
- nome do proprietario
- endereco

### Atalhos que aparecem no chat

Menu:

- `Configuracoes`

Secao:

- `Opcoes iniciais do chat`

### Cadastro e controle da equipe

Menu:

- `Configuracoes`

Secoes:

- `Profissionais`
- `Configuracao por profissional`

### Horario de atendimento

Menu:

- `Horarios`

### Cadastro de servicos

Menu:

- `Servicos`

### Notificacoes no computador ou celular

Menu:

- `Configuracoes`

Secao:

- `Notificacoes neste aparelho`

### Controle da agenda

Menus:

- `Agenda`
- `Dashboard`
- `Agendamentos`

### Controle de despesas

Menu:

- `Financas`

### Atendimento tecnico com ordem de servico

Menu:

- `Ordens de Servico`

### Pedidos recebidos pelo chat

Menu:

- `Solicitacoes de Orcamento`

## 7. Orientacao para Treinamento de Novos Usuarios

Se o objetivo for ensinar uma pessoa nova a mexer no sistema, a recomendacao e apresentar o painel nesta ordem:

1. Login no painel
2. Menu lateral
3. Dashboard
4. Agenda
5. Agendamentos
6. Configuracoes
7. Servicos
8. Horarios
9. Financas
10. Ordens de Servico
11. Relatorios

Essa sequencia ajuda porque primeiro a pessoa entende a rotina do dia, depois aprende onde faz os ajustes do sistema.

## 8. Sugestao de Estrutura para PDF com Prints

Para transformar este material em um PDF mais profissional, uma boa ordem seria:

1. Capa
2. Apresentacao do Sheila System
3. Como entrar no painel
4. Visao geral do menu
5. Dashboard
6. Agenda
7. Agendamentos
8. Servicos
9. Horarios
10. Configuracoes
11. Financas
12. Ordens de Servico
13. Solicitacoes de Orcamento
14. Relatorios
15. Secretaria
16. Encerramento

Sugestao de prints:

- tela de login
- menu lateral aberto
- dashboard
- tela da agenda
- tela de agendamentos
- formulario de servico
- tela de horarios
- tela de configuracoes
- cadastro de profissionais
- tela de financas
- tela de ordens de servico
- tela de solicitacoes de orcamento
- tela de relatorios
- tela da secretaria

## 9. Documento Base

Este arquivo foi preparado para ser o documento principal de apresentacao e treinamento do painel admin.

Arquivo:

- [docs/manual-admin-completo.md](/C:/Users/Pichau/Desktop/SecretariaSheila/docs/manual-admin-completo.md)
