# Scripts

These are my personal scripts that help save me time while I work.

## Setup

### Windows

```pwsh
irm https://raw.githubusercontent.com/lbussell/scripts/refs/heads/main/Initialize-NewMachine.ps1 | iex
```

If this is the first time running a remote script, you might need to run this first:

```pwsh
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### PowerShell Profile

Get the command ready. This will put the correct command in your clipboard.

```pwsh
mkdir $(Split-Path -parent $PROFILE.CurrentUserAllHosts)

Set-Clipboard $('New-Item -Path ' + [IO.Path]::Combine($($pwd.Path), 'PowerShell', 'profile.ps1') + ' -Value ' + $PROFILE.CurrentUserAllHosts + ' -ItemType "SymbolicLink" -Force')
```

Then, paste it into an Administrator PowerShell session (you need admin privileges to create symlinks on Windows).

```pwsh
mkdir $HOME/Documents/PowerShell/
Copy-Item PowerShell/Microsoft.PowerShell_Profile.ps1 $HOME/Documents/PowerShell/
```

Reference for [profile types and locations](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_profiles?view=powershell-7.4#profile-types-and-locations).

### Bash Profile

```bash
echo "source $(pwd)/bash/.bashrc" >> $HOME/.bashrc
echo "source $(pwd)/bash/.bash_profile" >> $HOME/.bash_profile
```

### Git Config

**PowerShell**:

```pwsh
$gitconfig = [IO.Path]::Combine($($pwd.Path), '.gitconfig')
git config --local include.path $gitconfig
```

**Bash**:

```bash
git config --global include.path $(pwd)/.gitconfig
```
