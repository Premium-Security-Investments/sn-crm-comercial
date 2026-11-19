import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../apiClient';

// AGT-001 «Pregúntele a Vig-IA» (Juan, 2026-11-19; maqueta aprobada el mismo día): el directivo pregunta en sus
// palabras y Vig-IA contesta en 1 o 2 minutos leyendo Avancys, SecurityOps y el CRM. Cada persona ve solo lo suyo.
// La respuesta sigue las reglas de la Torre: lo que hay que saber antes de creerle va arriba en ámbar, cada cifra
// con su detalle, la lista con nombres y «¿Cómo lo calculé?» con la fuente y la hora del corte.

export type Cifra = { rotulo: string; valor: string; detalle: string; atencion: boolean };
export type Respuesta = {
  respuesta: string;
  aviso: string;
  cifras: Cifra[];
  pasos: string[];
  fuentes: string[];
  faltantes: { dato: string; responsable: string }[];
  corte: string;
};
export type TablaRespuesta = { titulo: string; columnas: string[]; filas: (string | number | null)[][]; total: number; recortado: boolean };
export type Pregunta = {
  id: string;
  question: string;
  parent_id: string | null;
  status: 'pendiente' | 'leyendo' | 'respondida' | 'fallida';
  answer: Respuesta | null;
  answer_table: TablaRespuesta | null;
  failure_code: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
};
type Estado = { preguntas: Pregunta[]; puede_ver_aprendizaje: boolean };
type Aprendizaje = {
  mas_preguntadas: { pregunta: string; veces: number; personas: number; ultima: string; sin_respuesta: number }[];
  conocimiento: { id: string; topic: string; note: string; uses: number; updated_at: string }[];
};

const EJEMPLOS = [
  '¿Cuántas mujeres hay en la empresa?',
  '¿Cuántos empleados tienen más de 60 años?',
  '¿Cuánto suma la nómina de supervisores este mes?',
];
const FILAS_A_LA_VISTA = 10;
const ESPERA_MS = 5_000;

const FALLAS: Record<string, string> = {
  VIGIA_SESION_VENCIDA: 'La sesión de Claude de Vig-IA Gerencia venció. Avise a Innovación para renovarla y vuelva a preguntar.',
  VIGIA_LIMITE: 'Se alcanzó el límite de uso de la suscripción de Claude. Vuelva a preguntar más tarde.',
  VIGIA_TIEMPO: 'Vig-IA no alcanzó a contestar en 8 minutos. Intente con una pregunta más acotada.',
  VIGIA_ABANDONADA: 'La respuesta se interrumpió. Vuelva a preguntar.',
};

export function textoFalla(codigo: string | null) {
  return (codigo && FALLAS[codigo]) || 'Vig-IA no pudo contestar esta pregunta. Vuelva a intentarlo o pregúntela de otra forma.';
}

export function horaBogota(iso: string | null) {
  if (!iso) return '';
  const fecha = new Date(iso);
  const hoy = new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }) === fecha.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });
  return fecha.toLocaleString('es-CO', { timeZone: 'America/Bogota', ...(hoy ? {} : { day: 'numeric', month: 'short' }), hour: 'numeric', minute: '2-digit' });
}

