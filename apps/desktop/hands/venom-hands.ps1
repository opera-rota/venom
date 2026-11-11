Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$QuoteMarks = '[' + (-join ([char[]](0x22, 0x27, 0x2018, 0x2019, 0x201C, 0x201D))) + ']'

$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Drawing

Add-Type -Path (Join-Path $PSScriptRoot 'VenomNative.cs') -ReferencedAssemblies System.Drawing

$Automation = [System.Windows.Automation.AutomationElement]
$TreeScope = [System.Windows.Automation.TreeScope]
$ControlType = [System.Windows.Automation.ControlType]

$WorkRoot = Join-Path $env:LOCALAPPDATA 'VENOM\work'
$PowerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$OutputLimit = 16000
$StreamLimit = 200000
$PictureWidth = 1280
$PictureLimit = 1900000
$MarkLimit = 60
$TypeLimit = 2000

$Apps = [ordered]@{
    notepad  = @{ Title = 'Notepad'; Words = @('notepad'); Processes = @('notepad'); Classes = @() }
    explorer = @{ Title = 'File Explorer'; Words = @('file explorer', 'explorer', 'files', 'windows explorer', 'folder'); Processes = @('explorer'); Classes = @('CabinetWClass') }
    chrome   = @{ Title = 'Chrome'; Words = @('chrome', 'google chrome', 'browser'); Processes = @('chrome'); Classes = @('Chrome_WidgetWin_1') }
}

$KnownFolders = @{
    'desktop'   = 'shell:Desktop'
    'documents' = 'shell:Personal'
    'downloads' = 'shell:Downloads'
    'pictures'  = 'shell:My Pictures'
    'music'     = 'shell:My Music'
    'videos'    = 'shell:My Video'
}

function Send-Line([hashtable]$Message) {
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $Message -Compress -Depth 8))
    [Console]::Out.Flush()
}

function Get-Arg($Request, [string]$Name) {
    $property = $Request.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function New-Result([bool]$Ok, [string]$Detail, [hashtable]$Data = @{}) {
    return @{ Ok = $Ok; Detail = $Detail; Data = $Data }
}

function Get-ChromePath {
    foreach ($key in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe')) {
        $item = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
        if ($null -ne $item) {
            $path = [string]$item.'(default)'
            if ($path -and (Test-Path -LiteralPath $path)) { return $path }
        }
    }
    return $null
}

function Get-Python {
    foreach ($name in @('python', 'py')) {
        $found = @(Get-Command $name -CommandType Application -All -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike '*\WindowsApps\*' })
        if ($found.Length -gt 0) {
            $prefix = @()
            if ($name -eq 'py') { $prefix = @('-3') }
            return @{ Path = $found[0].Source; Prefix = $prefix }
        }
    }
    return $null
}

$ChromePath = Get-ChromePath
$Python = Get-Python

function Get-TopWindows {
    $names = @{}
    foreach ($process in Get-Process) { $names[$process.Id] = $process.ProcessName.ToLowerInvariant() }
    $children = $Automation::RootElement.FindAll($TreeScope::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($element in $children) {
        try {
            $current = $element.Current
            [pscustomobject]@{
                Handle  = [long]$current.NativeWindowHandle
                Process = $names[$current.ProcessId]
                Name    = [string]$current.Name
                Class   = [string]$current.ClassName
                Element = $element
            }
        }
        catch { }
    }
}

$ShellClasses = @('Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW', 'tooltips_class32', 'NotifyIconOverflowWindow')

function Test-AppWindow($App, $Window) {
    if ($ShellClasses -contains $Window.Class) { return $false }
    if ($App.Processes.Length -gt 0 -and $App.Processes -notcontains $Window.Process) { return $false }
    if ($App.Classes.Length -gt 0 -and $App.Classes -notcontains $Window.Class) { return $false }
    return $Window.Handle -ne 0
}

function ConvertTo-Plain([string]$Text) {
    return (($Text.ToLowerInvariant() -replace $QuoteMarks, '' -replace '[^\p{L}\p{N}]+', ' ').Trim())
}

$script:StartApps = $null

function Get-StartApps([bool]$Fresh) {
    if ($Fresh -or $null -eq $script:StartApps) {
        $shell = New-Object -ComObject Shell.Application
        $list = New-Object System.Collections.ArrayList
        foreach ($item in $shell.NameSpace('shell:AppsFolder').Items()) {
            $name = [string]$item.Name
            $id = [string]$item.Path
            if ($name.Trim().Length -gt 0 -and $id.Trim().Length -gt 0) {
                [void]$list.Add([pscustomobject]@{ Name = $name.Trim(); Id = $id; Plain = (ConvertTo-Plain $name) })
            }
        }
        $script:StartApps = $list.ToArray()
    }
    return $script:StartApps
}

function Find-StartApp([string]$Wanted, [bool]$Fresh) {
    $all = @(Get-StartApps $Fresh)
    $exact = @($all | Where-Object { $_.Plain -eq $Wanted })
    if ($exact.Length -gt 0) { return $exact[0] }
    $words = @($Wanted -split ' ' | Where-Object { $_ })
    $partial = @($all | Where-Object {
            $nameWords = @($_.Plain -split ' ')
            @($words | Where-Object { $nameWords -notcontains $_ }).Length -eq 0
        })
    return $partial
}

function Resolve-App([string]$Name) {
    $wanted = ConvertTo-Plain ($Name -replace '^\s*the\s+', '' -replace '\s+app\s*$', '')
    if ($wanted.Length -eq 0) { return @{ Problem = 'I was not told which app to open.' } }
    foreach ($key in $Apps.Keys) {
        if ($key -eq 'chrome' -and $null -eq $ChromePath) { continue }
        if ($Apps[$key].Words -contains $wanted) { return @{ Key = $key; App = $Apps[$key]; Id = $null } }
    }
    $found = @(Find-StartApp $wanted $false)
    if ($found.Length -eq 0) { $found = @(Find-StartApp $wanted $true) }
    if ($found.Length -eq 1) {
        $app = @{ Title = $found[0].Name; Words = @(); Processes = @(); Classes = @() }
        return @{ Key = 'start'; App = $app; Id = $found[0].Id }
    }
    if ($found.Length -gt 1) {
        $names = @($found | Select-Object -First 4 | ForEach-Object { $_.Name }) -join ', '
        return @{ Problem = "More than one app matches '$Name' ($names), so I opened nothing." }
    }
    return @{ Problem = "I could not find an app called '$Name' on this computer." }
}

function Resolve-Folder([string]$Open) {
    $wanted = ($Open.ToLowerInvariant() -replace '^\s*(my|the)\s+', '' -replace '\s+folder\s*$', '').Trim()
    if ($KnownFolders.ContainsKey($wanted)) {
        $shell = New-Object -ComObject Shell.Application
        return $shell.NameSpace($KnownFolders[$wanted]).Self.Path
    }
    $expanded = [Environment]::ExpandEnvironmentVariables($Open)
    if ([IO.Path]::IsPathRooted($expanded) -and (Test-Path -LiteralPath $expanded -PathType Container)) { return $expanded }
    return $null
}

function Resolve-WebAddress([string]$Open) {
    $expanded = [Environment]::ExpandEnvironmentVariables($Open.Trim())
    if ([IO.Path]::IsPathRooted($expanded) -and (Test-Path -LiteralPath $expanded -PathType Leaf)) { return ([Uri]$expanded).AbsoluteUri }
    if ($expanded -match '^https?://[^\s]+$') { return $expanded }
    if ($expanded -match '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(/[^\s]*)?$') { return "https://$expanded" }
    return $null
}

function Quote([string]$Value) {
    return '"' + $Value + '"'
}

function Wait-AppWindow($App, [hashtable]$Before, [long]$FrontBefore, [int]$TimeoutMs) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.ElapsedMilliseconds -lt $TimeoutMs) {
        $windows = @(Get-TopWindows | Where-Object { Test-AppWindow $App $_ })
        $fresh = @($windows | Where-Object { -not $Before.ContainsKey($_.Handle) })
        if ($fresh.Length -gt 0) { return @{ Window = $fresh[0]; Reused = $false } }
        if ($clock.ElapsedMilliseconds -gt 2500) {
            $front = [Venom.Hands]::Foreground()
            $reused = @($windows | Where-Object { $_.Handle -eq $front -and ($_.Handle -ne $FrontBefore -or $Before[$_.Handle] -ne $_.Name) })
            if ($reused.Length -gt 0) { return @{ Window = $reused[0]; Reused = $true } }
        }
        Start-Sleep -Milliseconds 200
    }
    return $null
}

