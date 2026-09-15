# =====================================================================
#  Setup do servidor Valheim — PC com Docker Desktop (Windows)
#
#  Faz tudo o que dá pra automatizar:
#    - confere Docker
#    - cria o .env com senhas que VOCÊ digita (nunca fixas no arquivo)
#    - gera o segredo de sessão com gerador criptográfico
#    - cria as pastas
#    - importa o mundo (de pasta ou .zip)
#    - sobe os containers
#
#  Uso:
#      .\setup.ps1
#      .\setup.ps1 -MundoOrigem "D:\ICELAND"
#      .\setup.ps1 -MundoOrigem "D:\ICELAND.zip"
#
#  Não precisa rodar como administrador, exceto se pedir a regra de
#  firewall no fim.
# =====================================================================

param(
  # Pasta OU .zip do mundo a importar. Se omitido, o script procura no
  # save local do Valheim desta máquina.
  [string]$MundoOrigem = "",

  # Nome do mundo. Precisa bater com o nome da pasta do save.
  [string]$Mundo = "ICELAND",

  # Pula a subida dos containers (só prepara os arquivos).
  [switch]$SemSubir
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Titulo($t) {
  Write-Host ""
  Write-Host "=== $t ===" -ForegroundColor Cyan
}
function Ok($t)    { Write-Host "  [ok] $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }
function Erro($t)  { Write-Host "  [X]  $t" -ForegroundColor Red }

# ---------------------------------------------------------------------
Titulo "1/6  Conferindo o Docker"

try {
  docker version --format '{{.Server.Version}}' | Out-Null
  Ok "Docker respondendo"
} catch {
  Erro "Docker nao esta rodando."
  Write-Host ""
  Write-Host "  Abra o Docker Desktop e espere a baleia ficar estavel na" -ForegroundColor Yellow
  Write-Host "  bandeja do sistema. Depois rode este script de novo." -ForegroundColor Yellow
  exit 1
}

# 'docker compose' (v2) e nao 'docker-compose' (v1, descontinuado)
try {
  docker compose version | Out-Null
  Ok "docker compose disponivel"
} catch {
  Erro "'docker compose' nao encontrado. Atualize o Docker Desktop."
  exit 1
}

# ---------------------------------------------------------------------
Titulo "2/6  Configurando o .env"

if (Test-Path ".env") {
  Aviso ".env ja existe — mantendo o que esta la."
  Write-Host "       (apague o arquivo e rode de novo pra refazer)"
} else {

  # --- senha do jogo ---
  # Regra do Valheim: minimo 5 caracteres e nao pode conter o nome do
  # servidor nem o nome do mundo. Validamos aqui pra nao descobrir isso
  # so quando o servidor subir e morrer sem explicar.
  $nomeServidor = Read-Host "  Nome do servidor (aparece na lista) [Da Galera]"
  if ([string]::IsNullOrWhiteSpace($nomeServidor)) { $nomeServidor = "Da Galera" }

  do {
    $sp = Read-Host "  Senha do JOGO (min 5, sem conter '$Mundo' nem o nome do servidor)" -AsSecureString
    $senhaJogo = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sp))

    $problema = $null
    if ($senhaJogo.Length -lt 5) {
      $problema = "precisa de pelo menos 5 caracteres"
    } elseif ($senhaJogo -like "*$Mundo*") {
      $problema = "nao pode conter o nome do mundo ($Mundo)"
    } else {
      foreach ($palavra in $nomeServidor.Split(' ')) {
        if ($palavra.Length -ge 3 -and $senhaJogo -like "*$palavra*") {
          $problema = "nao pode conter '$palavra' (parte do nome do servidor)"
          break
        }
      }
    }
    if ($problema) { Erro "Senha invalida: $problema" }
  } while ($problema)
  Ok "Senha do jogo aceita"

  # --- senha do painel ---
  do {
    $pp = Read-Host "  Senha do PAINEL web (min 8 caracteres)" -AsSecureString
    $senhaPainel = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pp))
    if ($senhaPainel.Length -lt 8) { Erro "Precisa de pelo menos 8 caracteres" }
  } while ($senhaPainel.Length -lt 8)
  Ok "Senha do painel aceita"

  # --- segredo de sessao ---
  # RandomNumberGenerator, nao Get-Random: este e criptografico.
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $segredo = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  Ok "Segredo de sessao gerado (64 hex, criptografico)"

  # --- crossplay ---
  Write-Host ""
  Write-Host "  Crossplay (PlayFab): dispensa liberar porta no roteador —" -ForegroundColor Gray
  Write-Host "  resolve CGNAT e deixa Xbox/Game Pass entrar." -ForegroundColor Gray
  Write-Host "  Porem NINGUEM entra por IP local, nem voce nesta casa." -ForegroundColor Gray
  $resp = Read-Host "  Ligar crossplay? (s/N)"
  $crossplay = if ($resp -match '^[sS]') { "true" } else { "false" }
  $crossArg  = if ($crossplay -eq "true") { "-crossplay" } else { "" }
  Ok "Crossplay: $crossplay"

  @"
