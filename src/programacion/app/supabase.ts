// Cliente de la base del SIIO. Dentro del SIIO, Programación usa el mismo cliente y la misma sesión del SIIO:
// lo que cada usuario puede ver lo deciden los permisos por fila del esquema programacion.
import { supabaseBrowser } from '../../supabaseBrowser';

export const supabase = supabaseBrowser;
export const db = () => supabase.schema('programacion');

export type Rol = 'admin' | 'coordinador' | 'nomina' | 'consulta';
export interface Acceso { rol: Rol; ciudad_id: string | null }

export const NOMBRE_ROL: Record<Rol, string> = {
  admin: 'Administrador',
  coordinador: 'Coordinador de programación',
  nomina: 'Nómina',
  consulta: 'Consulta',
};
