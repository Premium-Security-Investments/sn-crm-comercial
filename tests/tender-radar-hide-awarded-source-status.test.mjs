import assert from 'node:assert/strict';

process.env.VERCEL = '1';
process.env.NEXT_PUBLIC_SUPABASE_URL = /^https?:\/\//i.test(process.env.NEXT_PUBLIC_SUPABASE_URL || '')
  ? process.env.NEXT_PUBLIC_SUPABASE_URL
  : 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'tender-awarded-status-test-key';

for (const [index, backendPath] of ['../server/index.js', '../api/[...path].js'].entries()) {
  const backend = await import(`${backendPath}?awarded-source-status=${index}`);
  assert.equal(typeof backend.isTenderTrackable, 'function', `${backendPath} debe exponer isTenderTrackable.`);

  const nestedSeleccionado = {
    status: 'Presentación de oferta',
    raw: { estado_del_procedimiento: 'Seleccionado' },
  };
  assert.equal(backend.isTenderTrackable(nestedSeleccionado), false, `${backendPath} debe excluir un proceso con estado oficial anidado Seleccionado aunque el estado de tope muestre presentación de oferta.`);

  const topLevelAdjudicado = { status: 'Adjudicado' };
  assert.equal(backend.isTenderTrackable(topLevelAdjudicado), false, `${backendPath} debe excluir un proceso oficial con estado de tope Adjudicado.`);

  const notAwardedYet = { status: 'Adjudicado: No' };
  assert.equal(backend.isTenderTrackable(notAwardedYet), true, `${backendPath} no debe tratar "Adjudicado: No" como prueba de adjudicación.`);

  const activePublicado = {
    status: 'Publicado',
    raw: { estado_del_procedimiento: 'Publicado', adjudicado: 'No' },
  };
  assert.equal(backend.isTenderTrackable(activePublicado), true, `${backendPath} debe conservar un proceso activo Publicado con campo adjudicado=No.`);

  const activePresentacionOferta = {
    status: 'Presentación de oferta',
    raw: { estado_del_procedimiento: 'Presentación de oferta', adjudicado: 'No' },
  };
  assert.equal(backend.isTenderTrackable(activePresentacionOferta), true, `${backendPath} debe conservar un proceso activo en presentación de oferta con campo adjudicado=No.`);
}

console.log('awarded official source status is hidden from radar without over-matching "Adjudicado: No"');
