// Estudios de Seguridad Física, tramo 5: la caracterización de la sede, como el capítulo I-A del informe real de HADA.
// Contexto del cliente y de la sede (con sus fuentes), estadística de delitos, dispositivo de seguridad (sembrable desde
// los puestos del contrato en Avancys), contactos, mapa y logo. Todo opcional; el informe toma lo que haya.
import { useEffect, useState } from 'react';
import { EvidenceStrip } from './EvidenceStrip';
import {
  addCharacterizationRow, deleteCharacterizationRow, seedPostsFromAvancys, updateStudy,
  type Characterization, type CharacterizationSection, type Evidence, type Study,
} from './api';

const message = (reason: unknown) => (reason instanceof Error ? reason.message : 'No se pudo guardar.');
const MODALITY_LABELS = { vigilancia: 'Vigilancia', guia_canino: 'Guía canino', supervision: 'Supervisión', monitoreo: 'Monitoreo', otro: 'Otro' } as const;
const CONTACT_LABELS = { apoyo: 'Entidad de apoyo', empresa: 'Seguridad Nacional', interventor: 'Interventor del contrato' } as const;
type Texts = { client_description: string; location_description: string; latitude: string; longitude: string; external_context: string; criminal_groups: string; internal_context: string };
type Source = { nombre: string; url: string | null; fecha: string | null };

const textsFrom = (study: Study): Texts => ({
  client_description: study.client_description || '', location_description: study.location_description || '',
  latitude: study.latitude == null ? '' : String(study.latitude), longitude: study.longitude == null ? '' : String(study.longitude),
  external_context: study.external_context || '', criminal_groups: study.criminal_groups || '', internal_context: study.internal_context || '',
});

