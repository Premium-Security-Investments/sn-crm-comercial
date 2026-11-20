import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../apiClient';

// AGT-001 «Pregúntele a Vig-IA» como conversación (Juan, 2026-11-20, opción A): a la izquierda las conversaciones del
// directivo agrupadas por día; a la derecha el hilo, con la caja para escribir abajo. Una conversación nueva empieza
// solo con «Nueva conversación», y Vig-IA recuerda todo lo hablado en ella. Cada persona ve solo lo suyo.
// Cada respuesta sigue las reglas de la Torre: lo que hay que saber antes de creerle va arriba en ámbar, las cifras con
// su detalle, la lista con nombres y «¿Cómo lo calculé?» con la fuente y la hora del corte.

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
export type Mensaje = {
  id: string;
  question: string;
  conversation_id: string | null;
  status: 'pendiente' | 'leyendo' | 'respondida' | 'fallida';
  answer: Respuesta | null;
  answer_table: TablaRespuesta | null;
  failure_code: string | null;
  progress: { paso: string; a: string }[] | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
};
export type Conversacion = { id: string; title: string; created_at: string; last_message_at: string; mensajes: number; en_curso: boolean };
type Lista = { conversaciones: Conversacion[]; puede_ver_aprendizaje: boolean; mensajes_larga: number };
type Hilo = { conversacion: { id: string; title: string; created_at: string; last_message_at: string }; mensajes: Mensaje[] };
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
const ESPERA_MS = 3_000;

const FALLAS: Record<string, string> = {
  VIGIA_SESION_VENCIDA: 'La sesión de Claude de Vig-IA Gerencia venció. Avise a Innovación para renovarla y vuelva a intentarlo.',
  VIGIA_LIMITE: 'Se alcanzó el límite de uso de la suscripción de Claude. Vuelva a intentarlo más tarde.',
  VIGIA_TIEMPO: 'Vig-IA no alcanzó a contestar en 8 minutos. Intente con una pregunta más acotada.',
  VIGIA_ABANDONADA: 'La respuesta se interrumpió. Vuelva a intentarlo.',
};

export function textoFalla(codigo: string | null) {
  return (codigo && FALLAS[codigo]) || 'Vig-IA no pudo contestar este mensaje. Vuelva a intentarlo o dígalo de otra forma.';
}

const diaBogota = (valor: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(valor));

export function horaBogota(iso: string | null) {
  if (!iso) return '';
  const fecha = new Date(iso);
  const hoy = diaBogota(new Date()) === diaBogota(fecha);
  return fecha.toLocaleString('es-CO', { timeZone: 'America/Bogota', ...(hoy ? {} : { day: 'numeric', month: 'short' }), hour: 'numeric', minute: '2-digit' });
}

