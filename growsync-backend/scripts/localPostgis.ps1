param([ValidateSet('Start','Stop')][string]$Action='Start')
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$localRoot=Join-Path $repoRoot '.local-postgis'
$runtime=Join-Path $localRoot 'runtime/pgsql'
$cluster=Join-Path $localRoot 'data'
if(-not $cluster.StartsWith($repoRoot+[IO.Path]::DirectorySeparatorChar)){throw 'Cluster must stay in this workspace'}
if($Action -eq 'Stop'){
  if(Test-Path (Join-Path $cluster 'postmaster.pid')){& (Join-Path $runtime 'bin/pg_ctl.exe') -D $cluster -m fast -w stop;if($LASTEXITCODE -ne 0){throw 'Cannot stop test cluster'}}
  exit
}
if(-not(Test-Path (Join-Path $runtime 'share/extension/postgis.control'))){
  $postgis=Join-Path $localRoot 'postgis/postgis-bundle-pg17-3.6.2x64'
  foreach($folder in @('bin','lib','share')){Copy-Item -Path (Join-Path $postgis "$folder/*") -Destination (Join-Path $runtime $folder) -Recurse -Force}
}
$configPath=Join-Path $localRoot 'connection.json'
if(-not(Test-Path $configPath)){
  $password=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
  @{host='127.0.0.1';port=55439;user='growsync_validation';password=$password;database='growsync_test_stock_initial'} | ConvertTo-Json | Set-Content -LiteralPath $configPath
  Set-Content -LiteralPath (Join-Path $localRoot 'init-password.txt') -Value $password -Encoding ascii
}
if(-not(Test-Path (Join-Path $cluster 'PG_VERSION'))){
  $passwordFile=Join-Path $localRoot 'init-password.txt'
  & (Join-Path $runtime 'bin/initdb.exe') -D $cluster -U growsync_validation --auth=scram-sha-256 --encoding=UTF8 --locale=C "--pwfile=$passwordFile"
  if($LASTEXITCODE -ne 0){throw 'initdb failed'}
  @("listen_addresses = '127.0.0.1'",'port = 55439',"lc_messages = 'C'",'max_connections = 30') | Add-Content -LiteralPath (Join-Path $cluster 'postgresql.conf')
}
if(-not(Test-Path (Join-Path $cluster 'postmaster.pid'))){
  $process=Start-Process -FilePath (Join-Path $runtime 'bin/postgres.exe') -ArgumentList @('-D',('"'+$cluster+'"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $localRoot 'server.out.log') -RedirectStandardError (Join-Path $localRoot 'server.err.log')
  $process.Id | Set-Content -LiteralPath (Join-Path $localRoot 'launched-pid.txt')
}
Write-Output 'Portable test cluster requested on 127.0.0.1:55439; no Windows service or production configuration changed.'
