import { CifraKit, millones, sinCodigo, type NotasCredito } from './SiioTorreAvancys';
import { SiioOperationsDetail } from './SiioOperationsPanel';
import { monthLabel, provisionRate, regionalName, type OperationsSummary, type Semana } from './operationsSummary';

// Operación (definida con Juan el 2026-11-17): cinco preguntas, con las reglas de la Portada. La 1 queda reservada hasta
// que haya fuente (la Programación del SIIO no se usa; Juan consigue el dato). Las notas crédito salen en vivo de Avancys;
// lo de SecurityOps, de la última extracción, con su fecha a la vista y aviso cuando está vieja.

// Desde estos días la extracción de SecurityOps se considera vieja y se dice arriba en ámbar.
export const DIAS_EXTRACCION_VIEJA = 2;
const cuenta = (n: number) => n.toLocaleString('es-CO');
const mayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1] || mes;
const mesAnterior = (mes: string) => {
  const [anio, numero] = mes.split('-').map(Number);
  return numero === 1 ? `${anio - 1}-12` : `${anio}-${String(numero - 1).padStart(2, '0')}`;
};
const fechaLarga = (iso: string) => new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', timeZone: 'America/Bogota' }).format(new Date(iso));

function Encabezado({ pregunta, periodo, tono = 'vivo' }: { pregunta: string; periodo: string; tono?: 'vivo' | 'confirmar' }) {
  return <div className="siio-sub" style={{ marginBottom: 6 }}>
    <h2>{pregunta}</h2>
    <span className={`siio-chip ${tono}`}>{periodo}</span>
  </div>;
}

// 2. ¿Cuánto nos descuentan por servicio no prestado? Del mes anterior (cerrado de facturación) contra el previo.
function NotasDelMes({ notas, hoy }: { notas: NotasCredito | null | undefined; hoy: Date }) {
  if (notas?.error) return <p className="siio-alert-text">No se pudieron leer las notas crédito de Avancys: {notas.error}</p>;
  const mes = mesAnterior(hoy.toISOString().slice(0, 7));
  const fila = notas?.meses?.[mes];
  const previo = notas?.meses?.[mesAnterior(mes)];
  if (!fila) return <p className="siio-nota">Sin notas crédito de {nombreMes(mes)} en Avancys.</p>;
  const sinMotivo = fila.sin_motivo.valor + fila.otro.valor;
  const notasSinMotivo = fila.sin_motivo.notas + fila.otro.notas;
  const dif = previo ? fila.no_prestado.valor - previo.no_prestado.valor : null;
  return <>
    <div className="siio-cifras siio-cifras-3">
      <CifraKit etiqueta="Servicio no prestado" valor={millones(fila.no_prestado.valor)} tono={dif !== null && dif > 1e6 ? 'mal' : undefined}
        nota={<>{cuenta(fila.no_prestado.notas)} {fila.no_prestado.notas === 1 ? 'nota que lo dice' : 'notas que lo dicen'}.{previo ? <span className={`ref ${dif !== null && Math.abs(dif) >= 1e6 ? (dif > 0 ? 'mal' : 'bien') : ''}`}>{nombreMes(mesAnterior(mes))}: {millones(previo.no_prestado.valor)}</span> : null}</>} />
      <CifraKit etiqueta="Sin motivo escrito" valor={millones(sinMotivo)}
        nota={<>{cuenta(notasSinMotivo)} notas sin un motivo claro: pueden ser servicio no prestado. Escribir el motivo · <strong>Facturación</strong></>} />
      <CifraKit etiqueta="Correcciones de facturación" valor={millones(fila.correccion.valor)}
        nota={`${cuenta(fila.correccion.notas)} notas que anulan una factura para refacturarla: no es plata perdida.`} />
    </div>
    {fila.clientes.length ? <div className="siio-tabla-wrap" style={{ marginTop: 10 }}><table className="siio-tabla apilable">
      <thead><tr><th>Cliente</th><th className="num">Sin motivo escrito</th><th className="num total">Servicio no prestado</th></tr></thead>
      <tbody>{fila.clientes.map(c => <tr key={c.cliente}>
        <td><span className="nombre">{sinCodigo(c.cliente)}</span></td>
        <td className="num" data-etiqueta="Sin motivo escrito"><strong>{c.sin_motivo ? millones(c.sin_motivo) : '—'}</strong></td>
        <td className="num total"><strong>{c.no_prestado ? millones(c.no_prestado) : '—'}</strong></td>
      </tr>)}</tbody>
    </table></div> : null}
    <p className="siio-nota" style={{ marginTop: 6 }}>Notas crédito de {nombreMes(mes)} en Avancys, sin IVA. El motivo se lee de la referencia de cada nota; Avancys no tiene un campo para él.</p>
  </>;
}

