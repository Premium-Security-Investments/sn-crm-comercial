export function rejectUngovernedAgt002Route(_req, res) {
  return res.status(410).json({
    error: {
      code: 'governed_workset_required',
      message: 'Este flujo fue retirado. Seleccione, congele y ejecute un paquete documental gobernado para Vig-IA Licitaciones.',
    },
  });
}
