import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { TenderRadarFilters, TenderRequest, TenderSearchProfile } from '../types';

export type TenderSearchProfilePayload = Pick<TenderSearchProfile, 'name' | 'region_key' | 'source_filter' | 'section_filter' | 'internal_status_filter' | 'deadline_filter' | 'value_filter' | 'score_filter' | 'query_text'>;

export function buildTenderSearchProfilePayload(name: string, filters: TenderRadarFilters): TenderSearchProfilePayload {
  return {
    name: name.trim(),
    region_key: filters.region,
    source_filter: filters.source,
    section_filter: filters.section,
    internal_status_filter: filters.internalStatus,
    deadline_filter: filters.deadline,
    value_filter: filters.value,
    score_filter: filters.score,
    query_text: filters.query,
  };
}

export function prependTenderSearchProfile(current: TenderSearchProfile[], saved: TenderSearchProfile): TenderSearchProfile[] {
  return [saved, ...current.filter(profile => profile.id !== saved.id)];
}

export function removeTenderSearchProfile(current: TenderSearchProfile[], profileId: string): TenderSearchProfile[] {
  return current.filter(profile => profile.id !== profileId);
}

type TenderSavedSearchesProps = {
  filters: TenderRadarFilters;
  profiles: TenderSearchProfile[];
  profilesError?: string | null;
  request: TenderRequest;
  onProfilesChange: Dispatch<SetStateAction<TenderSearchProfile[]>>;
  onApply: (profile: TenderSearchProfile) => void;
};

