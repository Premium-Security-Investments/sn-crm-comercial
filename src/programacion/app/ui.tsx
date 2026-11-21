// Piezas de interfaz compartidas: ventana modal y formulario genérico de edición.
import { useState, type ReactNode } from 'react';

export function Modal({ children, onCerrar, ancho }: { children: ReactNode; onCerrar: () => void; ancho?: number }) {
  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" role="dialog" aria-modal="true" style={ancho ? { maxWidth: ancho } : undefined} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

export type Campo =
  | { clave: string; etiqueta: string; tipo: 'texto' | 'fecha' | 'hora' | 'numero'; requerido?: boolean }
  | { clave: string; etiqueta: string; tipo: 'si_no' }
  | { clave: string; etiqueta: string; tipo: 'opciones'; opciones: [string | number, string][]; requerido?: boolean }
  | { clave: string; etiqueta: string; tipo: 'dias' };

export const DIAS: [number, string][] = [[1, 'L'], [2, 'M'], [3, 'Mi'], [4, 'J'], [5, 'V'], [6, 'S'], [7, 'D']];

/** Formulario de edición: devuelve los valores al guardar; muestra el error que devuelva onGuardar. */
export function Formulario({ titulo, campos, inicial, onGuardar, onCancelar }: {
  titulo: string; campos: Campo[]; inicial: Record<string, unknown>;
  onGuardar: (v: Record<string, unknown>) => Promise<string | null>; onCancelar: () => void;
}) {
  const [v, setV] = useState<Record<string, unknown>>(inicial);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const poner = (k: string, x: unknown) => setV((a) => ({ ...a, [k]: x }));
  const guardar = async () => {
    for (const c of campos) {
      if ('requerido' in c && c.requerido && (v[c.clave] === undefined || v[c.clave] === null || v[c.clave] === '')) {
        setError(`Falta: ${c.etiqueta}`); return;
      }
    }
    setGuardando(true);
    const e = await onGuardar(v);
    setGuardando(false);
    if (e) setError(e);
  };
  return (
    <>
      <h3 style={{ margin: 0 }}>{titulo}</h3>
      {campos.map((c) => (
        <label key={c.clave} className={c.tipo === 'si_no' ? undefined : 'campo'} style={c.tipo === 'si_no' ? { display: 'flex', gap: 8, alignItems: 'center' } : undefined}>
          {c.tipo === 'si_no' ? (
            <><input type="checkbox" checked={Boolean(v[c.clave])} onChange={(e) => poner(c.clave, e.target.checked)} /> {c.etiqueta}</>
          ) : c.tipo === 'dias' ? (
            <>{c.etiqueta}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {DIAS.map(([n, t]) => {
                  const sel = ((v[c.clave] as number[]) ?? []).includes(n);
                  return (
                    <button type="button" key={n} onClick={() => poner(c.clave, sel ? ((v[c.clave] as number[]) ?? []).filter((x) => x !== n) : [...((v[c.clave] as number[]) ?? []), n].sort())}
                      className={sel ? 'chico' : 'secundario chico'} aria-pressed={sel} style={{ minWidth: 36 }}>{t}</button>
                  );
                })}
              </div>
            </>
          ) : c.tipo === 'opciones' ? (
            <>{c.etiqueta}
              <select value={String(v[c.clave] ?? '')} onChange={(e) => poner(c.clave, e.target.value === '' ? null : (typeof c.opciones[0]?.[0] === 'number' ? Number(e.target.value) : e.target.value))}>
                <option value="">—</option>
                {c.opciones.map(([val, t]) => <option key={String(val)} value={String(val)}>{t}</option>)}
              </select>
            </>
          ) : (
            <>{c.etiqueta}
              <input type={c.tipo === 'fecha' ? 'date' : c.tipo === 'hora' ? 'time' : c.tipo === 'numero' ? 'number' : 'text'}
                value={String(v[c.clave] ?? '')} onChange={(e) => poner(c.clave, c.tipo === 'numero' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} />
            </>
          )}
        </label>
      ))}
      {error && <div className="aviso-caja error" style={{ margin: 0 }}>{error}</div>}
      <button onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
      <button className="secundario" onClick={onCancelar}>Cancelar</button>
    </>
  );
}

/** Texto corto de un servicio contratado: "L–D · 06:00–06:00 (24 h) · 1 guarda · armado". */
export function textoServicio(s: { dias: number[]; incluye_festivos: boolean; hora_inicio: string; hora_fin: string; guardas: number; armado: boolean }) {
  const d = [...s.dias].sort();
  const dias = d.length === 7 ? 'Todos los días' : d.join(',') === '1,2,3,4,5' ? 'Lunes a viernes' : d.join(',') === '1,2,3,4,5,6' ? 'Lunes a sábado'
    : d.map((n) => DIAS.find(([x]) => x === n)?.[1]).join(' ');
  const hi = s.hora_inicio.slice(0, 5), hf = s.hora_fin.slice(0, 5);
  const horas = hi === hf ? '24 h' : `${hi}–${hf}`;
  return `${dias}${s.incluye_festivos ? '' : ' (sin festivos)'} · ${horas} · ${s.guardas} guarda${s.guardas === 1 ? '' : 's'}${s.armado ? ' · armado' : ''}`;
}