# Gerado por setup.ps1 em $(Get-Date -Format 'yyyy-MM-dd HH:mm')
# Este arquivo tem SENHAS. Nao commite, nao compartilhe.

VALHEIM_SERVER_NAME=$nomeServidor
VALHEIM_WORLD_NAME=$Mundo
VALHEIM_SERVER_PASS=$senhaJogo
VALHEIM_PORT=2456
VALHEIM_PUBLIC=false
VALHEIM_CROSSPLAY=$crossplay
VALHEIM_CROSSPLAY_ARG=$crossArg
VALHEIM_SAVE_INTERVAL=600
VALHEIM_ADMIN_IDS=
TZ=America/Sao_Paulo

BACKUP_INTERVAL_HOURS=6
BACKUP_KEEP=14
BACKUP_MAX_AGE_DAYS=30

PANEL_PORT=9091
PANEL_USER=admin
PANEL_PASS=$senhaPainel
PANEL_SESSION_SECRET=$segredo
PANEL_SESSION_HOURS=12
VALHEIM_CONTAINER=valheim-server
"@ | Set-Content -Path ".env" -Encoding UTF8

  Ok ".env criado"
}

# ---------------------------------------------------------------------
Titulo "3/6  Criando as pastas"

$worldsDir = ".\data\config\worlds_local"
New-Item -ItemType Directory -Force -Path $worldsDir | Out-Null
New-Item -ItemType Directory -Force -Path ".\data\server" | Out-Null
New-Item -ItemType Directory -Force -Path ".\backups" | Out-Null
Ok "data\config\worlds_local, data\server e backups prontos"

# ---------------------------------------------------------------------
Titulo "4/6  Importando o mundo '$Mundo'"

$destino = Join-Path $worldsDir $Mundo

