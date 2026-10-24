import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ESTADOS,
  FORMAS,
  FRESCURAS,
  peorEstado,
  puedeLeer,
  resolverCodigosRup,
  resolverCompanyFit,
  resolverIdentidadEmpresa,
  resolverParaLector,
  vencimientoDelCertificado,
} from '../catalogo-fuentes.js';

// Base de datos de mentira con el encadenamiento mínimo que usan los resolvedores:
// select/eq/order/limit devuelven la cadena; maybeSingle y el await resuelven filas.
function baseDeDatos(tablas, { ausentes = [] } = {}) {
  return {
    from(tabla) {
      const filtros = [];
      const filas = () => (tablas[tabla] || []).filter(fila => filtros.every(([clave, valor]) => fila[clave] === valor));
      const resultado = () => (ausentes.includes(tabla)
        ? { data: null, error: { code: 'PGRST205', message: 'tabla ausente' } }
        : { data: filas(), error: null });
      const cadena = {
        select() { return cadena; },
        eq(clave, valor) { filtros.push([clave, valor]); return cadena; },
        order() { return cadena; },
        limit() { return cadena; },
        maybeSingle() {
          const salida = resultado();
          return Promise.resolve(salida.error ? salida : { data: salida.data[0] || null, error: null });
        },
        then(resolver, rechazar) { return Promise.resolve(resultado()).then(resolver, rechazar); },
      };
      return cadena;
    },
  };
}

const CODIGOS_TIPADOS = [
  { codigo: '46151600', descripcion: 'Equipo de seguridad y control', contratos_con_el_codigo: 66, contratos_base: 101, inscrito_al: '2026-09-28', fuente: 'Certificado RUP 28/09/2026' },
  { codigo: '92121500', descripcion: 'Servicios de guardias', contratos_con_el_codigo: 101, contratos_base: 101, inscrito_al: '2026-09-28', fuente: 'Certificado RUP 28/09/2026' },
];

test('el peor estado gana: una respuesta no es más cierta que su insumo más débil', () => {
  assert.equal(peorEstado([ESTADOS.VIGENTE, ESTADOS.VIGENTE]), ESTADOS.VIGENTE);
  assert.equal(peorEstado([ESTADOS.VIGENTE, ESTADOS.EN_DISPUTA]), ESTADOS.EN_DISPUTA);
  assert.equal(peorEstado([ESTADOS.EN_DISPUTA, ESTADOS.NO_VERIFICADO]), ESTADOS.NO_VERIFICADO);
  assert.equal(peorEstado([ESTADOS.VIGENTE, ESTADOS.VENCIDO]), ESTADOS.VENCIDO);
});

test('sin estados declarados la respuesta nace no verificada, nunca vigente', () => {
  assert.equal(peorEstado([]), ESTADOS.NO_VERIFICADO);
  assert.equal(peorEstado(['inventado']), ESTADOS.NO_VERIFICADO);
});

test('negado por defecto: el silencio significa no', () => {
  assert.equal(puedeLeer('empresa.identidad', 'agt002.mesa'), true);
  assert.equal(puedeLeer('empresa.identidad', 'agt003.copiloto'), false);
  assert.equal(puedeLeer('dato.inexistente', 'agt002.mesa'), false);
});

test('el certificado del RUP vence a los 60 días calendario; el hecho inscrito no', () => {
  assert.equal(vencimientoDelCertificado('2026-09-28'), '2026-11-27');
  assert.equal(vencimientoDelCertificado(null), null);
});

test('los códigos del RUP se sirven tipados, con su base de conteo y su vencimiento', async () => {
  const resuelto = await resolverCodigosRup(baseDeDatos({ psi_company_rup_codes: CODIGOS_TIPADOS }));
  assert.equal(resuelto.forma, FORMAS.TIPADO);
  assert.equal(resuelto.interpretable, false);
  assert.equal(resuelto.frescura, FRESCURAS.CONGELADA_CON_VENCIMIENTO);
  assert.equal(resuelto.valor.total, 2);
  assert.equal(resuelto.valor.inscritos_al, '2026-09-28');
  assert.equal(resuelto.vence_el, '2026-11-27');
  // La frecuencia viaja con la base sobre la que se contó: 101 contratos, no los 103 de hoy.
  assert.equal(resuelto.valor.codigos[1].contratos_base, 101);
  assert.equal(resuelto.procedencia.tabla, 'psi_company_rup_codes');
});

