Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = oWS.ExpandEnvironmentStrings("%USERPROFILE%") & "\Desktop\Радар 6.0.lnk"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "d:\mir-tankov-bot\RadarV5\RadarHistory\RadarHistory.exe"
oLink.WorkingDirectory = "d:\mir-tankov-bot\RadarV5\RadarHistory"
oLink.Save

sLinkFile2 = "d:\mir-tankov-bot\Радар 6.0.lnk"
Set oLink2 = oWS.CreateShortcut(sLinkFile2)
oLink2.TargetPath = "d:\mir-tankov-bot\RadarV5\RadarHistory\RadarHistory.exe"
oLink2.WorkingDirectory = "d:\mir-tankov-bot\RadarV5\RadarHistory"
oLink2.Save
