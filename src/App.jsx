import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./lib/supabase";

const PORTAL_URL = "https://erp-portal-fawn.vercel.app";
const fmtDate = d => d ? new Date(d + "T00:00:00").toLocaleDateString("es-AR") : "—";

function diasHasta(fechaStr) {
  if (!fechaStr) return null;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const fecha = new Date(fechaStr + "T00:00:00");
  return Math.round((fecha - hoy) / (1000*60*60*24));
}
function getAlertColor(dias) {
  if (dias === null) return null;
  if (dias < 0) return "vencido";
  if (dias <= 30) return "critico";
  if (dias <= 90) return "proximo";
  return "ok";
}
function fechaHoy() { return new Date().toISOString().slice(0,10); }

// ─── API ───────────────────────────────────────────────────────────────────
const api = {
  async getEmpleados() {
    const { data, error } = await supabase.from("empleados").select("*").order("apellido_nombre");
    if (error) throw error;
    return data || [];
  },
  async upsertEmpleado(emp) {
    const { data, error } = await supabase.from("empleados").upsert([emp]).select().single();
    if (error) throw error;
    return data;
  },
  async deleteEmpleado(id) {
    const { error } = await supabase.from("empleados").update({ activo: false }).eq("id", id);
    if (error) throw error;
  },
  async getTiposDoc() {
    const { data, error } = await supabase.from("tipos_documento").select("*").order("codigo");
    if (error) throw error;
    return data || [];
  },
  async getDocumentos() {
    const { data, error } = await supabase.from("documentos_empleado").select("*");
    if (error) throw error;
    return data || [];
  },
  async upsertDocumento(doc) {
    const { data, error } = await supabase.from("documentos_empleado").upsert([doc]).select().single();
    if (error) throw error;
    return data;
  },
  async deleteDocumento(id) {
    const { error } = await supabase.from("documentos_empleado").delete().eq("id", id);
    if (error) throw error;
  },
  async subirArchivo(file, bucket, path) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  },
  async getEppTipos() {
    const { data, error } = await supabase.from("epp_tipos").select("*").order("nombre");
    if (error) throw error;
    return data || [];
  },
  async getTalles() {
    const { data, error } = await supabase.from("epp_talles_empleado").select("*");
    if (error) throw error;
    return data || [];
  },
  async upsertTalle(t) {
    const { data, error } = await supabase.from("epp_talles_empleado").upsert([t], { onConflict: "empleado_id,epp_tipo_id" }).select().single();
    if (error) throw error;
    return data;
  },
  async getEntregas() {
    const { data, error } = await supabase.from("epp_entregas").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async getEntregaItems(entregaId) {
    const { data, error } = await supabase.from("epp_entrega_items").select("*").eq("entrega_id", entregaId);
    if (error) throw error;
    return data || [];
  },
  async insertEntrega(entrega, items) {
    const { data: ent, error: e1 } = await supabase.from("epp_entregas").insert([entrega]).select().single();
    if (e1) throw e1;
    if (items.length > 0) {
      const rows = items.map(it => ({ ...it, entrega_id: ent.id }));
      const { error: e2 } = await supabase.from("epp_entrega_items").insert(rows);
      if (e2) throw e2;
    }
    return ent;
  },
  async updateEntrega(id, cambios) {
    const { error } = await supabase.from("epp_entregas").update(cambios).eq("id", id);
    if (error) throw error;
  },
};

// ─── CSS ───────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --navy:#213363;--blue:#235C96;--mid:#6381A7;--light:#A5B5CC;
  --bg:#EEF2F7;--surface:#fff;--surface2:#F4F6FA;--border:#D6E0ED;
  --text:#213363;--muted:#6381A7;
  --ok:#065F46;--ok-bg:#D1FAE5;--ok-b:#A7F3D0;
  --warn:#92400E;--warn-bg:#FEF3C7;--warn-b:#FDE68A;
  --danger:#991B1B;--danger-bg:#FEE2E2;--danger-b:#FECACA;
  --orange:#9A3412;--orange-bg:#FFEDD5;--orange-b:#FED7AA;
  --sans:'Montserrat',sans-serif;--mono:'DM Mono',monospace;
  --r:8px;--shadow:0 1px 4px rgba(33,51,99,.08);
}
body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:14px;line-height:1.5;min-height:100vh}
input,select,textarea,button{font-family:var(--sans)}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-thumb{background:var(--light);border-radius:3px}

