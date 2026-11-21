// Estilos en línea que usan las pantallas. La mayor parte del diseño vive en siio.css; aquí solo se
// ajustan los casos que se aplican por objeto (los botones y campos toman el estilo global).
import type { CSSProperties } from 'react';

export const estilos: Record<string, CSSProperties> = {
  pagina: {},
  centro: { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 },
  tarjeta: { background: '#fff', padding: 24, borderRadius: 20, width: '100%', maxWidth: 420, boxShadow: '0 28px 70px rgba(21,38,69,.16)', display: 'grid', gap: 10 },
  etiqueta: { fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: '#174ea6', fontWeight: 800 },
  campo: { display: 'grid', gap: 5, fontSize: 14 },
  input: {},
  boton: {},
  botonSecundario: { background: '#e9eef7', color: '#1b355f', boxShadow: 'none' },
  barra: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 },
  cifra: { position: 'relative', background: '#fff', border: '1px solid #e7edf5', borderRadius: 16, padding: '14px 16px', minWidth: 160, boxShadow: '0 8px 22px rgba(21,38,69,.06)' },
};
