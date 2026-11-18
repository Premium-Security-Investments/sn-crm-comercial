import React, { useEffect, useState } from 'react';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-700.css';
import './ingreso-marca.css';

// La pantalla de ingreso con la marca de SecurityOps (design/marca-sn.tokens.json, componente.ingreso):
// azul en todo el campo, panel de marca a la izquierda en escritorio y el formulario en su tarjeta.
// Solo cambia cómo se ve; quien la usa pone el formulario y la lógica de Supabase.
const LOGO = '/marca/logo-sn.png';

function useHoraLocal() {
  const [hora, setHora] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setHora(new Date()), 30000);
    return () => window.clearInterval(t);
  }, []);
  return hora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function IngresoMarca({ titulo, subtitulo, children }: { titulo: string; subtitulo: string; children: React.ReactNode }) {
  // Antes de entrar no hay sesión ni forma de saber si el servidor está sano: la hora del propio
  // equipo es el único dato vivo honesto, y el rótulo lo dice.
  const hora = useHoraLocal();
  return <div className="sn-ingreso">
    <section className="sn-ingreso-marca">
      <div className="sn-ingreso-escudo" aria-hidden="true" />
      <div className="sn-ingreso-marca-cuerpo">
        <img src={LOGO} alt="Seguridad Nacional Ltda." width="366" height="130" className="sn-ingreso-logo" />
        <p className="sn-ingreso-sistema">Sistema Interno de Inteligencia Operativa</p>
        <div className="sn-ingreso-raya" aria-hidden="true" />
        <h1 className="sn-ingreso-titular">Vender, licitar y decidir<span>en un solo sistema.</span></h1>
        <p className="sn-ingreso-apoyo">Oportunidades, procesos públicos, estudios de seguridad y la Torre de Control, con Vig-IA trabajando a su lado.</p>
        <dl className="sn-ingreso-datos">
          <div><dt>Hora local del equipo</dt><dd className="sn-ingreso-hora">{hora}</dd></div>
          <div><dt>Operación</dt><dd>24 / 7</dd></div>
          <div><dt>Cobertura</dt><dd>Nacional</dd></div>
        </dl>
      </div>
    </section>
    <main className="sn-ingreso-columna">
      <div className="sn-ingreso-movil">
        <img src={LOGO} alt="Seguridad Nacional Ltda." width="248" height="88" />
        <p className="sn-ingreso-sistema">Sistema Interno de Inteligencia Operativa</p>
        <span className="sn-ingreso-pastilla-hora">{hora}</span>
      </div>
      <div className="sn-ingreso-tarjeta">
        <h2>{titulo}</h2>
        <p className="sn-ingreso-subtitulo">{subtitulo}</p>
        {children}
        <footer className="sn-ingreso-pie">
          <p>© {new Date().getFullYear()} Seguridad Nacional Ltda. · SIIO</p>
          <p className="sn-ingreso-version">{import.meta.env.SIIO_VERSION}</p>
        </footer>
      </div>
    </main>
  </div>;
}

export function AvisoIngreso({ tipo, children }: { tipo: 'error' | 'info'; children: React.ReactNode }) {
  // El error es rojo; nunca amarillo, que en esta pantalla significa «adelante».
  return <div className={`sn-ingreso-aviso sn-ingreso-aviso-${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>{children}</div>;
}
