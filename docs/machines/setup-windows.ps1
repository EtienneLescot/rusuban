# Prepares a Windows machine for Rusuban's agents (docs/machines/README.md):
# - the OpenSSH server, started now and at boot, port 22 open;
# - the `rusuban` account: a standard user, not an administrator, with a random password nobody
#   keeps, so only the key given gets in;
# - the workspace ~\rusuban, and Git for Windows for every user.
# Run it in PowerShell as administrator on the machine, with the public key of the host where
# Rusuban runs:
#   .\setup-windows.ps1 -Key "ssh-ed25519 AAAA... you@host"
# Running it again changes nothing that is already in place.
param([Parameter(Mandatory = $true)][string]$Key)
$ErrorActionPreference = "Stop"
$name = "rusuban"

if ($Key -notmatch '^(ssh-|ecdsa-|sk-)') { throw "not a public key line: $Key" }
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
	throw "run it in PowerShell as administrator"
}

# Git for every user, so that the agent account finds it on its PATH.
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
	if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
		throw "install Git for Windows for all users, then run this again"
	}
	winget install --id Git.Git --exact --scope machine --silent `
		--accept-source-agreements --accept-package-agreements
}

# The OpenSSH server.
$server = Get-WindowsCapability -Online -Name "OpenSSH.Server*"
if ($server.State -ne "Installed") { Add-WindowsCapability -Online -Name $server.Name | Out-Null }
Set-Service -Name sshd -StartupType Automatic
Start-Service -Name sshd
if (-not (Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue)) {
	New-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -DisplayName "OpenSSH Server (sshd)" `
		-Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
}

# The account. Its profile folder only exists once it has logged on: one hidden process as the
# account makes it, so that the key goes where sshd reads it.
$user = Get-LocalUser -Name $name -ErrorAction SilentlyContinue
if (-not $user) {
	$bytes = New-Object byte[] 24
	[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
	$password = ConvertTo-SecureString ("Aa1!" + [Convert]::ToBase64String($bytes)) -AsPlainText -Force
	$user = New-LocalUser -Name $name -Password $password -FullName "Rusuban agents" `
		-Description "Rusuban's agents work as this account" -PasswordNeverExpires
	Add-LocalGroupMember -SID "S-1-5-32-545" -Member $name # Users
	$credential = New-Object Management.Automation.PSCredential($name, $password)
	Start-Process -FilePath "cmd.exe" -ArgumentList "/c exit" -Credential $credential `
		-WorkingDirectory $env:SystemRoot -LoadUserProfile -WindowStyle Hidden -Wait
}
$profileDir = (Get-CimInstance Win32_UserProfile | Where-Object { $_.SID -eq $user.SID.Value }).LocalPath
if (-not $profileDir) { throw "the profile of $name was not created: log on as $name once, then again" }

$ssh = Join-Path $profileDir ".ssh"
$auth = Join-Path $ssh "authorized_keys"
New-Item -ItemType Directory -Force -Path $ssh, (Join-Path $profileDir "rusuban") | Out-Null
if (-not (Test-Path -LiteralPath $auth) -or -not (Select-String -LiteralPath $auth -SimpleMatch $Key -Quiet)) {
	Add-Content -LiteralPath $auth -Value $Key -Encoding ascii
}
# sshd ignores a key file others can write: the account, SYSTEM and the administrators only.
icacls $auth /inheritance:r /grant "${name}:F" /grant "*S-1-5-18:F" /grant "*S-1-5-32-544:F" | Out-Null

Write-Output "Ready. On the Rusuban host: ssh -l $name <alias> exit (once, to accept its host key),"
Write-Output "then rusuban machine add <alias> --os windows."
