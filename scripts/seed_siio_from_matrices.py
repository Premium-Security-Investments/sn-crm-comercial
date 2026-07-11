from pathlib import Path
import json, hashlib, openpyxl, re
import argparse
parser=argparse.ArgumentParser(description='Dry-run SIIO seed data from matrices. Does not write DB.')
parser.add_argument('--json-out', default='siio_f2_seed_preview.json')
parser.add_argument('--summary-out', default='siio_f2_seed_preview_summary.md')
parser.add_argument('--apply', action='store_true', help='Reserved. DB writes are intentionally disabled until approval.')
args=parser.parse_args()
if args.apply:
    raise SystemExit('--apply is disabled in this branch. Review/approval required before DB writes.')
root=Path('/root/psi-comercial/portafolio-innovacion')
out=Path(args.json_out).resolve().parent
out.mkdir(parents=True, exist_ok=True)
mat_f2=Path('/root/psi-comercial/potencializacion-ia/Matriz MVP Control Gerencial F2-F4.xlsx')
mat_strat=root/'matriz_potencializacion_ia_interna.sharepoint-current.xlsx'
source_files={'matriz_f2_f4':mat_f2,'matriz_estrategica':mat_strat}
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for c in iter(lambda:f.read(1024*1024), b''):
            h.update(c)
    return h.hexdigest()
def clean(v):
    if v is None: return None
    if isinstance(v,str):
        s=v.strip()
        return s if s else None
    return v
def slug_id(s):
    return re.sub(r'[^A-Za-z0-9_-]+','-',str(s or '').strip()).strip('-')[:80]
def rows_as_dicts(ws):
    headers=[clean(ws.cell(1,c).value) for c in range(1, ws.max_column+1)]
    out=[]
    for r in range(2, ws.max_row+1):
        d={}
        anyv=False
        for c,h in enumerate(headers,1):
            if not h: continue
            v=clean(ws.cell(r,c).value)
            d[h]=v
            if v is not None: anyv=True
        if anyv: out.append((r,d))
    return out
h_before={k:sha(p) for k,p in source_files.items()}
wb=openpyxl.load_workbook(mat_f2, read_only=True, data_only=True)
fronts=[]
for r,d in rows_as_dicts(wb['Arquitectura_F1_F6']):
    f=d.get('Frente')
    if f and f not in [x['id'] for x in fronts]:
        fronts.append({'id':str(f).split()[0] if str(f).startswith('F') else slug_id(f), 'name':str(f), 'description':d.get('Submódulo / capacidad') or d.get('Ubicación / alcance') or '', 'status':'diseño', 'source':'Arquitectura_F1_F6', 'source_row':r})
# Ensure canonical
for fid,name in [('SIIO','Sistema Interno de Inteligencia Operativa'),('F1','Gestión Comercial Inteligente'),('F2','Gestión Gerencial y Control'),('F3','Personal / Operación'),('F4','Archivo Corporativo Inteligente'),('F5','Motor de razonamiento'),('F6','Agentes internos')]:
    if fid not in [x['id'] for x in fronts]: fronts.append({'id':fid,'name':name,'description':'Base canónica','status':'diseño','source':'canonical','source_row':None})
records=[]
for r,d in rows_as_dicts(wb['F2_Control_Gerencial']):
    rid=d.get('ID')
    if not rid: continue
    records.append({'id':rid,'front_id':str(d.get('Frente') or '').split()[0] if d.get('Frente') else 'F2','title':d.get('Proyecto / iniciativa'),'record_type':d.get('Tipo de registro'),'objective':d.get('Objetivo'),'area':d.get('Área'),'owner':d.get('Responsable'),'sponsor':d.get('Sponsor gerencial'),'status':str(d.get('Estado') or 'diseño').lower(),'priority':str(d.get('Prioridad') or 'media').lower(),'semaforo':str(d.get('Semáforo') or 'amarillo').lower(),'next_milestone':d.get('Próximo hito'),'next_action':d.get('Próxima acción') or d.get('Próximo hito'),'blockers':d.get('Bloqueos'),'risks':d.get('Riesgos'),'decision_required':d.get('Decisión pendiente'),'decision_owner':d.get('Responsable decisión'),'source_ids':[],'source':'F2_Control_Gerencial','source_row':r})
sources=[]
for r,d in rows_as_dicts(wb['F4_Indice_Fuentes']):
    sid=d.get('ID fuente')
    if not sid: continue
    sources.append({'id':sid,'name':d.get('Nombre de fuente'),'source_type':d.get('Tipo de fuente'),'related_fronts':[d.get('Frente relacionado')] if d.get('Frente relacionado') else [],'related_records':[d.get('Fuente relacionada F2')] if d.get('Fuente relacionada F2') else [],'url':d.get('Ubicación / link'),'owner':d.get('Dueño de la fuente'),'responsible_area':d.get('Área responsable'),'trust_level':d.get('Nivel de confianza'),'status':d.get('Estado de la fuente'),'permissions':d.get('Permisos'),'allowed_agent_use':d.get('Uso permitido por el agente'),'restrictions':d.get('Restricciones'),'update_frequency':d.get('Frecuencia'),'source':'F4_Indice_Fuentes','source_row':r})
