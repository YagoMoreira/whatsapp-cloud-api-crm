# Canal WhatsApp num CRM — API oficial da Meta, ponta a ponta

Integração do **WhatsApp Business Cloud API** dentro de um CRM em produção:
caixa de entrada com visibilidade por consultor, automações administrativas e
envio em lote com aprovação e controle de ritmo.

`8.200 linhas` · `TypeScript (Deno) + React` · `171 verificações automatizadas`

> Extraído de um sistema proprietário, com o domínio e os identificadores da
> infraestrutura substituídos por exemplos. O restante é o código como foi
> para produção.

---

## O problema

O CRM já tinha um botão de WhatsApp. Ele montava a mensagem e abria
`https://wa.me/...` — dali em diante tudo acontecia fora do sistema.

O que ficava registrado era a **intenção** de mandar, nunca o envio. E a
resposta do cliente não voltava para lugar nenhum: vivia no celular de quem
atendeu. Consultor de férias, conversa perdida. Pergunta de "o que foi
combinado com esse cliente?", sem resposta.

O objetivo foi fechar esse buraco sem trocar a ferramenta de suporte que já
rodava em outro número.

---

## A regra que manda no desenho

Quase toda decisão deste projeto sai de **uma** regra da Meta:

> Dentro de 24h contadas da última mensagem **do cliente**, você responde o que
> quiser, de graça. Fora disso, só **template aprovado** — e é cobrado.

Ela não é um detalhe de integração. Ela decide:

- que a tela precisa mostrar o tempo restante e trocar sozinha a caixa de texto
  pelo seletor de template (ninguém decora a regra);
- que campanha em massa é **sempre** template, porque a janela está fechada para
  quase todo mundo por definição;
- que uma automação noturna que manda texto livre é uma recusa garantida;
- que o custo do canal é uma função de quantas conversas você **inicia**, não de
  quantas mensagens troca.

E há uma segunda regra, que só aparece quando o volume cresce: a Meta limita
**destinatários únicos por 24h** em degraus — 250 → 1.000 → 10.000 → 100.000 —
e o degrau **desce** quando a nota de qualidade cai. Estourar o teto não perde
só o excedente: a rajada de recusas derruba a nota, e com ela o degrau.

Quem tenta acelerar fica mais lento.

---

## Arquitetura

```
                      Meta Cloud API
                       ▲          │
              envio    │          │  webhook (HMAC-SHA256)
                       │          ▼
    ┌──────────────────┴──────────────────────────┐
    │  shared/                                    │
    │    whatsapp.ts          Graph API + regras  │
    │    whatsappConversa.ts  fio da conversa     │
    │    whatsappAcesso.ts    quem vê o quê       │
    │    whatsappAutomacao.ts as quatro travas    │
    │    whatsappCampanha.ts  fila e teto diário  │
    └──────────────────┬──────────────────────────┘
                       │
    ┌──────────────────┴──────────────────────────┐
    │  functions/  (Deno, uma porta por papel)    │
    │    receberWhatsApp   ← webhook, portaria    │
    │    enviarWhatsApp    → saída, portaria      │
    │    whatsappConversas   caixa de entrada     │
    │    whatsappVigia       cron 30 min          │
    │    whatsappAutomacoes  cron diário          │
    │    campanhasWhatsApp   gestão de campanha   │
    │    campanhaWhatsAppDisparo  cron 15 min     │
    └──────────────────┬──────────────────────────┘
                       │  entidades fechadas ao navegador (RLS deny-all)
    ┌──────────────────┴──────────────────────────┐
    │  React — caixa de entrada, gaveta, campanhas│
    └─────────────────────────────────────────────┘
```

**`shared/` não tem I/O e não lê variável de ambiente.** A configuração é
passada como argumento. Não é purismo: é o que permite empacotar esses módulos
com esbuild e rodar as regras em Node, sem rede e sem banco — que é o motivo de
existirem 171 verificações num projeto sem framework de teste.

---

## Cinco decisões e o porquê de cada uma

### 1. A conversa é o número, não o atendimento

O WhatsApp não tem "assunto". O mesmo cliente escreve hoje sobre um chamado e
daqui a um mês sobre outro, no mesmo fio.

Modelar a conversa por atendimento obrigaria a decidir, **a cada mensagem que
chega**, a qual atendimento ela pertence — e a errar. Aqui a conversa é o fio do
número; ticket, cliente e oportunidade são **vínculos** que mudam sem quebrar o
histórico.

