# =====================================================================
#  Setup do servidor Valheim - PC com Docker Desktop (Windows)
#
#  ASCII puro, sem acentos e sem here-strings: as duas coisas ja
#  quebraram o parser do PowerShell 5 neste arquivo.
#
#  Uso:
#      .\setup.ps1
#      .\setup.ps1 -MundoOrigem "D:\ICELAND"
#      .\setup.ps1 -MundoOrigem "D:\ICELAND.zip"
#      .\setup.ps1 -MundoOrigem "D:\ICELAND.zip" -SemSubir
# =====================================================================

param(
  [string]$MundoOrigem = "",
  [string]$Mundo = "ICELAND",
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
  docker version --format "{{.Server.Version}}" | Out-Null
  Ok "Docker respondendo"
} catch {
  Erro "Docker nao esta rodando."
  Write-Host "  Abra o Docker Desktop, espere a baleia estabilizar, e rode de novo." -ForegroundColor Yellow
  exit 1
}

try {
  docker compose version | Out-Null
  Ok "docker compose disponivel"
} catch {
  Erro "docker compose nao encontrado. Atualize o Docker Desktop."
  exit 1
}

# ---------------------------------------------------------------------
Titulo "2/6  Configurando o .env"

if (Test-Path ".env") {
  Aviso ".env ja existe - mantendo. Apague o arquivo e rode de novo pra refazer."
}
else {
  $nomeServidor = Read-Host "  Nome do servidor [Da Galera]"
  if ([string]::IsNullOrWhiteSpace($nomeServidor)) {
    $nomeServidor = "Da Galera"
  }

  # Senha do jogo. Regra do Valheim: minimo 5 caracteres, e nao pode
  # conter o nome do servidor nem o nome do mundo. Validar aqui evita
  # o sintoma classico: servidor sobe, morre, e o log nao explica.
  $senhaJogo = ""
  $senhaOk = $false
  while (-not $senhaOk) {
    $sp = Read-Host "  Senha do JOGO - min 5 caracteres" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sp)
    $senhaJogo = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

    $problema = ""
    if ($senhaJogo.Length -lt 5) {
      $problema = "precisa de pelo menos 5 caracteres"
    }
    elseif ($senhaJogo.ToLower().Contains($Mundo.ToLower())) {
      $problema = "nao pode conter o nome do mundo"
    }
    else {
      foreach ($palavra in $nomeServidor.Split(" ")) {
        if ($palavra.Length -ge 3) {
          if ($senhaJogo.ToLower().Contains($palavra.ToLower())) {
            $problema = "nao pode conter parte do nome do servidor"
            break
          }
        }
      }
    }

    if ($problema -eq "") {
      $senhaOk = $true
    }
    else {
      Erro "Senha invalida: $problema"
    }
  }
  Ok "Senha do jogo aceita"

  # Senha do painel.
  $senhaPainel = ""
  $painelOk = $false
  while (-not $painelOk) {
    $pp = Read-Host "  Senha do PAINEL web - min 8 caracteres" -AsSecureString
    $bstr2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pp)
    $senhaPainel = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr2)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr2)

    if ($senhaPainel.Length -ge 8) {
      $painelOk = $true
    }
    else {
      Erro "Precisa de pelo menos 8 caracteres"
    }
  }
  Ok "Senha do painel aceita"

  # Segredo de sessao. RandomNumberGenerator, nao Get-Random:
  # este e criptografico, o outro nao.
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $segredo = ""
  foreach ($b in $bytes) {
    $segredo = $segredo + $b.ToString("x2")
  }
  Ok "Segredo de sessao gerado - 64 hex criptografico"

  # Crossplay.
  Write-Host ""
  Write-Host "  Crossplay usa relay da PlayFab: dispensa liberar porta no" -ForegroundColor Gray
  Write-Host "  roteador, resolve CGNAT, e deixa Xbox/Game Pass entrar." -ForegroundColor Gray
  Write-Host "  Porem NINGUEM entra por IP local, nem voce nesta casa." -ForegroundColor Gray
  $resp = Read-Host "  Ligar crossplay? (s/N)"
  if ($resp -match "^[sS]") {
    $crossplay = "true"
    $crossArg = "-crossplay"
  }
  else {
    $crossplay = "false"
    $crossArg = ""
  }
  Ok "Crossplay: $crossplay"

  $agora = Get-Date -Format "yyyy-MM-dd HH:mm"

  $linhas = @()
  $linhas += "# Gerado por setup.ps1 em $agora"
  $linhas += "# Este arquivo tem SENHAS. Nao commite, nao compartilhe."
  $linhas += ""
  $linhas += "VALHEIM_SERVER_NAME=$nomeServidor"
  $linhas += "VALHEIM_WORLD_NAME=$Mundo"
  $linhas += "VALHEIM_SERVER_PASS=$senhaJogo"
  $linhas += "VALHEIM_PORT=2456"
  $linhas += "VALHEIM_PUBLIC=false"
  $linhas += "VALHEIM_CROSSPLAY=$crossplay"
  $linhas += "VALHEIM_CROSSPLAY_ARG=$crossArg"
  $linhas += "VALHEIM_SAVE_INTERVAL=600"
  $linhas += "VALHEIM_ADMIN_IDS="
  $linhas += "TZ=America/Sao_Paulo"
  $linhas += ""
  $linhas += "BACKUP_INTERVAL_HOURS=6"
  $linhas += "BACKUP_KEEP=14"
  $linhas += "BACKUP_MAX_AGE_DAYS=30"
  $linhas += ""
  $linhas += "PANEL_PORT=9091"
  $linhas += "PANEL_USER=admin"
  $linhas += "PANEL_PASS=$senhaPainel"
  $linhas += "PANEL_SESSION_SECRET=$segredo"
  $linhas += "PANEL_SESSION_HOURS=12"
  $linhas += "VALHEIM_CONTAINER=valheim-server"

  Set-Content -Path ".env" -Value $linhas -Encoding UTF8
  Ok ".env criado"
}

