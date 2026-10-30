import { useEffect, useRef, useState } from 'react';
import { createManualTenderProcess } from '../api';
import type { TenderManualProcessCreated, TenderManualProcessInput, TenderRequest } from '../types';

/**
 * Registrar a mano un proceso que no está en SECOP (Juan, 2026-10-29). Desde aquí la encargada de Licitaciones crea en
 * la pantalla el mismo par licitación + oportunidad que produce el Radar al convertir, y sigue con el expediente, la
 * carga manual de documentos, el análisis, la decisión y el cierre, sin pasar por nadie.
 *
 * Obligatorio sólo lo que no se puede adivinar: plataforma, entidad y objeto. La fecha de cierre se queda opcional a
 * propósito: inventarla corrompería el reloj del proceso, y el formulario lo dice en vez de obligar.
 */
const EMPTY: TenderManualProcessInput = {
  source: '', entity: '', title: '', ref: '', url: '', city: '', dept: '', value: '', close_date: '', description: '',
};

/** Plataformas que ya aparecen en el Radar, como sugerencia: el campo sigue siendo libre. */
const PLATFORM_SUGGESTIONS = ['TVEC', 'ESU Contratación', 'Régimen especial web', 'Privado web', 'Portal de la entidad'];

export function TenderManualProcessForm({ request, onCreated, onCancel }: {
  request: TenderRequest;
  onCreated: (created: TenderManualProcessCreated) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<TenderManualProcessInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  // El panel aparece a pedido: el foco entra en el primer campo para que no haya que buscarlo.
  useEffect(() => { firstFieldRef.current?.focus(); }, []);

  const set = (field: keyof TenderManualProcessInput) => (value: string) => setDraft(current => ({ ...current, [field]: value }));

  const submit = async () => {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const created = await createManualTenderProcess(request, draft);
      setDraft(EMPTY);
      await onCreated(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return <form className="card stack tender-manual-process-form" aria-labelledby="tender-manual-process-heading" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <div>
      <h3 id="tender-manual-process-heading">Crear un proceso a mano</h3>
      <p className="muted">Para los procesos que no están en SECOP. Queda con el mismo seguimiento que los del Radar: expediente, documentos cargados a mano, análisis de Vig-IA, decisión y cierre.</p>
    </div>
    {error && <div className="error" role="alert">{error}</div>}
    <div className="company-profile-form">
      <label><span>Plataforma donde está el proceso *</span><input ref={firstFieldRef} value={draft.source} required list="tender-manual-process-platforms" placeholder="Ej. TVEC, portal de la entidad" onChange={event => set('source')(event.target.value)} /><datalist id="tender-manual-process-platforms">{PLATFORM_SUGGESTIONS.map(option => <option key={option} value={option} />)}</datalist></label>
      <label><span>Referencia del proceso</span><input value={draft.ref} placeholder="Ej. SA-024-2026" onChange={event => set('ref')(event.target.value)} /></label>
      <label className="wide"><span>Entidad *</span><input value={draft.entity} required placeholder="Nombre de la entidad que contrata" onChange={event => set('entity')(event.target.value)} /></label>
      <label className="wide"><span>Objeto del proceso *</span><textarea rows={2} value={draft.title} required placeholder="Lo que la entidad va a contratar" onChange={event => set('title')(event.target.value)} /></label>
      <label><span>Ciudad</span><input value={draft.city} onChange={event => set('city')(event.target.value)} /></label>
      <label><span>Departamento</span><input value={draft.dept} onChange={event => set('dept')(event.target.value)} /></label>
      <label><span>Valor estimado (COP)</span><input inputMode="numeric" value={draft.value} placeholder="Sin puntos ni comas" onChange={event => set('value')(event.target.value)} /></label>
      <label><span>Fecha de cierre</span><input type="date" value={draft.close_date} onChange={event => set('close_date')(event.target.value)} /><small>Sin fecha de cierre el proceso no tiene reloj de vencimiento.</small></label>
      <label className="wide"><span>Enlace del proceso</span><input type="url" value={draft.url} placeholder="https://…" onChange={event => set('url')(event.target.value)} /></label>
      <label className="wide"><span>Notas</span><textarea rows={2} value={draft.description} placeholder="Lo que haya que recordar del proceso" onChange={event => set('description')(event.target.value)} /></label>
    </div>
    <div className="row-actions">
      <button type="submit" disabled={saving}>{saving ? 'Creando…' : 'Crear proceso'}</button>
      <button type="button" className="secondary" disabled={saving} onClick={onCancel}>Cancelar</button>
    </div>
  </form>;
}