.app{display:flex;height:100vh;overflow:hidden}
.sidebar{width:240px;min-width:240px;background:var(--navy);display:flex;flex-direction:column;box-shadow:2px 0 8px rgba(33,51,99,.15)}
.sidebar-header{border-bottom:1px solid rgba(255,255,255,.1);padding:18px 16px 14px;display:flex;align-items:center;gap:12px}
.sidebar-logo-main{font-size:12px;font-weight:700;color:#fff;letter-spacing:2px;text-transform:uppercase}
.sidebar-logo-sub{font-size:9px;color:rgba(255,255,255,.5);letter-spacing:.5px}
.nav-section{padding:10px 16px 3px;font-family:var(--mono);font-size:9px;letter-spacing:2px;color:rgba(255,255,255,.3);text-transform:uppercase}
.ni{display:flex;align-items:center;gap:8px;padding:6px 16px;font-size:12px;font-weight:500;cursor:pointer;color:rgba(255,255,255,.6);border-left:3px solid transparent;transition:all .12s;user-select:none}
.ni:hover{color:#fff;background:rgba(255,255,255,.06)}
.ni.active{color:#fff;border-left-color:var(--light);background:rgba(255,255,255,.1);font-weight:600}
.ni-icon{font-size:13px;width:16px;text-align:center;flex-shrink:0}
.ni-badge{margin-left:auto;background:var(--danger);color:#fff;font-family:var(--mono);font-size:9px;font-weight:700;padding:1px 6px;border-radius:10px;min-width:18px;text-align:center}
.ni.back{color:rgba(255,255,255,.4);font-size:11px;border-top:1px solid rgba(255,255,255,.08);margin-top:4px}
.ni.back:hover{color:rgba(255,255,255,.8)}

.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.topbar{background:var(--surface);border-bottom:1px solid var(--border);padding:0 24px;height:52px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.topbar-title{font-size:12px;font-weight:600;letter-spacing:1px;color:var(--navy);text-transform:uppercase}
.content{flex:1;overflow-y:auto;padding:20px 24px}

.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:16px 20px;margin-bottom:14px;box-shadow:var(--shadow)}
.card-title{font-size:10px;font-weight:600;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between}

.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:12px 16px}
.stat-val{font-size:26px;font-weight:700;line-height:1;font-family:var(--mono)}
.stat-label{font-size:10px;color:var(--muted);font-weight:600;letter-spacing:.5px;margin-top:4px;text-transform:uppercase}
.sv{color:var(--blue)}.sr{color:var(--danger)}.sw{color:var(--warn)}.so{color:var(--orange)}

.btn{display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:6px;border:1px solid var(--border);font-size:12px;font-weight:600;cursor:pointer;transition:all .12s;background:var(--surface2);color:var(--text)}
.btn-sm{padding:4px 10px;font-size:11px}
.btn-primary{background:var(--blue);color:#fff;border-color:var(--blue)}.btn-primary:hover{background:var(--navy)}
.btn-danger{background:transparent;color:var(--danger);border-color:var(--danger)}.btn-danger:hover{background:var(--danger-bg)}
.btn-ghost{background:transparent;color:var(--muted);border-color:var(--border)}.btn-ghost:hover{color:var(--text);background:var(--surface2)}
.btn-print{background:var(--navy);color:#fff;border-color:var(--navy)}.btn-print:hover{background:#1a2a52}

.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;border:1px solid transparent;white-space:nowrap}
.b-ok{background:var(--ok-bg);color:var(--ok);border-color:var(--ok-b)}
.b-warn{background:var(--warn-bg);color:var(--warn);border-color:var(--warn-b)}
.b-danger{background:var(--danger-bg);color:var(--danger);border-color:var(--danger-b)}
.b-orange{background:var(--orange-bg);color:var(--orange);border-color:var(--orange-b)}
.b-gray{background:#F3F4F6;color:#6B7280;border-color:#E5E7EB}
.b-blue{background:#DBEAFE;color:#1E40AF;border-color:#BFDBFE}
.b-navy{background:var(--navy);color:#fff}

table{width:100%;border-collapse:collapse}
th{font-size:10px;font-weight:600;letter-spacing:.5px;color:var(--muted);text-transform:uppercase;padding:8px 12px;text-align:left;border-bottom:2px solid var(--border);background:var(--surface2);white-space:nowrap}
td{padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:var(--surface2)}

.filter-bar{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center}
.filter-input{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);color:var(--text);font-family:var(--sans);font-size:12px;padding:6px 10px;outline:none;min-width:160px}
.filter-input:focus{border-color:var(--blue)}
.filter-select{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);color:var(--text);font-family:var(--sans);font-size:12px;padding:6px 10px;outline:none;cursor:pointer}

/* MODAL */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:200;padding:16px}
.modal{background:var(--surface);border-radius:12px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.2)}
.modal-lg{max-width:720px}
.modal-header{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:var(--surface);z-index:1}
.modal-title{font-size:14px;font-weight:700;color:var(--navy)}
.modal-body{padding:20px}
.modal-footer{padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;background:var(--surface2);border-radius:0 0 12px 12px}
.mclose{background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1}.mclose:hover{color:var(--navy)}

.fg{margin-bottom:12px}
.fg label{display:block;font-size:10px;color:var(--navy);letter-spacing:.5px;text-transform:uppercase;font-weight:600;margin-bottom:4px}
.fg input,.fg select,.fg textarea{width:100%;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);color:var(--text);font-family:var(--sans);font-size:13px;padding:7px 10px;outline:none;transition:border-color .15s}
.fg input:focus,.fg select:focus,.fg textarea:focus{border-color:var(--blue)}
.fg-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}

.empty-state{text-align:center;padding:40px 20px;color:var(--muted);font-size:13px}
.loading{display:flex;align-items:center;justify-content:center;padding:40px;color:var(--muted);gap:10px;font-size:13px}
.text-mono{font-family:var(--mono)}
.notif{position:fixed;top:16px;right:16px;background:var(--navy);color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;z-index:999;box-shadow:0 4px 16px rgba(0,0,0,.2)}

/* PRINT */
@media print {
  .sidebar,.topbar,.no-print{display:none!important}
  .modal-overlay{position:static;background:none;padding:0}
  .modal{box-shadow:none;max-height:none;max-width:none}
  .print-area{padding:0}
}
`;

// ─── HELPERS UI ────────────────────────────────────────────────────────────
function Notif({ msg, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return <div className="notif">{msg}</div>;
}

function DiasChip({ fechaStr }) {
  if (!fechaStr) return <span className="badge b-gray">Sin fecha</span>;
  const dias = diasHasta(fechaStr);
  const color = getAlertColor(dias);
  const cls = color === "vencido" ? "b-danger" : color === "critico" ? "b-orange" : color === "proximo" ? "b-warn" : "b-ok";
  const label = color === "vencido" ? `Vencido (${Math.abs(dias)}d)` : color === "ok" ? `Vigente (${dias}d)` : `${dias}d`;
  return <span className={`badge ${cls}`}>{label}</span>;
}

// ─── MODAL EMPLEADO ────────────────────────────────────────────────────────
function ModalEmpleado({ emp, onClose, onSave, notify }) {
  const [form, setForm] = useState(emp || { apellido_nombre:"", dni:"", libreta:"", categoria:"", tipo:"efectivo", activo:true });
  const [saving, setSaving] = useState(false);
  const set = (k,v) => setForm(p => ({...p,[k]:v}));

  const handleSave = async () => {
    if (!form.apellido_nombre.trim()) { notify("Ingresá el nombre"); return; }
    setSaving(true);
    try { const saved = await api.upsertEmpleado(form); onSave(saved); onClose(); }
    catch(e) { notify("Error: " + e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{emp?.id ? "Editar empleado" : "Nuevo empleado"}</span>
          <button className="mclose" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="fg"><label>Apellido y Nombre *</label><input value={form.apellido_nombre} onChange={e=>set("apellido_nombre",e.target.value)}/></div>
          <div className="fg-row">
            <div className="fg"><label>DNI</label><input value={form.dni||""} onChange={e=>set("dni",e.target.value)}/></div>
            <div className="fg"><label>Libreta</label><input value={form.libreta||""} onChange={e=>set("libreta",e.target.value)}/></div>
          </div>
          <div className="fg-row">
            <div className="fg"><label>Categoría</label>
              <select value={form.categoria||""} onChange={e=>set("categoria",e.target.value)}>
                <option value="">— Seleccionar —</option>
                {["Capitán Ultramar","Capitán Fluvial","Of. Fluvial","Piloto de Ultr. 1ra","Jefe Conductor","I Conductor","I Maquinista","Aux. de Máquinas","Contramaestre","I Cabo Engrasador","Marinero","Cocinero"].map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="fg"><label>Tipo</label>
              <select value={form.tipo} onChange={e=>set("tipo",e.target.value)}>
                <option value="efectivo">Efectivo</option>
                <option value="relevo">Relevo</option>
              </select>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?"Guardando...":"Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL DOCUMENTO ───────────────────────────────────────────────────────
function ModalDocumento({ doc, empleadoId, tiposDoc, onClose, onSave, notify }) {
  const [form, setForm] = useState(doc || { empleado_id: empleadoId, tipo_documento_id:"", fecha_vto:"", estado:"vigente", archivo_url:"", notas:"" });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  const handleSave = async () => {
    if (!form.tipo_documento_id) { notify("Seleccioná el tipo de documento"); return; }
    setSaving(true);
    try {
      let url = form.archivo_url;
      if (file) {
        const ext = file.name.split(".").pop();
        const path = `${empleadoId}/${form.tipo_documento_id}/${Date.now()}.${ext}`;
        url = await api.subirArchivo(file, "documentos", path);
      }
      const saved = await api.upsertDocumento({ ...form, archivo_url: url });
      onSave(saved); onClose();
    } catch(e) { notify("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const tipoSel = tiposDoc.find(t => t.id === form.tipo_documento_id);

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{doc?.id ? "Editar documento" : "Cargar documento"}</span>
          <button className="mclose" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="fg"><label>Tipo de documento *</label>
            <select value={form.tipo_documento_id} onChange={e=>set("tipo_documento_id",e.target.value)}>
              <option value="">— Seleccionar —</option>
              {tiposDoc.map(t=><option key={t.id} value={t.id}>{t.codigo} — {t.nombre}</option>)}
            </select>
          </div>
          {tipoSel?.tiene_vencimiento && (
            <div className="fg"><label>Fecha de vencimiento</label><input type="date" value={form.fecha_vto||""} onChange={e=>set("fecha_vto",e.target.value)}/></div>
          )}
          <div className="fg"><label>Estado</label>
            <select value={form.estado||"vigente"} onChange={e=>set("estado",e.target.value)}>
              <option value="vigente">Vigente</option>
              <option value="a_vencer">A vencer</option>
              <option value="vencido">Vencido</option>
              <option value="no_aplica">No aplica</option>
            </select>
          </div>
          <div className="fg"><label>Adjuntar archivo (PDF, imagen)</label>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e=>setFile(e.target.files[0])}/>
            {form.archivo_url && !file && (
              <div style={{marginTop:6,fontSize:11,color:"var(--blue)"}}>
                <a href={form.archivo_url} target="_blank" rel="noreferrer">📎 Ver archivo actual</a>
              </div>
            )}
          </div>
          <div className="fg"><label>Notas</label><textarea rows={2} value={form.notas||""} onChange={e=>set("notas",e.target.value)}/></div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?"Guardando...":"Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL DETALLE EMPLEADO ────────────────────────────────────────────────
function ModalDetalleEmpleado({ empleado, tiposDoc, documentos, onClose, onDocChange, notify }) {
  const [showDoc, setShowDoc] = useState(null);
  const docsEmp = documentos.filter(d => d.empleado_id === empleado.id);

  const handleDeleteDoc = async (id) => {
    if (!confirm("¿Eliminar este documento?")) return;
    try { await api.deleteDocumento(id); onDocChange(); notify("Documento eliminado"); }
    catch(e) { notify("Error: " + e.message); }
  };

  // Armar checklist completo
  const checklist = tiposDoc.map(t => {
    const doc = docsEmp.find(d => d.tipo_documento_id === t.id);
    return { tipo: t, doc };
  });

  const total = checklist.length;
  const ok = checklist.filter(c => c.doc && c.doc.estado !== "vencido").length;

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div className="modal-header">
          <div>
            <div className="modal-title">{empleado.apellido_nombre}</div>
            <div style={{fontSize:11,color:"var(--muted)",marginTop:2}}>{empleado.categoria} · {empleado.tipo} · DNI {empleado.dni} · Libreta {empleado.libreta}</div>
          </div>
          <button className="mclose" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div style={{fontSize:12,color:"var(--muted)"}}>
              Documentos cargados: <strong style={{color:"var(--navy)"}}>{ok}/{total}</strong>
            </div>
            <button className="btn btn-primary btn-sm" onClick={()=>setShowDoc({})}>+ Cargar documento</button>
          </div>

          <table>
            <thead><tr>
              <th>Código</th><th>Documento</th><th>Vencimiento</th><th>Estado</th><th>Archivo</th><th></th>
            </tr></thead>
            <tbody>
              {checklist.map(({tipo, doc}) => (
                <tr key={tipo.id} style={{background: !doc ? "var(--danger-bg)" : undefined}}>
                  <td className="text-mono" style={{fontSize:11}}>{tipo.codigo}</td>
                  <td style={{fontWeight:600}}>{tipo.nombre}</td>
                  <td>{doc?.fecha_vto ? <DiasChip fechaStr={doc.fecha_vto}/> : <span className="badge b-gray">—</span>}</td>
                  <td>
                    {!doc ? <span className="badge b-danger">Sin cargar</span> :
                      doc.estado === "vigente" ? <span className="badge b-ok">Vigente</span> :
                      doc.estado === "a_vencer" ? <span className="badge b-warn">A vencer</span> :
                      doc.estado === "vencido" ? <span className="badge b-danger">Vencido</span> :
                      <span className="badge b-gray">N/A</span>}
                  </td>
                  <td>
                    {doc?.archivo_url
                      ? <a href={doc.archivo_url} target="_blank" rel="noreferrer" style={{fontSize:11,color:"var(--blue)"}}>📎 Ver</a>
                      : <span style={{color:"var(--muted)",fontSize:11}}>—</span>}
                  </td>
                  <td>
                    <div style={{display:"flex",gap:4}}>
                      <button className="btn btn-sm btn-ghost" onClick={()=>setShowDoc(doc||{empleado_id:empleado.id,tipo_documento_id:tipo.id})}>
                        {doc ? "✏️" : "📤"}
                      </button>
                      {doc && <button className="btn btn-sm btn-danger" onClick={()=>handleDeleteDoc(doc.id)}>🗑</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
      {showDoc !== null && (
        <ModalDocumento
          doc={showDoc?.id ? showDoc : null}
          empleadoId={empleado.id}
          tiposDoc={tiposDoc}
          onClose={()=>setShowDoc(null)}
          onSave={()=>{ onDocChange(); setShowDoc(null); notify("Documento guardado"); }}
          notify={notify}
        />
      )}
    </div>
  );
}

// ─── MODAL ENTREGA EPP ─────────────────────────────────────────────────────
function ModalEntregaEPP({ empleado, eppTipos, talles, onClose, onSave, notify }) {
  const [items, setItems] = useState(
    eppTipos.map(t => ({
      epp_tipo_id: t.id,
      nombre: t.nombre,
      requiere_talle: t.requiere_talle,
      talle: talles.find(x=>x.empleado_id===empleado.id&&x.epp_tipo_id===t.id)?.talle||"",
      marca: "", tiene_certificacion: true, cantidad: 1, incluir: false, fecha_entrega: fechaHoy(),
    }))
  );
  const [saving, setSaving] = useState(false);
  const [printMode, setPrintMode] = useState(false);

  const toggleItem = (i) => setItems(prev => prev.map((it,idx)=>idx===i?{...it,incluir:!it.incluir}:it));
  const updItem = (i,k,v) => setItems(prev => prev.map((it,idx)=>idx===i?{...it,[k]:v}:it));

  const handleSave = async () => {
    const seleccionados = items.filter(it=>it.incluir);
    if (seleccionados.length === 0) { notify("Seleccioná al menos un EPP"); return; }
    setSaving(true);
    try {
      const entrega = { empleado_id: empleado.id, fecha_entrega: fechaHoy(), firmado: false };
      const rows = seleccionados.map(({epp_tipo_id,talle,marca,tiene_certificacion,cantidad,fecha_entrega})=>({
        epp_tipo_id, talle, marca, tiene_certificacion, cantidad, fecha_entrega
      }));
      await api.insertEntrega(entrega, rows);
      onSave(); onClose(); notify("Entrega registrada");
    } catch(e) { notify("Error: "+e.message); }
    finally { setSaving(false); }
  };

  if (printMode) {
    const seleccionados = items.filter(it=>it.incluir);
    return (
      <div className="modal-overlay">
        <div className="modal modal-lg">
          <div className="modal-header no-print">
            <span className="modal-title">Vista previa — Constancia de Entrega EPP</span>
            <button className="mclose" onClick={()=>setPrintMode(false)}>×</button>
          </div>
          <div className="modal-body print-area">
            <div style={{border:"1px solid #ccc",padding:20,fontFamily:"Arial,sans-serif",fontSize:12}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <div><strong>PARANA LOGISTICA S.A.</strong><br/>CUIT: 30-71103347-1<br/>Alvear 653, San Fernando</div>
                <div style={{textAlign:"right",fontSize:10}}>N° 07.03.01-01<br/>Pág. 1 de 1</div>
              </div>
              <div style={{textAlign:"center",fontWeight:700,fontSize:14,margin:"8px 0",borderTop:"2px solid #213363",borderBottom:"2px solid #213363",padding:"6px 0"}}>
                CONSTANCIA DE ENTREGA DE ROPA DE TRABAJO Y EPP
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,margin:"10px 0",fontSize:11}}>
                <div><strong>Nombre:</strong> {empleado.apellido_nombre}</div>
                <div><strong>DNI:</strong> {empleado.dni}</div>
                <div><strong>Categoría:</strong> {empleado.categoria}</div>
                <div><strong>Fecha:</strong> {new Date().toLocaleDateString("es-AR")}</div>
              </div>
              <table style={{width:"100%",borderCollapse:"collapse",marginTop:10,fontSize:11}}>
                <thead>
                  <tr style={{background:"#213363",color:"#fff"}}>
                    <th style={{padding:"5px 8px",border:"1px solid #999"}}>#</th>
                    <th style={{padding:"5px 8px",border:"1px solid #999"}}>Producto</th>
                    <th style={{padding:"5px 8px",border:"1px solid #999"}}>Talle/Modelo</th>
                    <th style={{padding:"5px 8px",border:"1px solid #999"}}>Marca</th>
                    <th style={{padding:"5px 8px",border:"1px solid #999"}}>Cert.</th>
                    <th style={{padding:"5px 8px",border:"1px solid #999"}}>Cant.</th>
                    <th style={{padding:"5px 8px",border:"1px solid #999"}}>Fecha</th>
                    <th style={{padding:"5px 8px",border:"1px solid #999",width:60}}>Firma</th>
                  </tr>
                </thead>
                <tbody>
                  {seleccionados.map((it,i)=>(
                    <tr key={i}>
                      <td style={{padding:"5px 8px",border:"1px solid #ddd",textAlign:"center"}}>{i+1}</td>
                      <td style={{padding:"5px 8px",border:"1px solid #ddd"}}>{it.nombre}</td>
                      <td style={{padding:"5px 8px",border:"1px solid #ddd"}}>{it.talle||"—"}</td>
                      <td style={{padding:"5px 8px",border:"1px solid #ddd"}}>{it.marca||"—"}</td>
                      <td style={{padding:"5px 8px",border:"1px solid #ddd",textAlign:"center"}}>{it.tiene_certificacion?"SI":"NO"}</td>
                      <td style={{padding:"5px 8px",border:"1px solid #ddd",textAlign:"center"}}>{it.cantidad}</td>
                      <td style={{padding:"5px 8px",border:"1px solid #ddd"}}>{it.fecha_entrega}</td>
                      <td style={{padding:"5px 8px",border:"1px solid #ddd"}}></td>
                    </tr>
                  ))}
                  {Array.from({length:Math.max(0,8-seleccionados.length)}).map((_,i)=>(
                    <tr key={"empty"+i}>{Array(8).fill(0).map((_,j)=><td key={j} style={{padding:"5px 8px",border:"1px solid #ddd",height:24}}></td>)}</tr>
                  ))}
                </tbody>
              </table>
              <div style={{display:"flex",justifyContent:"space-around",marginTop:30,paddingTop:20,borderTop:"1px solid #ccc"}}>
                <div style={{textAlign:"center"}}>
                  <div style={{borderTop:"1px solid #333",paddingTop:4,fontSize:10,marginTop:20,minWidth:160}}>Firma del Capitán</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{borderTop:"1px solid #333",paddingTop:4,fontSize:10,marginTop:20,minWidth:160}}>Firma del Tripulante</div>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-footer no-print">
            <button className="btn btn-ghost" onClick={()=>setPrintMode(false)}>← Volver</button>
            <button className="btn btn-print" onClick={()=>window.print()}>🖨️ Imprimir / PDF</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?"Guardando...":"💾 Guardar entrega"}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div className="modal-header">
          <div>
            <div className="modal-title">Nueva entrega EPP — {empleado.apellido_nombre}</div>
            <div style={{fontSize:11,color:"var(--muted)",marginTop:2}}>{empleado.categoria}</div>
          </div>
          <button className="mclose" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p style={{fontSize:11,color:"var(--muted)",marginBottom:12}}>Seleccioná los EPP a entregar y completá los datos.</p>
          <table>
            <thead><tr>
              <th style={{width:32}}></th>
              <th>EPP</th><th>Talle</th><th>Marca</th><th>Certif.</th><th>Cant.</th>
            </tr></thead>
            <tbody>
              {items.map((it,i)=>(
                <tr key={i} style={{background:it.incluir?"var(--ok-bg)":undefined}}>
                  <td><input type="checkbox" checked={it.incluir} onChange={()=>toggleItem(i)}/></td>
                  <td style={{fontWeight:600,fontSize:12}}>{it.nombre}</td>
                  <td>
                    {it.requiere_talle
                      ? <input style={{width:70,padding:"3px 6px",border:"1px solid var(--border)",borderRadius:4,fontSize:11}} value={it.talle} onChange={e=>updItem(i,"talle",e.target.value)} placeholder="Ej: 42"/>
                      : <span style={{color:"var(--muted)",fontSize:11}}>—</span>}
                  </td>
                  <td><input style={{width:90,padding:"3px 6px",border:"1px solid var(--border)",borderRadius:4,fontSize:11}} value={it.marca} onChange={e=>updItem(i,"marca",e.target.value)} placeholder="Marca"/></td>
                  <td><input type="checkbox" checked={it.tiene_certificacion} onChange={e=>updItem(i,"tiene_certificacion",e.target.checked)}/></td>
                  <td><input type="number" style={{width:50,padding:"3px 6px",border:"1px solid var(--border)",borderRadius:4,fontSize:11}} value={it.cantidad} min={1} onChange={e=>updItem(i,"cantidad",parseInt(e.target.value)||1)}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-ghost" onClick={()=>setPrintMode(true)}>👁 Vista previa</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?"Guardando...":"Registrar entrega"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── PAGE: DASHBOARD ───────────────────────────────────────────────────────
function PageDashboard({ empleados, documentos, tiposDoc, onVerEmpleado }) {
  const tiposConVto = tiposDoc.filter(t=>t.tiene_vencimiento);
  const alertas = [];
  empleados.filter(e=>e.activo).forEach(emp => {
    tiposConVto.forEach(t => {
      const doc = documentos.find(d=>d.empleado_id===emp.id&&d.tipo_documento_id===t.id);
      if (!doc) { alertas.push({ emp, tipo: t, doc: null, nivel: "sin_doc" }); return; }
      if (!doc.fecha_vto) return;
      const dias = diasHasta(doc.fecha_vto);
      const color = getAlertColor(dias);
      if (color === "vencido" || color === "critico" || color === "proximo") {
        alertas.push({ emp, tipo: t, doc, nivel: color, dias });
      }
    });
    // También alertar si no tiene ningún documento
    const docsEmp = documentos.filter(d=>d.empleado_id===emp.id);
    if (docsEmp.length === 0) alertas.push({ emp, tipo: null, doc: null, nivel: "sin_doc" });
  });

  const vencidos = alertas.filter(a=>a.nivel==="vencido").length;
  const criticos = alertas.filter(a=>a.nivel==="critico").length;
  const proximos = alertas.filter(a=>a.nivel==="proximo").length;
  const sinDoc   = alertas.filter(a=>a.nivel==="sin_doc").length;

  return (
    <div>
      <div className="stat-grid">
        <div className="stat"><div className="stat-val sv">{empleados.filter(e=>e.activo).length}</div><div className="stat-label">Empleados activos</div></div>
        <div className="stat"><div className="stat-val sr">{vencidos}</div><div className="stat-label">Docs vencidos</div></div>
        <div className="stat"><div className="stat-val so">{criticos}</div><div className="stat-label">Críticos (&lt;30d)</div></div>
        <div className="stat"><div className="stat-val sw">{proximos}</div><div className="stat-label">A vencer (&lt;90d)</div></div>
        <div className="stat"><div className="stat-val sr">{sinDoc}</div><div className="stat-label">Sin documentar</div></div>
      </div>

      {alertas.length === 0 ? (
        <div className="card"><div className="empty-state">✅ Toda la documentación está al día</div></div>
      ) : (
        <div className="card">
          <div className="card-title">Alertas de documentación</div>
          <table>
            <thead><tr><th>Empleado</th><th>Categoría</th><th>Documento</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {alertas.sort((a,b)=>{const o={vencido:0,sin_doc:1,critico:2,proximo:3};return o[a.nivel]-o[b.nivel];}).map((al,i)=>(
                <tr key={i}>
                  <td style={{fontWeight:600}}>{al.emp.apellido_nombre}</td>
                  <td style={{fontSize:11,color:"var(--muted)"}}>{al.emp.categoria}</td>
                  <td>{al.tipo?.nombre || "Sin documentación cargada"}</td>
                  <td>
                    {al.nivel==="vencido"   && <span className="badge b-danger">Vencido ({Math.abs(al.dias)}d)</span>}
                    {al.nivel==="critico"   && <span className="badge b-orange">Crítico ({al.dias}d)</span>}
                    {al.nivel==="proximo"   && <span className="badge b-warn">A vencer ({al.dias}d)</span>}
                    {al.nivel==="sin_doc"   && <span className="badge b-danger">Sin cargar</span>}
                  </td>
                  <td><button className="btn btn-sm btn-ghost" onClick={()=>onVerEmpleado(al.emp)}>Ver empleado</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── PAGE: EMPLEADOS (efectivos o relevos) ─────────────────────────────────
function PageEmpleados({ tipo, empleados, documentos, tiposDoc, onReload, notify }) {
  const [filtro, setFiltro] = useState("");
  const [modalEmp, setModalEmp] = useState(null);
  const [detalle, setDetalle] = useState(null);

  const lista = empleados.filter(e=>e.activo&&e.tipo===tipo&&(
    !filtro || e.apellido_nombre.toLowerCase().includes(filtro.toLowerCase()) ||
    (e.categoria||"").toLowerCase().includes(filtro.toLowerCase())
  ));

  const getPct = (emp) => {
    const docsEmp = documentos.filter(d=>d.empleado_id===emp.id);
    const total = tiposDoc.length;
    const ok = docsEmp.filter(d=>d.estado!=="vencido").length;
    return { ok, total, pct: total>0?Math.round(ok/total*100):0 };
  };

  const handleDelete = async (emp) => {
    if (!confirm(`¿Dar de baja a ${emp.apellido_nombre}?`)) return;
    try { await api.deleteEmpleado(emp.id); onReload(); notify("Empleado dado de baja"); }
    catch(e) { notify("Error: "+e.message); }
  };

  return (
    <div>
      <div className="filter-bar">
        <input className="filter-input" placeholder="Buscar nombre o categoría..." value={filtro} onChange={e=>setFiltro(e.target.value)}/>
        <button className="btn btn-primary" onClick={()=>setModalEmp({tipo})}>+ Nuevo {tipo}</button>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Nombre</th><th>Categoría</th><th>DNI</th><th>Libreta</th><th>Docs</th><th></th></tr></thead>
          <tbody>
            {lista.length===0 && <tr><td colSpan={6} className="empty-state">No hay {tipo}s registrados</td></tr>}
            {lista.map(emp=>{
              const {ok,total,pct} = getPct(emp);
              const color = pct===100?"var(--ok)":pct>=70?"var(--warn)":"var(--danger)";
              return (
                <tr key={emp.id}>
                  <td style={{fontWeight:600}}>{emp.apellido_nombre}</td>
                  <td style={{fontSize:11,color:"var(--muted)"}}>{emp.categoria}</td>
                  <td className="text-mono" style={{fontSize:11}}>{emp.dni}</td>
                  <td className="text-mono" style={{fontSize:11}}>{emp.libreta}</td>
                  <td>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{height:6,width:60,background:"var(--border)",borderRadius:3,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${pct}%`,background:color,borderRadius:3}}/>
                      </div>
                      <span style={{fontSize:11,color,fontWeight:600}}>{ok}/{total}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{display:"flex",gap:4}}>
                      <button className="btn btn-sm btn-primary" onClick={()=>setDetalle(emp)}>📋 Ver legajo</button>
                      <button className="btn btn-sm btn-ghost" onClick={()=>setModalEmp(emp)}>✏️</button>
                      <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(emp)}>🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modalEmp !== null && (
        <ModalEmpleado
          emp={modalEmp?.id ? modalEmp : null}
          onClose={()=>setModalEmp(null)}
          onSave={()=>{ onReload(); setModalEmp(null); notify("Empleado guardado"); }}
          notify={notify}
        />
      )}
      {detalle && (
        <ModalDetalleEmpleado
          empleado={detalle}
          tiposDoc={tiposDoc}
          documentos={documentos}
          onClose={()=>setDetalle(null)}
          onDocChange={onReload}
          notify={notify}
        />
      )}
    </div>
  );
}

