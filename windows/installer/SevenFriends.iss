; The installer of Seven Friends for Windows (Inno Setup 6, https://jrsoftware.org/isinfo.php).
; First: npm run windows:publish (makes windows/publish), then: npm run windows:installer  ->  windows/installer/output/SevenFriendsSetup.exe
; It installs for the current person only (no administrator needed), with a Start menu entry and an optional desktop icon.
[Setup]
AppId={{6F2C8E3A-4B7D-4E59-9A1C-5D3E7B9F0A12}
AppName=Seven Friends
AppVersion=1.0.0
AppPublisher=Blueboot R&D AS
AppPublisherURL=https://sevenfriends.io
DefaultDirName={autopf}\Seven Friends
DefaultGroupName=Seven Friends
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2
SolidCompression=yes
OutputDir=output
OutputBaseFilename=SevenFriendsSetup
SetupIconFile=..\app.ico
UninstallDisplayIcon={app}\SevenFriends.exe
WizardStyle=modern

[Tasks]
Name: "desktopicon"; Description: "Put an icon on the desktop"; GroupDescription: "Icons:"
Name: "startup"; Description: "Start Seven Friends when I sign in to Windows (hidden, next to the clock), so new messages arrive as notifications"; GroupDescription: "Notifications:"

[Files]
Source: "..\publish\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Seven Friends"; Filename: "{app}\SevenFriends.exe"
Name: "{autodesktop}\Seven Friends"; Filename: "{app}\SevenFriends.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "SevenFriends"; ValueData: """{app}\SevenFriends.exe"" --tray"; Flags: uninsdeletevalue; Tasks: startup

[Run]
Filename: "{app}\SevenFriends.exe"; Description: "Open Seven Friends"; Flags: nowait postinstall skipifsilent