function Wait-Ready($Window, [int]$TimeoutMs) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.ElapsedMilliseconds -lt $TimeoutMs) {
        try {
            $current = $Window.Element.Current
            if ($current.IsEnabled -and -not $current.IsOffscreen -and $current.Name.Trim().Length -gt 0) { return [string]$current.Name }
        }
        catch { }
        Start-Sleep -Milliseconds 150
    }
    return $null
}

function Invoke-OpenApp($Request) {
    $requested = [string](Get-Arg $Request 'app')
    $open = Get-Arg $Request 'open'
    $resolved = Resolve-App $requested
    if ($resolved.ContainsKey('Problem')) { return New-Result $false $resolved.Problem }
    $key = $resolved.Key
    $app = $resolved.App
    $arguments = $null
    $timeout = 20000
    switch ($key) {
        'notepad' {
            $file = 'notepad.exe'
            if ($null -ne $open) {
                $path = [Environment]::ExpandEnvironmentVariables([string]$open)
                if (-not [IO.Path]::IsPathRooted($path)) { return New-Result $false "Notepad needs a full file path, and '$open' is not one." }
                $arguments = Quote $path
            }
        }
        'explorer' {
            $file = 'explorer.exe'
            if ($null -ne $open) {
                $folder = Resolve-Folder ([string]$open)
                if ($null -eq $folder) { return New-Result $false "I could not find the folder '$open'." }
                $arguments = Quote $folder
            }
        }
        'chrome' {
            $file = $ChromePath
            $address = 'about:blank'
            if ($null -ne $open) {
                $address = Resolve-WebAddress ([string]$open)
                if ($null -eq $address) { return New-Result $false "'$open' is not a web address I can open." }
            }
            $arguments = @('--force-renderer-accessibility', '--new-window', (Quote $address)) -join ' '
        }
        'start' {
            if ($null -ne $open) { return New-Result $false "I can open a file, folder or web address only with Notepad, File Explorer or Chrome so far, so I did not open $($app.Title)." }
            $file = 'explorer.exe'
            $arguments = Quote "shell:AppsFolder\$($resolved.Id)"
            $timeout = 30000
        }
    }
    $before = @{}
    foreach ($window in @(Get-TopWindows | Where-Object { Test-AppWindow $app $_ })) { $before[$window.Handle] = $window.Name }
    $frontBefore = [Venom.Hands]::Foreground()
    if ($null -eq $arguments) { Start-Process -FilePath $file | Out-Null }
    else { Start-Process -FilePath $file -ArgumentList $arguments | Out-Null }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $found = $null
    $title = $null
    while ($clock.ElapsedMilliseconds -lt $timeout) {
        $found = Wait-AppWindow $app $before $frontBefore ([int]($timeout - $clock.ElapsedMilliseconds))
        if ($null -eq $found) { break }
        $title = Wait-Ready $found.Window 8000
        Start-Sleep -Milliseconds 700
        if ($null -ne $title -and [Venom.Hands]::Exists($found.Window.Handle)) { break }
        $before[$found.Window.Handle] = $found.Window.Name
        $found = $null
    }
    if ($null -eq $found) { return New-Result $false "$($app.Title) did not show a window within $([int]($timeout / 1000)) seconds." }
    if ($null -eq $title) { return New-Result $false "$($app.Title) opened a window, but it never became ready." }
    $focused = [Venom.Hands]::Focus($found.Window.Handle)
    $data = @{ window = $found.Window.Handle; title = $title; app = $key; reused = $found.Reused; focused = $focused }
    $how = if ($found.Reused) { "I used the $($app.Title) window that was already open" } else { "$($app.Title) is open and ready" }
    return New-Result $true "${how}: $title." $data
}

