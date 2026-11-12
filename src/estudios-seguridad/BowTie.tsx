// Estudios de Seguridad Física: el corbatín de cada riesgo y los datos de cada control (migración 216; NTC-IEC/ISO
// 31010:2020, B.4.2; Juan, 2026-11-12). La lógica está en verticales/estudios-seguridad/corbatin.js.
import { useState } from 'react';
import { bowTie, controlNote, itemsOf, type CorbatinControl } from '../../verticales/estudios-seguridad/corbatin.js';
import type { ControlDetail, Risk, RiskDraft } from './api';

const sameText = (a: string, b: string) => a.toLowerCase().replace(/\s+/g, ' ').trim() === b.toLowerCase().replace(/\s+/g, ' ').trim();

/** En el formulario del riesgo: un renglón por control, con sus cinco datos. Todo opcional. */
export function ControlDetailsEditor({ form, set }: { form: RiskDraft; set: (patch: RiskDraft) => void }) {
  const [open, setOpen] = useState(Boolean(form.control_details?.length));
  const controls = [
    ...itemsOf(form.current_control).map(texto => ({ tipo: 'existente' as const, texto })),
    ...itemsOf(form.proposed_control).map(texto => ({ tipo: 'propuesto' as const, texto })),
  ];
  const causes = itemsOf(form.causes);
  if (!controls.length) return null;
  const details = form.control_details || [];
  const find = (tipo: ControlDetail['tipo'], texto: string) => details.find(item => item.tipo === tipo && sameText(item.texto, texto));
  const update = (tipo: ControlDetail['tipo'], texto: string, patch: Partial<ControlDetail>) => {
    const current: ControlDetail = find(tipo, texto) || { tipo, texto, momento: null, causa: null, verificado: null, depende_de: null, puede_fallar: null, lo_sostiene: null };
    const next = { ...current, ...patch };
    if (next.momento !== 'antes') next.causa = null;
    set({ control_details: [...details.filter(item => item !== find(tipo, texto)), next] });
  };
  return <fieldset className="es-fieldset">
    <legend>Datos de cada control (corbatín)</legend>
    {!open ? <p className="es-muted">Opcional: diga cuándo actúa cada control, si lo vio funcionar y qué lo puede hacer fallar. Con eso SIIO dibuja el corbatín del riesgo. <button type="button" className="es-link" onClick={() => setOpen(true)}>Llenar</button></p> : <>
      <small className="es-muted">Un renglón por control, tal como quedaron escritos arriba (uno por línea). Lo que no sepa, déjelo vacío.</small>
      {controls.map(control => {
        const detail = find(control.tipo, control.texto);
        const value = (field: 'depende_de' | 'puede_fallar' | 'lo_sostiene') => detail?.[field] || '';
        return <div key={`${control.tipo}:${control.texto}`} className="es-control-detail">
          <strong>{control.tipo === 'existente' ? 'Existente' : 'Propuesto'} · {control.texto}</strong>
          <div className="es-grid-3">
            <label>Cuándo actúa
              <select value={detail?.momento || ''} onChange={event => update(control.tipo, control.texto, { momento: (event.target.value || null) as ControlDetail['momento'] })}>
                <option value="">Sin decir</option><option value="antes">Antes: evita el evento</option><option value="despues">Después: reduce el daño</option>
              </select>
            </label>
            {detail?.momento === 'antes' && causes.length ? <label>Frente a qué causa
              <select value={detail.causa ?? ''} onChange={event => update(control.tipo, control.texto, { causa: event.target.value ? Number(event.target.value) : null })}>
                <option value="">Todas las causas</option>
                {causes.map((cause, index) => <option key={index} value={index + 1}>{index + 1}. {cause.slice(0, 80)}</option>)}
              </select>
            </label> : <span />}
            {control.tipo === 'existente' ? <label>¿Lo vio funcionar en el recorrido?
              <select value={detail?.verificado == null ? '' : detail.verificado ? 'si' : 'no'} onChange={event => update(control.tipo, control.texto, { verificado: event.target.value === '' ? null : event.target.value === 'si' })}>
                <option value="">Sin decir</option><option value="si">Sí, verificado</option><option value="no">No, me lo contaron</option>
              </select>
            </label> : <span />}
          </div>
          <div className="es-grid-3">
            <label>Depende de<input value={value('depende_de')} maxLength={300} placeholder="Ej.: alguien que mire el monitor" onChange={event => update(control.tipo, control.texto, { depende_de: event.target.value || null })} /></label>
            <label>Qué lo puede hacer fallar<input value={value('puede_fallar')} maxLength={300} placeholder="Ej.: un corte de energía" onChange={event => update(control.tipo, control.texto, { puede_fallar: event.target.value || null })} /></label>
            <label>Qué lo sostiene<input value={value('lo_sostiene')} maxLength={300} placeholder="Ej.: capacitación, mantenimiento" onChange={event => update(control.tipo, control.texto, { lo_sostiene: event.target.value || null })} /></label>
          </div>
        </div>;
      })}
    </>}
  </fieldset>;
}

function ControlChip({ control }: { control: CorbatinControl }) {
  const note = controlNote(control);
  return <li className={`es-bt-control es-bt-${control.tipo}`} title={note || undefined}>
    {control.texto}{note ? <small>{note}</small> : null}
  </li>;
}

/** En la ficha del riesgo: el corbatín, si el analista ya ubicó los controles. */
export function BowTieView({ risk }: { risk: Risk }) {
  const tie = bowTie(risk as unknown as Record<string, unknown>);
  if (!tie.detallado) return null;
  return <details className="es-bowtie">
    <summary>Corbatín{tie.sin_ningun_control.length ? ` · ${tie.sin_ningun_control.length === 1 ? 'una causa' : `${tie.sin_ningun_control.length} causas`} sin ningún control` : ''}</summary>
    <div className="es-bt-grid">
      <div className="es-bt-side">
        <span className="es-label">Causas y controles que lo evitan</span>
        <ol>
          {tie.causas.map(cause => <li key={cause.numero} className={tie.sin_ningun_control.includes(cause.numero) ? 'es-bt-gap' : undefined}>
            <span>{cause.texto}</span>
            {cause.controles.length ? <ul>{cause.controles.map(control => <ControlChip key={control.tipo + control.texto} control={control} />)}</ul> : tie.sin_ningun_control.includes(cause.numero) ? <small>Sin ningún control</small> : null}
          </li>)}
        </ol>
        {tie.antes_todas.length ? <><span className="es-muted">Para todas las causas</span><ul>{tie.antes_todas.map(control => <ControlChip key={control.tipo + control.texto} control={control} />)}</ul></> : null}
      </div>
      <div className="es-bt-knot"><strong>{tie.evento}</strong></div>
      <div className="es-bt-side">
        <span className="es-label">Controles que reducen el daño</span>
        {tie.despues.length ? <ul>{tie.despues.map(control => <ControlChip key={control.tipo + control.texto} control={control} />)}</ul> : <small className="es-muted">Ninguno</small>}
        <span className="es-label">Consecuencias</span>
        {tie.consecuencias.length ? <ul>{tie.consecuencias.map(item => <li key={item}>{item}</li>)}</ul> : <small className="es-muted">No registradas</small>}
      </div>
    </div>
    {tie.sin_clasificar.length ? <small className="es-muted">Sin ubicar (no se dijo cuándo actúan): {tie.sin_clasificar.map(control => control.texto).join('; ')}.</small> : null}
  </details>;
}
