import { useState } from 'react';
import type { TenderRadarFilters, TenderRequest, TenderSearchProfile } from '../types';

type TenderSavedSearchesProps = {
  filters: TenderRadarFilters;
  profiles: TenderSearchProfile[];
  request: TenderRequest;
  onProfilesChange: (profiles: TenderSearchProfile[]) => void;
  onApply: (profile: TenderSearchProfile) => void;
};

export function TenderSavedSearches({ filters, profiles, request, onProfilesChange, onApply }: TenderSavedSearchesProps) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) { setMessage('Escriba un nombre para guardar la búsqueda.'); return; }
    setSaving(true); setMessage(null);
    try {
      const payload = {
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
      const saved = await request<TenderSearchProfile>('/api/tender-search-profiles', { method: 'POST', body: JSON.stringify(payload) });
      onProfilesChange([saved, ...profiles.filter(profile => profile.id !== saved.id)]);
      setName(''); setMessage(`Búsqueda guardada: ${saved.name}`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };

  const remove = async (profile: TenderSearchProfile) => {
    if (!window.confirm(`¿Eliminar la búsqueda "${profile.name}"?`)) return;
    try {
      await request(`/api/tender-search-profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' });
      onProfilesChange(profiles.filter(item => item.id !== profile.id));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
  };

  return <section className="tender-saved-searches" aria-label="Búsquedas guardadas">
    <div className="row-actions"><label className="tender-saved-search-name"><span>Nombre</span><input value={name} onChange={event => setName(event.target.value)} placeholder="Ej. CCTV Bogotá $500M+" /></label><button onClick={() => void save()} disabled={saving}>Guardar búsqueda</button></div>
    {message && <div className="notice" role="status">{message}</div>}
    <div className="tender-saved-profiles"><h3>Búsquedas guardadas</h3>{profiles.length ? profiles.map(profile => <div className="tender-saved-profile-row" key={profile.id}><div><strong>{profile.name}</strong><small>{profile.region_key} · {profile.source_filter} · {profile.value_filter}</small></div><div className="row-actions"><button className="secondary" onClick={() => onApply(profile)}>Aplicar</button><button className="secondary" onClick={() => void remove(profile)}>Eliminar</button></div></div>) : <p className="muted">Aún no hay búsquedas guardadas.</p>}</div>
  </section>;
}
