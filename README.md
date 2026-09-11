# Servidor Valheim + Painel Web

Servidor dedicado de Valheim em Docker, com painel web pra ligar, parar,
ver quem está online e cuidar dos backups.

Escrito pra ser entendido daqui a três meses, quando você tiver esquecido
tudo. Se algo aqui não funcionar como está escrito, o README está errado —
conserte ele.

> **Ainda não é um repositório git.** Veja [PUBLICAR.md](PUBLICAR.md) — são
> dois cliques no GitHub Desktop.

---

## O mínimo pra subir

```bash
cp .env.example .env
nano .env                 # troque as DUAS senhas e gere o segredo
chmod +x scripts/*.sh
./scripts/start.sh
```

Painel em <http://localhost:8080>.

A primeira subida baixa ~2 GB do Steam e demora. Acompanhe com
`docker compose logs -f valheim` e espere aparecer `Game server connected`.

---

## Configuração (arquivo `.env`)

Tudo é configurado no `.env`. Ele **não vai pro git** — o `.env.example` é
o modelo com os nomes das variáveis, sem valores reais.

### As três coisas que você precisa preencher

```bash
VALHEIM_SERVER_PASS=...        # senha do jogo (mín. 5 caracteres)
PANEL_PASS=...                 # senha do painel (mín. 8 caracteres)
PANEL_SESSION_SECRET=...       # gere com: openssl rand -hex 32
```

O painel **se recusa a subir** se qualquer uma faltar. Isso é de propósito:
melhor quebrar na hora do que ficar um painel aberto na internet.

### Regra chata do Valheim

A senha do servidor **não pode conter** o nome do servidor nem o nome do
mundo. Se violar isso, o servidor sobe e morre sem explicar direito. Se ele
não ficar de pé e o log não fizer sentido, é quase sempre isso.

### Variáveis que importam

| Variável | O que faz |
|---|---|
| `VALHEIM_SERVER_NAME` | Nome na lista de servidores |
| `VALHEIM_WORLD_NAME` | Nome do mundo. **Mudar cria um mundo novo** |
| `VALHEIM_PORT` | Porta UDP base. Usa também +1 e +2 |
| `VALHEIM_PUBLIC` | `true` aparece na lista pública |
| `VALHEIM_CROSSPLAY` | `true` deixa Xbox/Game Pass entrar |
| `VALHEIM_ADMIN_IDS` | SteamIDs de admin, separados por espaço |
| `BACKUP_INTERVAL_HOURS` | De quanto em quanto tempo salva. `0` desliga |
| `BACKUP_KEEP` | Quantos backups manter |
| `BACKUP_MAX_AGE_DAYS` | Idade máxima. `0` = sem limite |

Mudou o `.env`? Precisa recriar os containers:

```bash
docker compose up -d --force-recreate
```

### Portas no firewall

Libere **UDP** 2456, 2457 e 2458 (ou `VALHEIM_PORT` +1 +2).
O painel é TCP 8080 — e esse é melhor **não** expor direto (veja Segurança).

---

## Backup

### Automático

Roda sozinho a cada `BACKUP_INTERVAL_HOURS` (padrão: 6h), feito pelo painel.
Vai pra pasta `backups/`.

Com o servidor parado, o backup é pulado — seria uma cópia idêntica à
anterior gastando um slot da rotação.

### Manual

Pelo painel: **Fazer backup agora**.
Pelo terminal:

```bash
./scripts/backup.sh
```

### Como a rotação decide o que apagar

Nessa ordem:

1. Os `BACKUP_KEEP` mais recentes **sempre ficam**. Essa regra ganha das outras.
2. Do resto, sai o que for mais velho que `BACKUP_MAX_AGE_DAYS`.
3. O que passar da cota de quantidade também sai.
4. **Nunca apaga todos.** Mesmo com a configuração zoada, sobra um.

A regra 1 vir antes da 2 é de propósito: se você deixar o servidor parado
dois meses, ao voltar não quer encontrar a pasta de backups vazia porque
"todos estavam velhos".

Arquivos que não seguem o padrão de nome (`valheim-<Mundo>-<data>.tar.gz`)
são ignorados pela rotação. Então backups `pre-restore-*` que o restore cria
ficam guardados pra sempre — apague na mão quando não precisar mais.

### O que tem dentro do backup

Os dois arquivos do mundo: `<Mundo>.db` e `<Mundo>.fwl`. O `.fwl` guarda a
seed; sem ele o `.db` não serve pra nada. Por isso os dois sempre andam juntos.

---

## Restaurar

### Pelo painel

Aba Backups → **Restaurar**. O painel para o servidor, restaura e sobe de volta.
Antes de sobrescrever, ele salva o mundo atual como backup de segurança —
restaurar o arquivo errado não é irreversível.

### Pelo terminal

```bash
./scripts/restore.sh                      # lista o que existe
./scripts/restore.sh valheim-Dedicated-20260911T143000.tar.gz
```

Pede confirmação, para o servidor, salva o mundo atual como
`pre-restore-*.tar.gz`, restaura e sobe de novo.

### Restaurar num servidor limpo

Copie o `.tar.gz` pra `backups/`, garanta que `VALHEIM_WORLD_NAME` no `.env`
bate com o nome no arquivo do backup, e rode o restore. Nome de mundo
diferente = mundo diferente; o save não é encontrado.

