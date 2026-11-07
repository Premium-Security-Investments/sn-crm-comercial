import { useEffect, useState, type ReactNode } from 'react';
import { AGT002_LESSON_CATEGORIES } from '../../verticales/licitaciones/agt002-company-lessons.js';
import { decideTenderLesson, loadTenderLessons } from './api';
import type { TenderLesson, TendersModuleProps } from './types';

type TenderLessonsViewProps = TendersModuleProps & { moduleNavigation: ReactNode; canManageLessons: boolean };

const categoryLabel = (code: string) => (AGT002_LESSON_CATEGORIES as Record<string, string>)[code] || code;
const fmt = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', year: 'numeric' }) : '');

function LessonBody({ lesson }: { lesson: TenderLesson }) {
  return <>
    <p className="tender-lesson-statement"><strong>{lesson.code}</strong> · <span className="muted">{categoryLabel(lesson.category)}</span><br />{lesson.statement}</p>
    {lesson.rationale && <p className="muted"><strong>Por qué:</strong> {lesson.rationale}</p>}
    {lesson.how_to_apply && <p className="muted"><strong>Cómo aplicarla:</strong> {lesson.how_to_apply}</p>}
  </>;
}

/**
 * Lecciones de la empresa (encargo AGT-002 del 2026-11-06; Juan, 2026-11-07): reglas que Vig-IA Licitaciones tiene en
 * cuenta en cada análisis y en la Mesa. Sólo entran las activas. Aprobar es un clic; descartar una propuesta no pide
 * motivo; retirar una activa sí.
 */
export function TenderLessonsView({ request, moduleNavigation, canManageLessons }: TenderLessonsViewProps) {
  const [lessons, setLessons] = useState<TenderLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retiring, setRetiring] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = async () => {
    setLoading(true);
    try { setLessons((await loadTenderLessons(request)).lessons); setMessage(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible cargar las lecciones.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (canManageLessons) void load(); else setLoading(false); }, [canManageLessons]);

  const decide = async (lesson: TenderLesson, status: 'activa' | 'descartada' | 'retirada', why: string | null = null) => {
    setBusy(lesson.code); setMessage(null);
    try {
      await decideTenderLesson(request, { code: lesson.code, expected_version: lesson.version, status, reason: why });
      setRetiring(null); setReason('');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible registrar la decisión.'); }
    finally { setBusy(null); }
  };

  const proposed = lessons.filter(lesson => lesson.status === 'propuesta');
  const active = lessons.filter(lesson => lesson.status === 'activa');

  return <section className="stack tenders-page tender-lessons-view" aria-labelledby="tender-lessons-heading">
    <header className="tracking-header"><div><span className="eyebrow">Lecciones de la empresa</span><h2 id="tender-lessons-heading">Lecciones</h2><p>Lo que la empresa ya aprendió en otros procesos. Vig-IA Licitaciones tiene en cuenta las activas en cada análisis y en la Mesa, y las nombra cuando las usa.</p></div>{canManageLessons && <button className="secondary" onClick={() => void load()} disabled={loading || Boolean(busy)}>Recargar</button>}</header>
    {moduleNavigation}
    {!canManageLessons && <div className="notice">Las lecciones sólo las ven y las deciden quienes tienen el permiso «Lecciones».</div>}
    {message && <div className="error" role="alert">{message}</div>}
    {canManageLessons && loading && <div className="notice">Cargando lecciones…</div>}
    {canManageLessons && !loading && <>
      <section className="panel" aria-labelledby="tender-lessons-proposed">
        <header className="company-base-section-head"><div><span className="eyebrow">{proposed.length} por aprobar</span><h3 id="tender-lessons-proposed">Por aprobar</h3><p>No entran a Vig-IA Licitaciones hasta que usted las apruebe.</p></div></header>
        {proposed.length ? <ul className="tender-lesson-list">{proposed.map(lesson => <li key={lesson.code} className="tender-lesson">
          <LessonBody lesson={lesson} />
          <p className="muted"><small>Propuesta {lesson.proposed_by_model ? 'por Vig-IA Licitaciones a nombre de ' : 'por '}{lesson.proposed_by_name || 'sin nombre'} · {fmt(lesson.proposed_at)}{lesson.source_ref ? ` · ${lesson.source_ref}` : ''}</small></p>
          <div className="row-actions">
            <button type="button" disabled={Boolean(busy)} onClick={() => void decide(lesson, 'activa')}>Aprobar</button>
            <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void decide(lesson, 'descartada')}>Descartar</button>
          </div>
        </li>)}</ul> : <p className="muted">No hay lecciones por aprobar.</p>}
      </section>
      <section className="panel" aria-labelledby="tender-lessons-active">
        <header className="company-base-section-head"><div><span className="eyebrow">{active.length} activas</span><h3 id="tender-lessons-active">Activas</h3><p>Vig-IA Licitaciones las tiene en cuenta desde la siguiente consulta.</p></div></header>
        {active.length ? <ul className="tender-lesson-list">{active.map(lesson => <li key={lesson.code} className="tender-lesson">
          <LessonBody lesson={lesson} />
          <p className="muted"><small>Aprobada por {lesson.decided_by_name || 'sin nombre'} · {fmt(lesson.created_at)}</small></p>
          {retiring === lesson.code
            ? <form className="row-actions" onSubmit={event => { event.preventDefault(); void decide(lesson, 'retirada', reason); }}>
                <label className="sr-only" htmlFor={`retire-${lesson.code}`}>Motivo para retirar {lesson.code}</label>
                <input id={`retire-${lesson.code}`} value={reason} onChange={event => setReason(event.target.value)} placeholder="¿Por qué se retira?" maxLength={1000} autoFocus />
                <button type="submit" disabled={Boolean(busy) || !reason.trim()}>Retirar</button>
                <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => { setRetiring(null); setReason(''); }}>Cancelar</button>
              </form>
            : <div className="row-actions"><button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => { setRetiring(lesson.code); setReason(''); }}>Retirar</button></div>}
        </li>)}</ul> : <p className="muted">Todavía no hay lecciones activas.</p>}
      </section>
    </>}
  </section>;
}
