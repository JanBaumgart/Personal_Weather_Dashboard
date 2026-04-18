Option Explicit

Dim oShell, oFSO, projectPath, chosenPort, i

Set oShell  = CreateObject("WScript.Shell")
Set oFSO    = CreateObject("Scripting.FileSystemObject")
projectPath = oFSO.GetParentFolderName(WScript.ScriptFullName)

' --- Python vorhanden? ---
If oShell.Run("cmd /c python --version", 0, True) <> 0 Then
    MsgBox "Python wurde nicht gefunden." & vbCrLf & _
           "Bitte installiere Python: https://www.python.org", _
           vbCritical, "Wetter Dashboard"
    WScript.Quit
End If

' --- Laeuft schon ein Server auf einem unserer Ports? ---
For i = 8080 To 8083
    If IsServerAlive(i) Then
        oShell.Run "http://localhost:" & i
        WScript.Quit
    End If
Next

' --- Freien Port suchen ---
chosenPort = 0
For i = 8080 To 8083
    If IsPortFree(i) Then
        chosenPort = i
        Exit For
    End If
Next

If chosenPort = 0 Then
    MsgBox "Kein freier Port (8080-8083) gefunden." & vbCrLf & _
           "Bitte schliesse andere Anwendungen und versuche es erneut.", _
           vbExclamation, "Wetter Dashboard"
    WScript.Quit
End If

If chosenPort <> 8080 Then
    MsgBox "Port 8080 ist bereits belegt." & vbCrLf & _
           "Das Dashboard startet auf Port " & chosenPort & ".", _
           vbInformation, "Wetter Dashboard"
End If

' --- Server unsichtbar im Hintergrund starten ---
oShell.CurrentDirectory = projectPath
oShell.Run "python -m http.server " & chosenPort, 0, False

' --- Warten bis Server wirklich antwortet (max. 3 Sekunden) ---
Dim attempts
For attempts = 1 To 15
    WScript.Sleep 200
    If IsServerAlive(chosenPort) Then Exit For
Next

' --- Browser oeffnen ---
oShell.Run "http://localhost:" & chosenPort


' ==========================================================================
' Hilfsfunktionen
' ==========================================================================

Function IsPortFree(p)
    Dim r
    r = oShell.Run("cmd /c netstat -ano | findstr :" & p & " > nul 2>&1", 0, True)
    IsPortFree = (r <> 0)
End Function

Function IsServerAlive(p)
    On Error Resume Next
    Dim http
    Set http = CreateObject("MSXML2.XMLHTTP")
    http.Open "GET", "http://localhost:" & p & "/index.html", False
    http.Send
    IsServerAlive = (Err.Number = 0 And http.Status = 200)
    On Error GoTo 0
End Function
