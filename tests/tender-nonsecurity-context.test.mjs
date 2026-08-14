import assert from 'node:assert/strict';

process.env.VERCEL = '1';
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'tender-relevance-test-key';

for (const [index, backendPath] of ['../server/index.js', '../api/[...path].js'].entries()) {
  const backend = await import(`${backendPath}?non-security-context=${index}`);
  assert.equal(typeof backend.isTenderTrackable, 'function', `${backendPath} debe exponer isTenderTrackable para verificar relevancia.`);
  assert.equal(typeof backend.scoreTender, 'function', `${backendPath} debe exponer scoreTender para probar la señal comercial real.`);
  assert.equal(typeof backend.hasTenderServiceSignal, 'function', `${backendPath} debe exponer hasTenderServiceSignal para probar el gate del Radar.`);

  const objectFields = ['nombre_del_procedimiento', 'descripci_n_del_procedimiento'];
  const sanitaryInspectionTender = {
    nombre_del_procedimiento: 'PRESTACION DE SERVICIOS PROFESIONALES',
    descripci_n_del_procedimiento: 'PRESTACION DE SERVICIOS DE APOYO A LA GESTION PARA FORTALECER LAS ACCIONES DE INSPECCION VIGILANCIA PROMOCION Y PREVENCION DE RIESGOS SANITARIOS Y AMBIENTALES DEL PROGRAMA DE AGUA Y SANEAMIENTO EN EL MARCO DEL EJE ESTRATEGICO DE SALUD AMBIENTAL RELACIONADAS CON EL AGUA PARA CONSUMO HUMANO Y LOS ESTABLECIMIENTOS SUJETOS A VIGILANCIA',
    entidad: 'MUNICIPIO DE PEREIRA- OFICIAL',
    ciudad_entidad: 'Pereira',
    departamento_entidad: 'Risaralda',
    precio_base: '12133333',
  };
  const sanitaryScored = backend.scoreTender(sanitaryInspectionTender, objectFields);
  assert.equal(backend.hasTenderServiceSignal(sanitaryScored), false, `${backendPath} no debe aceptar vigilancia aislada en inspección sanitaria/ambiental.`);
  assert.equal(backend.hasTenderServiceSignal({ reasons: ['vigilancia'] }), false, `${backendPath} debe retirar del Radar historizado los registros admitidos sólo por la palabra vigilancia.`);

  const contextualPhysicalSecurityTender = {
    nombre_del_procedimiento: 'Contratar vigilancia para proteger las instalaciones, bienes y personas de la entidad',
    descripci_n_del_procedimiento: 'Cobertura permanente en las sedes institucionales.',
    precio_base: '750000000',
  };
  const contextualScored = backend.scoreTender(contextualPhysicalSecurityTender, objectFields);
  assert.equal(backend.hasTenderServiceSignal(contextualScored), true, `${backendPath} debe conservar vigilancia con contexto explícito de seguridad física.`);

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

  const nonCommercialSecurityAgreement = {
    objeto_a_contratar: 'Servicios Políticos y de Asuntos Cívicos',
    detalle_del_objeto_a_contratar: 'AUNAR ESFUERZOS ADMINISTRATIVOS Y FINANCIEROS entre la Secretaría Distrital de Seguridad y los Fondos de Desarrollo Local para el suministro e instalación de cámaras en puntos de videovigilancia existentes.',
    nombre_entidad: 'BOGOTÁ D.C. - ALCALDÍA LOCAL DE SUBA',
    municipio_entidad: 'Bogotá D.C.',
    cuantia_proceso: '907233362',
    estado_del_proceso: 'Convocado',
  };
  assert.equal(backend.isTenderTrackable(nonCommercialSecurityAgreement), false, `${backendPath} debe excluir convenios para aunar esfuerzos aunque mencionen cámaras o videovigilancia.`);

  const alreadyExecutedSecurityProcess = {
    objeto_a_contratar: 'Servicio de vigilancia y seguridad privada',
    detalle_del_objeto_a_contratar: 'Protección de instalaciones mediante vigilancia armada.',
    estado_del_proceso: 'Celebrado',
  };
  assert.equal(backend.isTenderTrackable(alreadyExecutedSecurityProcess), false, `${backendPath} debe excluir procesos ya celebrados del Radar activo.`);

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
