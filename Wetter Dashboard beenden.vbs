Option Explicit

Dim oShell, oFSO, tmpFile, ts, line, pid, port, found, j, parts

Set oShell = CreateObject("WScript.Shell")
Set oFSO   = CreateObject("Scripting.FileSystemObject")
tmpFile    = oFSO.BuildPath(oFSO.GetSpecialFolder(2), "wd_pid.txt")

found = False

For port = 8080 To 8083
    oShell.Run "cmd /c netstat -ano | findstr :" & port & _
               " | findstr LISTENING > """ & tmpFile & """", 0, True

    If oFSO.FileExists(tmpFile) Then
        If oFSO.GetFile(tmpFile).Size > 0 Then
            Set ts  = oFSO.OpenTextFile(tmpFile, 1)
            line    = ts.ReadLine()
            ts.Close

            ' Letztes nicht-leeres Token der Zeile = PID
            parts = Split(line, " ")
            pid   = ""
            For j = UBound(parts) To 0 Step -1
                If Trim(parts(j)) <> "" Then
                    pid = Trim(parts(j))
                    Exit For
                End If
            Next

            If IsNumeric(pid) And CLng(pid) > 0 Then
                oShell.Run "cmd /c taskkill /PID " & pid & " /F", 0, True
                found = True
                MsgBox "Wetter Dashboard Server gestoppt." & vbCrLf & _
                       "(Port " & port & ", PID " & pid & ")", _
                       vbInformation, "Wetter Dashboard"
            End If
        End If
        oFSO.DeleteFile tmpFile, True
    End If

    If found Then Exit For
Next

If Not found Then
    MsgBox "Kein laufender Wetter Dashboard Server gefunden.", _
           vbExclamation, "Wetter Dashboard"
End If
