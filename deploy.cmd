@echo off
rem Deploys everything: the API (functions), the Firestore rules and indexes, the Storage rules and the web app (hosting).
rem The builds run by themselves first (the predeploy steps in firebase.json). It stops at the first error.
rem   deploy.cmd             everything
rem   deploy.cmd hosting     only the parts named (functions, firestore, storage, hosting; comma separated)
setlocal
cd /d "%~dp0"

set TARGETS=functions,firestore,storage,hosting
if not "%~1"=="" set TARGETS=%~1

echo Syncing the shared models...
call node scripts\sync-models.mjs
if errorlevel 1 goto :failed

echo Deploying: %TARGETS%
call firebase deploy --only %TARGETS%
if errorlevel 1 goto :failed

echo.
echo Deployed. Reload the app with Ctrl+F5 (on a phone: close and open it) to get the new version.
exit /b 0

:failed
echo.
echo Deploy stopped because of an error (see above). Nothing after the failing step was deployed.
exit /b 1