// 3. ¿Qué falló? La semana (últimos 7 días completos) cuando la extracción la trae; si no, el mes.
function LaSemana({ semana }: { semana: Semana }) {
  const pctNoLlego = semana.aprovisionamientos ? semana.noLlego / semana.aprovisionamientos : 0;
  return <div className="siio-cifras siio-cifras-4">
    <CifraKit etiqueta="Novedades críticas o altas" valor={cuenta(semana.novedadesCriticas)} tono={semana.novedadesCriticas ? 'mal' : undefined} nota="registradas por supervisores y motorizados" />
    <CifraKit etiqueta="El camión no llegó" valor={cuenta(semana.noLlego)} tono={pctNoLlego >= 0.05 ? 'mal' : undefined} nota={`de ${cuenta(semana.aprovisionamientos)} aperturas de descargue nocturno`} />
    <CifraKit etiqueta="Revistas canceladas" valor={cuenta(semana.revistasCanceladas)} tono={semana.revistas && semana.revistasCanceladas / semana.revistas >= 0.1 ? 'mal' : undefined} nota={`de ${cuenta(semana.revistas)} revistas nocturnas`} />
    <CifraKit etiqueta="Motorizados que empezaron tarde" valor={cuenta(semana.jornadasTarde)} tono={semana.jornadas && semana.jornadasTarde / semana.jornadas >= 0.5 ? 'mal' : undefined} nota={`de ${cuenta(semana.jornadas)} jornadas de noche`} />
  </div>;
}

function QueFallo({ ops }: { ops: OperationsSummary }) {
  const actual = ops.totals.current;
  const tasa = provisionRate(actual);
  const fallidos = Math.max(0, actual.aprovProgramados - actual.aprovCumplidos);
  const sinVisita = Math.max(0, actual.puestos - actual.visitados);
  return <div className="siio-cifras siio-cifras-3">
    <CifraKit etiqueta="Aprovisionamientos sin cumplir" valor={cuenta(fallidos)} tono={tasa !== null && tasa < 0.95 ? 'mal' : undefined}
      nota={actual.aprovProgramados ? `de ${cuenta(actual.aprovProgramados)} programados: ${Math.round((tasa || 0) * 100)} % cumplido` : 'sin aprovisionamientos programados'} />
    <CifraKit etiqueta="Puestos sin visita de supervisor" valor={cuenta(sinVisita)}
      nota={`de ${cuenta(actual.puestos)} puestos en las regionales que usan SecurityOps`} />
    <CifraKit etiqueta="Visitas de supervisor" valor={cuenta(actual.visitasSupervisor)}
      nota={ops.previousMonth ? `${mayuscula(monthLabel(ops.previousMonth))}: ${cuenta(ops.totals.previous.visitasSupervisor)}` : null} />
  </div>;
}