test('sin la tabla tipada cae a la prosa y lo declara, en vez de devolver vacío en silencio', async () => {
  const database = baseDeDatos({
    psi_company_procurement_profile: [{
      rup_unspsc_codes: '14 códigos inscritos, al 28/09/2026.\n46151600: Equipo (66)\n92121500: Guardias (101)\n46151600: repetido',
      rup_updated_at: '2026-09-28',
      updated_at: '2026-10-13T00:00:00.000Z',
    }],
  }, { ausentes: ['psi_company_rup_codes'] });
  const resuelto = await resolverCodigosRup(database);
  assert.equal(resuelto.forma, FORMAS.PROSA);
  assert.equal(resuelto.interpretable, true);
  assert.deepEqual(resuelto.valor.codigos, ['46151600', '92121500']);
  assert.match(resuelto.procedencia.nota, /prosa/);
});

test('un certificado viejo sale marcado vencido, no silenciosamente vigente', async () => {
  const viejos = CODIGOS_TIPADOS.map(fila => ({ ...fila, inscrito_al: '2020-01-01' }));
  const resuelto = await resolverCodigosRup(baseDeDatos({ psi_company_rup_codes: viejos }));
  assert.equal(resuelto.estado, ESTADOS.VENCIDO);
  assert.equal(resuelto.vence_el, '2020-03-01');
});

test('la identidad de la empresa viaja como porción, no como el perfil entero', async () => {
  const resuelto = await resolverIdentidadEmpresa(baseDeDatos({
    psi_company_procurement_profile: [{
      legal_name: 'SEGURIDAD NACIONAL LIMITADA',
      nit: '891408256-4',
      supervigilancia_license: 'Resolución 1234',
      rup_updated_at: '2026-09-28',
      updated_at: '2026-10-13T00:00:00.000Z',
    }],
  }));
  assert.equal(resuelto.valor.razon_social, 'SEGURIDAD NACIONAL LIMITADA');
  assert.equal(resuelto.valor.nit, '891408256-4');
  assert.equal(Object.keys(resuelto.valor).length, 3);
  assert.equal(resuelto.estado, ESTADOS.VIGENTE);
});

test('sin perfil cargado la identidad sale no verificada, nunca inventada', async () => {
  const resuelto = await resolverIdentidadEmpresa(baseDeDatos({ psi_company_procurement_profile: [] }));
  assert.equal(resuelto.estado, ESTADOS.NO_VERIFICADO);
  assert.equal(resuelto.valor, null);
});

test('company_fit se sirve del análisis canónico congelado, por sección', async () => {
  const database = baseDeDatos({
    psi_tender_analysis_runs: [{
      id: 'run-1',
      tender_id: 'tender-1',
      canonical: true,
      result: { company_fit: { veredicto: 'parcial' }, claims: ['…'] },
      updated_at: '2026-10-22T00:00:00.000Z',
    }],
  });
  const resuelto = await resolverCompanyFit(database, { tenderId: 'tender-1' });
  assert.deepEqual(resuelto.valor, { veredicto: 'parcial' });
  assert.equal(resuelto.frescura, FRESCURAS.CONGELADA);
  assert.equal(resuelto.procedencia.run_id, 'run-1');
  assert.equal(resuelto.procedencia.seccion, 'company_fit');
});

test('sin proceso en el expediente company_fit no inventa: declara que no lo tiene', async () => {
  const resuelto = await resolverCompanyFit(baseDeDatos({}), { tenderId: '' });
  assert.equal(resuelto.estado, ESTADOS.NO_VERIFICADO);
  assert.match(resuelto.procedencia.nota, /sin proceso/);
});

test('el servidor resuelve por adelantado solo lo que ese lector puede leer', async () => {
  const database = baseDeDatos({
    psi_company_rup_codes: CODIGOS_TIPADOS,
    psi_company_procurement_profile: [{ legal_name: 'SEGURIDAD NACIONAL LIMITADA', nit: '891408256-4', updated_at: '2026-10-13T00:00:00.000Z' }],
  });
  const resueltos = await resolverParaLector(database, {
    lector: 'agt002.mesa',
    nombres: ['empresa.identidad', 'empresa.codigos_rup', 'empresa.sedes', 'dato.inexistente'],
  });
  const nombres = resueltos.map(entrada => entrada.nombre);
  assert.deepEqual(nombres, ['empresa.identidad', 'empresa.codigos_rup']);
  assert.equal(resueltos[0].responsable, 'Katherine');
});

test('cada respuesta resuelta dice de cuándo es y de dónde salió', async () => {
  const resueltos = await resolverParaLector(baseDeDatos({ psi_company_rup_codes: CODIGOS_TIPADOS }), {
    lector: 'agt002.mesa',
    nombres: ['empresa.codigos_rup'],
  });
  assert.equal(resueltos.length, 1);
  assert.ok(resueltos[0].as_of, 'la respuesta debe traer su fecha de corte');
  assert.ok(resueltos[0].procedencia, 'la respuesta debe traer su procedencia');
  assert.ok(Object.isFrozen(resueltos[0]));
});
