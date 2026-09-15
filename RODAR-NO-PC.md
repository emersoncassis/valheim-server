# Rodar no PC com Docker Desktop (Windows)

Guia pra subir o servidor num PC Windows com Docker Desktop, trazendo um
mundo que já existe.

## Caminho rápido: `setup.ps1`

Faz tudo sozinho — confere o Docker, monta o `.env` com as senhas que você
digitar, gera o segredo, cria as pastas, importa o mundo e sobe.

```powershell
git clone https://github.com/emersoncassis/valheim-server.git
cd valheim-server
.\setup.ps1 -MundoOrigem "D:\ICELAND"
```

Troque `D:\ICELAND` pelo caminho onde você colocou a pasta do mundo (ou o
`.zip` dele). Se o mundo já estiver no save local **desta** máquina, pode
rodar só `.\setup.ps1` que ele acha sozinho.

Se o PowerShell recusar por política de execução:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -MundoOrigem "D:\ICELAND"
```

O script **se recusa a subir sem o mundo**, de propósito: subir primeiro
criaria um mundo vazio e a importação viraria bagunça.

O resto deste documento é o passo a passo manual — útil se algo falhar ou
se você quiser entender o que o script fez.

---

Se você só quer testar o painel sem Docker, veja a seção
"Testar o painel localmente" no [README.md](README.md).

---

## Antes de começar

- **Docker Desktop instalado e rodando** (ícone da baleia na bandeja, sem
  aviso de erro). Se estiver parado, nada aqui funciona.
- **Git instalado**, pra clonar o repositório.
- O PC vai ficar ligado enquanto a galera joga. É ele o servidor.

---

## 1. Clonar o projeto

No PowerShell, na pasta onde você quer guardar o projeto:

```powershell
git clone https://github.com/emersoncassis/valheim-server.git
cd valheim-server
```

A partir daqui, todos os comandos são de dentro dessa pasta.

---

## 2. Criar o `.env`

```powershell
Copy-Item .env.example .env
notepad .env
```

Preencha assim — **os quatro primeiros são obrigatórios**:

```
VALHEIM_WORLD_NAME=ICELAND
VALHEIM_SERVER_PASS=<senha do jogo, 5+ caracteres>
PANEL_PASS=<senha do painel, 8+ caracteres>
PANEL_SESSION_SECRET=<cole o hex gerado abaixo>

VALHEIM_SERVER_NAME=Da Galera
PANEL_USER=admin
PANEL_PORT=9091
```

Gere o segredo da sessão:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Sem Node instalado, use este equivalente em PowerShell:

```powershell
$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
-join ($b | ForEach-Object { $_.ToString('x2') })
```

### As duas regras que mais derrubam servidor

1. `VALHEIM_SERVER_PASS` **não pode conter** o nome do servidor nem o nome
   do mundo. Com `VALHEIM_SERVER_NAME=Da Galera` e
   `VALHEIM_WORLD_NAME=ICELAND`, a senha não pode ter "Galera" nem
   "ICELAND" dentro. O servidor sobe e morre sem explicar direito.
2. `VALHEIM_WORLD_NAME` precisa bater **exatamente** com o nome da pasta do
   seu mundo, inclusive maiúsculas. `ICELAND` ≠ `Iceland`.

---

## 3. Copiar o mundo para dentro do projeto

**Faça isso ANTES de subir o servidor.** Se ele subir primeiro, cria um
mundo vazio com esse nome e depois a cópia vira bagunça.

Crie a pasta destino e copie:

```powershell
New-Item -ItemType Directory -Force -Path ".\data\config\worlds_local"

Copy-Item "$env:USERPROFILE\AppData\LocalLow\IronGate\Valheim\worlds_local\ICELAND" `
  ".\data\config\worlds_local\ICELAND" -Recurse
```

> Se o mundo está no **outro** PC, copie a pasta `ICELAND` inteira por
> pendrive/rede até aqui. É a pasta toda, com todos os `.chunk` dentro —
> não só alguns arquivos.

Confira que veio tudo:

```powershell
Get-ChildItem ".\data\config\worlds_local\ICELAND" | Measure-Object
```

Tem que aparecer dezenas de arquivos. Se aparecer 0 ou 2, a cópia falhou.

Confira também que os metadados vieram — sem eles o mundo não abre:

```powershell
Get-ChildItem ".\data\config\worlds_local\ICELAND\_main.*"
```

Deve listar quatro arquivos: `.db2`, `.fwl2`, `.chunks` e `.ok`.

---

## 4. Subir

```powershell
docker compose up -d
```

