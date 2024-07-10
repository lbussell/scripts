function Copy-DotnetRepo {

    <#
        .SYNOPSIS
            Clones a dotnet repository and sets up the remotes

        .EXAMPLE
            Copy-DotnetRepo -repoName "runtime"
            Clone runtime repo
    #>

    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string]
        # The name of the repository to clone
        $repoName,

        [string]
        # The URL of the upstream remote
        $upstream = "https://github.com/dotnet/$repoName",

        [string]
        # The URL of the dnceng remote
        $dnceng = "https://dnceng@dev.azure.com/dnceng/internal/_git/dotnet-$repoName",

        [string]
        # The name of the user to rename the origin remote to
        $me = "lbussell"
    )

    $url = "https://github.com/$me/$repoName"

    # Clone the repository
    git clone $url

    # Change to the repository directory
    Set-Location $repoName

    # Add the additional remotes
    git remote add upstream $upstream
    git remote add dnceng $dnceng

    git fetch upstream
    git fetch dnceng
}

function New-FeatureBranch {

    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [Alias('b')]
        [string]$branchName,

        [Alias('u')]
        [string]$upstreamBranch = "main",

        [Alias('s')]
        [string]$sourceRemote = "upstream"
    )

    # Fetch the latest changes from the upstream remote
    git fetch ${sourceRemote}

    # Create a new branch based on the specified upstream branch
    # Also make sure we don't track the upstream branch so we don't accidentally push to it
    git checkout ${sourceRemote}/${upstreamBranch}
    git checkout -b ${branchName}
}

function Open-DistrolessImage {

    [CmdletBinding()]
    param (
        [Parameter(Position=0, Mandatory = $true)]
        [string]$distrolessImageTag
    )

    $dockerfile = Join-Path $PSScriptRoot "Dockerfile.inspect-distroless"
    $imageName = "inspect"

    docker build -t inspect -f $dockerfile --build-arg DISTROLESS_IMAGE=$distrolessImageTag .
    docker run -it --rm inspect
}
