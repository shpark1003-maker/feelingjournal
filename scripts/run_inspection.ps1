param(
    [string]$OutDir = "scratch/inspection"
)

$ErrorActionPreference = "Continue"

if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$summaryFile = Join-Path $OutDir "summary_$ts.txt"

function Write-Step {
    param([string]$Text)
    "$Text" | Tee-Object -FilePath $summaryFile -Append
}

function Run-Step {
    param(
        [string]$Name,
        [string]$Command,
        [string]$LogFile
    )

    Write-Step ""
    Write-Step "=== $Name ==="
    Write-Step "CMD: $Command"

    try {
        Invoke-Expression $Command *>&1 | Tee-Object -FilePath $LogFile
        if ($LASTEXITCODE -eq 0) {
            Write-Step "RESULT: PASS"
        } else {
            Write-Step "RESULT: FAIL (exit=$LASTEXITCODE)"
        }
    } catch {
        $_ | Out-String | Tee-Object -FilePath $LogFile -Append | Out-Null
        Write-Step "RESULT: ERROR ($($_.Exception.Message))"
    }
}

Write-Step "Inspection started: $(Get-Date -Format o)"
Write-Step "Output dir: $OutDir"

Run-Step -Name "System module contract diagnose" -Command "node test/system_diagnose.js" -LogFile (Join-Path $OutDir "system_diagnose_$ts.log")
Run-Step -Name "Briefing performance and cache" -Command "node test/briefing_performance.test.js" -LogFile (Join-Path $OutDir "briefing_performance_$ts.log")
Run-Step -Name "AI tasks pipeline" -Command "node test/ai_tasks.test.js" -LogFile (Join-Path $OutDir "ai_tasks_$ts.log")
Run-Step -Name "AI consent test" -Command "npm run test:consent" -LogFile (Join-Path $OutDir "ai_consent_$ts.log")

Run-Step -Name "Known regression guard: dayView symbol" -Command "Select-String -Path public/modules/calendar/dayView.js -Pattern 'getDayName|isEventOnDate|parseDateSafe'" -LogFile (Join-Path $OutDir "guard_dayview_$ts.log")
Run-Step -Name "Known regression guard: chat user id access" -Command "Select-String -Path public/modules/chat/chatUI.js -Pattern 'store.currentUser\?\.id \|\| store.user\?\.id|store\.user\.id'" -LogFile (Join-Path $OutDir "guard_chat_$ts.log")
Run-Step -Name "Known regression guard: briefing body render" -Command "Select-String -Path public/modules/persona.js -Pattern 'briefing-typing-body|innerHTML = htmlSafeContent'" -LogFile (Join-Path $OutDir "guard_briefing_render_$ts.log")

Write-Step ""
Write-Step "Inspection finished: $(Get-Date -Format o)"
Write-Step "Summary: $summaryFile"

Get-Content $summaryFile