import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
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

export function TenderSavedSearches({ filters, profiles, profilesError, request, onProfilesChange, onApply }: TenderSavedSearchesProps) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const deletingIdsRef = useRef(new Set<string>());
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) { setMessage('Escriba un nombre para guardar la búsqueda.'); return; }
    setSaving(true); setMessage(null);
    try {
      const payload = buildTenderSearchProfilePayload(name, filters);
      const saved = await request<TenderSearchProfile>('/api/tender-search-profiles', { method: 'POST', body: JSON.stringify(payload) });
      onProfilesChange(current => prependTenderSearchProfile(current, saved));
      setName(''); setMessage(`Búsqueda guardada: ${saved.name}`);
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
    <div className="row-actions"><label className="tender-saved-search-name"><span>Nombre</span><input value={name} onChange={event => setName(event.target.value)} placeholder="Ej. CCTV Bogotá $500M+" /></label><button onClick={() => void save()} disabled={saving}>Guardar búsqueda</button></div>
    {message && <div className="notice" role="status">{message}</div>}
    <div className="tender-saved-profiles"><h3>Búsquedas guardadas</h3>{profilesError && <div className="error" role="alert">No fue posible cargar las búsquedas guardadas. {profilesError}</div>}{profiles.length ? profiles.map(profile => <div className="tender-saved-profile-row" key={profile.id}><div><strong>{profile.name}</strong><small>{profile.region_key} · {profile.source_filter} · {profile.value_filter}</small></div><div className="row-actions"><button className="secondary" onClick={() => onApply(profile)} disabled={deletingIds.has(profile.id)}>Aplicar</button><button className="secondary" onClick={() => void remove(profile)} disabled={deletingIds.has(profile.id)}>{deletingIds.has(profile.id) ? 'Eliminando…' : 'Eliminar'}</button></div></div>) : <p className="muted">Aún no hay búsquedas guardadas.</p>}</div>
  </section>;
}