function Resolve-Window($Request) {
    $handle = Get-Arg $Request 'window'
    $windows = @(Get-TopWindows)
    if ($null -ne $handle) {
        $match = @($windows | Where-Object { $_.Handle -eq [long]$handle })
        if ($match.Length -eq 0) { throw 'The window VENOM opened for this task is closed.' }
        return $match[0]
    }
    $title = [string](Get-Arg $Request 'title')
    $needle = ($title.ToLowerInvariant() -replace '^\s*the\s+', '' -replace '\s+window\s*$', '').Trim()
    if ($needle.Length -eq 0) { throw 'I was not told which window to use.' }
    $match = @($windows | Where-Object { $_.Name.ToLowerInvariant().Contains($needle) })
    $front = [Venom.Hands]::Foreground()
    $inFront = @($match | Where-Object { $_.Handle -eq $front })
    if ($inFront.Length -eq 1) { return $inFront[0] }
    if ($match.Length -eq 1) { return $match[0] }
    if ($match.Length -eq 0) { throw "I could not find a window called '$title'." }
    throw "I found $($match.Length) windows called '$title', so I did nothing."
}

function Test-PasswordFocus {
    try {
        $focused = $Automation::FocusedElement
        return ($null -ne $focused -and $focused.Current.IsPassword)
    }
    catch { return $false }
}

function Read-FocusedText {
    try {
        $element = $Automation::FocusedElement
        if ($null -eq $element) { return $null }
        try { return [string]$element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern).DocumentRange.GetText(-1) } catch { }
        try { return [string]$element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch { }
    }
    catch { }
    return $null
}

function ConvertTo-Lines([string]$Text) {
    return ($Text -replace "`r`n", "`n" -replace "`r", "`n")
}

function Invoke-TypeText($Request) {
    $window = Resolve-Window $Request
    $text = [string](Get-Arg $Request 'text')
    $title = $window.Name
    if (-not [Venom.Hands]::Focus($window.Handle)) { return New-Result $false "I could not bring '$title' to the front, so I typed nothing." }
    Start-Sleep -Milliseconds 200
    $done = 0
    while ($done -lt $text.Length) {
        if (Test-PasswordFocus) { return New-Result $false "The place to type in '$title' is a password box, and VENOM never types passwords. Typed $done of $($text.Length) characters." @{ typed = $done } }
        $chunk = $text.Substring($done, [Math]::Min(32, $text.Length - $done))
        $typed = [Venom.Hands]::Type($window.Handle, $chunk, 10)
        $done += $typed
        if ($typed -lt $chunk.Length) { return New-Result $false "'$title' lost focus, so I stopped after $done of $($text.Length) characters." @{ typed = $done } }
    }
    Start-Sleep -Milliseconds 300
    $after = Read-FocusedText
    if ($null -eq $after) {
        return New-Result $true "Typed $($text.Length) characters into '$title'. This window does not let me read its text, so I could not check it." @{ typed = $done; window = $window.Handle; verified = 'unreadable' }
    }
    $wanted = (ConvertTo-Lines $text).TrimEnd("`n")
    $arrived = ConvertTo-Lines $after
    if ($arrived.Contains($wanted)) {
        return New-Result $true "Typed $($text.Length) characters into '$title' and checked that they arrived." @{ typed = $done; window = $window.Handle; verified = 'match' }
    }
    $tail = if ($arrived.Length -gt 300) { $arrived.Substring($arrived.Length - 300) } else { $arrived }
    return New-Result $false "I typed $($text.Length) characters into '$title', but what arrived is different, so this step is not done." @{ typed = $done; window = $window.Handle; verified = 'different'; arrived = $tail }
}

function ConvertTo-Label([string]$Text) {
    $label = $Text.ToLowerInvariant() -replace $QuoteMarks, ''
    $label = $label -replace '^\s*the\s+', ''
    $label = $label -replace '\s+(button|link|menu|tab|item|option|icon|box)\s*$', ''
    return (($label -replace '[^\p{L}\p{N}]+', ' ').Trim())
}

$ClickableTypes = @(
    $ControlType::Button, $ControlType::Hyperlink, $ControlType::MenuItem, $ControlType::TabItem,
    $ControlType::ListItem, $ControlType::CheckBox, $ControlType::RadioButton, $ControlType::SplitButton,
    $ControlType::TreeItem, $ControlType::DataItem
)
$ClickableConditions = [System.Windows.Automation.Condition[]]@(
    $ClickableTypes | ForEach-Object { New-Object System.Windows.Automation.PropertyCondition -ArgumentList $Automation::ControlTypeProperty, $_ }
)
$ClickableCondition = New-Object System.Windows.Automation.OrCondition -ArgumentList (, $ClickableConditions)

function Find-Clickable($Window, [string]$Needle) {
    $words = @($Needle -split ' ' | Where-Object { $_ })
    $exact = New-Object System.Collections.ArrayList
    $partial = New-Object System.Collections.ArrayList
    foreach ($element in $Window.Element.FindAll($TreeScope::Descendants, $ClickableCondition)) {
        try {
            $current = $element.Current
            if (-not $current.IsEnabled -or $current.IsOffscreen) { continue }
            $name = ConvertTo-Label $current.Name
            if ($name.Length -eq 0) { continue }
            if ($name -eq $Needle) { [void]$exact.Add($element); continue }
            $nameWords = @($name -split ' ')
            if (@($words | Where-Object { $nameWords -notcontains $_ }).Length -eq 0) { [void]$partial.Add($element) }
        }
        catch { }
    }
    if ($exact.Count -gt 0) { return $exact.ToArray() }
    return $partial.ToArray()
}

function Test-Showing($Element) {
    $point = New-Object System.Windows.Point
    if (-not $Element.TryGetClickablePoint([ref]$point)) { return $false }
    try { $hit = $Automation::FromPoint($point) } catch { return $false }
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    for ($depth = 0; $null -ne $hit -and $depth -lt 12; $depth++) {
        if ([System.Windows.Automation.Automation]::Compare($hit, $Element)) { return $true }
        $hit = $walker.GetParent($hit)
    }
    return $false
}

