param ([int]$sleepDuration = 5)

$month = (get-date).Month

$windowsTags = @("nanoserver:1809-amd64", "nanoserver:ltsc2022-amd64", "servercore:ltsc2022-amd64", "servercore:ltsc2019-amd64", "servercore:ltsc2016-amd64")

try {
    Write-Host "Checking if Dredge is installed."
    dredge --version
} catch {
    Write-Host "Dredge didn't work, installing Dredge..."
    dotnet tool install -g Valleysoft.Dredge
}

while ($true) {
    $allMatch = $true
    $windowsTags | ForEach-Object {
        $created = $(dredge image inspect mcr.microsoft.com/windows/$_ | ConvertFrom-Json).created
        if ($created.Month -ne $month) {
            $allMatch = $false
        }
        Write-Host $_
        Write-Host $created
    }
    if ($allMatch) {
        Write-Host "foo"
        curl `
            -H "Title: Windows Base Images Updated" `
            -H "Tags: warning" `
            -d "Please queue Windows container rebuilds now." `
        exit 0
    }
    Start-Sleep -Seconds $sleepDuration
    Write-Host
}