export function duracion(ms: number | null) {
  if (!ms || ms < 0) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** CSV con BOM y punto y coma (Excel en español lo abre en columnas). */
export function csvParaExcel(tabla: TablaRespuesta) {
  const celda = (valor: unknown) => {
    const texto = valor === null || valor === undefined ? '' : String(valor);
    return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  return `﻿${[tabla.columnas, ...tabla.filas].map(fila => fila.map(celda).join(';')).join('\r\n')}`;
}

function descargar(tabla: TablaRespuesta) {
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(new Blob([csvParaExcel(tabla)], { type: 'text/csv;charset=utf-8' }));
  enlace.download = `vig-ia-${new Date().toISOString().slice(0, 10)}.csv`;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
}

function TablaDeRespuesta({ tabla }: { tabla: TablaRespuesta }) {
  const [todas, setTodas] = useState(false);
  const filas = todas ? tabla.filas : tabla.filas.slice(0, FILAS_A_LA_VISTA);
  return <div className="siio-vigia-tabla">
    <h4>{tabla.titulo}</h4>
    <div className="siio-tabla-wrap">
      <table className="siio-tabla apilable">
        <thead><tr>{tabla.columnas.map(columna => <th key={columna} scope="col">{columna.replace(/_/g, ' ')}</th>)}</tr></thead>
        <tbody>{filas.map((fila, i) => <tr key={i}>{fila.map((valor, j) => <td key={j} data-etiqueta={tabla.columnas[j].replace(/_/g, ' ')}>{valor ?? '—'}</td>)}</tr>)}</tbody>
      </table>
    </div>
    <p className="siio-nota">
      {filas.length < tabla.filas.length ? `Se ven ${filas.length} de ${tabla.filas.length}.` : `${tabla.filas.length} ${tabla.filas.length === 1 ? 'fila' : 'filas'}.`}
      {tabla.recortado ? ` Vig-IA encontró ${tabla.total}; aquí y en el archivo van las primeras ${tabla.filas.length}.` : ''}
    </p>
    <div className="siio-vigia-acciones">
      {tabla.filas.length > FILAS_A_LA_VISTA ? <button type="button" className="siio-boton-secundario" onClick={() => setTodas(!todas)}>{todas ? 'Ver menos' : `Ver las ${tabla.filas.length}`}</button> : null}
      <button type="button" className="siio-boton-secundario" onClick={() => descargar(tabla)}>Descargar para Excel</button>
    </div>
  </div>;
}

function TarjetaRespuesta({ pregunta, onSeguir }: { pregunta: Pregunta; onSeguir: (pregunta: Pregunta) => void }) {
  const a = pregunta.answer;
  if (pregunta.status === 'pendiente' || pregunta.status === 'leyendo') {
    return <article className="siio-panel siio-vigia-respuesta" aria-label="Pregunta en curso" aria-busy="true">
      <header><h3>{pregunta.question}</h3><span className="siio-chip">{pregunta.status === 'pendiente' ? 'En cola' : 'Vig-IA está leyendo los datos'}</span></header>
      <p className="siio-nota">Usted preguntó a las {horaBogota(pregunta.requested_at)}. La respuesta aparece aquí en 1 o 2 minutos; puede seguir en otra pestaña.</p>
    </article>;
  }
  if (pregunta.status === 'fallida' || !a) {
    return <article className="siio-panel siio-vigia-respuesta" aria-label="Pregunta sin respuesta">
      <header><h3>{pregunta.question}</h3></header>
      <p className="siio-alert-text" role="alert">{textoFalla(pregunta.failure_code)}</p>
    </article>;
  }
  return <article className="siio-panel siio-vigia-respuesta" aria-label="Respuesta de Vig-IA">
    <header>
      <h3>{pregunta.question}</h3>
      <p className="siio-nota">Usted preguntó a las {horaBogota(pregunta.requested_at)}{pregunta.duration_ms ? ` · Vig-IA respondió en ${duracion(pregunta.duration_ms)}` : ''}</p>
    </header>
    {a.aviso ? <div className="siio-aviso-mes" role="note"><p><strong>Antes de creerle a esta cifra:</strong> {a.aviso}</p></div> : null}
    {a.cifras.length ? <div className="siio-vigia-cifras">
      {a.cifras.map(cifra => <div key={cifra.rotulo} className={`siio-cifra${cifra.atencion ? ' atencion' : ''}`}>
        <span>{cifra.rotulo}</span><strong>{cifra.valor}</strong>{cifra.detalle ? <small>{cifra.detalle}</small> : null}
      </div>)}
    </div> : null}
    <p className="siio-vigia-texto">{a.respuesta}</p>
    {pregunta.answer_table?.columnas?.length ? <TablaDeRespuesta tabla={pregunta.answer_table} /> : null}
    {a.faltantes.length ? <div className="siio-vigia-faltantes">
      <h4>¿Qué faltó para contestar completo?</h4>
      <ul>{a.faltantes.map(f => <li key={f.dato}>{f.dato}{f.responsable ? <> · <strong>{f.responsable}</strong></> : null}</li>)}</ul>
    </div> : null}
    <details className="siio-vigia-calculo">
      <summary>¿Cómo lo calculé?</summary>
      <ol>{a.pasos.map(paso => <li key={paso}>{paso}</li>)}</ol>
      <p className="siio-nota">Fuente: {a.fuentes.length ? a.fuentes.join(' · ') : 'sin fuente declarada'} · corte {horaBogota(a.corte)}</p>
    </details>
    <div className="siio-vigia-acciones">
      <button type="button" className="siio-link-button" onClick={() => onSeguir(pregunta)}>Preguntar algo sobre esta respuesta</button>
    </div>
  </article>;
}

function LoQueAprende() {
  const [datos, setDatos] = useState<Aprendizaje | null>(null);
  const [error, setError] = useState(false);
  const cargar = useCallback(() => {
    api<Aprendizaje>('/api/siio/preguntas/aprendizaje').then(r => { setDatos(r); setError(false); }).catch(() => setError(true));
  }, []);
  const quitar = async (id: string) => {
    setDatos(actual => actual && { ...actual, conocimiento: actual.conocimiento.filter(k => k.id !== id) });
    await api(`/api/siio/preguntas/conocimiento/${id}/quitar`, { method: 'POST' }).catch(cargar);
  };
  return <details className="siio-panel siio-vigia-aprende" onToggle={event => { if ((event.target as HTMLDetailsElement).open && !datos) cargar(); }}>
    <summary><h3>¿Qué está aprendiendo Vig-IA?</h3><span className="siio-nota">Solo lo ve el administrador.</span></summary>
    {error ? <p className="siio-nota">No se pudo cargar.</p> : null}
    {datos ? <div className="siio-vigia-aprende-cuerpo">
      <section aria-label="Lo que más se pregunta">
        <h4>Lo que más se pregunta (90 días, sin respuestas ni nombres)</h4>
        {datos.mas_preguntadas.length ? <ul>{datos.mas_preguntadas.map(p => <li key={p.pregunta}>
          {p.pregunta} <span className="siio-nota">· {p.veces} {p.veces === 1 ? 'vez' : 'veces'}, {p.personas} {p.personas === 1 ? 'persona' : 'personas'}{p.sin_respuesta ? `, ${p.sin_respuesta} sin respuesta` : ''}</span>
        </li>)}</ul> : <p className="siio-nota">Todavía no hay preguntas.</p>}
      </section>
      <section aria-label="Lo que Vig-IA aprendió">
        <h4>Lo que Vig-IA aprendió de los datos</h4>
        <p className="siio-nota">Vig-IA lo lee antes de cada pregunta. Si algo está mal, quítelo y lo volverá a buscar.</p>
        {datos.conocimiento.length ? <ul>{datos.conocimiento.map(k => <li key={k.id}>
          <strong>{k.topic}:</strong> {k.note} <span className="siio-nota">· usado {k.uses} {k.uses === 1 ? 'vez' : 'veces'}</span>{' '}
          <button type="button" className="siio-link-button" onClick={() => void quitar(k.id)}>Quitar</button>
        </li>)}</ul> : <p className="siio-nota">Todavía no ha aprendido nada.</p>}
      </section>
    </div> : null}
  </details>;
}

export function SiioPreguntas() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [texto, setTexto] = useState('');
  const [sobre, setSobre] = useState<Pregunta | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);
  const entrada = useRef<HTMLTextAreaElement>(null);

  const cargar = useCallback(() => {
    api<Estado>('/api/siio/preguntas').then(setEstado).catch(() => setMensaje('No se pudieron cargar sus preguntas.'));
  }, []);
  useEffect(cargar, [cargar]);

  const enCurso = estado?.preguntas.some(p => p.status === 'pendiente' || p.status === 'leyendo') ?? false;
  useEffect(() => {
    if (!enCurso) return undefined;
    const reloj = setInterval(cargar, ESPERA_MS);
    return () => clearInterval(reloj);
  }, [enCurso, cargar]);

  const preguntar = async (event: FormEvent) => {
    event.preventDefault();
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    setMensaje('');
    try {
      const nueva = await api<Pregunta>('/api/siio/preguntas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: texto, parent_id: sobre?.id ?? null }),
      });
      setEstado(actual => ({ preguntas: [nueva, ...(actual?.preguntas || [])], puede_ver_aprendizaje: actual?.puede_ver_aprendizaje ?? false }));
      setAbierta(nueva.id);
      setTexto('');
      setSobre(null);
    } catch (reason) {
      setMensaje(reason instanceof Error ? reason.message : 'No se pudo enviar la pregunta.');
    } finally {
      setEnviando(false);
    }
  };

  const seguir = (pregunta: Pregunta) => {
    setSobre(pregunta);
    entrada.current?.focus();
    entrada.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const preguntas = estado?.preguntas || [];
  const visible = preguntas.find(p => p.id === abierta) || preguntas[0] || null;
  const anteriores = preguntas.filter(p => p.id !== visible?.id);

  return <div className="siio-vigia-preguntas">
    <section className="siio-panel siio-vigia-caja" aria-label="Pregúntele a Vig-IA">
      <div>
        <h2 className="siio-titulo-pantalla">¿Qué quiere saber?</h2>
        <p className="siio-nota">Pregunte en sus palabras. Vig-IA lee Avancys, SecurityOps y el CRM, y contesta en 1 o 2 minutos con la fuente y la fecha de cada cifra. Solo usted ve sus preguntas y respuestas.</p>
      </div>
      <form onSubmit={event => void preguntar(event)}>
        {sobre ? <p className="siio-vigia-sobre">Sobre: «{sobre.question}» <button type="button" className="siio-link-button" onClick={() => setSobre(null)}>Quitar</button></p> : null}
        <div className="siio-vigia-fila">
          <label htmlFor="vigia-pregunta" className="sr-only">Su pregunta</label>
          <textarea id="vigia-pregunta" ref={entrada} rows={2} maxLength={600} value={texto}
            placeholder="Por ejemplo: ¿cuántos vigilantes tienen más de 60 años en Cali?"
            onChange={event => setTexto(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void preguntar(event); } }} />
          <button type="submit" className="siio-boton-primario" disabled={enviando || enCurso || texto.trim().length < 3}>
            {enCurso ? 'Contestando…' : enviando ? 'Enviando…' : 'Preguntar'}
          </button>
        </div>
      </form>
      <div className="siio-vigia-ejemplos">
        <span className="siio-nota">Por ejemplo:</span>
        {EJEMPLOS.map(ejemplo => <button key={ejemplo} type="button" className="siio-vigia-ejemplo" onClick={() => { setTexto(ejemplo); entrada.current?.focus(); }}>{ejemplo}</button>)}
      </div>
      {mensaje ? <p className="siio-alert-text" role="alert">{mensaje}</p> : null}
    </section>

    {visible ? <TarjetaRespuesta pregunta={visible} onSeguir={seguir} /> : null}

    {anteriores.length ? <section className="siio-vigia-anteriores" aria-label="Sus preguntas anteriores">
      <h3>Sus preguntas anteriores</h3>
      <ul className="siio-panel">
        {anteriores.map(p => <li key={p.id}>
          <button type="button" onClick={() => setAbierta(p.id)}>
            <span>{p.question}</span>
            <small>{p.status === 'fallida' ? 'Sin respuesta · ' : ''}{horaBogota(p.requested_at)}</small>
          </button>
        </li>)}
      </ul>
    </section> : null}

    {estado?.puede_ver_aprendizaje ? <LoQueAprende /> : null}
  </div>;
}