function Invoke-Click($Request) {
    $window = Resolve-Window $Request
    $on = [string](Get-Arg $Request 'on')
    $needle = ConvertTo-Label $on
    $title = $window.Name
    if ($needle.Length -eq 0) { return New-Result $false 'I was not told what to click.' }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $found = @()
    while ($clock.ElapsedMilliseconds -lt 10000) {
        $found = @(Find-Clickable $window $needle)
        if ($found.Length -gt 0) { break }
        Start-Sleep -Milliseconds 300
    }
    if ($found.Length -eq 0) { return New-Result $false "I could not find '$on' in '$title' within 10 seconds, so I clicked nothing." }
    if (-not [Venom.Hands]::Focus($window.Handle)) { return New-Result $false "I could not bring '$title' to the front, so I clicked nothing." }
    if ($found.Length -gt 1) {
        $matching = $found.Length
        Start-Sleep -Milliseconds 150
        $found = @($found | Where-Object { Test-Showing $_ })
        if ($found.Length -eq 0) { return New-Result $false "I found $matching things matching '$on' in '$title', but none of them is showing on the screen, so I clicked nothing." }
        if ($found.Length -gt 1) { return New-Result $false "I found $($found.Length) things matching '$on' showing in '$title', so I clicked nothing." }
    }
    $element = $found[0]
    $name = $element.Current.Name
    try { $element.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView() } catch { }
    Start-Sleep -Milliseconds 150
    $point = New-Object System.Windows.Point
    if ($element.TryGetClickablePoint([ref]$point) -and [Venom.Hands]::ClickAt($window.Handle, [int]$point.X, [int]$point.Y)) {
        return New-Result $true "Clicked '$name' in '$title'." @{ window = $window.Handle }
    }
    try {
        $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        return New-Result $true "Pressed '$name' in '$title'." @{ window = $window.Handle }
    }
    catch { return New-Result $false "I found '$name' in '$title', but something was covering it, so I clicked nothing." }
}

function Get-WorkFolder([string]$Task, [bool]$Low) {
    if ($Task -notmatch '^[A-Za-z0-9-]{1,64}$') { throw 'The task name is not safe for a folder.' }
    $folder = Join-Path $WorkRoot $Task
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    if ($Low) {
        & icacls.exe $folder /setintegritylevel '(OI)(CI)low' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Windows would not lock the work folder for scripts.' }
        foreach ($inner in @('.tmp', '.appdata\Roaming', '.appdata\Local')) { New-Item -ItemType Directory -Force -Path (Join-Path $folder $inner) | Out-Null }
    }
    return $folder
}

function Invoke-Screenshot($Request) {
    $folder = Get-WorkFolder ([string](Get-Arg $Request 'task')) $false
    $handle = Get-Arg $Request 'window'
    $title = 'the whole screen'
    $target = [long]0
    if ($null -ne $handle) {
        $window = Resolve-Window $Request
        if (-not [Venom.Hands]::Focus($window.Handle)) { return New-Result $false "I could not bring '$($window.Name)' to the front, so I took no screenshot." }
        $target = $window.Handle
        $title = "'$($window.Name)'"
        Start-Sleep -Milliseconds 250
    }
    $path = Join-Path $folder ('screenshot-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.png')
    $size = [Venom.Hands]::Capture($target, $path)
    return New-Result $true "Took a screenshot of $title ($size)." @{ path = $path; size = $size }
}

function New-SandboxEnvironment([string]$Folder) {
    $keep = @(
        'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'PATHEXT', 'OS', 'NUMBER_OF_PROCESSORS',
        'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION',
        'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'CommonProgramFiles',
        'CommonProgramFiles(x86)', 'CommonProgramW6432', 'PUBLIC', 'USERNAME', 'USERDOMAIN',
        'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'COMPUTERNAME'
    )
    $variables = @{}
    foreach ($name in $keep) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if ($value) { $variables[$name] = $value }
    }
    $paths = @([Environment]::GetEnvironmentVariable('Path', 'Machine') -split ';' | Where-Object { $_ })
    if ($null -ne $Python) { $paths = @(Split-Path -Parent $Python.Path) + $paths }
    $variables['Path'] = $paths -join ';'
    $variables['PSModulePath'] = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')
    $variables['TEMP'] = Join-Path $Folder '.tmp'
    $variables['TMP'] = Join-Path $Folder '.tmp'
    $variables['APPDATA'] = Join-Path $Folder '.appdata\Roaming'
    $variables['LOCALAPPDATA'] = Join-Path $Folder '.appdata\Local'
    $variables['PYTHONIOENCODING'] = 'utf-8'
    $variables['PYTHONUTF8'] = '1'
    $variables['PYTHONDONTWRITEBYTECODE'] = '1'
    $lines = $variables.GetEnumerator() | Sort-Object -Property Name | ForEach-Object { "$($_.Name)=$($_.Value)" }
    return ($lines -join "`0") + "`0"
}

