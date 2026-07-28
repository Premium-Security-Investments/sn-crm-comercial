import assert from 'node:assert/strict';

process.env.VERCEL = '1';
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'tender-relevance-test-key';

for (const [index, backendPath] of ['../server/index.js', '../api/[...path].js'].entries()) {
  const backend = await import(`${backendPath}?non-security-context=${index}`);
  assert.equal(typeof backend.isTenderTrackable, 'function', `${backendPath} debe exponer isTenderTrackable para verificar relevancia.`);

  const avianHealthTender = {
    nombre_del_procedimiento: 'Aunar esfuerzos para mantener el estatus sanitario libre de Influenza Aviar',
    descripci_n_del_procedimiento: 'Acciones de sanidad aviar, vigilancia epidemiológica, análisis diagnóstico veterinario y bioseguridad para controlar la tifosis aviar y Newcastle.',
    entidad: 'INSTITUTO COLOMBIANO AGROPECUARIO - ICA',
    ciudad_entidad: 'Bogotá',
    departamento_entidad: 'Distrito Capital de Bogotá',
    precio_base: '11539098400',
    fase: 'Presentación de oferta',
  };
  assert.equal(backend.isTenderTrackable(avianHealthTender), false, `${backendPath} debe excluir vigilancia epidemiológica/sanidad aviar antes del Radar.`);

  const healthSurveillanceTender = {
    objeto_a_contratar: 'Fortalecer la vigilancia sanitaria y epidemiológica en salud pública',
    municipio_entidad: 'Medellín',
    cuantia_proceso: '900000000',
  };
  assert.equal(backend.isTenderTrackable(healthSurveillanceTender), false, `${backendPath} debe excluir vigilancia sanitaria o de salud pública.`);

  const securityTender = {
    nombre_del_procedimiento: 'Servicio de vigilancia y seguridad privada con armas y sin armas',
    descripci_n_del_procedimiento: 'Protección de instalaciones a nivel nacional.',
    entidad: 'Entidad pública',
    ciudad_entidad: 'Bogotá',
    precio_base: '3500000000',
  };
  assert.equal(backend.isTenderTrackable(securityTender), true, `${backendPath} debe conservar procesos reales de vigilancia y seguridad privada.`);
}

console.log('non-security tender contexts are excluded before Radar');
