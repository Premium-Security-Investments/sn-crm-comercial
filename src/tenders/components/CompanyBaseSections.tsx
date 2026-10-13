import { useEffect, useRef, useState } from 'react';
import {
  COMPANY_BLOCK_STATE_LABELS, COMPANY_BLOCK_STATES, groupCompanyBlocks, parseFinancialIndicators, parseUnspscCodes,
  type CompanyBlock, type CompanyBlockState, type CompanyExperience, type CompanySite,
} from '../companyBase';
import type { TenderCompanyProfile } from '../types';

const dateFormatter = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const moneyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}
function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function CompanyStatusSummary({ counts, total, withSupport, reviewed, filter, onFilter }: {
  counts: Record<CompanyBlockState, number>; total: number; withSupport: number; reviewed: number;
  filter: CompanyBlockState | null; onFilter: (state: CompanyBlockState | null) => void;
}) {
  return <section className="panel company-base-summary" aria-labelledby="company-summary-heading">
    <header className="company-base-section-head"><div><span className="eyebrow">Resumen de estado</span><h3 id="company-summary-heading">¿Está la empresa lista para presentarse hoy?</h3><p>Toque un recuadro para ver sólo esos bloques.</p></div></header>
    <div className="company-base-counts">
      {COMPANY_BLOCK_STATES.map(state => <button key={state} type="button" className={`company-base-count state-${state}`} aria-pressed={filter === state} onClick={() => onFilter(filter === state ? null : state)}>
        <strong>{counts[state]}</strong><span>{COMPANY_BLOCK_STATE_LABELS[state]}</span>
      </button>)}
    </div>
    <p className="company-base-facts"><span><strong>{withSupport} de {total}</strong> bloques tienen el soporte cargado en el CRM</span><span><strong>{reviewed}</strong> revisados por una persona</span></p>
  </section>;
}

function expiryLabel(block: CompanyBlock) {
  if (!block.expiry) return null;
  const prefix = block.state === 'vencido' ? 'Venció' : 'Vence';
  return `${prefix} ${formatDay(block.expiry)}${block.expirySource === 'calculada' ? ' (calculada, por confirmar)' : ''}`;
}

export function CompanyBlocksTable({ blocks, filter, onClearFilter }: { blocks: CompanyBlock[]; filter: CompanyBlockState | null; onClearFilter: () => void }) {
  const groups = groupCompanyBlocks(blocks, filter);
  return <section className="panel company-base-blocks" aria-labelledby="company-blocks-heading">
    <header className="company-base-section-head"><div><span className="eyebrow">Bloques con vigencia y soporte</span><h3 id="company-blocks-heading">Documentos y requisitos habilitantes</h3><p>Sin fecha registrada, el bloque queda como "falta o sin verificar" hasta que una persona la confirme.</p></div>{filter && <button type="button" className="secondary" onClick={onClearFilter}>Ver todos</button>}</header>
    {blocks.length === 0 ? <div className="company-document-empty"><strong>Aún no hay bloques registrados.</strong><span>El registro de soportes empresariales está vacío o no se pudo cargar.</span></div>
      : <div className="tablewrap crm-readable-table company-base-table"><table>
        <thead><tr><th>Bloque</th><th>Estado</th><th>Vigencia</th><th>Soporte</th><th>Revisión</th></tr></thead>
        {groups.map(group => <tbody key={group.area}>
          <tr className="company-base-area"><th colSpan={5} scope="colgroup">{group.area}</th></tr>
          {group.blocks.map(block => <tr key={block.entryId}>
            <td><strong>{block.name}</strong></td>
            <td><span className={`company-block-state state-${block.state}`}>{COMPANY_BLOCK_STATE_LABELS[block.state]}</span></td>
            <td>{expiryLabel(block) && <strong className="company-block-expiry">{expiryLabel(block)}</strong>}<small>{block.vigenciaText || 'Sin vigencia registrada'}</small></td>
            <td>{block.supportDocument?.url ? <a href={block.supportDocument.url} target="_blank" rel="noreferrer">Ver soporte<span className="sr-only">: {block.name}</span></a> : block.supportLoaded ? 'Cargado' : <span className="muted">Sin soporte cargado</span>}</td>
            <td>{block.review}</td>
          </tr>)}
        </tbody>)}
      </table></div>}
  </section>;
}