// ─── PAGE: EPP TALLES ──────────────────────────────────────────────────────
function PageEPPTalles({ empleados, eppTipos, talles, onReload, notify }) {
  const [filtro, setFiltro] = useState("");
  const [editando, setEditando] = useState(null); // {emp, tipo}
  const [talleVal, setTalleVal] = useState("");

  const lista = empleados.filter(e=>e.activo&&(!filtro||e.apellido_nombre.toLowerCase().includes(filtro.toLowerCase())));

  const getTalle = (empId, eppTipoId) => talles.find(t=>t.empleado_id===empId&&t.epp_tipo_id===eppTipoId)?.talle || "";

  const handleEdit = (emp, tipo, talle) => { setEditando({emp,tipo}); setTalleVal(talle); };

  const handleSaveTalle = async () => {
    try {
      await api.upsertTalle({ empleado_id: editando.emp.id, epp_tipo_id: editando.tipo.id, talle: talleVal });
      onReload(); setEditando(null); notify("Talle guardado");
    } catch(e) { notify("Error: "+e.message); }
  };

  return (
    <div>
      <div className="filter-bar">
        <input className="filter-input" placeholder="Buscar empleado..." value={filtro} onChange={e=>setFiltro(e.target.value)}/>
      </div>
      <div className="card" style={{overflowX:"auto"}}>
        <table>
          <thead>
            <tr>
              <th>Empleado</th>
              <th>Tipo</th>
              {eppTipos.filter(t=>t.requiere_talle).map(t=><th key={t.id} style={{minWidth:90}}>{t.nombre}</th>)}
            </tr>
          </thead>
          <tbody>
            {lista.map(emp=>(
              <tr key={emp.id}>
                <td style={{fontWeight:600}}>{emp.apellido_nombre}</td>
                <td><span className={`badge ${emp.tipo==="efectivo"?"b-navy":"b-blue"}`}>{emp.tipo}</span></td>
                {eppTipos.filter(t=>t.requiere_talle).map(t=>{
                  const talle = getTalle(emp.id, t.id);
                  return (
                    <td key={t.id}>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        {editando?.emp.id===emp.id&&editando?.tipo.id===t.id ? (
                          <>
                            <input style={{width:55,padding:"2px 5px",border:"1px solid var(--blue)",borderRadius:4,fontSize:11}} value={talleVal} onChange={e=>setTalleVal(e.target.value)} autoFocus onKeyDown={e=>e.key==="Enter"&&handleSaveTalle()}/>
                            <button className="btn btn-sm btn-primary" onClick={handleSaveTalle}>✓</button>
                            <button className="btn btn-sm btn-ghost" onClick={()=>setEditando(null)}>✕</button>
                          </>
                        ) : (
                          <span className={`badge ${talle?"b-ok":"b-gray"}`} style={{cursor:"pointer"}} onClick={()=>handleEdit(emp,t,talle)}>
                            {talle||"—"}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── PAGE: ENTREGAS EPP ────────────────────────────────────────────────────
function PageEntregasEPP({ empleados, eppTipos, talles, onReload, notify }) {
  const [entregas, setEntregas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [modalEntrega, setModalEntrega] = useState(null);
  const [fileUpload, setFileUpload] = useState(null);
  const [uploading, setUploading] = useState(null);

  useEffect(()=>{ loadEntregas(); },[]);

  const loadEntregas = async () => {
    setLoading(true);
    try { setEntregas(await api.getEntregas()); }
    catch(e) { notify("Error cargando entregas"); }
    finally { setLoading(false); }
  };

  const handleUploadConstancia = async (entregaId) => {
    if (!fileUpload) return;
    setUploading(entregaId);
    try {
      const ext = fileUpload.name.split(".").pop();
      const path = `${entregaId}/${Date.now()}.${ext}`;
      const url = await api.subirArchivo(fileUpload, "constancias-epp", path);
      await api.updateEntrega(entregaId, { constancia_url: url, firmado: true });
      loadEntregas(); setFileUpload(null); notify("Constancia firmada cargada");
    } catch(e) { notify("Error: "+e.message); }
    finally { setUploading(null); }
  };

  const lista = entregas.filter(e=>{
    const emp = empleados.find(em=>em.id===e.empleado_id);
    return !filtro || (emp?.apellido_nombre||"").toLowerCase().includes(filtro.toLowerCase());
  });

  return (
    <div>
      <div className="filter-bar">
        <input className="filter-input" placeholder="Buscar empleado..." value={filtro} onChange={e=>setFiltro(e.target.value)}/>
        <button className="btn btn-primary" onClick={()=>setModalEntrega("select")}>+ Nueva entrega</button>
      </div>

      {/* Selector de empleado para nueva entrega */}
      {modalEntrega==="select" && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">Seleccionar empleado</span>
              <button className="mclose" onClick={()=>setModalEntrega(null)}>×</button>
            </div>
            <div className="modal-body">
              {empleados.filter(e=>e.activo).map(emp=>(
                <div key={emp.id} style={{padding:"8px 12px",borderRadius:6,cursor:"pointer",marginBottom:4,border:"1px solid var(--border)"}}
                  onClick={()=>setModalEntrega(emp)}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surface2)"}
                  onMouseLeave={e=>e.currentTarget.style.background=""}>
                  <div style={{fontWeight:600,fontSize:13}}>{emp.apellido_nombre}</div>
                  <div style={{fontSize:11,color:"var(--muted)"}}>{emp.categoria} · {emp.tipo}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {modalEntrega && typeof modalEntrega==="object" && (
        <ModalEntregaEPP
          empleado={modalEntrega}
          eppTipos={eppTipos}
          talles={talles}
          onClose={()=>setModalEntrega(null)}
          onSave={()=>{ loadEntregas(); onReload(); }}
          notify={notify}
        />
      )}

      {loading ? <div className="loading">Cargando...</div> : (
        <div className="card">
          <table>
            <thead><tr><th>Empleado</th><th>Fecha</th><th>Estado</th><th>Constancia</th><th></th></tr></thead>
            <tbody>
              {lista.length===0 && <tr><td colSpan={5} className="empty-state">No hay entregas registradas</td></tr>}
              {lista.map(ent=>{
                const emp = empleados.find(e=>e.id===ent.empleado_id);
                return (
                  <tr key={ent.id}>
                    <td style={{fontWeight:600}}>{emp?.apellido_nombre||"—"}</td>
                    <td className="text-mono" style={{fontSize:11}}>{fmtDate(ent.fecha_entrega)}</td>
                    <td>{ent.firmado ? <span className="badge b-ok">Firmada</span> : <span className="badge b-warn">Pendiente firma</span>}</td>
                    <td>
                      {ent.constancia_url
                        ? <a href={ent.constancia_url} target="_blank" rel="noreferrer" style={{fontSize:11,color:"var(--blue)"}}>📎 Ver constancia</a>
                        : <span style={{fontSize:11,color:"var(--muted)"}}>Sin adjunto</span>}
                    </td>
                    <td>
                      {!ent.firmado && (
                        <div style={{display:"flex",gap:4,alignItems:"center"}}>
                          <input type="file" accept=".pdf,.jpg,.png" onChange={e=>setFileUpload(e.target.files[0])} style={{fontSize:10,maxWidth:140}}/>
                          <button className="btn btn-sm btn-primary" onClick={()=>handleUploadConstancia(ent.id)} disabled={!fileUpload||uploading===ent.id}>
                            {uploading===ent.id?"...":"📤 Subir firmada"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── PAGE: PROYECCIÓN DE COMPRAS ───────────────────────────────────────────
function PageProyeccionCompras({ empleados, eppTipos, talles }) {
  const tiposConTalle = eppTipos.filter(t=>t.requiere_talle);

  const getDistribucion = (eppTipoId) => {
    const tallesItem = talles.filter(t=>t.epp_tipo_id===eppTipoId&&t.talle);
    const dist = {};
    tallesItem.forEach(t=>{ dist[t.talle] = (dist[t.talle]||0)+1; });
    const total = tallesItem.length;
    return Object.entries(dist).sort((a,b)=>b[1]-a[1]).map(([talle,count])=>({
      talle, count, pct: Math.round(count/total*100)
    }));
  };

  return (
    <div>
      <div className="card">
        <div className="card-title">Proyección de compras por distribución de talles</div>
        <p style={{fontSize:12,color:"var(--muted)",marginBottom:16,lineHeight:1.6}}>
          Basado en los talles registrados de los {empleados.filter(e=>e.activo).length} empleados activos. 
          La distribución muestra qué talles son más frecuentes para optimizar el stock mínimo.
        </p>
        {tiposConTalle.map(tipo=>{
          const dist = getDistribucion(tipo.id);
          const sinTalle = empleados.filter(e=>e.activo).length - talles.filter(t=>t.epp_tipo_id===tipo.id&&t.talle).length;
          return (
            <div key={tipo.id} style={{marginBottom:20,paddingBottom:20,borderBottom:"1px solid var(--border)"}}>
              <div style={{fontWeight:700,color:"var(--navy)",marginBottom:8,fontSize:13}}>{tipo.nombre}</div>
              {dist.length===0 ? (
                <div style={{fontSize:12,color:"var(--muted)"}}>Sin talles registrados</div>
              ) : (
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
                  {dist.map(({talle,count,pct})=>(
                    <div key={talle} style={{textAlign:"center",minWidth:60}}>
                      <div style={{height:Math.max(4,pct*1.5),background:"var(--blue)",borderRadius:"4px 4px 0 0",transition:"height .3s"}}/>
                      <div style={{fontSize:13,fontWeight:700,marginTop:4,fontFamily:"var(--mono)",color:"var(--navy)"}}>{talle}</div>
                      <div style={{fontSize:10,color:"var(--muted)"}}>{count} ({pct}%)</div>
                    </div>
                  ))}
                  {sinTalle>0 && (
                    <div style={{fontSize:11,color:"var(--warn)",marginLeft:8,alignSelf:"center"}}>
                      ⚠️ {sinTalle} sin talle registrado
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── APP PRINCIPAL ─────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("dashboard");
  const [empleados, setEmpleados] = useState([]);
  const [documentos, setDocumentos] = useState([]);
  const [tiposDoc, setTiposDoc] = useState([]);
  const [eppTipos, setEppTipos] = useState([]);
  const [talles, setTalles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notif, setNotif] = useState(null);
  const [detalleExterno, setDetalleExterno] = useState(null);

  const notify = useCallback((msg) => { setNotif(msg); }, []);

  const loadAll = useCallback(async () => {
    try {
      const [emps, docs, tipos, eppT, tall] = await Promise.all([
        api.getEmpleados(), api.getDocumentos(), api.getTiposDoc(),
        api.getEppTipos(), api.getTalles(),
      ]);
      setEmpleados(emps); setDocumentos(docs); setTiposDoc(tipos);
      setEppTipos(eppT); setTalles(tall);
    } catch(e) { notify("Error cargando datos: "+e.message); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleVerEmpleado = (emp) => { setDetalleExterno(emp); setPage("efectivos"); };

  const NAV = [
    { id:"dashboard",  label:"Dashboard",          icon:"📊" },
    { id:"efectivos",  label:"Efectivos",           icon:"👤" },
    { id:"relevos",    label:"Relevos",             icon:"🔄" },
    { id:"epp_talles", label:"EPP / Talles",        icon:"🦺" },
    { id:"entregas",   label:"Entregas EPP",        icon:"📦" },
    { id:"proyeccion", label:"Proyección Compras",  icon:"📈" },
  ];

  const PAGE_TITLES = {
    dashboard:"Dashboard — Alertas",
    efectivos:"Tripulantes Efectivos",
    relevos:"Tripulantes Relevos",
    epp_talles:"EPP — Registro de Talles",
    entregas:"Entregas de EPP",
    proyeccion:"Proyección de Compras EPP",
  };

  const vencidos = documentos.filter(d=>{
    if (!d.fecha_vto) return false;
    return diasHasta(d.fecha_vto) < 0;
  }).length;

  if (loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"var(--bg)",color:"var(--muted)",fontSize:14,gap:10}}>
      <style>{CSS}</style>
      ⏳ Cargando módulo...
    </div>
  );

  return (
    <>
      <style>{CSS}</style>
      {notif && <Notif msg={notif} onClose={()=>setNotif(null)}/>}
      <div className="app">
        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <img src="/pL.png" alt="" style={{width:34,height:34,objectFit:"cover",borderRadius:"50%",border:"2px solid rgba(255,255,255,.2)"}} onError={e=>e.target.style.display="none"}/>
            <div>
              <div className="sidebar-logo-main">Parana Logística</div>
              <div className="sidebar-logo-sub">Control Doc. y EPP</div>
            </div>
          </div>
          <div style={{flex:1,overflowY:"auto",paddingBottom:12}}>
            <div className="nav-section">Módulo</div>
            {NAV.map(n=>(
              <div key={n.id} className={`ni ${page===n.id?"active":""}`} onClick={()=>setPage(n.id)}>
                <span className="ni-icon">{n.icon}</span>
                {n.label}
                {n.id==="dashboard" && vencidos>0 && <span className="ni-badge">{vencidos}</span>}
              </div>
            ))}
            <div className="nav-section" style={{marginTop:8}}>Sistema</div>
            <div className="ni back" onClick={()=>window.location.href=PORTAL_URL}>← Portal</div>
          </div>
        </aside>

        {/* MAIN */}
        <main className="main">
          <div className="topbar">
            <span className="topbar-title">{PAGE_TITLES[page]||page}</span>
            <span style={{fontSize:11,color:"var(--muted)"}}>{empleados.filter(e=>e.activo).length} empleados activos</span>
          </div>
          <div className="content">
            {page==="dashboard" && (
              <PageDashboard
                empleados={empleados} documentos={documentos} tiposDoc={tiposDoc}
                onVerEmpleado={handleVerEmpleado}
              />
            )}
            {page==="efectivos" && (
              <PageEmpleados tipo="efectivo" empleados={empleados} documentos={documentos}
                tiposDoc={tiposDoc} onReload={loadAll} notify={notify}
              />
            )}
            {page==="relevos" && (
              <PageEmpleados tipo="relevo" empleados={empleados} documentos={documentos}
                tiposDoc={tiposDoc} onReload={loadAll} notify={notify}
              />
            )}
            {page==="epp_talles" && (
              <PageEPPTalles empleados={empleados} eppTipos={eppTipos}
                talles={talles} onReload={loadAll} notify={notify}
              />
            )}
            {page==="entregas" && (
              <PageEntregasEPP empleados={empleados} eppTipos={eppTipos}
                talles={talles} onReload={loadAll} notify={notify}
              />
            )}
            {page==="proyeccion" && (
              <PageProyeccionCompras empleados={empleados} eppTipos={eppTipos} talles={talles}/>
            )}
          </div>
        </main>
      </div>

      {/* Modal detalle externo (desde dashboard) */}
      {detalleExterno && (
        <ModalDetalleEmpleado
          empleado={detalleExterno}
          tiposDoc={tiposDoc}
          documentos={documentos}
          onClose={()=>setDetalleExterno(null)}
          onDocChange={loadAll}
          notify={notify}
        />
      )}
    </>
  );
}
