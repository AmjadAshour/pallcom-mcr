Option Explicit
Dim files, shell, script, powershell
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
script = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "backend\agent\Start-MCR-Agent.ps1")
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
shell.Run """" & powershell & """ -NoProfile -ExecutionPolicy RemoteSigned -STA -WindowStyle Hidden -File """ & script & """", 0, False