---

## Comandos do dia a dia

```bash
./scripts/start.sh                    # sobe tudo
./scripts/stop.sh                     # para tudo (até 2 min, salvando)
./scripts/restart.sh                  # reinicia só o Valheim
./scripts/backup.sh                   # backup manual
./scripts/restore.sh <arquivo>        # restaura

docker compose logs -f valheim        # log ao vivo
docker compose ps                     # o que está no ar
```

**Parar demora até 2 minutos e isso é certo.** O Valheim salva o mundo ao
receber o sinal de desligar. Matar na força perde o progresso desde o
último save automático.

---

## Painel

- Liga, para e reinicia o servidor
- Status, uptime e quem está online (lido do log)
- Lista, baixa e restaura backups
- Log recente, sem as linhas de ruído
- Atualiza o status a cada 10s

Login com `PANEL_USER` / `PANEL_PASS` do `.env`.

A contagem de jogadores é reconstruída do log (conexões menos desconexões).
É confiável na prática, mas depois de uma queda feia do servidor pode
mostrar gente que já saiu — reiniciar limpa.

---

## Segurança

O que já está feito:

- Senhas só em variável de ambiente, nunca no código nem no git
- Sessão em cookie assinado com HMAC, `HttpOnly` + `SameSite=Strict`
- Comparação de senha em tempo constante
- Rate limit: 5 tentativas por IP, janela de 15 min
- Download de backup só aceita nomes que casam com o padrão (mata path traversal)
- O painel recusa subir sem as variáveis obrigatórias

**O que falta e depende de você:** o painel fala HTTP puro. Ele liga e
desliga um servidor — não exponha na internet sem HTTPS na frente. No
Dokploy, ponha o domínio pelo proxy dele e deixe o Traefik cuidar do TLS.
Em casa, deixe só na rede local ou atrás de VPN.

O painel monta `/var/run/docker.sock` porque precisa controlar o container
do Valheim. Na prática isso dá a ele poder de root no host — mais um motivo
pra não deixar o login exposto.

---

## Testes

```bash
cd panel && npm test
```

Sem dependências, só o runner nativo do Node (precisa de Node 20+).

O script lista os três arquivos de teste **um por um**, de propósito. Nem
`node --test test/` nem `node --test test/*.test.js` são confiáveis aqui:
o primeiro falha no Node 24 no Windows (`MODULE_NOT_FOUND`) e o segundo
depende do shell expandir o `*` — o `cmd` não expande. Caminho explícito
funciona em cmd, PowerShell e bash igual.

**Criou um teste novo? Adicione ele à lista em `package.json`**, senão ele
nunca roda e você não fica sabendo.

Cobre o que quebra **em silêncio**:

- **Rotação de backup** — que nunca apaga tudo, que a cota de quantidade
  ganha da de idade, que arquivo alheio na pasta não é removido
- **Autenticação** — token adulterado rejeitado, sessão expirada rejeitada,
  env sem senha nega tudo (em vez de liberar)
- **Parsing de log** — reconexão não conta como dois jogadores, linha
  estranha não derruba o parser

---

## Deploy no Dokploy

1. **Create** → **Compose**
2. Aponte pro repositório, branch `main`
3. Compose path: `docker-compose.yml`
4. Em **Environment**, cole o conteúdo do seu `.env` (o Dokploy guarda
   isso fora do git)
5. Domínio no serviço `panel`, porta `8080`, HTTPS ligado
6. Deploy

Detalhe: o Dokploy não roda o `scripts/start.sh`, e é ele quem traduz
`VALHEIM_CROSSPLAY` na flag do servidor. Se quiser crossplay lá, adicione
também `VALHEIM_CROSSPLAY_ARG=-crossplay` nas variáveis.

As portas UDP do Valheim precisam estar abertas no firewall do servidor —
o proxy do Dokploy só cuida de HTTP/HTTPS.

Volumes: `./data` e `./backups` ficam ao lado do compose. Não apague a
pasta do projeto achando que é cache — o mundo está ali.

---

## Quando der errado

**Servidor sobe e cai logo em seguida**
Quase sempre a senha. Mínimo 5 caracteres e não pode conter o nome do
servidor nem o do mundo. `docker compose logs valheim` confirma.

**Ninguém acha o servidor na lista**
Servidor público leva alguns minutos pra aparecer. Mais rápido: no jogo,
*Join Game* → *Join IP* com o IP e a porta.

**Painel não sobe**
`docker compose logs panel`. Se faltar variável obrigatória, ele diz qual
e sai. É o comportamento esperado.

**Painel diz "docker falhou"**
O container do painel não está alcançando o socket do Docker. Confira se
o volume `/var/run/docker.sock` está montado e se `VALHEIM_CONTAINER` no
`.env` bate com o `container_name` do compose.

**Mundo "sumiu" depois de mexer no .env**
Você trocou `VALHEIM_WORLD_NAME`. O mundo antigo continua em
`data/config/worlds_local/`. Volte o nome pro que era.

**Backup falha com "mundo não existe"**
O servidor ainda não rodou tempo suficiente pra criar o save. Suba, espere
aparecer `Game server connected`, tente de novo.