export function SiioPestanaOperacion({ notas, ops, hoy = new Date() }: { notas: NotasCredito | null | undefined; ops: OperationsSummary | null; hoy?: Date }) {
  const dias = ops?.extractedAt ? Math.floor((hoy.getTime() - new Date(ops.extractedAt).getTime()) / 86400000) : null;
  const corte = ops?.extractedAt ? fechaLarga(ops.extractedAt) : null;
  const periodoOps = ops ? `${mayuscula(monthLabel(ops.currentMonth))} · SecurityOps al ${corte}` : 'Sin datos de SecurityOps';
  const enUso = ops?.regionals.filter(r => r.status === 'en_uso') || [];
  const ciegas = ops?.regionals.filter(r => r.status !== 'en_uso') || [];
  const mesNotas = nombreMes(mesAnterior(hoy.toISOString().slice(0, 7)));
  return <>
    {dias !== null && dias >= DIAS_EXTRACCION_VIEJA ? <div className="siio-aviso-mes" role="note"><p><strong>Las cifras de SecurityOps son del {corte}: tienen {dias} días.</strong> La extracción diaria no ha corrido; mientras tanto, lo de las preguntas 3, 4 y 5 puede haber cambiado · <strong>Innovación</strong>.</p></div> : null}

    <section className="siio-panel" aria-label="¿Estamos prestando el servicio que cobramos?">
      <Encabezado pregunta="¿Estamos prestando el servicio que cobramos?" periodo="Sin fuente todavía" tono="confirmar" />
      <p className="siio-nota">Hace falta saber, por cliente, cuántas horas se prestaron contra las que se cobran. Avancys todavía no programa turnos y la Programación del SIIO no se usa. <strong>Gerencia</strong> está consiguiendo la fuente.</p>
    </section>

    <section className="siio-panel" aria-label="¿Cuánto nos descuentan por servicio no prestado?">
      <Encabezado pregunta="¿Cuánto nos descuentan por servicio no prestado?" periodo={`${mayuscula(mesNotas)} · Avancys`} />
      <NotasDelMes notas={notas} hoy={hoy} />
    </section>

    <section className="siio-panel" aria-label="¿Qué falló?">
      <Encabezado pregunta="¿Qué falló?" periodo={ops?.semana && corte ? `Últimos 7 días · SecurityOps al ${corte}` : periodoOps} tono={dias !== null && dias >= DIAS_EXTRACCION_VIEJA ? 'confirmar' : 'vivo'} />
      {ops?.semana ? <LaSemana semana={ops.semana} /> : null}
      {ops ? <>{ops.semana ? <p className="siio-nota" style={{ margin: '10px 0 6px' }}>En lo que va de {monthLabel(ops.currentMonth)}:</p> : null}<QueFallo ops={ops} /></> : <p className="siio-nota">Sin cifras de SecurityOps cargadas.</p>}
    </section>

    <section className="siio-panel" aria-label="¿La atención técnica está al día?">
      <Encabezado pregunta="¿La atención técnica está al día?" periodo={periodoOps} tono={dias !== null && dias >= DIAS_EXTRACCION_VIEJA ? 'confirmar' : 'vivo'} />
      {ops ? <div className="siio-cifras siio-cifras-2">
        <CifraKit etiqueta="Tickets técnicos abiertos" valor={cuenta(ops.totals.current.ticketsAbiertos)} nota={`${cuenta(ops.totals.current.visitasTecnico)} visitas técnicas en ${monthLabel(ops.currentMonth)}`} />
        <CifraKit etiqueta="Con más de 5 días sin respuesta" valor={cuenta(ops.totals.current.ticketsVencidos)} tono={ops.totals.current.ticketsVencidos ? 'mal' : undefined} nota="el plazo de SecurityOps para responder un reporte de falla" />
      </div> : <p className="siio-nota">Sin cifras de SecurityOps cargadas.</p>}
    </section>

    <section className="siio-panel" aria-label="¿Dónde no estamos midiendo?">
      <Encabezado pregunta="¿Dónde no estamos midiendo?" periodo="A hoy" />
      <ul className="siio-lista">
        <li><strong>Horas prestadas contra cobradas:</strong> sin fuente en ninguna regional (pregunta 1).</li>
        {ops ? <li><strong>Cumplimiento en SecurityOps:</strong> {enUso.length ? `se mide en ${enUso.map(r => regionalName(r.regional)).join(', ')}` : 'todavía no se mide en ninguna regional'}{ciegas.length ? `; ${cuenta(ciegas.reduce((s, r) => s + r.puestos, 0))} puestos en ${ciegas.length} ${ciegas.length === 1 ? 'regional sigue' : 'regionales siguen'} sin cifras (${ciegas.map(r => regionalName(r.regional)).join(', ')})` : ''} · <strong>Operaciones</strong>.</li> : null}
        <li><strong>Motivo de las notas crédito:</strong> las que no lo traen escrito no se pueden separar entre servicio no prestado y otros ajustes · <strong>Facturación</strong>.</li>
      </ul>
      {ops ? <details className="siio-plegado">
        <summary>SecurityOps · detalle por cliente y uso por regional</summary>
        <SiioOperationsDetail summary={ops} />
      </details> : null}
    </section>
  </>;
}