export function CharacterizationPanel({ study, characterization, evidence, urls, editable, evidenceAvailable, onChanged }: {
  study: Study; characterization?: Characterization; evidence: Evidence[]; urls: Record<string, string | null>; editable: boolean; evidenceAvailable: boolean; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [texts, setTexts] = useState<Texts>(() => textsFrom(study));
  const [sources, setSources] = useState<Source[]>(study.context_sources || []);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setTexts(textsFrom(study)); setSources(study.context_sources || []); }, [study]);
  if (!characterization?.available) return null;

  const filled = [study.client_description, study.location_description, study.external_context, study.internal_context].filter(Boolean).length
    + (characterization.estadisticas.length ? 1 : 0) + (characterization.dispositivo.length ? 1 : 0) + (characterization.contactos.length ? 1 : 0);
  const saveTexts = async () => {
    setSaving(true); setError(''); setStatus('');
    try {
      await updateStudy(study.id, { ...texts, latitude: texts.latitude || null, longitude: texts.longitude || null, context_sources: sources.filter(source => source.nombre.trim()) });
      setStatus('Guardado.');
      onChanged();
    } catch (reason) { setError(message(reason)); } finally { setSaving(false); }
  };
  const area = (key: keyof Texts, label: string, placeholder: string, rows = 3) => <label>{label}
    <textarea rows={rows} value={texts[key]} disabled={!editable} onChange={event => setTexts({ ...texts, [key]: event.target.value })} placeholder={placeholder} maxLength={8000} />
  </label>;

  return <section className="es-card es-characterization" aria-label="Caracterización de la sede">
    <button type="button" className="es-link es-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}>
      {open ? '▾' : '▸'} Caracterización de la sede <small className="es-muted">({filled} de 7 partes con información)</small>
    </button>
    {open ? <div className="es-form">
      <p className="es-muted">Es el capítulo de contexto del informe: el cliente, la sede, la situación delincuencial con sus fuentes, el dispositivo y los contactos. Lo que no se llene no aparece en el informe.</p>
      {area('client_description', 'Descripción del cliente', 'A qué se dedica, desde cuándo, qué produce o qué servicios presta.')}
      {area('location_description', 'Ubicación y vía de aproximación', 'Dirección, distancias a puertos, aeropuerto y ciudad, vías de acceso y transporte.')}
      <div className="es-grid-2">
        <label>Latitud<input inputMode="decimal" value={texts.latitude} disabled={!editable} onChange={event => setTexts({ ...texts, latitude: event.target.value })} placeholder="10.951667" /></label>
        <label>Longitud<input inputMode="decimal" value={texts.longitude} disabled={!editable} onChange={event => setTexts({ ...texts, longitude: event.target.value })} placeholder="-74.906667" /></label>
      </div>
      {area('external_context', 'Contexto externo (situación delincuencial)', 'Qué pasa en el sector y quién lo dice: cite la fuente de cada dato.', 4)}
      {area('criminal_groups', 'Grupos y organizaciones delincuenciales', 'Grupos que operan en la zona y su actividad.')}
      {area('internal_context', 'Contexto interno', 'Instalaciones, áreas, turnos, operación del cliente.')}
      <fieldset className="es-fieldset">
        <legend>Fuentes del contexto</legend>
        {sources.map((source, index) => <div className="es-grid-4" key={index}>
          <label>Fuente<input value={source.nombre} disabled={!editable} onChange={event => setSources(sources.map((item, at) => (at === index ? { ...item, nombre: event.target.value } : item)))} placeholder="Defensoría del Pueblo — alerta temprana" /></label>
          <label>Enlace<input value={source.url || ''} disabled={!editable} onChange={event => setSources(sources.map((item, at) => (at === index ? { ...item, url: event.target.value || null } : item)))} placeholder="https://" /></label>
          <label>Fecha<input type="date" value={source.fecha || ''} disabled={!editable} onChange={event => setSources(sources.map((item, at) => (at === index ? { ...item, fecha: event.target.value || null } : item)))} /></label>
          {editable ? <div className="es-actions"><button type="button" className="es-link" onClick={() => setSources(sources.filter((_, at) => at !== index))}>Quitar</button></div> : null}
        </div>)}
        {editable && sources.length < 15 ? <button type="button" className="es-link" onClick={() => setSources([...sources, { nombre: '', url: null, fecha: null }])}>+ Fuente</button> : null}
      </fieldset>
      {editable ? <div className="es-actions">
        <button type="button" onClick={saveTexts} disabled={saving}>{saving ? 'Guardando…' : 'Guardar caracterización'}</button>
        {status ? <small className="es-muted" role="status">{status}</small> : null}
      </div> : null}
      {error ? <p className="es-error" role="alert">{error}</p> : null}

      <RowsEditor studyId={study.id} section="estadisticas" title="Estadística de delitos" editable={editable} onChanged={onChanged}
        rows={characterization.estadisticas.map(row => ({ id: row.id, cells: [row.crime, row.count.toLocaleString('es-CO'), row.source, row.cutoff_date || '—'] }))}
        header={['Delito', 'Cantidad', 'Fuente', 'Fecha de corte']}
        fields={[{ key: 'crime', label: 'Delito' }, { key: 'count', label: 'Cantidad', type: 'number' }, { key: 'source', label: 'Fuente', placeholder: 'Policía Nacional' }, { key: 'cutoff_date', label: 'Fecha de corte', type: 'date' }]} />

      <RowsEditor studyId={study.id} section="dispositivo" title="Dispositivo de seguridad" editable={editable} onChanged={onChanged}
        rows={characterization.dispositivo.map(row => ({ id: row.id, cells: [row.name, MODALITY_LABELS[row.modality], row.schedule || '—', row.armed === true ? 'Sí' : row.armed === false ? 'No' : '—', String(row.quantity), row.source === 'avancys' ? `Avancys ${row.source_ref}` : 'Escrito'] }))}
        header={['Servicio', 'Modalidad', 'Horario', 'Armado', 'Cantidad', 'Fuente']}
        fields={[
          { key: 'name', label: 'Servicio', placeholder: 'Fase 4' },
          { key: 'modality', label: 'Modalidad', options: Object.entries(MODALITY_LABELS) },
          { key: 'schedule', label: 'Horario', placeholder: '24 horas todo el mes' },
          { key: 'armed', label: 'Armado', options: [['', 'Sin dato'], ['true', 'Sí'], ['false', 'No']] },
        ]}
        extra={editable && study.client_source === 'avancys' ? <SeedFromAvancys studyId={study.id} onChanged={onChanged} /> : null} />

      <RowsEditor studyId={study.id} section="contactos" title="Entidades de apoyo y contactos" editable={editable} onChanged={onChanged}
        rows={characterization.contactos.map(row => ({ id: row.id, cells: [CONTACT_LABELS[row.kind], row.entity, row.detail || '—', row.phone || '—', row.email || '—'] }))}
        header={['Tipo', 'Entidad', 'Detalle', 'Teléfono', 'Correo']}
        fields={[
          { key: 'kind', label: 'Tipo', options: Object.entries(CONTACT_LABELS) },
          { key: 'entity', label: 'Entidad', placeholder: 'Gaula de la Policía' },
          { key: 'detail', label: 'Detalle', placeholder: 'Cargo, estación o sede' },
          { key: 'phone', label: 'Teléfono' },
        ]} />

      {evidenceAvailable ? <div className="es-grid-2">
        <EvidenceStrip studyId={study.id} items={evidence.filter(item => item.purpose === 'mapa')} urls={urls} purpose="mapa" editable={editable} label="Mapa de la sede" onChanged={onChanged} />
        <EvidenceStrip studyId={study.id} items={evidence.filter(item => item.purpose === 'logo')} urls={urls} purpose="logo" editable={editable} label="Logo del cliente (portada)" onChanged={onChanged} />
      </div> : null}
    </div> : null}
  </section>;
}

