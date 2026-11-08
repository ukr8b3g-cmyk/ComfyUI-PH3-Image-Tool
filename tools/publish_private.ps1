# Optional user-run helper. Never invoked by the application.
[CmdletBinding()]
param([switch]$Publish)
$ErrorActionPreference = 'Stop'
if (-not $Publish) { throw 'No action taken. Review docs/PUBLISH.md, then use -Publish explicitly.' }
$Root = Split-Path -Parent $PSScriptRoot
$Target = 'ukr8b3g-cmyk/ComfyUI-PH3-Image-Tool'
if (-not (Test-Path (Join-Path $Root 'nodes.py'))) { throw 'Run from the unpacked source package.' }
if (Test-Path (Join-Path $Root '.git')) { throw 'Existing Git worktree detected. Inspect it manually; no automatic replacement.' }
foreach ($Tool in @('git','gh')) { if (-not (Get-Command $Tool -ErrorAction SilentlyContinue)) { throw "$Tool must already be installed; nothing was installed." } }
function Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed. Inspect the current state before retrying." }
}
$Login = & gh api user --jq .login
if ($LASTEXITCODE -ne 0 -or $Login.Trim() -ne 'ukr8b3g-cmyk') { throw 'Authenticate GitHub CLI as the intended repository owner first.' }
# A positive 404 is required. Network/auth/rate-limit failures must not be treated as an empty repository.
$Old = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$Probe = & gh api "repos/$Target" 2>&1
$ProbeExit = $LASTEXITCODE
$ErrorActionPreference = $Old
if ($ProbeExit -eq 0) { throw "$Target already exists; nothing was changed." }
if (($Probe | Out-String) -notmatch 'HTTP 404') { throw 'Could not verify repository absence; nothing was changed.' }
$Name = & git -C $Root config user.name
$Mail = & git -C $Root config user.email
if (-not $Name -or -not $Mail) { throw 'Set your own Git author name/email before publishing; the helper does not change global configuration.' }
$ParentWorktree = & git -C $Root rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -eq 0) { throw 'This folder is inside another Git worktree. Move it to an independent location.' }
Checked 'git' @('-C',$Root,'init','-b','main')
Checked 'git' @('-C',$Root,'add','--','.')
Checked 'git' @('-C',$Root,'commit','-m','feat: add PH3 Image Tool release candidate')
Checked 'gh' @('repo','create',$Target,'--private','--source',$Root,'--remote','origin','--push','--description','Local P-H3 single-image generation and layered editing for ComfyUI')
Write-Host "Private repository created and pushed: $Target. No Release or public publication was performed."