export function duracion(ms: number | null) {
  if (!ms || ms < 0) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** El grupo de cada conversación en la lista, por el día de su último mensaje (hora de Bogotá). */
export function grupoDelDia(iso: string, ahora = new Date()) {
  const dia = Date.parse(`${diaBogota(iso)}T00:00:00Z`);
  const hoy = Date.parse(`${diaBogota(ahora)}T00:00:00Z`);
  const dias = Math.round((hoy - dia) / 86400000);
  if (dias <= 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  if (dias < 7) return 'Esta semana';
  return 'Antes';
}

export function agruparPorDia(conversaciones: Conversacion[], ahora = new Date()) {
  const orden = ['Hoy', 'Ayer', 'Esta semana', 'Antes'];
  const grupos = new Map<string, Conversacion[]>(orden.map(g => [g, []]));
  for (const c of conversaciones) grupos.get(grupoDelDia(c.last_message_at, ahora))!.push(c);
  return orden.map(g => ({ grupo: g, conversaciones: grupos.get(g)! })).filter(g => g.conversaciones.length);
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
  const [abierta, setAbierta] = useState(false);
  const [todas, setTodas] = useState(false);
  const filas = todas ? tabla.filas : tabla.filas.slice(0, FILAS_A_LA_VISTA);
  return <div className="siio-vigia-tabla">
    <div className="siio-vigia-lista-enlace">
      <span><strong>Lista:</strong> {tabla.titulo} · {tabla.filas.length} {tabla.filas.length === 1 ? 'fila' : 'filas'}{tabla.recortado ? ` de ${tabla.total}` : ''}</span>
      <span>
        <button type="button" className="siio-link-button" onClick={() => setAbierta(!abierta)}>{abierta ? 'Ocultar' : 'Ver'}</button>
        <button type="button" className="siio-link-button" onClick={() => descargar(tabla)}>Descargar para Excel</button>
      </span>
    </div>
    {abierta ? <>
      <div className="siio-tabla-wrap">
        <table className="siio-tabla apilable">
          <thead><tr>{tabla.columnas.map(columna => <th key={columna} scope="col">{columna.replace(/_/g, ' ')}</th>)}</tr></thead>
          <tbody>{filas.map((fila, i) => <tr key={i}>{fila.map((valor, j) => <td key={j} data-etiqueta={tabla.columnas[j].replace(/_/g, ' ')}>{valor ?? '—'}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {tabla.filas.length > FILAS_A_LA_VISTA ? <button type="button" className="siio-link-button" onClick={() => setTodas(!todas)}>{todas ? 'Ver menos' : `Ver las ${tabla.filas.length}`}</button> : null}
    </> : null}
  </div>;
}

function RespuestaDeVigia({ mensaje, onReintentar }: { mensaje: Mensaje; onReintentar: (texto: string) => void }) {
  const a = mensaje.answer;
  if (mensaje.status === 'pendiente' || mensaje.status === 'leyendo') {
    const pasos = mensaje.progress || [];
    return <div className="siio-vigia-trabajando" aria-busy="true" aria-live="polite">
      <span className="siio-vigia-quien">{mensaje.status === 'pendiente' ? 'Vig-IA va a empezar' : 'Vig-IA está trabajando'}</span>
      {pasos.length ? <ul>{pasos.slice(-4).map((p, i, todos) => <li key={`${p.a}-${i}`} className={i === todos.length - 1 ? 'actual' : ''}>{i === todos.length - 1 ? '… ' : '✓ '}{p.paso}</li>)}</ul>
        : <p className="siio-nota">Leyendo lo que hace falta para contestar.</p>}
    </div>;
  }
  if (mensaje.status === 'fallida' || !a) {
    return <div className="siio-vigia-mensaje">
      <p className="siio-alert-text" role="alert">{textoFalla(mensaje.failure_code)}</p>
      <button type="button" className="siio-link-button" onClick={() => onReintentar(mensaje.question)}>Intentar de nuevo</button>
    </div>;
  }
  return <div className="siio-vigia-mensaje">
    <span className="siio-vigia-quien">Vig-IA{mensaje.duration_ms ? ` · ${duracion(mensaje.duration_ms)}` : ''}</span>
    {a.aviso ? <div className="siio-aviso-mes" role="note"><p><strong>Antes de creerle a esta cifra:</strong> {a.aviso}</p></div> : null}
    {a.cifras.length ? <div className="siio-vigia-cifras">
      {a.cifras.map(cifra => <div key={cifra.rotulo} className={`siio-cifra${cifra.atencion ? ' atencion' : ''}`}>
        <span>{cifra.rotulo}</span><strong>{cifra.valor}</strong>{cifra.detalle ? <small>{cifra.detalle}</small> : null}
      </div>)}
    </div> : null}
    <p className="siio-vigia-texto">{a.respuesta}</p>
    {mensaje.answer_table?.columnas?.length ? <TablaDeRespuesta tabla={mensaje.answer_table} /> : null}
    {a.faltantes.length ? <div className="siio-vigia-faltantes">
      <h4>¿Qué faltó para contestar completo?</h4>
      <ul>{a.faltantes.map(f => <li key={f.dato}>{f.dato}{f.responsable ? <> · <strong>{f.responsable}</strong></> : null}</li>)}</ul>
    </div> : null}
    {a.pasos.length ? <details className="siio-vigia-calculo">
      <summary>¿Cómo lo calculé?</summary>
      <ol>{a.pasos.map(paso => <li key={paso}>{paso}</li>)}</ol>
      <p className="siio-nota">Fuente: {a.fuentes.length ? a.fuentes.join(' · ') : 'sin fuente declarada'} · corte {horaBogota(a.corte)}</p>
    </details> : null}
  </div>;
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
        <p className="siio-nota">Vig-IA lo lee al empezar cada conversación. Si algo está mal, quítelo y lo volverá a buscar.</p>
        {datos.conocimiento.length ? <ul>{datos.conocimiento.map(k => <li key={k.id}>
          <strong>{k.topic}:</strong> {k.note} <span className="siio-nota">· usado {k.uses} {k.uses === 1 ? 'vez' : 'veces'}</span>{' '}
          <button type="button" className="siio-link-button" onClick={() => void quitar(k.id)}>Quitar</button>
        </li>)}</ul> : <p className="siio-nota">Todavía no ha aprendido nada.</p>}
      </section>
    </div> : null}
  </details>;
}

function ListaDeConversaciones({ lista, actual, onAbrir, onNueva }: { lista: Lista | null; actual: string | null; onAbrir: (id: string) => void; onNueva: () => void }) {
  const grupos = agruparPorDia(lista?.conversaciones || []);
  return <nav className="siio-panel siio-vigia-conversaciones" aria-label="Sus conversaciones">
    <button type="button" className="siio-boton-secundario" onClick={onNueva} disabled={actual === null}>Nueva conversación</button>
    <p className="siio-nota">Solo usted ve sus conversaciones.</p>
    {grupos.map(({ grupo, conversaciones }) => <div key={grupo} className="siio-vigia-grupo">
      <h3>{grupo}</h3>
      <ul>{conversaciones.map(c => <li key={c.id}>
        <button type="button" aria-current={c.id === actual ? 'true' : undefined} onClick={() => onAbrir(c.id)}>
          <span>{c.title}</span>
          <small>{c.en_curso ? 'Vig-IA está contestando · ' : ''}{c.mensajes} {c.mensajes === 1 ? 'mensaje' : 'mensajes'} · {horaBogota(c.last_message_at)}</small>
        </button>
      </li>)}</ul>
    </div>)}
    {lista && !lista.conversaciones.length ? <p className="siio-nota">Todavía no tiene conversaciones.</p> : null}
  </nav>;
}

export function SiioPreguntas() {
  const [lista, setLista] = useState<Lista | null>(null);
  const [actual, setActual] = useState<string | null>(null);
  const [hilo, setHilo] = useState<Hilo | null>(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const entrada = useRef<HTMLTextAreaElement>(null);
  const final = useRef<HTMLDivElement>(null);

  const cargarLista = useCallback(() => {
    api<Lista>('/api/siio/vigia/conversaciones').then(setLista).catch(() => setMensaje('No se pudieron cargar sus conversaciones.'));
  }, []);
  useEffect(cargarLista, [cargarLista]);

  const cargarHilo = useCallback((id: string) => {
    api<Hilo>(`/api/siio/vigia/conversaciones/${id}`).then(setHilo).catch(() => setMensaje('No se pudo abrir la conversación.'));
  }, []);
  useEffect(() => { if (actual) cargarHilo(actual); else setHilo(null); }, [actual, cargarHilo]);

  const enCurso = hilo?.mensajes.some(m => m.status === 'pendiente' || m.status === 'leyendo') ?? false;
  useEffect(() => {
    if (!enCurso || !actual) return undefined;
    const reloj = setInterval(() => cargarHilo(actual), ESPERA_MS);
    return () => clearInterval(reloj);
  }, [enCurso, actual, cargarHilo]);
  // Cuando Vig-IA termina, la lista se actualiza (cuenta de mensajes, «contestando»).
  useEffect(() => { if (!enCurso) cargarLista(); }, [enCurso, cargarLista]);
  useEffect(() => { final.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [hilo?.mensajes.length, enCurso]);

  const enviar = async (valor: string) => {
    if (valor.trim().length < 3 || enviando) return;
    setEnviando(true);
    setMensaje('');
    try {
      const nuevo = await api<Mensaje>('/api/siio/preguntas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: valor, conversation_id: actual }),
      });
      setTexto('');
      if (!actual && nuevo.conversation_id) setActual(nuevo.conversation_id);
      else if (actual) cargarHilo(actual);
      cargarLista();
    } catch (reason) {
      setMensaje(reason instanceof Error ? reason.message : 'No se pudo enviar el mensaje.');
    } finally {
      setEnviando(false);
    }
  };
  const alEnviar = (event: FormEvent) => { event.preventDefault(); void enviar(texto); };
  const nueva = () => { setActual(null); setTexto(''); setMensaje(''); entrada.current?.focus(); };

  const mensajes = hilo?.mensajes || [];
  const larga = lista && mensajes.length >= lista.mensajes_larga;

  return <div className="siio-vigia-preguntas">
    <div className="siio-vigia-chat">
      <ListaDeConversaciones lista={lista} actual={actual} onAbrir={setActual} onNueva={nueva} />

      <section className="siio-panel siio-vigia-hilo" aria-label={hilo ? hilo.conversacion.title : 'Nueva conversación'}>
        <header>
          <h2 className="siio-titulo-pantalla">{hilo ? hilo.conversacion.title : '¿Qué quiere saber?'}</h2>
          <p className="siio-nota">{hilo ? `Desde ${horaBogota(hilo.conversacion.created_at)}` : 'Escriba en sus palabras. Vig-IA lee Avancys, SecurityOps y el CRM, recuerda toda la conversación y contesta en uno o dos minutos con la fuente y la fecha de cada cifra.'}</p>
        </header>

        <div className="siio-vigia-mensajes">
          {!hilo ? <div className="siio-vigia-ejemplos">
            <span className="siio-nota">Por ejemplo:</span>
            {EJEMPLOS.map(ejemplo => <button key={ejemplo} type="button" className="siio-vigia-ejemplo" onClick={() => { setTexto(ejemplo); entrada.current?.focus(); }}>{ejemplo}</button>)}
          </div> : null}
          {mensajes.map(m => <div key={m.id} className="siio-vigia-turno">
            <p className="siio-vigia-usuario">{m.question}</p>
            <RespuestaDeVigia mensaje={m} onReintentar={valor => void enviar(valor)} />
          </div>)}
          <div ref={final} />
        </div>

        {larga ? <p className="siio-nota siio-vigia-larga">Esta conversación ya es larga: cada mensaje la relee entera. Para un tema nuevo, abra una nueva conversación.</p> : null}
        {mensaje ? <p className="siio-alert-text" role="alert">{mensaje}</p> : null}
        <form className="siio-vigia-escribir" onSubmit={alEnviar}>
          <label htmlFor="vigia-mensaje" className="sr-only">Su mensaje</label>
          <textarea id="vigia-mensaje" ref={entrada} rows={2} maxLength={600} value={texto}
            placeholder={hilo ? 'Escriba su mensaje. Vig-IA recuerda toda esta conversación.' : 'Por ejemplo: ¿cuántos vigilantes tienen más de 60 años en Cali?'}
            onChange={event => setTexto(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void enviar(texto); } }} />
          <button type="submit" className="siio-boton-primario" disabled={enviando || enCurso || texto.trim().length < 3}>
            {enCurso ? 'Contestando…' : enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </form>
      </section>
    </div>

    {lista?.puede_ver_aprendizaje ? <LoQueAprende /> : null}
  </div>;
}
