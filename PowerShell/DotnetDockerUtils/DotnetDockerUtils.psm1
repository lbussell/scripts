$ErrorActionPreference = 'Stop'

function Update-ImageSizes {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [Alias('p')]
        [string]
        $baselinePath,

        # [Alias('b')]
        # [string]
        # $buildId,

        [string]
        $os,

        [string]
        $path,

        [switch]
        $force = $false,

        [switch]
        $dryRun = $false
    )

    $isWindoze = $baselinePath.Contains('windows')

    if ($isWindoze) {
        Write-Host "Doing special things for Windows"
    }

    # $baseUrl = "dotnetdocker.azurecr.io/build-staging/${buildId}/dotnet/nightly/"
    $baseUrl = "mcr.microsoft.com/dotnet/nightly/"

    # If buildId is not set, set baseUrl to mcrBaseUrl

    $baseline = Get-Content $baselinePath | ConvertFrom-Json

    ForEach ($object in $baseline.PsObject.Properties) {
        $repo = $object.Name

        $object.Value.PSObject.Properties | ForEach-Object {
            $name = $_.Name
            $parts = $name.Split('/')

            $product = $parts[1]
            $version = $parts[2]
            $osPart = $parts[3]
            $arch = $parts[4]

            # if os is set, and doesn't match the one we're looking for, skip
            if ($os -and $os -ne $osPart) {
                return
            }

            if ($path -and $name -inotlike ${path}) {
                return
            }

            if ($product -eq "monitor-base") {
                $product = "monitor/base"
            }

            if ($isWindoze) {
                $imageUrl = "${baseUrl}${product}:${version}-${osPart}"
            } else {
                $imageUrl = "${baseUrl}${product}:${version}-${osPart}-${arch}"
            }

            Write-Host "${name} => ${imageUrl}"

            $size = [long](Get-ImageSize -image $imageUrl)
            $oldSize = [long]$baseline.$repo.$name
            Write-Host "$oldSize => $size"

            $low = $oldSize * [double]0.95
            $hi = $oldSize * [double]1.05
            Write-Host "Acceptable Range: $low - $hi"
            # only update baseline if the size has changed >20% up or down or if $force is set
            if ($size -gt $hi -or $size -lt $low -or $force) {
                Write-Host "Updating baseline for $name from $oldSize to $size"
                $baseline.$repo.$name = $size
            }
            Write-Host

            if (!$dryRun) {
                $baseline | ConvertTo-Json | Out-File $baselinePath
            }
        }
    }

    if (!$dryRun) {
        $baseline | ConvertTo-Json | Out-File $baselinePath
    }
}

function Get-ImageSize {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]
        $image
    )

    # Pull the Docker image
    $output = & docker pull $image 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to pull Docker image '$image'. Output: `n $output"
    }

    # Get the size of the Docker image
    if ($clean) {
        $size = docker images $image --format "{{.Size}}"
    } else {
        $size = docker image inspect $image --format "{{.Size}}"
    }

    # Get the size of the Docker image
    Write-Output $size.Trim('"')
}

function Connect-Acr {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]
        $registryName
    )

    az login
    az acr login -n ${registryName}
}