function Read-NewOutput($State) {
    if ($null -eq $State.Stream) {
        if (-not (Test-Path -LiteralPath $State.Path)) { return '' }
        $State.Stream = New-Object IO.FileStream -ArgumentList $State.Path, ([IO.FileMode]::Open), ([IO.FileAccess]::Read), ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
    }
    $buffer = New-Object byte[] 65536
    $text = New-Object Text.StringBuilder
    while (($count = $State.Stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $chars = New-Object char[] ($State.Decoder.GetCharCount($buffer, 0, $count))
        $made = $State.Decoder.GetChars($buffer, 0, $count, $chars, 0)
        [void]$text.Append($chars, 0, $made)
    }
    return $text.ToString()
}

function Send-Output([string]$Id, $State, [string]$Text) {
    if ($Text.Length -eq 0) { return }
    $State.Tail = $State.Tail + $Text
    if ($State.Tail.Length -gt $OutputLimit) { $State.Tail = $State.Tail.Substring($State.Tail.Length - $OutputLimit) }
    $room = $StreamLimit - $State.Streamed
    if ($room -le 0) { return }
    $piece = if ($Text.Length -gt $room) { $Text.Substring(0, $room) + "`n[VENOM: the rest of the output is not shown live]`n" } else { $Text }
    $State.Streamed += $piece.Length
    for ($start = 0; $start -lt $piece.Length; $start += 4000) {
        Send-Line @{ type = 'output'; id = $Id; text = $piece.Substring($start, [Math]::Min(4000, $piece.Length - $start)) }
    }
}

function Invoke-RunScript([string]$Id, $Request) {
    $language = [string](Get-Arg $Request 'language')
    $code = [string](Get-Arg $Request 'code')
    $timeout = [int](Get-Arg $Request 'timeout_seconds')
    if ($timeout -lt 1 -or $timeout -gt 300) { $timeout = 300 }
    $folder = Get-WorkFolder ([string](Get-Arg $Request 'task')) $true
    $log = Join-Path $folder 'output.log'
    Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue
    switch ($language) {
        'powershell' {
            $script = Join-Path $folder 'script.ps1'
            [IO.File]::WriteAllText($script, $code, (New-Object Text.UTF8Encoding $true))
            $launcher = '$ErrorActionPreference = ''Stop''; $ProgressPreference = ''SilentlyContinue''; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; $Error.Clear(); try { & ''.\script.ps1'' *>&1 | Out-String -Stream -Width 4096 } catch { [Console]::Out.WriteLine(($_ | Out-String -Width 4096).TrimEnd()); exit 1 }; $hidden = @($Error | ForEach-Object { $_.Exception.Message } | Select-Object -Unique); if ($hidden.Count -gt 0) { $hidden | ForEach-Object { [Console]::Out.WriteLine(''VENOM saw an error: '' + $_) }; exit 5 }; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }'
            $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($launcher))
            $command = "$(Quote $PowerShellPath) -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -OutputFormat Text -EncodedCommand $encoded"
        }
        'python' {
            if ($null -eq $Python) { return New-Result $false 'Python is not installed on this computer, so the script did not run.' }
            $script = Join-Path $folder 'script.py'
            [IO.File]::WriteAllText($script, $code, $utf8)
            $command = (@(Quote $Python.Path) + $Python.Prefix + @('-I', '-u', (Quote $script))) -join ' '
        }
        default { return New-Result $false "VENOM cannot run $language scripts." }
    }
    $line = "$(Quote $env:ComSpec) /d /s /c `"$command 1> $(Quote $log) 2>&1`""
    $process = [Venom.Hands]::StartLow($line, $folder, (New-SandboxEnvironment $folder))
    $state = @{ Path = $log; Stream = $null; Decoder = $utf8.GetDecoder(); Tail = ''; Streamed = 0 }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $timedOut = $false
    try {
        while (-not $process.WaitExit(150)) {
            Send-Output $Id $state (Read-NewOutput $state)
            if ($clock.Elapsed.TotalSeconds -ge $timeout) {
                $process.Kill()
                $timedOut = $true
                [void]$process.WaitExit(5000)
                break
            }
        }
        Start-Sleep -Milliseconds 100
        Send-Output $Id $state (Read-NewOutput $state)
        $exit = $process.ExitCode
    }
    finally {
        if ($null -ne $state.Stream) { $state.Stream.Dispose() }
        $process.Dispose()
    }
    $refused = $state.Tail -match 'Access to the path .* is denied|Access is denied|UnauthorizedAccess|PermissionError|\[Errno 13\]'
    $note = if ($refused) { " Windows refused a change outside VENOM's work folder." } else { '' }
    $data = @{ exit_code = $exit; output = $state.Tail; refused_outside = [bool]$refused; folder = $folder; seconds = [Math]::Round($clock.Elapsed.TotalSeconds, 1) }
    if ($timedOut) { return New-Result $false "The script ran longer than $timeout seconds, so I stopped it.$note" $data }
    if ($refused) { return New-Result $false "Windows refused a change outside VENOM's work folder, so this step is not done." $data }
    if ($exit -ne 0) { return New-Result $false "The script ran into an error (exit code $exit), so this step is not done." $data }
    return New-Result $true 'The script finished.' $data
}

$MarkKinds = @{
    'Button' = 'button'; 'SplitButton' = 'button'; 'Hyperlink' = 'link'; 'Edit' = 'box'; 'Document' = 'box'
    'ComboBox' = 'list'; 'List' = 'list'; 'CheckBox' = 'check'; 'RadioButton' = 'check'; 'ListItem' = 'item'
    'TreeItem' = 'item'; 'DataItem' = 'item'; 'TabItem' = 'tab'; 'MenuItem' = 'menu'
}
$MarkRanks = @{ 'box' = 0; 'button' = 1; 'tab' = 1; 'menu' = 1; 'check' = 1; 'list' = 1; 'link' = 2; 'item' = 2 }
$MarkConditions = [System.Windows.Automation.Condition[]]@(
    $MarkKinds.Keys | ForEach-Object { New-Object System.Windows.Automation.PropertyCondition -ArgumentList $Automation::ControlTypeProperty, $ControlType::$_ }
)
$MarkCondition = New-Object System.Windows.Automation.AndCondition -ArgumentList (, [System.Windows.Automation.Condition[]]@(
        (New-Object System.Windows.Automation.OrCondition -ArgumentList (, $MarkConditions)),
        (New-Object System.Windows.Automation.PropertyCondition -ArgumentList $Automation::IsOffscreenProperty, $false)
    ))
$ReadOnlyProperty = [System.Windows.Automation.ValuePattern]::IsReadOnlyProperty
$script:Woken = @{}

function New-MarkCache {
    $cache = New-Object System.Windows.Automation.CacheRequest
    foreach ($property in @(
            $Automation::NameProperty, $Automation::ControlTypeProperty, $Automation::BoundingRectangleProperty,
            $Automation::IsEnabledProperty, $Automation::IsPasswordProperty, $Automation::HasKeyboardFocusProperty,
            $Automation::IsValuePatternAvailableProperty, $Automation::IsTextPatternAvailableProperty, $ReadOnlyProperty
        )) { $cache.Add($property) }
    $cache.AutomationElementMode = [System.Windows.Automation.AutomationElementMode]::None
    return $cache
}

function Get-Cached($Element, $Property) {
    return $Element.GetCachedPropertyValue($Property, $true)
}

function Test-Editable([string]$Type, $Element) {
    $readOnly = Get-Cached $Element $ReadOnlyProperty
    $hasValue = (Get-Cached $Element $Automation::IsValuePatternAvailableProperty) -eq $true
    $writable = $hasValue -and $readOnly -eq $false
    switch ($Type) {
        'Edit' { return ($readOnly -ne $true) }
        'Document' { return ($writable -or (-not $hasValue -and (Get-Cached $Element $Automation::HasKeyboardFocusProperty) -eq $true -and (Get-Cached $Element $Automation::IsTextPatternAvailableProperty) -eq $true)) }
        'ComboBox' { return $writable }
    }
    return $false
}

function Get-Marks($Window, [double]$Scale, [int]$Width, [int]$Height) {
    $cache = New-MarkCache
    $active = $cache.Activate()
    try { $found = $Window.Element.FindAll($TreeScope::Descendants, $MarkCondition) }
    finally { $active.Dispose() }
    $seen = @{}
    $marks = New-Object System.Collections.ArrayList
    foreach ($element in $found) {
        try {
            $cached = $element.Cached
            if (-not $cached.IsEnabled) { continue }
            $type = $cached.ControlType.ProgrammaticName -replace '^ControlType\.', ''
            $kind = $MarkKinds[$type]
            if ($null -eq $kind) { continue }
            $rect = $cached.BoundingRectangle
            if ($rect.IsEmpty -or $rect.Width -lt 4 -or $rect.Height -lt 4) { continue }
            $left = [Math]::Max(0, [int][Math]::Floor($rect.Left * $Scale))
            $top = [Math]::Max(0, [int][Math]::Floor($rect.Top * $Scale))
            $right = [Math]::Min($Width, [int][Math]::Ceiling($rect.Right * $Scale))
            $bottom = [Math]::Min($Height, [int][Math]::Ceiling($rect.Bottom * $Scale))
            if ($right - $left -lt 3 -or $bottom - $top -lt 3) { continue }
            $editable = Test-Editable $type $element
            if ($type -eq 'Document' -and -not $editable) { continue }
            $name = ([string]$cached.Name -replace '\s+', ' ').Trim()
            if ($name.Length -gt 120) { $name = $name.Substring(0, 117) + '...' }
            $focus = [bool]$cached.HasKeyboardFocus
            if ($name.Length -eq 0 -and -not $editable -and -not $focus) { continue }
            $key = "$left,$top,$right,$bottom,$name"
            if ($seen.ContainsKey($key)) { continue }
            $seen[$key] = $true
            $rank = if ($editable -or $focus) { 0 } else { $MarkRanks[$kind] }
            if ($editable) { $kind = 'box' }
            [void]$marks.Add([pscustomobject]@{
                    Rank = $rank; Kind = $kind; Name = $name; Editable = $editable
                    Password = [bool]$cached.IsPassword; Focused = $focus
                    X = $left; Y = $top; W = $right - $left; H = $bottom - $top; Row = [int][Math]::Floor($top / 12)
                })
        }
        catch { }
    }
    $chosen = @($marks | Sort-Object -Property Rank, Row, X | Select-Object -First $MarkLimit | Sort-Object -Property Row, X)
    return $chosen
}

function Invoke-Observe($Request) {
    $handle = Get-Arg $Request 'window'
    $desktop = (Get-Arg $Request 'desktop') -eq $true
    $front = [Venom.Hands]::Foreground()
    $target = if ($desktop) { [long]0 } elseif ($null -ne $handle) { [long]$handle } else { $front }
    $window = @(if (-not $desktop) { Get-TopWindows | Where-Object { $_.Handle -eq $target } })
    $screen = [Venom.Hands]::Screen()
    $scale = [Math]::Min(1.0, $PictureWidth / [double]$screen[0])
    $width = [Math]::Max(1, [int][Math]::Round($screen[0] * $scale))
    $height = [Math]::Max(1, [int][Math]::Round($screen[1] * $scale))
    $marks = @()
    $title = ''
    $app = ''
    if ($window.Length -gt 0 -and $ShellClasses -notcontains $window[0].Class) {
        $title = ([string]$window[0].Name -replace '\s+', ' ').Trim()
        if ($title.Length -gt 300) { $title = $title.Substring(0, 297) + '...' }
        $app = [string]$window[0].Process
        if ($app.Length -gt 120) { $app = $app.Substring(0, 120) }
        $pages = [Venom.Hands]::WakePages($window[0].Handle)
        if ($pages -gt 0 -and -not $script:Woken.ContainsKey($target)) {
            $script:Woken[$target] = $true
            Start-Sleep -Milliseconds 1200
        }
        $marks = @(Get-Marks $window[0] $scale $width $height)
        for ($try = 0; $pages -gt 0 -and $marks.Length -lt $MarkLimit -and $try -lt 4; $try++) {
            Start-Sleep -Milliseconds 700
            [void][Venom.Hands]::WakePages($window[0].Handle)
            $again = @(Get-Marks $window[0] $scale $width $height)
            if ($again.Length -le $marks.Length) { break }
            $marks = $again
        }
    }
    elseif ($null -ne $handle) { return New-Result $false 'The window VENOM was looking at is closed.' }
    $boxes = New-Object 'System.Collections.Generic.List[int]'
    foreach ($mark in $marks) { $boxes.AddRange([int[]]@($mark.X, $mark.Y, $mark.W, $mark.H)) }
    $picture = [Venom.Hands]::Look($width, $height, $boxes.ToArray(), $PictureLimit)
    $list = New-Object System.Collections.ArrayList
    $focused = $null
    for ($index = 0; $index -lt $marks.Length; $index++) {
        $mark = $marks[$index]
        if ($mark.Focused -and $null -eq $focused) { $focused = $index + 1 }
        [void]$list.Add(@{
                id = $index + 1; kind = $mark.Kind; name = $mark.Name; editable = $mark.Editable; password = $mark.Password
                box = @{ x = $mark.X; y = $mark.Y; width = $mark.W; height = $mark.H }
            })
    }
    $observation = @{
        picture = $picture.Data; width = $picture.Width; height = $picture.Height
        window = $title; app = $app; marks = $list.ToArray(); focused = $focused
    }
    $what = if ($title.Length -gt 0) { "'$title'" } else { 'the desktop' }
    $script:LastLook = @{ Window = $target; Scale = $scale; Marks = $marks }
    $data = @{ observation = $observation; window = $target; front = ($front -eq $target); scale = $scale }
    return New-Result $true "Looked at the screen and $what, and found $($list.Count) things to use." $data
}

$KeyCodes = @{
    'enter' = @(0x0D); 'tab' = @(0x09); 'escape' = @(0x1B); 'backspace' = @(0x08); 'delete' = @(0x2E)
    'up' = @(0x26); 'down' = @(0x28); 'left' = @(0x25); 'right' = @(0x27)
    'page_up' = @(0x21); 'page_down' = @(0x22); 'home' = @(0x24); 'end' = @(0x23)
    'ctrl+a' = @(0x11, 0x41); 'ctrl+c' = @(0x11, 0x43); 'ctrl+v' = @(0x11, 0x56); 'ctrl+f' = @(0x11, 0x46)
    'ctrl+l' = @(0x11, 0x4C); 'ctrl+t' = @(0x11, 0x54); 'ctrl+w' = @(0x11, 0x57)
    'alt+left' = @(0x12, 0x25); 'alt+tab' = @(0x12, 0x09); 'win' = @(0x5B); 'f5' = @(0x74)
}
$script:LastLook = $null

function Get-LookWindow {
    if ($null -eq $script:LastLook) { throw 'VENOM has not looked at the screen yet, so it does not know where to act.' }
    if ($script:LastLook.Window -eq 0) { throw 'VENOM only looked at the desktop, so it opens an app before it clicks or types.' }
    $window = @(Get-TopWindows | Where-Object { $_.Handle -eq $script:LastLook.Window })
    if ($window.Length -eq 0) { throw 'The window VENOM looked at is closed.' }
    if (-not [Venom.Hands]::Focus($window[0].Handle)) { throw "I could not bring '$($window[0].Name)' to the front, so I did nothing." }
    return $window[0]
}

function Get-MarkPoint($Mark) {
    $scale = [double]$script:LastLook.Scale
    return @([int][Math]::Round(($Mark.X + $Mark.W / 2.0) / $scale), [int][Math]::Round(($Mark.Y + $Mark.H / 2.0) / $scale))
}

function Get-LookMark($Number) {
    $marks = @($script:LastLook.Marks)
    $index = [int]$Number - 1
    if ($index -lt 0 -or $index -ge $marks.Length) { throw "There is no mark $Number on the last look, so I did nothing." }
    return $marks[$index]
}

$SpotKinds = @{
    'Button' = 'button'; 'SplitButton' = 'button'; 'Hyperlink' = 'link'; 'Edit' = 'box'; 'ComboBox' = 'list'; 'List' = 'list'
    'CheckBox' = 'check'; 'RadioButton' = 'check'; 'ListItem' = 'item'; 'TreeItem' = 'item'; 'DataItem' = 'item'; 'TabItem' = 'tab'; 'MenuItem' = 'menu'
}

function Invoke-Spot($Request) {
    if ($null -eq $script:LastLook) { return New-Result $false 'VENOM has not looked at the screen yet, so it cannot read a spot.' }
    $scale = [double]$script:LastLook.Scale
    $x = [double](Get-Arg $Request 'x') / $scale
    $y = [double](Get-Arg $Request 'y') / $scale
    try { $element = $Automation::FromPoint((New-Object System.Windows.Point -ArgumentList $x, $y)) }
    catch { return New-Result $false 'VENOM could not read what is at that spot.' @{ kind = 'other'; name = ''; password = $false } }
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $kind = 'other'
    $name = ''
    $password = $false
    for ($depth = 0; $null -ne $element -and $depth -lt 6; $depth++) {
        $current = $element.Current
        $type = $current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
        $label = ([string]$current.Name -replace '\s+', ' ').Trim()
        if ($SpotKinds.ContainsKey($type)) {
            $kind = $SpotKinds[$type]
            $name = $label
            $password = [bool]$current.IsPassword
            break
        }
        if ($name.Length -eq 0) { $name = $label }
        $element = $walker.GetParent($element)
    }
    if ($name.Length -gt 120) { $name = $name.Substring(0, 117) + '...' }
    return New-Result $true "At that spot: $kind '$name'." @{ kind = $kind; name = $name; password = $password }
}

function Get-Target($Move) {
    $mark = Get-Arg $Move 'mark'
    if ($null -ne $mark) {
        $chosen = Get-LookMark $mark
        return @{ Point = (Get-MarkPoint $chosen); Mark = $chosen; Label = "mark $mark '$($chosen.Name)'" }
    }
    $point = Get-Arg $Move 'point'
    if ($null -ne $point) {
        $scale = [double]$script:LastLook.Scale
        $x = [int][Math]::Round([double](Get-Arg $point 'x') / $scale)
        $y = [int][Math]::Round([double](Get-Arg $point 'y') / $scale)
        return @{ Point = @($x, $y); Mark = $null; Label = "the point $(Get-Arg $point 'x'),$(Get-Arg $point 'y')" }
    }
    return $null
}

function Invoke-MoveClick($Window, $Move) {
    $target = Get-Target $Move
    if ($null -eq $target) { return New-Result $false 'I was not told where to click.' }
    $times = if ((Get-Arg $Move 'double') -eq $true) { 2 } else { 1 }
    if (-not [Venom.Hands]::ClickTimes($Window.Handle, $target.Point[0], $target.Point[1], $times)) {
        return New-Result $false "Something else is covering $($target.Label) in '$($Window.Name)', so I clicked nothing."
    }
    $how = if ($times -eq 2) { 'Double-clicked' } else { 'Clicked' }
    return New-Result $true "$how $($target.Label) in '$($Window.Name)'." @{ window = $Window.Handle }
}

function Invoke-MoveType($Window, $Move) {
    $text = [string](Get-Arg $Move 'text')
    if ($text.Length -eq 0 -or $text.Length -gt $TypeLimit) { return New-Result $false "I can type 1 to $TypeLimit characters in one move." }
    $target = Get-Target $Move
    if ($null -ne $target) {
        if ($null -ne $target.Mark -and $target.Mark.Password) { return New-Result $false 'That is a password box, and VENOM never types passwords. Please type it yourself.' }
        if (-not [Venom.Hands]::ClickTimes($Window.Handle, $target.Point[0], $target.Point[1], 1)) {
            return New-Result $false "Something else is covering $($target.Label), so I typed nothing."
        }
        Start-Sleep -Milliseconds 200
    }
    $done = 0
    while ($done -lt $text.Length) {
        if (Test-PasswordFocus) { return New-Result $false "The place to type is a password box, and VENOM never types passwords. Typed $done of $($text.Length) characters." @{ typed = $done } }
        $chunk = $text.Substring($done, [Math]::Min(32, $text.Length - $done))
        $typed = [Venom.Hands]::Type($Window.Handle, $chunk, 10)
        $done += $typed
        if ($typed -lt $chunk.Length) { return New-Result $false "'$($Window.Name)' lost focus, so I stopped after $done of $($text.Length) characters." @{ typed = $done } }
    }
    Start-Sleep -Milliseconds 250
    $after = Read-FocusedText
    $verified = if ($null -eq $after) { 'unreadable' } elseif ((ConvertTo-Lines $after).Contains((ConvertTo-Lines $text).TrimEnd("`n"))) { 'match' } else { 'different' }
    if ((Get-Arg $Move 'enter') -eq $true) { [void][Venom.Hands]::Chord($Window.Handle, [int[]]@(0x0D)) }
    $where = if ($null -ne $target) { " into $($target.Label)" } else { '' }
    $check = switch ($verified) { 'match' { ' and checked that it arrived' } 'different' { ', but what arrived looks different' } default { '' } }
    $enter = if ((Get-Arg $Move 'enter') -eq $true) { ', then pressed Enter' } else { '' }
    return New-Result ($verified -ne 'different') "Typed $($text.Length) characters$where$check$enter." @{ window = $Window.Handle; verified = $verified; typed = $done }
}

