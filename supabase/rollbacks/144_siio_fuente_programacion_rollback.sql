-- Rollback de 144: quita el registro de la fuente de Programación. No toca el esquema `programacion`.
delete from public.siio_sources where id = 'SRC-PROG-PROGRAMACION';
