import React from 'react';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-700.css';
import './marco-marca.css';

// El marco de todas las pantallas con la marca de SecurityOps (design/marca-sn.tokens.json): la misma
// cabecera azul de su panel de coordinación, con logo, el nombre del sistema y el área en que se está.
export function CabeceraMarca({ area, menu, children }: { area: string; menu: React.ReactNode; children: React.ReactNode }) {
  return <header className="sn-cabecera">
    <div className="sn-cabecera-escudo" aria-hidden="true" />
    <div className="sn-cabecera-marca">
      {menu}
      <img src="/marca/logo-sn.png" alt="Seguridad Nacional Ltda." width="128" height="46" className="sn-cabecera-logo" />
      <div className="sn-cabecera-divisor" aria-hidden="true" />
      <div className="sn-cabecera-sistema">
        <span>SIIO</span>
        <strong>{area}</strong>
      </div>
    </div>
    <div className="sn-cabecera-acciones">{children}</div>
  </header>;
}

// Los 50 años de la empresa al pie del menú, en negativo para leerse sobre el azul (mismo archivo que SecurityOps).
export function LogoCincuentaAnos() {
  return <div className="sn-menu-50">
    <img src="/marca/logo-50-negativo.png" alt="Seguridad Nacional: 50 años evolucionando para cuidarte" width="321" height="349" />
  </div>;
}