function Invoke-MoveKey($Window, $Move) {
    $name = ([string](Get-Arg $Move 'key')).ToLowerInvariant()
    if (-not $KeyCodes.ContainsKey($name)) { return New-Result $false "The key '$name' is not on VENOM's list." }
    if (-not [Venom.Hands]::Chord($Window.Handle, [int[]]$KeyCodes[$name])) { return New-Result $false "'$($Window.Name)' was not in front, so I pressed nothing." }
    return New-Result $true "Pressed $name in '$($Window.Name)'." @{ window = $Window.Handle }
}

function Invoke-MoveScroll($Window, $Move) {
    $steps = [int](Get-Arg $Move 'steps')
    if ($steps -lt 1 -or $steps -gt 10) { return New-Result $false 'I can scroll 1 to 10 steps in one move.' }
    $direction = [string](Get-Arg $Move 'direction')
    if (@('up', 'down') -notcontains $direction) { return New-Result $false 'I can only scroll up or down.' }
    $target = Get-Target $Move
    $point = if ($null -ne $target) { $target.Point } else { [Venom.Hands]::Center($Window.Handle) }
    $notches = if ($direction -eq 'down') { -$steps } else { $steps }
    if (-not [Venom.Hands]::Wheel($Window.Handle, $point[0], $point[1], $notches)) { return New-Result $false "Something else is covering '$($Window.Name)', so I did not scroll." }
    return New-Result $true "Scrolled $direction $steps steps in '$($Window.Name)'." @{ window = $Window.Handle }
}

