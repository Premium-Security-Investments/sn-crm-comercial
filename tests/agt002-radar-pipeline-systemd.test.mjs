import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';const base=new URL('../ops/agt002-radar-pipeline/',import.meta.url);const files=['run-agt002-radar-pipeline.mjs','agt002-radar-pipeline.service','agt002-radar-pipeline.timer','env.example','README.md'];for(const file of files)assert.equal(existsSync(new URL(file,base)),true,file);const read=file=>readFileSync(new URL(file,base),'utf8');const runner=read(files[0]),service=read(files[1]),timer=read(files[2]),env=read(files[3]),readme=read(files[4]);assert.match(runner,/createAgt002RadarPipeline/);assert.equal((runner.match(/\bpipeline\.runOnce\(\)/g)||[]).length,1);assert.equal((runner.match(/\brefresher\.runOnce\(\)/g)||[]).length,1);assert.doesNotMatch(runner,/setInterval|setTimeout|while\s*\(|for\s*\(;;\)|fetch\(|https?:\/\//);assert.match(runner,/SUPABASE_SERVICE_ROLE_KEY/);assert.match(runner,/process\.exitCode\s*=\s*1/);assert.match(service,/Type=oneshot/);assert.match(service,/EnvironmentFile=/);assert.match(timer,/OnUnitActiveSec=/);assert.match(timer,/Persistent=false/);assert.doesNotMatch(timer,/RandomizedDelaySec=0\b/);assert.match(env,/^AGT002_RADAR_GATE=false$/m);for(const file of files){assert.equal(read(file).includes('systemctl '),false);assert.equal(read(file).includes('--apply'),false);}assert.match(readme,/autorizaci[oó]n separada/i);

// Hardening baseline: paridad exacta con ops/agt002-reanalysis-worker/agt002-reanalysis-worker.service.
// Se compara línea completa (no substring) para que `CapabilityBoundingSet=CAP_...` no pase como `CapabilityBoundingSet=`.
const HARDENING_BASELINE=['NoNewPrivileges=true','PrivateTmp=true','ProtectSystem=strict','ProtectHome=true','ProtectKernelTunables=true','ProtectKernelModules=true','ProtectKernelLogs=true','ProtectControlGroups=true','RestrictSUIDSGID=true','LockPersonality=true','CapabilityBoundingSet=','AmbientCapabilities=','RestrictAddressFamilies=AF_UNIX AF_NETLINK AF_INET AF_INET6','SystemCallArchitectures=native'];
const directiveCounter=unit=>{const lines=unit.split('\n').map(line=>line.trim());return directive=>lines.filter(line=>line===directive).length;};
const countPipeline=directiveCounter(service);
const worker=readFileSync(new URL('../ops/agt002-reanalysis-worker/agt002-reanalysis-worker.service',import.meta.url),'utf8');
const countWorker=directiveCounter(worker);
for(const rule of HARDENING_BASELINE){
  assert.equal(countPipeline(rule),1,`agt002-radar-pipeline.service debe declarar exactamente una vez: ${rule}`);
  assert.equal(countWorker(rule),1,`la baseline de referencia cambió; agt002-reanalysis-worker.service ya no la declara: ${rule}`);
}

// Sin regresión de privilegio. En systemd la última asignación gana: una segunda línea
// `RestrictSUIDSGID=false` dejaría intacta la primera y desactivaría la protección. Por eso cada
// nombre de la baseline debe aparecer exactamente una vez en todo el fichero, con su valor exacto.
const pipelineAssignments=service.split('\n').map(line=>line.trim());
for(const rule of HARDENING_BASELINE){
  const name=rule.slice(0,rule.indexOf('='));
  const assigned=pipelineAssignments.filter(line=>line.startsWith(`${name}=`));
  assert.deepEqual(assigned,[rule],`${name} debe asignarse una sola vez y con el valor de la baseline`);
}
assert.doesNotMatch(service,/^[ \t]*CapabilityBoundingSet=[ \t]*\S/m,'CapabilityBoundingSet debe quedar vacío');
assert.doesNotMatch(service,/^[ \t]*AmbientCapabilities=[ \t]*\S/m,'AmbientCapabilities debe quedar vacío');
assert.match('CapabilityBoundingSet=CAP_NET_RAW',/^[ \t]*CapabilityBoundingSet=[ \t]*\S/m,'sanity: valor no vacío debe detectarse');
assert.match('AmbientCapabilities=CAP_NET_RAW',/^[ \t]*AmbientCapabilities=[ \t]*\S/m,'sanity: valor no vacío debe detectarse');
assert.doesNotMatch('CapabilityBoundingSet=\nOtraDirectiva=algo',/^[ \t]*CapabilityBoundingSet=[ \t]*\S/m,'sanity: línea vacía no debe cruzar al siguiente renglón');
assert.doesNotMatch(service,/^\s*(User|Group)=root\s*$/m,'la unidad no corre como root');
assert.doesNotMatch(service,/^\s*PermissionsStartOnly=/m,'PermissionsStartOnly relaja el sandbox');
// Node necesita JIT: MemoryDenyWriteExecute queda deliberadamente fuera de la baseline.
assert.doesNotMatch(service,/^\s*MemoryDenyWriteExecute=/m,'MemoryDenyWriteExecute rompería el JIT de Node');

// Identidad y contrato de ejecución preservados.
for(const rule of ['User=psi-comercial','Group=psi-comercial','WorkingDirectory=/opt/psi-comercial/app','EnvironmentFile=/etc/psi-comercial/agt002-radar-pipeline.env','TimeoutStartSec=720','Type=oneshot'])assert.equal(countPipeline(rule),1,rule);

console.log('AGT-002 Radar one-shot systemd artifacts are present, hardened at worker parity and not enabled');