function trapDialogFocus(event: KeyboardEvent, dialog: HTMLDivElement | null) {
  if (event.key !== 'Tab' || !dialog) return;
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export function TenderSavedSearches({ filters, profiles, profilesError, request, onProfilesChange, onApply }: TenderSavedSearchesProps) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const deletingIdsRef = useRef(new Set<string>());
  const saveTriggerRef = useRef<HTMLButtonElement | null>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const saveRestoreFocusRef = useRef<HTMLElement | null>(null);
  const libraryRestoreFocusRef = useRef<HTMLElement | null>(null);
  const saveDialogRef = useRef<HTMLDivElement | null>(null);
  const libraryDialogRef = useRef<HTMLDivElement | null>(null);
  const saveInputRef = useRef<HTMLInputElement | null>(null);
  const libraryCloseRef = useRef<HTMLButtonElement | null>(null);

  const restoreFocus = (target: HTMLElement | null, fallback: HTMLButtonElement | null) => {
    if (target?.isConnected) target.focus();
    else fallback?.focus();
  };
  const closeSave = () => {
    if (saving) return;
    setSaveOpen(false);
    restoreFocus(saveRestoreFocusRef.current, saveTriggerRef.current);
    saveRestoreFocusRef.current = null;
  };
  const closeLibrary = () => {
    setLibraryOpen(false);
    restoreFocus(libraryRestoreFocusRef.current, libraryTriggerRef.current);
    libraryRestoreFocusRef.current = null;
  };
  const openSave = (trigger: HTMLButtonElement) => {
    saveRestoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
    saveTriggerRef.current = trigger;
    setMessage(null);
    setSaveOpen(true);
  };
  const openLibrary = (trigger: HTMLButtonElement) => {
    libraryRestoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
    libraryTriggerRef.current = trigger;
    setMessage(null);
    setLibraryOpen(true);
  };

  useEffect(() => {
    if (!saveOpen) return;
    saveInputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeSave(); return; }
      trapDialogFocus(event, saveDialogRef.current);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [saveOpen, saving]);

  useEffect(() => {
    if (!libraryOpen) return;
    libraryCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeLibrary(); return; }
      trapDialogFocus(event, libraryDialogRef.current);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [libraryOpen]);

  const save = async () => {
    if (!name.trim()) { setMessage('Escriba un nombre para guardar la búsqueda.'); return; }
    setSaving(true); setMessage(null);
    try {
      const payload = buildTenderSearchProfilePayload(name, filters);
      const saved = await request<TenderSearchProfile>('/api/tender-search-profiles', { method: 'POST', body: JSON.stringify(payload) });
      onProfilesChange(current => prependTenderSearchProfile(current, saved));
      setName(''); setMessage(`Búsqueda guardada: ${saved.name}`);
      setSaveOpen(false);
      restoreFocus(saveRestoreFocusRef.current, saveTriggerRef.current);
      saveRestoreFocusRef.current = null;
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };

  const remove = async (profile: TenderSearchProfile) => {
    if (deletingIdsRef.current.has(profile.id)) return;
    if (!window.confirm(`¿Eliminar la búsqueda "${profile.name}"?`)) return;
    deletingIdsRef.current.add(profile.id);
    setDeletingIds(current => new Set(current).add(profile.id));
    try {
      await request(`/api/tender-search-profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' });
      onProfilesChange(current => removeTenderSearchProfile(current, profile.id));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally {
      deletingIdsRef.current.delete(profile.id);
      setDeletingIds(current => {
        const next = new Set(current);
        next.delete(profile.id);
        return next;
      });
    }
  };

  return <section className="tender-saved-searches" aria-label="Búsquedas guardadas">
    <div className="tender-saved-search-actions">
      <button type="button" ref={saveTriggerRef} aria-haspopup="dialog" aria-expanded={saveOpen} aria-controls="tender-save-search-dialog" onClick={event => openSave(event.currentTarget)}>Guardar búsqueda</button>
      <button type="button" className="secondary" ref={libraryTriggerRef} aria-haspopup="dialog" aria-expanded={libraryOpen} aria-controls="tender-saved-searches-dialog" onClick={event => openLibrary(event.currentTarget)}>Búsquedas guardadas</button>
    </div>
    {!saveOpen && !libraryOpen && message && <div className="notice" role="status">{message}</div>}
    {saveOpen && <div className="tender-saved-searches-backdrop" role="presentation" onMouseDown={closeSave}>
      <div id="tender-save-search-dialog" className="tender-saved-search-dialog" ref={saveDialogRef} role="dialog" aria-modal="true" aria-labelledby="tender-save-search-title" onMouseDown={event => event.stopPropagation()}>
        <header><h3 id="tender-save-search-title">Guardar búsqueda</h3><button type="button" className="secondary" onClick={closeSave} disabled={saving} aria-label="Cerrar guardar búsqueda">Cerrar</button></header>
        {saveOpen && message && <div className="error" role="alert">{message}</div>}
        <label className="tender-saved-search-name"><span>Nombre</span><input ref={saveInputRef} value={name} onChange={event => setName(event.target.value)} placeholder="Ej. CCTV Bogotá $500M+" /></label>
        <footer><button type="button" className="secondary" onClick={closeSave} disabled={saving}>Cancelar</button><button type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar búsqueda'}</button></footer>
      </div>
    </div>}
    {libraryOpen && <div className="tender-saved-profiles">
      <div className="tender-saved-searches-backdrop" role="presentation" onMouseDown={closeLibrary}>
        <div id="tender-saved-searches-dialog" className="tender-saved-search-dialog" ref={libraryDialogRef} role="dialog" aria-modal="true" aria-labelledby="tender-saved-searches-title" onMouseDown={event => event.stopPropagation()}>
          <header><h3 id="tender-saved-searches-title">Búsquedas guardadas</h3><button type="button" className="secondary" ref={libraryCloseRef} onClick={closeLibrary} aria-label="Cerrar búsquedas guardadas">Cerrar</button></header>
          {profilesError && <div className="error" role="alert">No fue posible cargar las búsquedas guardadas. {profilesError}</div>}
          {libraryOpen && message && <div className="error" role="alert">{message}</div>}
          {profiles.length ? profiles.map(profile => <div className="tender-saved-profile-row" key={profile.id}><div><strong>{profile.name}</strong><small>{profile.region_key} · {profile.source_filter} · {profile.value_filter}</small></div><div className="row-actions"><button className="secondary" onClick={() => { onApply(profile); closeLibrary(); }} disabled={deletingIds.has(profile.id)}>Aplicar</button><button className="secondary" onClick={() => void remove(profile)} disabled={deletingIds.has(profile.id)}>{deletingIds.has(profile.id) ? 'Eliminando…' : 'Eliminar'}</button></div></div>) : <p className="muted">Aún no hay búsquedas guardadas.</p>}
        </div>
      </div>
    </div>}
  </section>;
}
