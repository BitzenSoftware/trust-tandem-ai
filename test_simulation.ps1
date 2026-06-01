# Trust & Tandem AI - Simulacao com 1000 registros
# ~920 validos, ~80 com erros para revisao humana
# Execute: .\test_simulation.ps1

$API     = "https://trust-tandem-ai.onrender.com/api/v1"
$API_KEY = "ttai_mcPXNWnfx81k80KPVDcpFkTH27Vu6oqUfnMKc04LnKQ"
$HEADERS = @{ "X-API-Key" = $API_KEY; "Content-Type" = "application/json" }

# --- Dados base ---
$nomes = @(
    "Ana Silva","Carlos Oliveira","Maria Santos","Joao Pereira","Fernanda Lima",
    "Lucas Souza","Beatriz Costa","Rafael Alves","Juliana Ferreira","Pedro Rodrigues",
    "Camila Martins","Thiago Barbosa","Larissa Gomes","Bruno Carvalho","Patricia Ribeiro",
    "Marcos Araujo","Amanda Rocha","Felipe Melo","Isabela Nunes","Diego Mendes",
    "Leticia Castro","Rodrigo Dias","Vanessa Moura","Gustavo Freitas","Aline Cardoso",
    "Leonardo Pinto","Gabriela Ramos","Eduardo Lopes","Monica Vieira","Alexandre Cruz",
    "Renata Teixeira","Fabio Monteiro","Claudia Nascimento","Vitor Azevedo","Simone Cunha",
    "Andre Correia","Flavia Cavalcante","Henrique Peixoto","Tatiana Moreira","Roberto Campos",
    "Priscila Rezende","Danilo Aguiar","Natalia Farias","Leandro Borges","Viviane Macedo",
    "Mauricio Guimaraes","Raquel Andrade","Sergio Queiroz","Alessandra Figueiredo","Paulo Duarte",
    "Elaine Brito","Marcelo Coelho","Cristiane Tavares","Jonatas Sampaio","Rosana Vianna",
    "Caio Lacerda","Denise Braga","Walmir Saraiva","Sueli Marques","Gilberto Vasconcelos",
    "Sonia Bastos","Nelson Coutinho","Ivone Leal","Claudio Fontes","Vera Pacheco",
    "Arnaldo Medeiros","Teresinha Amaral","Osvaldo Maciel","Neusa Teles","Benedito Rego",
    "Marlene Pires","Edson Leao","Luzia Fonseca","Ademir Batista","Conceicao Sales",
    "Geraldo Caldas","Neuza Marinho","Raimundo Alencar","Darci Monteiro","Odete Barros",
    "Wanderley Couto","Geralda Prado","Valdemar Esteves","Aparecida Nogueira","Manoel Assis",
    "Joselita Paiva","Eunice Santana","Odinei Machado","Cleonice Xavier","Josefa Abreu",
    "Iraides Castro","Hilda Bispo","Alcides Pinheiro","Anesia Lemos","Djanira Mota",
    "Alzira Neto","Elza Luz","Orlandina Bravo","Divina Prado","Orlanda Cerqueira"
)

$dominios = @("gmail.com","hotmail.com","outlook.com","yahoo.com.br","terra.com.br","uol.com.br","bol.com.br")
$bases_legais = @("consentimento","obrigacao_legal","interesse_legitimo","contrato","consentimento","consentimento")

function New-CPF {
    $a = Get-Random -Min 100 -Max 999
    $b = Get-Random -Min 100 -Max 999
    $c = Get-Random -Min 100 -Max 999
    $d = Get-Random -Min 10  -Max 99
    return "$a.$b.$c-$d"
}

function Name-To-Email($nome, $dominio) {
    $parts = $nome.ToLower() -replace "[^a-z ]", "" -split " "
    if ($parts.Count -ge 2) {
        return "$($parts[0]).$($parts[-1])@$dominio"
    }
    return "$($parts[0])@$dominio"
}

# --- Gerar 1000 registros ---
$records = @()
$erros_inseridos = @()

for ($i = 0; $i -lt 1000; $i++) {
    $nome   = $nomes[$i % $nomes.Count] + " " + (Get-Random -Min 1 -Max 999)
    $dominio = $dominios[$i % $dominios.Count]
    $email  = Name-To-Email $nome $dominio
    $cpf    = New-CPF
    $bl     = $bases_legais[$i % $bases_legais.Count]

    # Introduzir erros em ~80 registros (indices especificos para facilitar revisao)
    $tipo_erro = ""
    if ($i % 13 -eq 0) {
        # Email sem @ (dominio errado)
        $email = ($email -replace "@", ".")
        $tipo_erro = "email_sem_arroba"
    } elseif ($i % 17 -eq 0) {
        # CPF com letras
        $cpf = $cpf -replace "\d{3}$", "ABC"
        $tipo_erro = "cpf_invalido"
    } elseif ($i % 23 -eq 0) {
        # Email incompleto
        $email = $email.Split("@")[0]
        $tipo_erro = "email_incompleto"
    }

    $rec = @{
        name        = $nome
        email       = $email
        cpf         = $cpf
        legal_basis = $bl
    }

    if ($tipo_erro -ne "") {
        $erros_inseridos += [PSCustomObject]@{ index = $i; nome = $nome; erro = $tipo_erro }
    }

    $records += $rec
}

Write-Host ""
Write-Host "Simulacao: $($records.Count) registros gerados" -ForegroundColor Cyan
Write-Host "  Erros introduzidos: $($erros_inseridos.Count)" -ForegroundColor Yellow
Write-Host "  Validos esperados : $($records.Count - $erros_inseridos.Count)" -ForegroundColor Green
Write-Host ""

# --- Enviar em lotes de 100 ---
$batch_size = 100
$total_limpo = 0
$total_fila  = 0
$batch_num   = 0

for ($i = 0; $i -lt $records.Count; $i += $batch_size) {
    $batch_num++
    $batch = $records[$i..([Math]::Min($i + $batch_size - 1, $records.Count - 1))]
    $body  = $batch | ConvertTo-Json -Depth 3 -Compress

    Write-Host "Lote $batch_num/$([ Math]::Ceiling($records.Count / $batch_size)) ($($batch.Count) registros)..." -ForegroundColor Gray

    try {
        $r = Invoke-RestMethod -Uri "$API/ingest" -Method Post -Headers $HEADERS -Body $body -TimeoutSec 60
        $total_limpo += $r.registros_banco_limpo
        $total_fila  += $r.registros_fila_revisao
        Write-Host "  banco=$($r.registros_banco_limpo) | fila=$($r.registros_fila_revisao)" -ForegroundColor Gray
    } catch {
        Write-Host "  ERRO no lote $batch_num : $_" -ForegroundColor Red
    }

    # Pequena pausa entre lotes para nao estourar rate limit
    if ($batch_num % 5 -eq 0) { Start-Sleep -Seconds 5 }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "RESULTADO FINAL" -ForegroundColor Cyan
Write-Host "  Total ingerido : $($records.Count)" -ForegroundColor White
Write-Host "  Banco limpo    : $total_limpo" -ForegroundColor Green
Write-Host "  Fila de revisao: $total_fila" -ForegroundColor Yellow
Write-Host "  Conformidade   : $([Math]::Round($total_limpo / $records.Count * 100, 1))%" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Acesse o dashboard para revisar os registros na fila:" -ForegroundColor White
Write-Host "https://trust-tandem-ai.vercel.app" -ForegroundColor Blue
Write-Host ""