type Field = { key: string; label: string; type?: 'number' | 'date'; placeholder?: string; options?: Array<[string, string]> };

function RowsEditor({ studyId, section, title, header, rows, fields, editable, extra, onChanged }: {
  studyId: string; section: CharacterizationSection; title: string; header: string[]; rows: Array<{ id: string; cells: string[] }>;
  fields: Field[]; editable: boolean; extra?: React.ReactNode; onChanged: () => void;
}) {
  const empty = () => Object.fromEntries(fields.map(field => [field.key, field.options ? field.options[0][0] : '']));
  const [draft, setDraft] = useState<Record<string, string>>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const body: Record<string, unknown> = { ...draft };
      if ('armed' in body) body.armed = body.armed === 'true' ? true : body.armed === 'false' ? false : null;
      if ('count' in body) body.count = Number(body.count);
      await addCharacterizationRow(studyId, section, body);
      setDraft(empty());
      onChanged();
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    try { await deleteCharacterizationRow(studyId, section, id); onChanged(); } catch (reason) { setError(message(reason)); }
  };
  return <div className="es-rows">
    <div className="es-section-head"><span className="es-label">{title}</span>{extra}</div>
    {rows.length ? <div className="tablewrap"><table>
      <thead><tr>{header.map(cell => <th key={cell}>{cell}</th>)}{editable ? <th /> : null}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>{row.cells.map((cell, index) => <td key={index}>{cell}</td>)}{editable ? <td><button type="button" className="es-link" onClick={() => remove(row.id)}>Quitar</button></td> : null}</tr>)}</tbody>
    </table></div> : <small className="es-muted">Sin datos.</small>}
    {editable ? <form className="es-grid-4" onSubmit={add} aria-label={`Agregar a ${title}`}>
      {fields.map(field => <label key={field.key}>{field.label}
        {field.options
          ? <select value={draft[field.key]} onChange={event => setDraft({ ...draft, [field.key]: event.target.value })}>{field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          : <input type={field.type || 'text'} value={draft[field.key]} placeholder={field.placeholder} onChange={event => setDraft({ ...draft, [field.key]: event.target.value })} />}
      </label>)}
      <div className="es-actions"><button type="submit" className="secondary" disabled={busy}>Agregar</button></div>
    </form> : null}
    {error ? <p className="es-error" role="alert">{error}</p> : null}
  </div>;
}

function SeedFromAvancys({ studyId, onChanged }: { studyId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const run = async () => {
    setBusy(true); setNote('');
    try {
      const result = await seedPostsFromAvancys(studyId);
      setNote(result.added ? `Se trajeron ${result.added} puestos de Avancys. Complete horario y si son armados.` : result.found ? 'Los puestos de Avancys ya estaban.' : 'Avancys no tiene puestos para este cliente.');
      onChanged();
    } catch (reason) { setNote(message(reason)); } finally { setBusy(false); }
  };
  return <span className="es-actions"><button type="button" className="secondary" onClick={run} disabled={busy}>{busy ? 'Consultando Avancys…' : 'Traer puestos de Avancys'}</button>{note ? <small className="es-muted">{note}</small> : null}</span>;
}