type Field = { key: string; label: string; type?: 'text' | 'number' | 'checkbox'; required?: boolean; wide?: boolean };
const SITE_FIELDS: Field[] = [
  { key: 'department', label: 'Departamento', required: true }, { key: 'city', label: 'Ciudad' },
  { key: 'address', label: 'Dirección', wide: true }, { key: 'supervigilancia_authorization', label: 'Autorización SuperVigilancia (resolución)', wide: true },
  { key: 'is_main', label: 'Sede principal', type: 'checkbox' }, { key: 'source', label: 'Fuente del dato' }, { key: 'notes', label: 'Notas', wide: true },
];
const EXPERIENCE_FIELDS: Field[] = [
  { key: 'contracting_party', label: 'Contratante', required: true, wide: true }, { key: 'rup_number', label: 'N.º en el RUP', type: 'number' },
  { key: 'contract_year', label: 'Año', type: 'number' }, { key: 'contract_object', label: 'Objeto o servicio', wide: true },
  { key: 'value_smmlv', label: 'Valor (SMMLV)', type: 'number' }, { key: 'value_cop', label: 'Valor (pesos)', type: 'number' },
  { key: 'source', label: 'Fuente del dato', required: true }, { key: 'notes', label: 'Notas', wide: true },
];

function CompanyRecordDialog({ title, fields, initial, onCancel, onSave }: {
  title: string; fields: Field[]; initial: Record<string, unknown>;
  onCancel: () => void; onSave: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    firstFieldRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onCancel(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [saving]);
  const submit = async () => {
    const missing = fields.find(field => field.required && !String(values[field.key] ?? '').trim());
    if (missing) { setError(`${missing.label} es obligatorio.`); return; }
    setSaving(true); setError(null);
    try { await onSave(values); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setSaving(false); }
  };
  return <div className="tender-go-no-go-backdrop" role="presentation" onMouseDown={() => { if (!saving) onCancel(); }}>
    <div className="company-document-upload-dialog company-record-dialog" role="dialog" aria-modal="true" aria-labelledby="company-record-title" onMouseDown={event => event.stopPropagation()}>
      <header><div><span className="eyebrow">Empresa</span><h3 id="company-record-title">{title}</h3></div><button type="button" className="secondary" onClick={onCancel} disabled={saving}>Cerrar</button></header>
      <div className="company-record-grid">{fields.map((field, index) => field.type === 'checkbox'
        ? <label key={field.key} className="company-record-check"><input type="checkbox" checked={values[field.key] === true} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.checked }))} /><span>{field.label}</span></label>
        : <label key={field.key} className={field.wide ? 'wide' : ''}><span>{field.label}{field.required ? ' *' : ''}</span><input ref={index === 0 ? firstFieldRef : undefined} type={field.type === 'number' ? 'number' : 'text'} step="any" value={String(values[field.key] ?? '')} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))} /></label>)}</div>
      {error && <div className="notice" role="alert">{error}</div>}
      <footer><button type="button" className="secondary" onClick={onCancel} disabled={saving}>Cancelar</button><button type="button" onClick={() => void submit()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button></footer>
    </div>
  </div>;
}

type Editing<T> = { record: Partial<T> } | null;

export function CompanySitesSection({ sites, available, canEdit, onSave }: { sites: CompanySite[]; available: boolean; canEdit: boolean; onSave: (site: Partial<CompanySite>) => Promise<void> }) {
  const [editing, setEditing] = useState<Editing<CompanySite>>(null);
  return <section className="panel company-base-sites" aria-labelledby="company-sites-heading">
    <header className="company-base-section-head"><div><span className="eyebrow">Bloque nuevo</span><h3 id="company-sites-heading">Sedes por departamento</h3><p>Muchos pliegos exigen sede en los departamentos donde se presta el servicio.</p></div>{canEdit && available && <button type="button" className="secondary" onClick={() => setEditing({ record: { is_main: false } })}>Agregar sede</button>}</header>
    {!available ? <div className="notice" role="status">Sedes y experiencia se habilitan al aplicar la migración 127.</div>
      : sites.length === 0 ? <div className="company-document-empty"><strong>No hay sedes registradas.</strong><span>Agregue cada sede con su dirección y la autorización de SuperVigilancia.</span></div>
      : <div className="tablewrap crm-readable-table company-base-table"><table>
        <thead><tr><th>Departamento</th><th>Ciudad y dirección</th><th>Autorización SuperVigilancia</th><th>Fuente</th>{canEdit && <th><span className="sr-only">Acciones</span></th>}</tr></thead>
        <tbody>{sites.map(site => <tr key={site.id}>
          <td><strong>{site.department}</strong>{site.is_main && <small>Sede principal</small>}</td>
          <td>{[site.city, site.address].filter(Boolean).join(' · ') || <span className="muted">Sin dato</span>}</td>
          <td>{site.supervigilancia_authorization || <span className="company-block-state state-sin_verificar">Por confirmar</span>}</td>
          <td><small>{site.source || 'Sin fuente'}</small>{site.notes && <small>{site.notes}</small>}</td>
          {canEdit && <td><button type="button" className="secondary" onClick={() => setEditing({ record: site })}>Editar<span className="sr-only">: sede {site.department}</span></button></td>}
        </tr>)}</tbody>
      </table></div>}
    {editing && <CompanyRecordDialog title={editing.record.id ? 'Editar sede' : 'Agregar sede'} fields={SITE_FIELDS} initial={editing.record as Record<string, unknown>} onCancel={() => setEditing(null)} onSave={async values => { await onSave(values as Partial<CompanySite>); setEditing(null); }} />}
  </section>;
}