# ---------------------------------------------------------------------
Titulo "3/6  Criando as pastas"

$worldsDir = ".\data\config\worlds_local"
New-Item -ItemType Directory -Force -Path $worldsDir | Out-Null
New-Item -ItemType Directory -Force -Path ".\data\server" | Out-Null
New-Item -ItemType Directory -Force -Path ".\backups" | Out-Null
Ok "Pastas data e backups prontas"

# ---------------------------------------------------------------------
Titulo "4/6  Importando o mundo $Mundo"

$destino = Join-Path $worldsDir $Mundo

if (Test-Path $destino) {
  $n = (Get-ChildItem $destino -File | Measure-Object).Count
  Ok "Mundo ja esta no lugar - $n arquivos - nao vou mexer"
}
else {
  if ([string]::IsNullOrWhiteSpace($MundoOrigem)) {
    $saveLocal = Join-Path $env:USERPROFILE "AppData\LocalLow\IronGate\Valheim\worlds_local\$Mundo"
    if (Test-Path $saveLocal) {
      $MundoOrigem = $saveLocal
      Ok "Achei o mundo no save local desta maquina"
    }
  }

  if ([string]::IsNullOrWhiteSpace($MundoOrigem) -or -not (Test-Path $MundoOrigem)) {
    Aviso "Mundo $Mundo nao encontrado nesta maquina."
    Write-Host ""
    Write-Host "  Traga a pasta do save e rode indicando o caminho:" -ForegroundColor Yellow
    Write-Host "      .\setup.ps1 -MundoOrigem D:\caminho\$Mundo" -ForegroundColor White
    Write-Host "      .\setup.ps1 -MundoOrigem D:\caminho\$Mundo.zip" -ForegroundColor White
    Write-Host ""
    Write-Host "  NAO suba o servidor antes disso: ele criaria um mundo vazio" -ForegroundColor Red
    Write-Host "  com esse nome e a importacao viraria bagunca." -ForegroundColor Red
    exit 1
  }

  if ($MundoOrigem.ToLower().EndsWith(".zip")) {
    Write-Host "  Extraindo $MundoOrigem"
    $tmp = Join-Path $env:TEMP ("vh-import-" + (Get-Random))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    try {
      Expand-Archive -Path $MundoOrigem -DestinationPath $tmp -Force

      # O zip pode ter o mundo na raiz ou aninhado. Procuramos a pasta
      # que realmente contem os metadados _main.
      $cand = $null
      $dirs = Get-ChildItem $tmp -Recurse -Directory
      foreach ($d in $dirs) {
        $temMeta = (Get-ChildItem $d.FullName -Filter "_main.*" -File -ErrorAction SilentlyContinue | Measure-Object).Count
        if ($temMeta -gt 0) {
          $cand = $d
          break
        }
      }

      if ($cand -eq $null) {
        $temMetaRaiz = (Get-ChildItem $tmp -Filter "_main.*" -File -ErrorAction SilentlyContinue | Measure-Object).Count
        if ($temMetaRaiz -gt 0) {
          $cand = Get-Item $tmp
        }
      }

      if ($cand -eq $null) {
        Erro "Nao achei um mundo dentro do zip - nenhum arquivo _main"
        exit 1
      }

      Copy-Item $cand.FullName $destino -Recurse
    }
    finally {
      Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  else {
    Write-Host "  Copiando de $MundoOrigem"
    Copy-Item $MundoOrigem $destino -Recurse
  }
  Ok "Mundo copiado"
}

# Validacao: mundo sem os metadados _main nao abre. Melhor falhar aqui
# do que o servidor subir e criar um mundo vazio por cima.
$arquivos = Get-ChildItem $destino -File -ErrorAction SilentlyContinue
$nArq = ($arquivos | Measure-Object).Count
$nChunk = ($arquivos | Where-Object { $_.Extension -eq ".chunk" } | Measure-Object).Count
$nMeta = ($arquivos | Where-Object { $_.Name -like "_main.*" } | Measure-Object).Count

Write-Host "  Conteudo: $nArq arquivos - $nChunk chunks - $nMeta metadados"

if ($nMeta -eq 0) {
  Erro "Nenhum arquivo _main - este mundo nao vai abrir"
  Write-Host "  A copia veio incompleta. Traga a pasta $Mundo inteira." -ForegroundColor Red
  exit 1
}
Ok "Metadados presentes"

# ---------------------------------------------------------------------
Titulo "5/6  Subindo os containers"

if ($SemSubir) {
  Aviso "Pulando - voce passou -SemSubir"
}
else {
  docker compose up -d
  if ($LASTEXITCODE -ne 0) {
    Erro "docker compose falhou. Veja a mensagem acima."
    exit 1
  }
  Ok "Containers no ar"
}

# ---------------------------------------------------------------------
Titulo "6/6  Pronto"

$porta = "9091"
$linhaPorta = Select-String -Path ".env" -Pattern "^PANEL_PORT=" -ErrorAction SilentlyContinue
if ($linhaPorta -ne $null) {
  $porta = $linhaPorta.Line.Split("=")[1].Trim()
}

Write-Host ""
Write-Host "  Painel:  http://localhost:$porta" -ForegroundColor Green
Write-Host "  Usuario: admin"
Write-Host ""
Write-Host "  A PRIMEIRA subida baixa cerca de 2 GB do Steam e demora." -ForegroundColor Yellow
Write-Host "  Acompanhe ate aparecer Game server connected:"
Write-Host "      docker compose logs -f valheim" -ForegroundColor White
Write-Host ""
Write-Host "  Depois que subir, TESTE O BACKUP uma vez pelo painel." -ForegroundColor Yellow
Write-Host "  Backup que nunca foi testado nao e backup."
Write-Host ""

$regra = Get-NetFirewallRule -DisplayName "Valheim UDP" -ErrorAction SilentlyContinue
if ($regra -eq $null) {
  Write-Host "  Pra conectar pela rede local, libere as portas UDP 2456-2457." -ForegroundColor Yellow
  Write-Host "  Num PowerShell COMO ADMINISTRADOR, rode o comando do README." -ForegroundColor Yellow
  Write-Host ""
}
