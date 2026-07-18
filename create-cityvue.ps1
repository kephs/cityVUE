# ==========================================
# Create-CityVUE.ps1
# Creates the CityVUE project structure
# ==========================================

$projectName = "CityVUE"

Write-Host "Creating project: $projectName..." -ForegroundColor Cyan

# Create project folder
New-Item -ItemType Directory -Path $projectName -Force | Out-Null

# Folder structure
$folders = @(
    "$projectName\assets",
    "$projectName\assets\css",
    "$projectName\assets\js",
    "$projectName\assets\images",
    "$projectName\assets\icons",
    "$projectName\pages"
)

foreach ($folder in $folders) {
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
}

# File structure
$files = @(
    "$projectName\assets\css\styles.css",
    "$projectName\assets\css\darkmode.css",

    "$projectName\assets\js\app.js",
    "$projectName\assets\js\storage.js",
    "$projectName\assets\js\ui.js",
    "$projectName\assets\js\dashboard.js",

    "$projectName\pages\about.html",
    "$projectName\pages\report.html",
    "$projectName\pages\issues.html",
    "$projectName\pages\contact.html",

    "$projectName\index.html",
    "$projectName\package.json",
    "$projectName\firebase.json",
    "$projectName\.firebaserc",
    "$projectName\README.md",
    "$projectName\.gitignore"
)

foreach ($file in $files) {
    New-Item -ItemType File -Path $file -Force | Out-Null
}

Write-Host ""
Write-Host "✅ CityVUE project created successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Project location:"
Write-Host (Resolve-Path $projectName)