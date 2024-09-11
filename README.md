# Scripts

These are my personal scripts that help save me time while I work.

## Setup

### PowerShell

```pwsh
Copy-Item PowerShell/Microsoft.PowerShell_Profile.ps1 $HOME/Documents/PowerShell/
```

Reference for [profile types and locations](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_profiles?view=powershell-7.4#profile-types-and-locations).

### Git

#### PowerShell

```pwsh
$gitconfig = [IO.Path]::Combine($($pwd.Path), '.gitconfig')
git config --local include.path $gitconfig
```

#### Bash

You got this!