A primeira vez baixa ~2 GB do Steam e demora. Acompanhe:

```powershell
docker compose logs -f valheim
```

Espere aparecer **`Game server connected`**. `Ctrl+C` sai do log sem
derrubar o servidor.

---

## 5. Abrir o painel

<http://localhost:9091>

Login com `PANEL_USER` / `PANEL_PASS` do `.env`.

O painel deve mostrar o servidor **No ar**, com uptime contando.

---

## 6. Conectar no jogo

No Valheim: **Join Game** → aba **Join IP** → digite o IP e porta.

- **Mesma casa / mesma rede:** use o IP local do PC servidor. Descubra com:

  ```powershell
  ipconfig | Select-String "IPv4"
  ```

  Fica algo tipo `192.168.0.15`. No jogo: `192.168.0.15:2456`

- **Pela internet:** o Valheim usa **UDP**, e Cloudflare Tunnel não passa
  UDP — o túnel serve pro painel, não pro jogo.

  **O caminho mais fácil é ligar o crossplay.** Segundo o manual oficial,
  o backend de crossplay (PlayFab) transmite por um servidor de relay, e
  por isso **não exige liberar porta nenhuma** no roteador. Resolve CGNAT
  de graça e ainda deixa gente de Xbox/Game Pass entrar.

  No `.env`:

  ```
  VALHEIM_CROSSPLAY=true
  ```

  Depois `docker compose up -d --force-recreate`.

  Detalhe do manual: em servidor com crossplay **não dá pra conectar por
  IP local nem por loopback**. Ou seja, mesmo você, na mesma casa, vai
  entrar pela lista de servidores ou por join code — não por
  `192.168.x.x`. Se quiser jogar por IP local, deixe o crossplay
  desligado.

  Alternativas, se não quiser crossplay:
  - Liberar as portas UDP 2456-2457 no roteador (só funciona se sua
    operadora te der IP público — muita operadora no Brasil usa CGNAT e aí
    não dá)
  - **playit.gg** — túnel grátis com suporte a UDP
  - **Tailscale** — cada amigo instala o cliente; funciona bem e é grátis
    pra grupo pequeno

A senha do servidor é a `VALHEIM_SERVER_PASS`.

---

## 7. Confirmar que o backup funciona

Não confie no backup automático sem testar uma vez. No painel, clique em
**Fazer backup agora** e veja se aparece na lista com tamanho razoável
(alguns MB, não alguns bytes).

Ou pelo terminal:

```powershell
docker compose exec panel ls -la /app/backups
```

O backup automático roda a cada 6h (`BACKUP_INTERVAL_HOURS`) e mantém os
14 mais recentes (`BACKUP_KEEP`).

---

## Firewall do Windows

Na primeira subida o Windows costuma perguntar se libera o Docker na rede.
**Permita em redes privadas**, senão ninguém conecta nem pela rede local.

Se não perguntou e ninguém conecta, libere na mão:

```powershell
New-NetFirewallRule -DisplayName "Valheim UDP" -Direction Inbound `
  -Protocol UDP -LocalPort 2456-2457 -Action Allow
```

(PowerShell **como administrador**.)

---

## Comandos do dia a dia

```powershell
docker compose up -d           # sobe
docker compose stop -t 120     # para (até 2 min, salvando o mundo)
docker compose restart valheim # reinicia só o jogo
docker compose logs -f valheim # log ao vivo
docker compose ps              # o que está no ar
```

**Parar demora até 2 minutos e isso é normal** — o Valheim salva o mundo
antes de sair. Matar na força perde o progresso desde o último save.

---

## Quando der errado

**`docker compose` não é reconhecido**
Docker Desktop não está instalado ou não está rodando. Abra ele e espere a
baleia ficar estável na bandeja.

**Servidor sobe e cai em seguida**
Quase sempre a senha (veja as duas regras no passo 2).
`docker compose logs valheim` mostra.

**Painel não abre em localhost:9091**
Veja se o container está de pé: `docker compose ps`.
Se o `panel` estiver reiniciando em loop:
`docker compose logs panel` — provavelmente falta variável no `.env`, e ele
diz exatamente qual.

**Mundo vazio em vez do meu mundo**
`VALHEIM_WORLD_NAME` não bate com o nome da pasta, ou a cópia do passo 3
não aconteceu / aconteceu depois de subir. Pare tudo
(`docker compose down`), apague `data\config\worlds_local`, refaça o passo
3 e suba de novo.

**Backup com poucos bytes**
Sinal de que o mundo não foi encontrado. Confira se
`data\config\worlds_local\ICELAND` existe e tem os `.chunk` dentro.
