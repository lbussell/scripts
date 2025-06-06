
$packages = @(
    # dev tools
    "Microsoft.DotNet.SDK.8"
    "Microsoft.DotNet.SDK.9"
    "Microsoft.DotNet.SDK.Preview"
    "Docker.DockerDesktop"

    # text editors
    "Microsoft.VisualStudioCode"
    "Microsoft.Edit"
    "Neovim.Neovim"

    "JesseDuffield.lazygit"
    "Starship.Starship"
)

foreach ($package in $packages) {
    Write-Host "Installing: $package"
    winget install `
        --accept-package-agreements `
        --accept-source-agreements `
        --disable-interactivity `
        --no-upgrade `
        --silent `
        --exact `
        $package
}