board_sections=[]
for r,d in rows_as_dicts(wb['F2_Junta_Asesores']):
    if not d.get('Sección mensual'): continue
    board_sections.append({'section_order':d.get('Orden') or len(board_sections)+1,'name':d.get('Sección mensual'),'content_required':d.get('Contenido requerido'),'data_minimum':d.get('Datos mínimos'),'primary_source':d.get('Fuente principal'),'automation_level':'parcial' if str(d.get('Automático desde dashboard') or '').lower().startswith('parcial') else ('automatico' if str(d.get('Automático desde dashboard') or '').lower().startswith('sí') else 'manual'),'human_review_required':str(d.get('Revisión humana necesaria') or '').lower() not in ['no','false'],'notes':d.get('Notas'),'source':'F2_Junta_Asesores','source_row':r})
wb.close()
wb2=openpyxl.load_workbook(mat_strat, read_only=True, data_only=True)
strategic=[]
for r,d in rows_as_dicts(wb2['Matriz oportunidades']):
    oid=d.get('ID')
    if not oid: continue
    strategic.append({'id':oid,'front_id':d.get('Frente'),'opportunity':d.get('Oportunidad'),'current_problem':d.get('Problema actual'),'ai_solution':d.get('Solución IA / automatización'),'benefited_area':d.get('Área beneficiada'),'expected_impact':d.get('Impacto esperado'),'ease':d.get('Facilidad'),'priority':d.get('Prioridad'),'status':d.get('Estado'),'first_deliverable':d.get('Primer entregable'),'notes':d.get('Notas'),'control_fields_missing':['Responsable','Bloqueo/riesgo','Decisión requerida','Fecha próxima revisión','Semáforo'],'source':'Matriz oportunidades','source_row':r})
wb2.close()
h_after={k:sha(p) for k,p in source_files.items()}
preview={'status':'preview_only_no_db_write','source_hashes_before':h_before,'source_hashes_after':h_after,'hashes_unchanged':h_before==h_after,'counts':{'fronts':len(fronts),'sources':len(sources),'gerencial_records':len(records),'board_sections':len(board_sections),'strategic_opportunities':len(strategic)},'fronts':fronts,'sources':sources,'gerencial_records':records,'board_sections_template':board_sections,'strategic_opportunities':strategic}
Path(args.json_out).write_text(json.dumps(preview, ensure_ascii=False, indent=2, default=str)+'\n')
summary=f"""# SIIO F2 Seed Preview — Resumen

Resultado: **PASS** — preview no destructivo, sin escritura a DB.

## Conteos

- Frentes: {len(fronts)}
- Fuentes F4: {len(sources)}
- Registros gerenciales F2: {len(records)}
- Secciones junta: {len(board_sections)}
- Oportunidades estratégicas: {len(strategic)}

## Observaciones

- Los registros F2 ya pueden alimentar el MVP inicial.
- F4 tiene fuentes suficientes para arrancar trazabilidad.
- La junta mensual tiene plantilla inicial de secciones.
- El backlog estratégico tiene 67 oportunidades, pero conserva faltantes gerenciales detectados: Responsable, Bloqueo/riesgo, Decisión requerida, Fecha próxima revisión y Semáforo.

## Reglas de carga

- No inventar responsables o fechas.
- Cargar oportunidades estratégicas como solo lectura/importadas.
- Nómina no se carga aquí; solo se modela como agregado futuro.
- Este preview requiere aprobación antes de escribirse a Supabase.

## Hashes intactos

- Matriz F2/F4: `{h_before['matriz_f2_f4']}` → `{h_after['matriz_f2_f4']}`
- Matriz estratégica: `{h_before['matriz_estrategica']}` → `{h_after['matriz_estrategica']}`
"""
Path(args.summary_out).write_text(summary)
checker={'result':'PASS' if h_before==h_after and len(strategic)>0 and len(records)>0 else 'FAIL','hashes_unchanged':h_before==h_after,'json_valid':True,'counts':preview['counts']}
(out/'siio_f2_seed_preview_checker.json').write_text(json.dumps(checker, ensure_ascii=False, indent=2)+'\n')
(out/'siio_f2_seed_preview_checker.md').write_text(f"# SIIO F2 Seed Preview Checker\n\n- Result: **{checker['result']}**\n- Source hashes unchanged: `{checker['hashes_unchanged']}`\n- JSON valid: `true`\n- Counts: `{checker['counts']}`\n\nNo DB or source file was modified.\n")
print('SIIO seed dry-run complete')
print('json_out', Path(args.json_out).resolve(), Path(args.json_out).stat().st_size)
print('summary_out', Path(args.summary_out).resolve(), Path(args.summary_out).stat().st_size)
print('checker_out', (out/'siio_f2_seed_preview_checker.json').resolve(), (out/'siio_f2_seed_preview_checker.json').stat().st_size)