function Invoke-Move($Request) {
    $move = Get-Arg $Request 'move'
    if ($null -eq $move) { return New-Result $false 'I was not told which move to make.' }
    $window = Get-LookWindow
    Start-Sleep -Milliseconds 120
    switch ([string](Get-Arg $move 'kind')) {
        'click' { return Invoke-MoveClick $window $move }
        'type' { return Invoke-MoveType $window $move }
        'key' { return Invoke-MoveKey $window $move }
        'scroll' { return Invoke-MoveScroll $window $move }
        default { return New-Result $false 'That move is not on the menu.' }
    }
}

function Invoke-Describe($Request) {
    $window = Resolve-Window $Request
    return New-Result $true $window.Name @{ title = $window.Name; window = $window.Handle; front = ([Venom.Hands]::Foreground() -eq $window.Handle) }
}

function Invoke-Request([string]$Id, $Request) {
    switch ([string](Get-Arg $Request 'op')) {
        'ping' { return New-Result $true 'ready' }
        'open_app' { return Invoke-OpenApp $Request }
        'type_text' { return Invoke-TypeText $Request }
        'click' { return Invoke-Click $Request }
        'screenshot' { return Invoke-Screenshot $Request }
        'run_script' { return Invoke-RunScript $Id $Request }
        'describe' { return Invoke-Describe $Request }
        'spot' { return Invoke-Spot $Request }
        'front' { return New-Result $true 'The window in front.' @{ window = [Venom.Hands]::Foreground() } }
        'observe' { return Invoke-Observe $Request }
        'move' { return Invoke-Move $Request }
        default { return New-Result $false 'The hands were asked for something that is not on the menu.' }
    }
}