A chave real é o par `(telefone, numeroId)`: a mesma pessoa falando com dois
números nossos são duas conversas, porque na Meta são mesmo duas.

### 2. A assinatura do webhook é conferida antes de qualquer parse

```ts
const corpoCru = await req.text();          // CRU — reserializar muda espaços
const appSecret = Deno.env.get('WHATSAPP_APP_SECRET') || '';
if (!appSecret) return Response.json({ … }, { status: 503 });
if (!(await assinaturaConfere(corpoCru, req.headers.get('x-hub-signature-256'), appSecret))) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
```

Comparação em **tempo constante**, sobre o corpo **cru**. Um `JSON.parse` antes
da conferência reordena chaves e normaliza espaços — a assinatura deixa de bater
por acidente, e a "correção" natural é afrouxar a verificação.

Sem o segredo configurado, recusa tudo com 503. Nunca "passa por enquanto".

### 3. A visibilidade é conferida no servidor, em toda ação

Cada consultor alcança as conversas dos clientes de que é responsável; admin
alcança todas. A regra vive num módulo só e é conferida em **toda** ação que
recebe um `conversaId` — listar, ler, marcar lido, enviar.

Conferir só na tela deixaria a conversa a um `fetch` de distância.

Quem não alcança recebe **"não encontrada"**, e não "não é sua": dizer que
existe já entrega que aquele número fala com a empresa.

Duas consequências ficaram registradas como decisão, não como bug:

- **Conversa sem vínculo aparece para todos.** Número novo não casa com cadastro
  nenhum; se ficasse restrita, a mensagem de um cliente novo não apareceria para
  ninguém.
- **`contato` e `agente` não têm responsável no cadastro**, então conversa presa
  a eles segue visível a todos. Vão conhecido — fechá-lo exigiria inventar um
  dono onde o sistema não tem um.

### 4. Toda mensagem automática passa por quatro travas

```
1. canal configurado
2. o cliente não pediu para sair        ← nenhuma automação passa por cima
3. existe template aprovado para o evento
4. aquele fato ainda não foi avisado    ← repetição vira denúncia de spam
```

Qualquer trava que feche devolve `{ ok: false, motivo }`. **Nenhuma delas é
erro**: são o funcionamento normal de um canal que prefere não mandar a mandar
errado.

Com zero templates cadastrados, as automações rodam, registram *"sem template
aprovado"* e não mandam nada. Esse é o estado seguro de partida — não um
defeito a corrigir depois.

E o descadastro funciona de verdade: o rodapé promete "responda SAIR", e o
webhook reconhece *sair*, *parar*, *pare*, *stop*, *descadastrar*, *cancelar* —
a palavra sozinha, para *"não quero sair do plano"* continuar sendo assunto de
atendimento. Prometer descadastro que não funciona é o caminho mais curto para a
denúncia que derruba o número.

### 5. Campanha é fila, não disparo

Por causa do degrau de destinatários únicos. O público inteiro fica gravado e um
cron entrega o que cabe no teto do dia.

**Uma campanha de 2.000 pessoas levar uma semana é o desenho funcionando.**

Duas escolhas dentro dela:

- **Deduplicação pelo telefone, não pelo id do cadastro.** Dois cadastros com o
  mesmo número são uma pessoa só do lado de lá, e receber a mesma campanha duas
  vezes é exatamente o que gera denúncia.
- **"Pulado" e "falhou" são contados separados.** Pulado é trava nossa
  segurando; falhou é a Meta recusando. Somar os dois num contador só esconderia
  justamente o que alguém vai querer olhar — *"21 pediram para sair"* é
  informação de campanha; *"3 a Meta recusou"* é problema.

Aprovar uma campanha grava **quem** aprovou, e o disparo confere essa assinatura
— não só o status:

```ts
if (!campanha.aprovadoPorUserId) return { ok: false, motivo: 'sem aprovação registrada' };
```

Status é campo que qualquer caminho futuro pode escrever. Assinatura não se põe
por acidente. Há um teste para isso: *"status aprovada SEM assinatura não
dispara"*.

---

## Testes

171 verificações, sem framework: um runner que empacota os módulos **reais** com
esbuild e roda em Node.

```
── Normalização do telefone (cliente e servidor têm de concordar)
── Assinatura do webhook
── A janela de 24 horas
── Leitura do payload da Meta
── Regra de alcance por consultor
── Campanha: montagem do público
── Campanha: o teto diário da Meta
```

Rodam a partir desta pasta, sem o resto do sistema:

```sh
npm i -D esbuild
sh scripts/rodarTestesWhatsApp.sh
```

O caso que mais se paga: a normalização de telefone existe **duas vezes** — no
navegador (que avisa enquanto a pessoa digita) e no servidor (que fala com a
Meta). Duas cópias porque os runtimes são diferentes, não porque possam
divergir. O teste roda **as duas** contra a mesma tabela.

Divergir ali significa a tela aceitar um número que o envio recusa — ou, pior,
mandar mensagem para outra pessoa.

---

## Segurança

| | |
|---|---|
| **Webhook** | HMAC-SHA256 do corpo cru, tempo constante, antes do parse |
| **Só o nosso número** | A assinatura é por conta, não por número: o que vier de outro `phone_number_id` é descartado |
| **Entidades fechadas** | `rls` deny-all no próprio schema, para o deploy aplicar junto com o código |
| **Autoria pela sessão** | `autorUserId` vem do usuário autenticado, nunca do corpo da requisição |
| **URL de mídia** | Só `https:` no envio, e só `https:` vira link na thread |
| **Idempotência** | Chaveada pelo `wamid` — a Meta reenviar o lote não duplica mensagem |
| **Segredos** | Cinco variáveis de ambiente. Nenhuma constante no código |

Uma revisão de segurança dedicada rodou sobre este código e achou dois
problemas reais — **ambos corrigidos antes do merge**:

1. **RLS ausente.** As entidades da conversa subiram sem o bloco `rls`, apesar
   de os comentários do próprio código afirmarem que estavam fechadas. Qualquer
   usuário logado podia listar e forjar mensagens.
2. **XSS armazenado via `midia.url`.** A URL vinha do corpo da requisição, era
   persistida **mesmo quando a Meta recusava o envio**, e depois renderizada num
   `<a href>`. React 18 não bloqueia `javascript:` — só avisa. Corrigido nos
   dois lados, com teste.

O segundo é o tipo de defeito que sobrevive à revisão humana porque cada peça,
isolada, parece razoável.

---

## O que a implantação ensinou

Três armadilhas que nenhum tutorial menciona, e que viraram documentação:

**Verificar não é registrar.** Receber o SMS não põe o número na Cloud API. O
status fica *Pendente* e o número **não existe no WhatsApp** — quem o procura vê
"convidar para o WhatsApp". O registro é a definição do PIN de duas etapas, e o
botão desse PIN no painel **fica acinzentado**: ele só troca o PIN de número já
conectado. Só sai por `POST /{phone_number_id}/register`.

**A conta precisa ser inscrita no app.** Assinar o campo `messages` diz ao app *o
que* escutar; falta dizer à conta que ela fala com esse app. Quem entra pelo
cadastro embutido ganha isso de graça; quem cadastra à mão, não. Sintoma:
webhook verde, `messages` assinado, e **nenhuma mensagem chegando**.

**`phone_number_id` não é o ID da conta.** Os dois são numéricos, do mesmo
tamanho, em telas vizinhas. Trocar um pelo outro **falha em silêncio**: o filtro
descarta toda mensagem como "de outro número" e devolve **200**. Log verde,
caixa de entrada vazia, nenhum erro em lugar nenhum.

O antídoto para as três é o mesmo: perguntar à API em vez de confiar na tela.

---

## Estrutura

```
base44/
  shared/       5 módulos, sem I/O — as regras, testáveis em Node
  functions/    7 funções Deno, uma porta por papel
  entities/     4 schemas com RLS deny-all
  workflows/    3 crons
src/
  lib/whatsapp/       cliente da API + normalização de telefone
  components/whatsapp/ caixa de entrada, gaveta, seleção em lote
  pages/whatsapp/      conversas e campanhas
scripts/
  testeWhatsApp.mjs   171 verificações
docs/whatsapp/
  PLANO.md            arquitetura, custo, quem vê o quê
  CONFIGURACAO-META.md passo a passo e as armadilhas acima
  TEMPLATES.md        os quatro templates e o cadastro dos dois lados
```

---

## O que ficou de fora, de propósito

- **Os botões `wa.me` continuam onde estavam.** Enquanto o canal oficial não
  estiver ligado, são eles que funcionam. Trocar os dois no mesmo dia seria
  apostar a operação num deploy.
- **Distribuição de atendimento** (fila, rodízio). Hoje o alcance é decidido pelo
  responsável do cliente.
- **Respostas com botões e listas interativas.** Chegam e são exibidas; o envio
  é texto, mídia e template.