if (Test-Path $destino) {
  $n = (Get-ChildItem $destino -File | Measure-Object).Count
  Ok "Mundo ja esta no lugar ($n arquivos) — nao vou mexer"
} else {

  # Descobre a origem, se nao foi passada por parametro.
  if ([string]::IsNullOrWhiteSpace($MundoOrigem)) {
    $saveLocal = Join-Path $env:USERPROFILE "AppData\LocalLow\IronGate\Valheim\worlds_local\$Mundo"
    if (Test-Path $saveLocal) {
      $MundoOrigem = $saveLocal
      Ok "Achei o mundo no save local desta maquina"
    }
  }

  if ([string]::IsNullOrWhiteSpace($MundoOrigem) -or -not (Test-Path $MundoOrigem)) {
    Aviso "Mundo '$Mundo' nao encontrado nesta maquina."
    Write-Host ""
    Write-Host "  O save esta no OUTRO PC. Traga a pasta (pendrive/rede) e rode:" -ForegroundColor Yellow
    Write-Host "      .\setup.ps1 -MundoOrigem `"D:\caminho\$Mundo`"" -ForegroundColor White
    Write-Host "  ou, se for zip:" -ForegroundColor Yellow
    Write-Host "      .\setup.ps1 -MundoOrigem `"D:\caminho\$Mundo.zip`"" -ForegroundColor White
    Write-Host ""
    Write-Host "  NAO suba o servidor antes disso: ele criaria um mundo" -ForegroundColor Red
    Write-Host "  vazio com esse nome e a importacao viraria bagunca." -ForegroundColor Red
    exit 1
  }

  # Importa de .zip ou de pasta.
  if ($MundoOrigem -like "*.zip") {
    Write-Host "  Extraindo $MundoOrigem ..."
    $tmp = Join-Path $env:TEMP "vh-import-$(Get-Random)"
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    try {
      Expand-Archive -Path $MundoOrigem -DestinationPath $tmp -Force

      # O zip pode ter o mundo na raiz ou dentro de uma pasta. Procuramos
      # a pasta que realmente contem os arquivos do mundo.
      $cand = Get-ChildItem $tmp -Recurse -Directory |
              Where-Object { (Get-ChildItem $_.FullName -Filter "_main.*" -File).Count -gt 0 } |
              Select-Object -First 1

      if (-not $cand) {
        # Talvez os arquivos estejam soltos na raiz do zip.
        if ((Get-ChildItem $tmp -Filter "_main.*" -File).Count -gt 0) {
          $cand = Get-Item $tmp
        }
      }

      if (-not $cand) {
        Erro "Nao achei um mundo dentro do zip (nenhum arquivo _main.*)."
        exit 1
      }

      Copy-Item $cand.FullName $destino -Recurse
    } finally {
      Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
  } else {
    Write-Host "  Copiando de $MundoOrigem ..."
    Copy-Item $MundoOrigem $destino -Recurse
  }
  Ok "Mundo copiado"
}

# --- validacao do que foi importado ---
# Mundo sem os metadados _main.* nao abre. Melhor falhar aqui do que
# o servidor subir e criar um mundo vazio por cima.
$arquivos = Get-ChildItem $destino -File -ErrorAction SilentlyContinue
$meta     = $arquivos | Where-Object { $_.Name -like "_main.*" }
$chunks   = $arquivos | Where-Object { $_.Extension -eq ".chunk" }

Write-Host "  Conteudo: $($arquivos.Count) arquivos ($($chunks.Count) chunks, $($meta.Count) metadados)"

if ($meta.Count -eq 0) {
  Erro "Nenhum arquivo _main.* — este mundo nao vai abrir."
  Write-Host "  A copia veio incompleta. Traga a pasta $Mundo INTEIRA." -ForegroundColor Red
  exit 1
}
Ok "Metadados presentes ($($meta.Count) arquivos _main.*)"

# ---------------------------------------------------------------------
Titulo "5/6  Subindo os containers"

if ($SemSubir) {
  Aviso "Pulando (voce passou -SemSubir)"
} else {
  docker compose up -d
  if ($LASTEXITCODE -ne 0) {
    Erro "docker compose falhou. Veja a mensagem acima."
    exit 1
  }
  Ok "Containers no ar"
}

# ---------------------------------------------------------------------
Titulo "6/6  Pronto"

$porta = (Select-String -Path ".env" -Pattern '^PANEL_PORT=(.+)$').Matches.Groups[1].Value
if (-not $porta) { $porta = "9091" }

Write-Host ""
Write-Host "  Painel:  http://localhost:$porta" -ForegroundColor Green
Write-Host "  Usuario: admin"
Write-Host ""
Write-Host "  A PRIMEIRA subida baixa ~2 GB do Steam e demora." -ForegroundColor Yellow
Write-Host "  Acompanhe ate aparecer 'Game server connected':"
Write-Host "      docker compose logs -f valheim" -ForegroundColor White
Write-Host ""
Write-Host "  Depois que subir, TESTE O BACKUP uma vez pelo painel." -ForegroundColor Yellow
Write-Host "  Backup que nunca foi testado nao e backup."
Write-Host ""

# Firewall: so avisa, nao mexe sozinho (precisa de admin).
$regra = Get-NetFirewallRule -DisplayName "Valheim UDP" -ErrorAction SilentlyContinue
if (-not $regra) {
  Write-Host "  Pra galera conectar pela rede local, libere as portas UDP." -ForegroundColor Yellow
  Write-Host "  Num PowerShell COMO ADMINISTRADOR:" -ForegroundColor Yellow
  Write-Host '      New-NetFirewallRule -DisplayName "Valheim UDP" -Direction Inbound -Protocol UDP -LocalPort 2456-2457 -Action Allow' -ForegroundColor White
  Write-Host ""
}