try {
    [Venom.Hands]::Init()
    $screen = $true
    try { [void]$Automation::RootElement.Current.Name } catch { $screen = $false }
    $special = @($Apps.Keys | Where-Object { $_ -ne 'chrome' -or $null -ne $ChromePath } | ForEach-Object { $Apps[$_].Title })
    $appNames = @(@($special) + @(Get-StartApps $true | ForEach-Object { $_.Name }) | Sort-Object -Unique)
    $scripts = @('powershell')
    if ($null -ne $Python) { $scripts += 'python' }
    Send-Line @{ type = 'hello'; version = 8; apps = $appNames; scripts = $scripts; sandbox = [Venom.Hands]::SandboxReady(); screen = $screen; work = $WorkRoot }
}
catch {
    Send-Line @{ type = 'fatal'; detail = "The hands could not start: $($_.Exception.Message)" }
    exit 1
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim().Length -eq 0) { continue }
    $id = $null
    try {
        $request = ConvertFrom-Json -InputObject $line
        $id = [string](Get-Arg $request 'id')
        $result = Invoke-Request $id $request
    }
    catch {
        $result = New-Result $false ([string]$_.Exception.Message)
    }
    Send-Line @{ type = 'result'; id = $id; ok = [bool]$result.Ok; detail = [string]$result.Detail; data = $result.Data }
}