export function CompanyExperienceSection({ experience, available, canEdit, onSave }: { experience: CompanyExperience[]; available: boolean; canEdit: boolean; onSave: (row: Partial<CompanyExperience>) => Promise<void> }) {
  const [editing, setEditing] = useState<Editing<CompanyExperience>>(null);
  return <section className="panel company-base-experience" aria-labelledby="company-experience-heading">
    <header className="company-base-section-head"><div><span className="eyebrow">Experiencia</span><h3 id="company-experience-heading">Contratos para acreditar experiencia</h3><p>{experience.length} contrato{experience.length === 1 ? '' : 's'} registrado{experience.length === 1 ? '' : 's'}. El objeto se valida contra la certificación antes de usarlo en una oferta.</p></div>{canEdit && available && <button type="button" className="secondary" onClick={() => setEditing({ record: {} })}>Agregar contrato</button>}</header>
    {!available ? null
      : experience.length === 0 ? <div className="company-document-empty"><strong>No hay contratos registrados.</strong><span>Agregue los contratos del RUP con su valor en SMMLV.</span></div>
      : <div className="tablewrap crm-readable-table company-base-table"><table>
        <thead><tr><th>N.º RUP</th><th>Contratante</th><th>Objeto</th><th className="numeric">Valor</th><th>Año</th><th>Fuente</th>{canEdit && <th><span className="sr-only">Acciones</span></th>}</tr></thead>
        <tbody>{experience.map(row => {
          const smmlv = toNumber(row.value_smmlv); const cop = toNumber(row.value_cop);
          return <tr key={row.id}>
            <td>{row.rup_number ?? <span className="muted">—</span>}</td>
            <td><strong>{row.contracting_party}</strong></td>
            <td>{row.contract_object || <span className="muted">Por confirmar</span>}</td>
            <td className="numeric">{smmlv !== null ? `${decimalFormatter.format(smmlv)} SMMLV` : cop !== null ? moneyFormatter.format(cop) : '—'}</td>
            <td>{row.contract_year ?? <span className="muted">—</span>}</td>
            <td><small>{row.source}</small></td>
            {canEdit && <td><button type="button" className="secondary" onClick={() => setEditing({ record: row })}>Editar<span className="sr-only">: contrato {row.contracting_party}</span></button></td>}
          </tr>;
        })}</tbody>
      </table></div>}
    {editing && <CompanyRecordDialog title={editing.record.id ? 'Editar contrato' : 'Agregar contrato'} fields={EXPERIENCE_FIELDS} initial={editing.record as Record<string, unknown>} onCancel={() => setEditing(null)} onSave={async values => { await onSave(values as Partial<CompanyExperience>); setEditing(null); }} />}
  </section>;
}

export function CompanyFinancialSection({ profile }: { profile: TenderCompanyProfile }) {
  const { cut, values } = parseFinancialIndicators(profile);
  const codes = parseUnspscCodes(profile.rup_unspsc_codes);
  return <div className="company-base-pair">
    <section className="panel company-base-financial" aria-labelledby="company-financial-heading">
      <header className="company-base-section-head"><div><span className="eyebrow">Capacidad financiera{cut ? ` · corte ${cut}` : ''}</span><h3 id="company-financial-heading">Indicadores del RUP</h3></div></header>
      {values.length === 0 ? <p className="muted">No hay indicadores en la ficha.</p> : <dl className="company-base-indicators">{values.map(item => <div key={item.key}><dt>{item.label}{item.calculated ? ' (calculado)' : ''}</dt><dd>{item.money ? moneyFormatter.format(item.value) : decimalFormatter.format(item.value)}</dd></div>)}</dl>}
    </section>
    <section className="panel company-base-unspsc" aria-labelledby="company-unspsc-heading">
      <header className="company-base-section-head"><div><span className="eyebrow">Clasificación UNSPSC · del RUP</span><h3 id="company-unspsc-heading">{codes.length} código{codes.length === 1 ? '' : 's'} inscrito{codes.length === 1 ? '' : 's'}</h3></div></header>
      {codes.length === 0 ? <p className="muted">Sin códigos en la ficha.</p> : <ul className="company-base-codes">{codes.map(item => <li key={item.code}><code>{item.code}</code><span>{item.description}</span></li>)}</ul>}
    </section>
  </div>;
}
