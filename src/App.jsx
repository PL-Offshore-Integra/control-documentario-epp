import { useState, useEffect, useCallback } from "react";
import JSZip from "jszip";
import { supabase } from "./lib/supabase";

const PORTAL_URL = "https://integra.ploffshore.com";
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
// Única fuente de verdad para el estado de un documento: si el tipo tiene
// vencimiento, el estado sale SIEMPRE de la fecha (se recalcula solo, nadie
// lo carga a mano). Si el tipo no tiene vencimiento, no hay fecha de la cual
// derivarlo, así que el único dato real es si está cargado o no ("no_aplica"
// para casos que no corresponden a este tripulante).
function estadoEfectivo(doc, tipo) {
  if (!doc) return "sin_cargar";
  const modo = tipo?.modo || (tipo?.tiene_vencimiento ? "vencimiento" : "checklist");
  if (modo === "actualizacion") {
    // No vence: se desactualiza. fecha_vto guarda la fecha de última actualización.
    if (!doc.fecha_vto) return "sin_fecha";
    const antiguedadDias = -diasHasta(doc.fecha_vto);
    const umbral = tipo.umbral_dias || 90;
    return antiguedadDias > umbral ? "desactualizado" : "actualizado";
  }
  if (modo === "vencimiento") {
    if (!doc.fecha_vto) return "sin_fecha";
    return getAlertColor(diasHasta(doc.fecha_vto)); // vencido | critico | proximo | ok
  }
  return doc.estado === "no_aplica" ? "no_aplica" : "vigente";
}
// catsOf soporta datos viejos que todavía tengan un solo "categoria" en vez de "categorias".
function catsOf(emp) {
  if (Array.isArray(emp?.categorias)) return emp.categorias.filter(Boolean);
  if (emp?.categoria) return [emp.categoria];
  return [];
}
function catsLabel(emp) { const c = catsOf(emp); return c.length ? c.join(" · ") : "—"; }
function esOficial(emp) { return catsOf(emp).some(c => JERARQUIA[c] && JERARQUIA[c] !== "marineria"); }

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
    const { data, error } = await supabase.from("tipos_documento").select("*").order("orden", { ascending: true, nullsFirst: false }).order("codigo");
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
  async getTitulos() {
    const { data, error } = await supabase.from("titulos_empleado").select("*").order("fecha_expira");
    if (error) throw error;
    return data || [];
  },
  async upsertTitulo(t) {
    const { data, error } = await supabase.from("titulos_empleado").upsert([t]).select().single();
    if (error) throw error;
    return data;
  },
  async deleteTitulo(id) {
    const { error } = await supabase.from("titulos_empleado").delete().eq("id", id);
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
  async getProyectos() {
    const { data, error } = await supabase.from("proyectos_buque").select("*").order("fecha_inicio", { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async upsertProyecto(p) {
    const { data, error } = await supabase.from("proyectos_buque").upsert([p]).select().single();
    if (error) throw error;
    return data;
  },
  async getAsignaciones() {
    const { data, error } = await supabase.from("asignaciones").select("*");
    if (error) throw error;
    return data || [];
  },
  async insertAsignacion(a) {
    const { data, error } = await supabase.from("asignaciones").insert([a]).select().single();
    if (error) throw error;
    return data;
  },
  async updateAsignacion(id, cambios) {
    const { error } = await supabase.from("asignaciones").update(cambios).eq("id", id);
    if (error) throw error;
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   CSS · tokens y componentes del módulo Compras (INTEGRA Brand Book v1.0).
   Los valores, las clases y las medidas son los del módulo Compras: navy de
   estructura, un solo color de acción, radio 4px, IBM Plex Sans + Mono,
   controles de 36px, cero sombras salvo capas flotantes.
   Excepción funcional documentada: la escala de vencimiento (vencido /
   crítico / próximo / vigente) conserva rojo · naranja · ámbar · verde,
   porque la criticidad tiene que leerse sin leer el texto.
   ══════════════════════════════════════════════════════════════════════════ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

:root{
  --navy:#082F4E;--blue:#056D76;--mid:#4A5560;--light:#C9D0D6;
  --bg:#FAFBFC;--surface:#FFFFFF;--surface2:#F4F6F8;--surface3:#E4E8EC;
  --border:#E4E8EC;--border2:#C9D0D6;
  --text:#0F1419;--muted:#4A5560;--muted2:#7A8792;
  --accent:#056D76;--accent2:#0E7A5F;--warn:#8F5A0B;--danger:#B3261E;--crit:#9A3F16;
  --mono:'IBM Plex Mono',monospace;--sans:'IBM Plex Sans',sans-serif;--r:4px;
  --nav:#082F4E;--action:#056D76;--action-press:#04565D;
  --tr:color 120ms cubic-bezier(.2,0,.38,.9),background-color 120ms cubic-bezier(.2,0,.38,.9),border-color 120ms cubic-bezier(.2,0,.38,.9);
}
[data-instance="pl-offshore"]{--nav:#002247;--action:#002247;--action-press:#001830;--blue:#002247;--accent:#002247}
[data-instance="clean-sea"]{--nav:#1B3765;--action:#006945;--blue:#006945;--accent:#006945}
[data-instance="terramare"]{--nav:#213363;--action:#1F5285;--blue:#1F5285;--accent:#1F5285}

body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.55;min-height:100vh;overflow-x:hidden}
*:focus-visible{outline:2px solid var(--action);outline-offset:2px}

/* ── BARRA DE APLICACIÓN ─────────────────────────────────────────────────── */
.appbar{height:56px;background:var(--nav);display:flex;align-items:center;gap:24px;padding:0 24px;flex:0 0 auto}
.appbar-iso{height:26px;width:auto;object-fit:contain;display:block;flex:0 0 auto}
.appbar-div{width:1px;height:24px;background:rgba(255,255,255,.14);flex:0 0 auto}
.appbar-instance{font:500 14px/1.2 var(--sans);color:#fff;white-space:nowrap;flex:0 0 auto}
.appbar-search{flex:1;max-width:380px;display:flex;align-items:center;gap:10px;height:32px;padding:0 12px;background:rgba(255,255,255,.10);border:0;border-radius:var(--r);font:400 14px/1.2 var(--sans);color:rgba(255,255,255,.72)}
.appbar-search::placeholder{color:rgba(255,255,255,.72)}
.appbar-tools{margin-left:auto;display:flex;align-items:center;gap:16px}
.appbar-avatar{width:28px;height:28px;border-radius:var(--r);background:rgba(255,255,255,.14);color:#fff;font-family:var(--mono);font-size:12px;font-weight:500;line-height:28px;text-align:center;flex:0 0 auto}
.appbar-user{font:500 13px/1.25 var(--sans);color:#fff;white-space:nowrap}
.appbar-link{background:none;border:0;padding:0;cursor:pointer;font:500 13px/1.2 var(--sans);color:rgba(255,255,255,.86);white-space:nowrap}
.appbar-link:hover{color:#fff;text-decoration:underline}

/* ── ARMAZÓN · navegación blanca con borde derecho ───────────────────────── */
.shell{display:grid;grid-template-columns:248px minmax(0,1fr);align-items:stretch;min-height:calc(100vh - 56px)}
.shell.is-collapsed{grid-template-columns:68px minmax(0,1fr)}
.sidebar{background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;min-width:0}
.sidebar-header{border-bottom:1px solid var(--border);padding:16px;display:flex;align-items:center;gap:12px;min-height:69px}
.sidebar-logo-img{width:32px;height:32px;object-fit:contain;border:0;background:none;flex:0 0 auto}
.sidebar-logo-main{font:600 15px/1.3 var(--sans);color:var(--navy)}
.sidebar-logo-sub{font-family:var(--mono);font-size:11px;font-weight:500;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;margin-top:2px}
.sidebar-nav{flex:1;padding:12px 0;overflow-y:auto}
.nav-section{padding:14px 16px 8px;font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.08em;color:var(--muted);text-transform:uppercase;text-align:left}
.ni{display:flex;align-items:center;gap:12px;width:100%;padding:9px 16px 9px 13px;background:transparent;border:0;border-left:3px solid transparent;cursor:pointer;text-align:left;font:400 14px/1.3 var(--sans);color:var(--muted);transition:var(--tr);min-height:38px}
.ni:hover{background:var(--surface2);color:var(--navy)}
.ni.active{background:var(--surface2);border-left-color:var(--action);color:var(--navy);font-weight:500}
.ni-ico{display:block;flex:0 0 auto;color:var(--muted2)}
.ni.active .ni-ico{color:var(--action)}
.ni-label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ni-badge{margin-left:auto;font-family:var(--mono);font-size:11px;font-weight:500;color:var(--muted);background:var(--surface2);padding:3px 6px;border-radius:3px;min-width:22px;text-align:center;border:1px solid var(--border)}
.ni.active .ni-badge{color:var(--action);background:var(--surface);border-color:var(--border2)}
.ni-badge.danger{color:var(--danger);border-color:#F0D5D2}
.sidebar-foot{border-top:1px solid var(--border);padding:12px 8px;display:flex;flex-direction:column;gap:2px}
.sidebar-foot-btn{display:flex;align-items:center;gap:12px;width:100%;padding:9px 10px;background:none;border:0;border-radius:var(--r);cursor:pointer;font:500 13px/1.2 var(--sans);color:var(--muted);transition:var(--tr)}
.sidebar-foot-btn:hover{background:var(--surface2);color:var(--navy)}
.sidebar-foot-meta{padding:8px 10px 0;font-family:var(--mono);font-size:11px;font-weight:500;line-height:1.6;letter-spacing:.06em;color:var(--muted2)}
.shell.is-collapsed .sidebar-header{justify-content:center;padding:16px 8px}
.shell.is-collapsed .ni{justify-content:center;padding:9px 8px 9px 5px}
.shell.is-collapsed .sidebar-foot-btn{justify-content:center}

/* ── ENCABEZADO DE PANTALLA ──────────────────────────────────────────────── */
.main{display:flex;flex-direction:column;min-width:0;overflow:hidden}
.pagehead{background:var(--surface);border-bottom:1px solid var(--border);padding:16px 24px;flex:0 0 auto}
.crumb{display:flex;align-items:center;gap:8px;font:400 13px/1.2 var(--sans);color:var(--muted)}
.crumb button{background:none;border:0;padding:0;cursor:pointer;font:400 13px/1.2 var(--sans);color:var(--action)}
.crumb button:hover{text-decoration:underline;color:var(--navy)}
.crumb-current{color:var(--text)}
.pagehead-row{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-top:10px}
.pagehead h1{font:600 24px/1.25 var(--sans);color:var(--navy);margin:0}
.pagehead p{font:400 13px/1.45 var(--sans);color:var(--muted);margin:6px 0 0;max-width:70ch}
.pagehead-actions{display:flex;gap:8px;flex:0 0 auto}
.content{flex:1;overflow-y:auto;overflow-x:hidden;padding:24px;background:var(--bg)}

/* ── PANELES ─────────────────────────────────────────────────────────────── */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:24px;margin-bottom:16px}
.card.flush{padding:24px 0 0}
.card-title{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.08em;color:var(--muted);text-transform:uppercase;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.card.flush .card-title{padding:0 24px}

/* ── KPIs ────────────────────────────────────────────────────────────────── */
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:24px}
.stats-5{grid-template-columns:repeat(5,minmax(0,1fr))}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:16px 18px}
.stat-label{font-family:var(--mono);font-size:11px;color:var(--muted);font-weight:500;letter-spacing:.08em;margin-bottom:8px;text-transform:uppercase}
.stat-value{font-family:var(--mono);font-size:30px;font-weight:600;color:var(--navy);font-variant-numeric:tabular-nums}
.va{color:var(--navy)}.vg{color:var(--accent2)}.vr{color:var(--danger)}.vc{color:var(--crit)}.vm{color:var(--warn)}.vp{color:var(--muted)}

/* ── TABLAS ──────────────────────────────────────────────────────────────── */
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.08em;color:var(--muted);text-transform:uppercase;padding:10px 12px;text-align:left;border-bottom:2px solid var(--navy);white-space:nowrap;background:var(--surface)}
td{padding:12px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr.click:hover td{background:var(--surface2);cursor:pointer}
tr.falta td{background:#FDF6F5}
.row-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end}
.icon-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:var(--r);border:1px solid var(--border2);background:var(--surface);color:var(--muted);cursor:pointer;transition:var(--tr)}
.icon-btn:hover{color:var(--navy);background:var(--surface2)}
.icon-btn.danger:hover{color:var(--danger);border-color:var(--danger);background:#FAEAE8}

/* ── FILTROS ─────────────────────────────────────────────────────────────── */
.filter-row{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
.filter-input,.filter-select{background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);color:var(--text);font-family:var(--sans);font-size:14px;height:36px;padding:0 10px;outline:none;min-width:220px;transition:var(--tr)}
.filter-select{cursor:pointer;min-width:150px}
.filter-input:focus,.filter-select:focus{border-width:2px;border-color:var(--action);padding:0 9px}
.filter-spacer{margin-left:auto}
.proyecto-tag{display:flex;align-items:center;height:36px;padding:0 12px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);font-size:14px;color:var(--navy);font-weight:500;white-space:nowrap}
.puestos-grupos{display:flex;flex-direction:column;gap:14px;margin-top:6px}
.puestos-grupo-titulo{font-family:var(--mono);font-size:11px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;font-weight:600;margin-bottom:6px}
.checklist-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px 16px}
.fg .checklist-item{display:flex;align-items:center;gap:8px;font-family:var(--sans);font-size:14px;font-weight:400;letter-spacing:normal;text-transform:none;color:var(--text)}
.checklist-item input{width:16px;height:16px;flex:none}

/* ── BADGES ──────────────────────────────────────────────────────────────── */
.badge{display:inline-flex;align-items:center;font-family:var(--mono);font-size:11px;font-weight:500;padding:3px 8px;border-radius:3px;white-space:nowrap;letter-spacing:.06em;text-transform:uppercase}
.b-red{background:#FAEAE8;color:#B3261E}
.b-crit{background:#FBEDE4;color:#9A3F16}
.b-amber{background:#FBF1E3;color:#8F5A0B}
.b-green{background:#E8F3EF;color:#0E7A5F}
.b-blue{background:#E8EDF3;color:#082F4E}
.b-gray{background:#F4F6F8;color:#4A5560}
.b-navy{background:var(--nav);color:#fff}
.badge.click{cursor:pointer}
.urgdot{width:6px;height:6px;border-radius:50%;display:inline-block;margin-right:6px;flex-shrink:0}

/* ── BOTONES ─────────────────────────────────────────────────────────────── */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:var(--sans);font-size:14px;font-weight:500;height:36px;padding:0 16px;border-radius:var(--r);border:1px solid transparent;cursor:pointer;transition:var(--tr);white-space:nowrap}
.btn-primary{background:var(--action);color:#fff}
.btn-primary:hover{background:var(--navy)}
.btn-primary:active{background:var(--action-press)}
.btn-danger{background:var(--surface);color:var(--danger);border-color:var(--border2)}
.btn-danger:hover{background:#FAEAE8;border-color:var(--danger)}
.btn-ghost{background:var(--surface);color:var(--muted);border-color:var(--border2)}
.btn-ghost:hover{color:var(--text);background:var(--surface2)}
.btn-sm{height:28px;padding:0 12px;font-size:13px}
.btn:disabled{background:var(--surface3);color:var(--muted2);border-color:transparent;cursor:not-allowed}

/* ── CAPAS FLOTANTES ─────────────────────────────────────────────────────── */
.overlay{position:fixed;inset:0;background:rgba(15,20,25,.45);display:flex;align-items:flex-start;justify-content:center;z-index:100;padding:24px;overflow-y:auto}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);width:100%;max-width:640px;margin:auto;box-shadow:0 8px 24px rgba(15,20,25,.14)}
.modal-lg{max-width:1000px}
.mhdr{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:20px 24px;border-bottom:1px solid var(--border);background:var(--surface);border-radius:var(--r) var(--r) 0 0}
.mtitle{font:600 18px/1.3 var(--sans);color:var(--navy)}
.msub{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-top:6px}
.mbody{padding:24px}
.mftr{padding:16px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;background:var(--surface2);border-radius:0 0 var(--r) var(--r)}
.mclose{background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1;transition:var(--tr)}
.mclose:hover{color:var(--navy)}

/* ── FORMULARIOS ─────────────────────────────────────────────────────────── */
.fg{display:flex;flex-direction:column;gap:6px}
.fg label{font-family:var(--mono);font-size:11px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;font-weight:500}
.fg input,.fg select,.fg textarea{background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);color:var(--text);font-family:var(--sans);font-size:14px;height:36px;padding:0 12px;outline:none;transition:var(--tr);width:100%}
.fg textarea{resize:vertical;min-height:72px;height:auto;padding:10px 12px}
.fg input:focus,.fg select:focus,.fg textarea:focus{border-width:2px;border-color:var(--action);padding:0 11px}
.fg textarea:focus{padding:9px 11px}
.fg input[type=file]{height:auto;padding:8px 12px;font-size:13px}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.form-single{display:grid;grid-template-columns:1fr;gap:16px;margin-bottom:16px}
.form-section{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.08em;color:var(--muted);text-transform:uppercase;margin:32px 0 16px;padding-bottom:8px;border-bottom:1px solid var(--border)}
.items-edit input,.items-edit select{background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);color:var(--text);font-family:var(--mono);font-size:13px;height:32px;padding:0 8px;width:100%;outline:none;transition:var(--tr)}
.items-edit input:focus,.items-edit select:focus{border-width:2px;border-color:var(--action);padding:0 7px}
.items-edit input[type=checkbox]{width:16px;height:16px;padding:0;accent-color:var(--action)}
.items-edit td{padding:8px 12px}

/* ── AVISOS ──────────────────────────────────────────────────────────────── */
.notif{position:fixed;bottom:24px;right:24px;background:var(--surface);border:1px solid var(--border);border-left-width:3px;border-left-color:var(--action);border-radius:var(--r);padding:14px 16px;font-size:14px;z-index:300;max-width:360px;display:flex;align-items:center;gap:12px;box-shadow:0 8px 24px rgba(15,20,25,.14)}
.info-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:14px 16px;font-size:14px}
.info-box.warn{border-left:3px solid var(--warn)}

/* ── UTILIDADES ──────────────────────────────────────────────────────────── */
.flex-gap{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.flex-between{display:flex;justify-content:space-between;align-items:center;gap:12px}
.text-mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.text-muted{color:var(--muted)}
.empty-state{text-align:center;padding:48px 24px;color:var(--muted);font-size:15px}
.loading{display:flex;align-items:center;justify-content:center;padding:48px;color:var(--muted);gap:12px;font-size:15px}
.kbar-track{height:6px;width:72px;background:var(--surface3);border-radius:3px;overflow:hidden}
.kbar-fill{height:100%;border-radius:3px}
.dist-row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
.dist-col{text-align:center;min-width:64px}
.dist-bar{background:var(--action);border-radius:2px 2px 0 0}
.dist-talle{font-family:var(--mono);font-size:13px;font-weight:600;color:var(--navy);margin-top:6px}
.dist-meta{font-family:var(--mono);font-size:11px;color:var(--muted)}
.link{color:var(--action);font-size:13px;text-decoration:none}
.link:hover{color:var(--navy);text-decoration:underline}

/* ── MOBILE ──────────────────────────────────────────────────────────────── */
@media (max-width:768px){
  .shell,.shell.is-collapsed{grid-template-columns:1fr}
  .sidebar{display:none}
  .appbar{gap:12px;padding:0 16px}
  .appbar-search,.appbar-instance,.appbar-user{display:none}
  .pagehead{padding:14px 16px}
  .pagehead-row{flex-direction:column;align-items:stretch;gap:12px}
  .pagehead-actions .btn{flex:1}
  .main{padding-bottom:72px}
  .content{padding:16px}
  .card{padding:16px;margin-bottom:12px}
  .stats,.stats-5{grid-template-columns:1fr 1fr;gap:12px}
  .stat{padding:14px}
  .stat-value{font-size:24px}
  .form-grid{grid-template-columns:1fr;gap:12px}
  table{min-width:560px}
  th,td{padding:10px 8px}
  .filter-row{flex-direction:column;align-items:stretch}
  .filter-input,.filter-select{min-width:unset;width:100%}
  .btn{height:44px}
  .btn-sm{height:36px}
  .overlay{padding:0;align-items:flex-end}
  .modal,.modal-lg{border-radius:var(--r) var(--r) 0 0;max-width:100%;max-height:92vh;overflow-y:auto}
  .mftr{flex-direction:column;align-items:stretch}
  .mftr .btn{width:100%}
  .notif{bottom:88px;right:12px;left:12px;max-width:unset}
  .mobile-nav{
    display:flex !important;position:fixed;bottom:0;left:0;right:0;
    background:var(--nav);border-top:1px solid rgba(255,255,255,.14);
    z-index:50;height:64px;justify-content:space-around;align-items:center;padding:0 4px;
  }
  .mobile-nav-item{display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;padding:8px;border-radius:var(--r);color:rgba(255,255,255,.72);transition:var(--tr);flex:1;position:relative;min-width:48px;min-height:48px;justify-content:center}
  .mobile-nav-item.active{color:#fff;background:rgba(255,255,255,.12)}
  .mobile-nav-label{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;text-align:center}
  .mobile-nav-badge{position:absolute;top:4px;right:8px;background:rgba(255,255,255,.14);color:#fff;font-family:var(--mono);font-size:10px;font-weight:500;padding:1px 5px;border-radius:3px;min-width:16px;text-align:center}
}
@media (min-width:769px){ .mobile-nav{display:none !important} }

/* ── IMPRESIÓN · el acta de entrega sale sola en la hoja ─────────────────── */
@media print{
  .appbar,.sidebar,.pagehead,.mobile-nav,.notif,.no-print{display:none !important}
  .overlay{position:static;background:none;padding:0;overflow:visible}
  .modal,.modal-lg{box-shadow:none;border:0;max-width:none;max-height:none}
  .mbody{padding:0}
  .content{padding:0;overflow:visible}
}
`;

/* ── Iconos de línea · trazo 1,6 · sin relleno · toman el color del texto ──
   Mismo criterio que el módulo Compras: los emoji están prohibidos, estas
   formas mínimas los reemplazan hasta que el brand book publique su set. */
const Ico = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const ICONS = {
  gauge:   <><path d="M4 19a8 8 0 1 1 16 0" /><path d="M12 19V13" /><path d="M15.5 9.5L12 13" /></>,
  user:    <><circle cx="12" cy="8" r="3.6" /><path d="M5 20c0-3.4 3.1-5.4 7-5.4s7 2 7 5.4" /></>,
  swap:    <><path d="M4 8h13l-3-3" /><path d="M20 16H7l3 3" /></>,
  vest:    <><path d="M8 3l4 3 4-3 3 2v16H5V5z" /><path d="M12 6v15" /></>,
  box:     <><path d="M3.3 7L12 3l8.7 4v10L12 21 3.3 17z" /><path d="M3.3 7L12 11l8.7-4" /><path d="M12 11v10" /></>,
  chart:   <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  file:    <><path d="M14 3H7a1.6 1.6 0 0 0-1.6 1.6v14.8A1.6 1.6 0 0 0 7 21h10a1.6 1.6 0 0 0 1.6-1.6V7.6z" /><path d="M14 3v4.6h4.6" /></>,
  plus:    <path d="M12 5v14M5 12h14" />,
  check:   <path d="M4.5 12.5l5 5 10-11" />,
  x:       <path d="M6 6l12 12M18 6L6 18" />,
  pencil:  <><path d="M4 20h4L20 8l-4-4L4 16z" /><path d="M14.5 5.5l4 4" /></>,
  trash:   <><path d="M4 7h16" /><path d="M9.5 7V4.5h5V7" /><path d="M6.5 7l1 13h9l1-13" /></>,
  upload:  <><path d="M12 17V4" /><path d="M7.5 8.5L12 4l4.5 4.5" /><path d="M4 20h16" /></>,
  print:   <><path d="M7 9V3.5h10V9" /><rect x="3.5" y="9" width="17" height="7.5" rx="1.6" /><path d="M7 16.5h10V21H7z" /></>,
  eye:     <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  panel:   <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9.5 4v16" /></>,
  bell:    <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  help:    <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.3c-.7.4-1.1 1-1.1 1.7v.3" /><path d="M12 17.5h.01" /></>,
  logout:  <><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13A1.5 1.5 0 0 1 18.5 20H15" /><path d="M11 8l-4 4 4 4" /><path d="M7 12h9" /></>,
};

// ─── HELPERS UI ────────────────────────────────────────────────────────────
function Notif({ msg, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return <div className="notif"><span>{msg}</span><button onClick={onClose} style={{marginLeft:"auto",background:"none",border:"none",color:"var(--muted)",cursor:"pointer"}}>✕</button></div>;
}

/* Escala de vencimiento · excepción funcional de color, documentada arriba. */
function DiasChip({ fechaStr }) {
  if (!fechaStr) return <span className="badge b-gray">Sin fecha</span>;
  const dias = diasHasta(fechaStr);
  const color = getAlertColor(dias);
  const cls = color === "vencido" ? "b-red" : color === "critico" ? "b-crit" : color === "proximo" ? "b-amber" : "b-green";
  const label = color === "vencido" ? `Vencido ${Math.abs(dias)}d` : color === "ok" ? `Vigente ${dias}d` : `${dias}d`;
  return <span className={`badge ${cls}`}>{label}</span>;
}

function FG({ label, children, full }) {
  return <div className="fg" style={full ? { gridColumn: "1/-1" } : {}}>
    {label && <label>{label}</label>}
    {children}
  </div>;
}

// ─── PUESTOS (categoría) ───────────────────────────────────────────────────
// Lista de puestos, en el orden exacto que indicaste — no se reordena ni se
// agrupa alfabéticamente. Es DISTINTA de la lista de títulos (más abajo):
// un puesto es el cargo del tripulante; un título es una titulación que
// puede tener, y usan nomenclaturas distintas (esta no separa Ultramar/Fluvial
// en todos los casos, la de títulos sí).
const ROLES_NAVALES = [
  { nombre:"Capitán Ultramar", jerarquia:"oficial_cubierta" },
  { nombre:"Capitán Fluvial", jerarquia:"oficial_cubierta" },
  { nombre:"Of. Fluvial", jerarquia:"oficial_cubierta" },
  { nombre:"Piloto de Ultr. 1ra", jerarquia:"oficial_cubierta" },
  { nombre:"Oficial de la Guardia de Navegación", jerarquia:"oficial_cubierta" },
  { nombre:"Jefe de Máquinas", jerarquia:"oficial_maquina" },
  { nombre:"Maquinista Naval de 1ra", jerarquia:"oficial_maquina" },
  { nombre:"Jefe Conductor", jerarquia:"oficial_maquina" },
  { nombre:"Conductor de Máquinas Navales de 1ra", jerarquia:"oficial_maquina" },
  { nombre:"Oficial de la Guardia de Máquinas", jerarquia:"oficial_maquina" },
  { nombre:"Auxiliar de Máquinas", jerarquia:"marineria" },
  { nombre:"1er Cabo", jerarquia:"marineria" },
  { nombre:"Cocinero", jerarquia:"marineria" },
  { nombre:"Marinero", jerarquia:"marineria" },
  { nombre:"Contramaestre", jerarquia:"marineria" },
  { nombre:"Enfermero", jerarquia:"marineria" },
  { nombre:"Mozo", jerarquia:"marineria" },
];
const CATEGORIAS = ROLES_NAVALES.map(r => r.nombre);
const JERARQUIA = Object.fromEntries(ROLES_NAVALES.map(r => [r.nombre, r.jerarquia]));
// Agrupa los puestos por jerarquía, respetando el orden de arriba dentro de
// cada grupo — solo para mostrarlos con subtítulo en el desplegable, no cambia el orden real.
const GRUPOS_PUESTO = [
  { key:"oficial_cubierta", titulo:"Oficial de Cubierta" },
  { key:"oficial_maquina", titulo:"Oficial de Máquina" },
  { key:"marineria", titulo:"Marinería" },
].map(g => ({ ...g, puestos: CATEGORIAS.filter(c => JERARQUIA[c] === g.key) }));

// ─── TÍTULOS ───────────────────────────────────────────────────────────────
// Lista propia y distinta de la de puestos, en el orden exacto que diste,
// para el desplegable de Título 1 / Título 2.
const TITULOS_POSIBLES = [
  "Capitán de Ultramar","Capitán Fluvial",
  "1er Oficial de Cubierta de Ultramar","1er Oficial Fluvial",
  "Oficial de la Guardia de Navegación de Ultramar","Oficial de la Guardia de Navegación Fluvial",
  "Jefe de Máquinas","Jefe Conductor",
  "1er Oficial de Máquinas","Conductor Naval de 1ra",
  "Oficial de la Guardia de Máquinas",
  "1er Cabo","Auxiliar de Máquinas-Engrasador","Contramaestre","Marinero","Cocinero","Mozo","Enfermero",
];

// ─── BUQUES ────────────────────────────────────────────────────────────────
// Igual que CATEGORIAS: lista fija en código, no tabla aparte, porque son solo dos.
const BUQUES = ["Atlantic Dama", "Golondrina de Mar"];

// ─── MODAL EMPLEADO ────────────────────────────────────────────────────────
// Separa "apellido_nombre" existente en apellido / nombre (heurística: primera palabra = apellido).
// Solo se usa para precargar el formulario al editar; el dato guardado sigue siendo un único campo.
function splitApellidoNombre(str) {
  const partes = (str || "").trim().split(/\s+/);
  if (partes.length <= 1) return { apellido: partes[0] || "", nombre: "" };
  return { apellido: partes[0], nombre: partes.slice(1).join(" ") };
}

function ModalEmpleado({ emp, onClose, onSave, notify }) {
  const [form, setForm] = useState(() => {
    if (emp) {
      const { apellido, nombre } = splitApellidoNombre(emp.apellido_nombre);
      const categorias = Array.isArray(emp.categorias) ? emp.categorias : (emp.categoria ? [emp.categoria] : []);
      return { ...emp, apellido, nombre, categorias };
    }
    return { apellido:"", nombre:"", dni:"", libreta:"", categorias:[], tipo:"efectivo", activo:true };
  });
  const [saving, setSaving] = useState(false);
  const set = (k,v) => setForm(p => ({...p,[k]:v}));
  const categoriasSel = Array.isArray(form.categorias) ? form.categorias : (form.categoria ? [form.categoria] : []);
  const puestoUnico = categoriasSel[0] || "";
  const setPuesto = (c) => setForm(p => ({ ...p, categorias: c ? [c] : [], categoria: null }));

  const handleSave = async () => {
    if (!form.apellido.trim()) { notify("Ingresá el apellido"); return; }
    if (!form.nombre.trim()) { notify("Ingresá el nombre"); return; }
    if (categoriasSel.length === 0) { notify("Elegí el puesto"); return; }
    setSaving(true);
    try {
      const { apellido, nombre, ...resto } = form;
      const payload = { ...resto, apellido_nombre: `${apellido.trim()} ${nombre.trim()}`.trim() };
      const saved = await api.upsertEmpleado(payload);
      onSave(saved); onClose();
    }
    catch(e) { notify("Error: " + e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="overlay">
      <div className="modal">
        <div className="mhdr">
          <div className="mtitle">{emp?.id ? "Editar tripulante" : "Nuevo tripulante"}</div>
          <button className="mclose" onClick={onClose}>✕</button>
        </div>
        <div className="mbody">
          <div className="form-grid">
            <FG label="Apellido *"><input value={form.apellido} onChange={e=>set("apellido",e.target.value)}/></FG>
            <FG label="Nombre *"><input value={form.nombre} onChange={e=>set("nombre",e.target.value)}/></FG>
            <FG label="DNI"><input value={form.dni||""} onChange={e=>set("dni",e.target.value)}/></FG>
            <FG label="Libreta"><input value={form.libreta||""} onChange={e=>set("libreta",e.target.value)}/></FG>
            <FG label="Tipo">
              <select value={form.tipo} onChange={e=>set("tipo",e.target.value)}>
                <option value="efectivo">Efectivo</option>
                <option value="relevo">Relevo</option>
              </select>
            </FG>
            <FG label="Puesto *">
              <select value={puestoUnico} onChange={e=>setPuesto(e.target.value)}>
                <option value="">Seleccionar...</option>
                {GRUPOS_PUESTO.map(g=>(
                  <optgroup key={g.key} label={g.titulo}>
                    {g.puestos.map(c=><option key={c} value={c}>{c}</option>)}
                  </optgroup>
                ))}
              </select>
            </FG>
          </div>
        </div>
        <div className="mftr">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?"Guardando...":"Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL DOCUMENTO ───────────────────────────────────────────────────────
function ModalDocumento({ doc, empleadoId, tiposDoc, onClose, onSave, notify }) {
  const [form, setForm] = useState(doc || { empleado_id: empleadoId, tipo_documento_id:"", fecha_vto:"", estado:"vigente", archivo_url:"", notas:"", detalle:null });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k,v) => setForm(p=>({...p,[k]:v}));
  const setDet = (k,v) => setForm(p=>({...p, detalle:{...(p.detalle||{}), [k]:v}}));

  const tipoSel = tiposDoc.find(t => t.id === form.tipo_documento_id);
  const esLibreta = (tipoSel?.nombre||"").toLowerCase().includes("libreta");
  const esActualizacion = tipoSel?.modo === "actualizacion";
  const esTitulo = /^Título \d/.test(tipoSel?.nombre||"");
  const det = form.detalle || {};

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
      let fechaVto = form.fecha_vto || null;
      if (esLibreta) {
        // La fecha "efectiva" (la que usan las alertas de todo el sistema) sale
        // del sticker si lo tiene, o si no de la cédula de embarque.
        fechaVto = det.posee_sticker ? (det.fecha_sticker || null) : (det.fecha_cedula || null);
      }
      const saved = await api.upsertDocumento({ ...form, archivo_url: url, fecha_vto: fechaVto });
      onSave(saved); onClose();
    } catch(e) { notify("Error: " + e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="overlay">
      <div className="modal">
        <div className="mhdr">
          <div className="mtitle">{doc?.id ? "Editar documento" : "Cargar documento"}</div>
          <button className="mclose" onClick={onClose}>✕</button>
        </div>
        <div className="mbody">
          <div className="form-single">
            <FG label="Tipo de documento *">
              <select value={form.tipo_documento_id} onChange={e=>set("tipo_documento_id",e.target.value)}>
                <option value="">Seleccionar...</option>
                {tiposDoc.map(t=><option key={t.id} value={t.id}>{t.codigo} — {t.nombre}</option>)}
              </select>
            </FG>
            {esTitulo ? (
              <>
                <FG label="Título">
                  <select value={det.titulo_elegido||""} onChange={e=>setDet("titulo_elegido",e.target.value)}>
                    <option value="">Seleccionar...</option>
                    {TITULOS_POSIBLES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </FG>
                <FG label="Fecha de vencimiento"><input type="date" value={form.fecha_vto||""} onChange={e=>set("fecha_vto",e.target.value)}/></FG>
              </>
            ) : esLibreta ? (
              <>
                <FG label="¿Posee sticker del título vigente?">
                  <select value={det.posee_sticker ? "si" : "no"} onChange={e=>setDet("posee_sticker", e.target.value==="si")}>
                    <option value="no">No</option>
                    <option value="si">Sí</option>
                  </select>
                </FG>
                {det.posee_sticker ? (
                  <FG label="Vencimiento del sticker"><input type="date" value={det.fecha_sticker||""} onChange={e=>setDet("fecha_sticker",e.target.value)}/></FG>
                ) : (
                  <>
                    <FG label="¿Posee cédula de embarque vigente?">
                      <select value={det.posee_cedula ? "si" : "no"} onChange={e=>setDet("posee_cedula", e.target.value==="si")}>
                        <option value="no">No</option>
                        <option value="si">Sí</option>
                      </select>
                    </FG>
                    {det.posee_cedula && (
                      <FG label="Vencimiento de la cédula"><input type="date" value={det.fecha_cedula||""} onChange={e=>setDet("fecha_cedula",e.target.value)}/></FG>
                    )}
                  </>
                )}
                <FG label="¿Está en el Censo Naval?">
                  <select value={det.censo ? "si" : "no"} onChange={e=>setDet("censo", e.target.value==="si")}>
                    <option value="no">No</option>
                    <option value="si">Sí</option>
                  </select>
                </FG>
              </>
            ) : tipoSel?.tiene_vencimiento ? (
              <FG label={esActualizacion ? "Fecha de última actualización" : "Fecha de vencimiento"}>
                <input type="date" value={form.fecha_vto||""} onChange={e=>set("fecha_vto",e.target.value)}/>
              </FG>
            ) : (
              <FG label="Estado">
                <select value={form.estado||"vigente"} onChange={e=>set("estado",e.target.value)}>
                  <option value="vigente">Vigente (documento cargado)</option>
                  <option value="no_aplica">No aplica a este tripulante</option>
                </select>
              </FG>
            )}
            <FG label="Adjuntar archivo (PDF, imagen)">
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e=>setFile(e.target.files[0])}/>
              {form.archivo_url && !file && (
                <a className="link" href={form.archivo_url} target="_blank" rel="noreferrer" style={{marginTop:6}}>Ver archivo actual</a>
              )}
            </FG>
            <FG label="Notas"><textarea rows={2} value={form.notas||""} onChange={e=>set("notas",e.target.value)}/></FG>
          </div>
        </div>
        <div className="mftr">
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
  const oficial = esOficial(empleado);

  const handleDeleteDoc = async (id) => {
    if (!confirm("¿Eliminar este documento?")) return;
    try { await api.deleteDocumento(id); onDocChange(); notify("Documento eliminado"); }
    catch(e) { notify("Error: " + e.message); }
  };

  // Armar checklist completo — a Marinería no se le pide lo que es solo de Oficialidad (COC, STCW Oficialidad).
  const checklist = tiposDoc
    .filter(t => !t.solo_oficialidad || oficial)
    .map(t => {
      const doc = docsEmp.find(d => d.tipo_documento_id === t.id);
      return { tipo: t, doc };
    });

  const total = checklist.length;
  const ok = checklist.filter(c => !["vencido","sin_cargar","sin_fecha"].includes(estadoEfectivo(c.doc, c.tipo))).length;

  return (
    <div className="overlay">
      <div className="modal modal-lg">
        <div className="mhdr">
          <div>
            <div className="mtitle">{empleado.apellido_nombre}</div>
            <div className="msub">{catsLabel(empleado)} · {empleado.tipo} · DNI {empleado.dni} · Libreta {empleado.libreta}</div>
          </div>
          <button className="mclose" onClick={onClose}>✕</button>
        </div>
        <div className="mbody">
          <div className="flex-between" style={{marginBottom:16}}>
            <div style={{fontSize:14,color:"var(--muted)"}}>
              Documentos cargados: <strong className="text-mono" style={{color:"var(--navy)"}}>{ok}/{total}</strong>
            </div>
            <button className="btn btn-primary btn-sm" onClick={()=>setShowDoc({})}>
              <Ico d={ICONS.plus} size={14}/>Cargar documento
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Código</th><th>Documento</th><th>Vencimiento</th><th>Estado</th><th>Archivo</th><th></th>
              </tr></thead>
              <tbody>
                {checklist.map(({tipo, doc}) => (
                  <tr key={tipo.id} className={!doc ? "falta" : ""}>
                    <td className="text-mono">{tipo.codigo}</td>
                    <td style={{fontWeight:500}}>{tipo.nombre}{doc?.detalle?.titulo_elegido ? ` — ${doc.detalle.titulo_elegido}` : ""}</td>
                    <td>{doc?.fecha_vto ? <DiasChip fechaStr={doc.fecha_vto}/> : <span className="badge b-gray">—</span>}</td>
                    <td>
                      {(() => { const est = estadoEfectivo(doc, tipo); return (
                        est === "sin_cargar" ? <span className="badge b-red">Sin cargar</span> :
                        est === "sin_fecha" ? <span className="badge b-amber">Sin fecha cargada</span> :
                        est === "vencido" ? <span className="badge b-red">Vencido</span> :
                        est === "critico" ? <span className="badge b-crit">Crítico</span> :
                        est === "proximo" ? <span className="badge b-amber">A vencer</span> :
                        est === "ok" ? <span className="badge b-green">Vigente</span> :
                        est === "desactualizado" ? <span className="badge b-red">Desactualizado</span> :
                        est === "actualizado" ? <span className="badge b-green">Actualizado</span> :
                        est === "no_aplica" ? <span className="badge b-gray">No aplica</span> :
                        <span className="badge b-green">Vigente</span>
                      ); })()}
                    </td>
                    <td>
                      {doc?.archivo_url
                        ? <a className="link" href={doc.archivo_url} target="_blank" rel="noreferrer">Ver archivo</a>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="icon-btn" title={doc ? "Editar documento" : "Cargar documento"}
                          onClick={()=>setShowDoc(doc||{empleado_id:empleado.id,tipo_documento_id:tipo.id})}>
                          <Ico d={doc ? ICONS.pencil : ICONS.upload} size={15}/>
                        </button>
                        {doc && <button className="icon-btn danger" title="Eliminar documento" onClick={()=>handleDeleteDoc(doc.id)}><Ico d={ICONS.trash} size={15}/></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mftr">
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

  /* Acta imprimible · membrete navy, tipografía del sistema, celdas de firma. */
  if (printMode) {
    const seleccionados = items.filter(it=>it.incluir);
    const cell = { padding:"7px 10px", border:"1px solid #C9D0D6" };
    const head = { ...cell, background:"var(--nav)", color:"#fff", fontFamily:"var(--mono)", fontSize:11, fontWeight:500, letterSpacing:".06em", textTransform:"uppercase" };
    return (
      <div className="overlay">
        <div className="modal modal-lg">
          <div className="mhdr no-print">
            <div className="mtitle">Constancia de entrega de EPP</div>
            <button className="mclose" onClick={()=>setPrintMode(false)}>✕</button>
          </div>
          <div className="mbody">
            <div style={{border:"1px solid #C9D0D6",borderRadius:4,padding:28,fontSize:13,color:"#0F1419"}}>
              <div className="flex-between" style={{alignItems:"flex-start",paddingBottom:16,borderBottom:"3px solid var(--nav)"}}>
                <div style={{lineHeight:1.5}}>
                  <div style={{font:"600 16px/1.3 var(--sans)",color:"var(--nav)"}}>PL OFFSHORE S.A.</div>
                  <div style={{color:"var(--muted)",fontSize:12}}>CUIT 30-71103347-1 · Alvear 653, San Fernando</div>
                </div>
                <div className="text-mono" style={{textAlign:"right",fontSize:11,color:"var(--muted)",letterSpacing:".06em"}}>
                  <div>N° 07.03.01-01</div>
                  <div>PÁG. 1 DE 1</div>
                </div>
              </div>

              <div style={{font:"600 18px/1.3 var(--sans)",color:"var(--nav)",margin:"20px 0 18px"}}>
                Constancia de entrega de ropa de trabajo y EPP
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px 24px",marginBottom:20}}>
                {[["Nombre",empleado.apellido_nombre],["DNI",empleado.dni],["Categoría",catsLabel(empleado)],["Fecha",new Date().toLocaleDateString("es-AR")]].map(([k,v])=>(
                  <div key={k}>
                    <div className="text-mono" style={{fontSize:11,color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase"}}>{k}</div>
                    <div style={{fontSize:14}}>{v || "—"}</div>
                  </div>
                ))}
              </div>

              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr>
                    <th style={{...head,width:32}}>#</th>
                    <th style={head}>Producto</th>
                    <th style={head}>Talle / Modelo</th>
                    <th style={head}>Marca</th>
                    <th style={head}>Cert.</th>
                    <th style={head}>Cant.</th>
                    <th style={head}>Fecha</th>
                    <th style={{...head,width:80}}>Firma</th>
                  </tr>
                </thead>
                <tbody>
                  {seleccionados.map((it,i)=>(
                    <tr key={i}>
                      <td style={{...cell,textAlign:"center"}} className="text-mono">{i+1}</td>
                      <td style={cell}>{it.nombre}</td>
                      <td style={cell} className="text-mono">{it.talle||"—"}</td>
                      <td style={cell}>{it.marca||"—"}</td>
                      <td style={{...cell,textAlign:"center"}} className="text-mono">{it.tiene_certificacion?"SI":"NO"}</td>
                      <td style={{...cell,textAlign:"center"}} className="text-mono">{it.cantidad}</td>
                      <td style={cell} className="text-mono">{it.fecha_entrega}</td>
                      <td style={cell}></td>
                    </tr>
                  ))}
                  {Array.from({length:Math.max(0,8-seleccionados.length)}).map((_,i)=>(
                    <tr key={"empty"+i}>{Array(8).fill(0).map((_,j)=><td key={j} style={{...cell,height:28}}></td>)}</tr>
                  ))}
                </tbody>
              </table>

              <div style={{display:"flex",justifyContent:"space-between",gap:48,marginTop:56}}>
                {["Firma del Capitán","Firma del Tripulante"].map(f=>(
                  <div key={f} style={{flex:1,borderTop:"1px solid #0F1419",paddingTop:8}}>
                    <div className="text-mono" style={{fontSize:11,color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase"}}>{f}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mftr no-print">
            <button className="btn btn-ghost" onClick={()=>setPrintMode(false)}>Volver</button>
            <button className="btn btn-ghost" onClick={()=>window.print()}><Ico d={ICONS.print} size={15}/>Imprimir / PDF</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?"Guardando...":"Guardar entrega"}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay">
      <div className="modal modal-lg">
        <div className="mhdr">
          <div>
            <div className="mtitle">Nueva entrega de EPP</div>
            <div className="msub">{empleado.apellido_nombre} · {catsLabel(empleado)}</div>
          </div>
          <button className="mclose" onClick={onClose}>✕</button>
        </div>
        <div className="mbody">
          <p className="text-muted" style={{fontSize:14,marginBottom:16}}>Seleccioná los EPP a entregar y completá talle, marca y cantidad.</p>
          <div className="table-wrap">
            <table className="items-edit">
              <thead><tr>
                <th style={{width:40}}></th>
                <th>EPP</th><th style={{width:110}}>Talle</th><th style={{width:150}}>Marca</th><th style={{width:80}}>Certif.</th><th style={{width:90}}>Cant.</th>
              </tr></thead>
              <tbody>
                {items.map((it,i)=>(
                  <tr key={i} style={{background:it.incluir?"#F4F6F8":undefined}}>
                    <td><input type="checkbox" checked={it.incluir} onChange={()=>toggleItem(i)}/></td>
                    <td style={{fontWeight:500,fontSize:14}}>{it.nombre}</td>
                    <td>
                      {it.requiere_talle
                        ? <input value={it.talle} onChange={e=>updItem(i,"talle",e.target.value)} placeholder="42"/>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td><input value={it.marca} onChange={e=>updItem(i,"marca",e.target.value)} placeholder="Marca"/></td>
                    <td><input type="checkbox" checked={it.tiene_certificacion} onChange={e=>updItem(i,"tiene_certificacion",e.target.checked)}/></td>
                    <td><input type="number" value={it.cantidad} min={1} onChange={e=>updItem(i,"cantidad",parseInt(e.target.value)||1)}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mftr">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-ghost" onClick={()=>setPrintMode(true)}><Ico d={ICONS.eye} size={15}/>Vista previa del acta</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?"Guardando...":"Registrar entrega"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── PAGE: DASHBOARD ───────────────────────────────────────────────────────
// Todo en una sola vista: filtro por tipo de tripulante, puesto y tipo de
// documento, todos combinables entre sí. El desplegable de documento lista
// los 8 tipos de documento existentes, no solo los que tienen vencimiento:
// para los que no vencen, filtrar por ese tipo muestra quién no lo cargó.
function PageDashboard({ empleados, documentos, tiposDoc, onVerEmpleado }) {
  const [tipoPersona, setTipoPersona] = useState("");
  const [puesto, setPuesto] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState("");

  const tiposConVto = tiposDoc.filter(t=>t.tiene_vencimiento);
  const tiposDocFiltrados = tipoDocumento === "__titulo__" ? tiposDoc.filter(t=>/^Título \d/.test(t.nombre))
    : tipoDocumento ? tiposDoc.filter(t=>t.id===tipoDocumento)
    : tiposConVto;
  const puestosDisponibles = [...new Set(empleados.flatMap(catsOf))].sort();

  const empleadosFiltrados = empleados.filter(e =>
    (tipoPersona === "baja" ? !e.activo : e.activo && (!tipoPersona || e.tipo===tipoPersona)) &&
    (!puesto || catsOf(e).includes(puesto))
  );

  const filas = [];
  empleadosFiltrados.forEach(emp => {
    tiposDocFiltrados.forEach(t => {
      const doc = documentos.find(d=>d.empleado_id===emp.id&&d.tipo_documento_id===t.id);
      if (!doc) { filas.push({ emp, tipoDoc: t, doc: null, nivel: "sin_doc" }); return; }
      if (!doc.fecha_vto) return;
      const dias = diasHasta(doc.fecha_vto);
      const color = getAlertColor(dias);
      if (color === "vencido" || color === "critico" || color === "proximo") {
        filas.push({ emp, tipoDoc: t, doc, nivel: color, dias: dias });
      }
    });
    // Sin ningún documento cargado: solo aplica si no se filtró por un tipo de documento puntual.
    if (!tipoDocumento) {
      const docsEmp = documentos.filter(d=>d.empleado_id===emp.id);
      if (docsEmp.length === 0) filas.push({ emp, tipoDoc: null, doc: null, nivel: "sin_doc" });
    }
  });
  filas.sort((a,b)=>{const o={vencido:0,sin_doc:1,critico:2,proximo:3};return o[a.nivel]-o[b.nivel];});

  const vencidos = filas.filter(f=>f.nivel==="vencido").length;
  const criticos = filas.filter(f=>f.nivel==="critico").length;
  const proximos = filas.filter(f=>f.nivel==="proximo").length;
  const sinDoc   = filas.filter(f=>f.nivel==="sin_doc").length;

  return (
    <div>
      <div className="filter-row">
        <select className="filter-select" value={tipoPersona} onChange={e=>setTipoPersona(e.target.value)}>
          <option value="">Efectivos y relevos</option>
          <option value="efectivo">Solo efectivos</option>
          <option value="relevo">Solo relevos</option>
          <option value="baja">Base de datos (dados de baja)</option>
        </select>
        <select className="filter-select" value={puesto} onChange={e=>setPuesto(e.target.value)}>
          <option value="">Todos los puestos</option>
          {puestosDisponibles.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <select className="filter-select" value={tipoDocumento} onChange={e=>setTipoDocumento(e.target.value)}>
          <option value="">Todos los documentos</option>
          {(() => {
            let tituloYaListado = false;
            return tiposDoc.map(t => {
              if (/^Título \d/.test(t.nombre)) {
                if (tituloYaListado) return null;
                tituloYaListado = true;
                return <option key="__titulo__" value="__titulo__">Título (1 y 2)</option>;
              }
              return <option key={t.id} value={t.id}>{t.codigo} — {t.nombre}</option>;
            });
          })()}
        </select>
      </div>

      <div className="stats stats-5">
        <div className="stat"><div className="stat-label">Tripulantes activos</div><div className="stat-value va">{empleadosFiltrados.length}</div></div>
        <div className="stat"><div className="stat-label">Documentos vencidos</div><div className="stat-value vr">{vencidos}</div></div>
        <div className="stat"><div className="stat-label">Críticos · menos de 30 d</div><div className="stat-value vc">{criticos}</div></div>
        <div className="stat"><div className="stat-label">A vencer · menos de 90 d</div><div className="stat-value vm">{proximos}</div></div>
        <div className="stat"><div className="stat-label">Sin documentar</div><div className="stat-value vr">{sinDoc}</div></div>
      </div>

      {filas.length === 0 ? (
        <div className="card"><div className="empty-state">Toda la documentación está al día.</div></div>
      ) : (
        <div className="card flush">
          <div className="card-title">Alertas de documentación · {filas.length}</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th style={{paddingLeft:24}}>Tripulante</th><th>Tipo</th><th>Puesto</th><th>Documento</th><th>Vencimiento</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {filas.map((f,i)=>(
                  <tr key={i}>
                    <td style={{fontWeight:500,paddingLeft:24}}>{f.emp.apellido_nombre}</td>
                    <td><span className={`badge ${f.emp.tipo==="efectivo"?"b-blue":"b-gray"}`}>{f.emp.tipo}</span></td>
                    <td className="text-muted">{catsLabel(f.emp)}</td>
                    <td>{f.tipoDoc?.nombre || "Sin documentación cargada"}</td>
                    <td className="text-mono">{f.doc ? fmtDate(f.doc.fecha_vto) : "—"}</td>
                    <td>
                      {!f.doc && <span className="badge b-red">Sin cargar</span>}
                      {f.nivel==="vencido" && <span className="badge b-red">Vencido {Math.abs(diasHasta(f.doc.fecha_vto))}d</span>}
                      {f.nivel==="critico" && <span className="badge b-crit">Crítico {diasHasta(f.doc.fecha_vto)}d</span>}
                      {f.nivel==="proximo" && <span className="badge b-amber">A vencer {diasHasta(f.doc.fecha_vto)}d</span>}
                      {f.nivel==="ok" && <span className="badge b-green">Vigente {diasHasta(f.doc.fecha_vto)}d</span>}
                    </td>
                    <td style={{paddingRight:24}}>
                      <div className="row-actions">
                        <button className="btn btn-sm btn-ghost" onClick={()=>onVerEmpleado(f.emp)}>Ver legajo</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PAGE: EMPLEADOS (efectivos o relevos) ─────────────────────────────────
function PageEmpleados({ tipo, empleados, documentos, tiposDoc, titulos, onReload, notify }) {
  const [filtro, setFiltro] = useState("");
  const [puesto, setPuesto] = useState("");
  const [modalEmp, setModalEmp] = useState(null);
  const [detalle, setDetalle] = useState(null);

  const puestosDisponibles = [...new Set(empleados.filter(e=>e.activo&&e.tipo===tipo).flatMap(catsOf))];

  const lista = empleados.filter(e=>e.activo&&e.tipo===tipo&&
    (!puesto || catsOf(e).includes(puesto)) &&
    (!filtro || e.apellido_nombre.toLowerCase().includes(filtro.toLowerCase()) ||
    catsLabel(e).toLowerCase().includes(filtro.toLowerCase()))
  );

  const getPct = (emp) => {
    const docsEmp = documentos.filter(d=>d.empleado_id===emp.id);
    const total = tiposDoc.length;
    const ok = docsEmp.filter(d => {
      const t = tiposDoc.find(x=>x.id===d.tipo_documento_id);
      return !["vencido","sin_fecha"].includes(estadoEfectivo(d, t));
    }).length;
    return { ok, total, pct: total>0?Math.round(ok/total*100):0 };
  };

  const handleDelete = async (emp) => {
    if (!confirm(`¿Dar de baja a ${emp.apellido_nombre}?`)) return;
    try { await api.deleteEmpleado(emp.id); onReload(); notify("Tripulante dado de baja"); }
    catch(e) { notify("Error: "+e.message); }
  };

  return (
    <div>
      <div className="filter-row">
        <input className="filter-input" placeholder="Buscar por nombre" value={filtro} onChange={e=>setFiltro(e.target.value)}/>
        <select className="filter-select" value={puesto} onChange={e=>setPuesto(e.target.value)}>
          <option value="">Todos los puestos</option>
          {puestosDisponibles.sort().map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <div className="filter-spacer" />
        <button className="btn btn-primary" onClick={()=>setModalEmp({tipo})}>
          <Ico d={ICONS.plus} size={15}/>Nuevo {tipo}
        </button>
      </div>
      <div className="card flush">
        <div className="card-title">{lista.length} {tipo}{lista.length===1?"":"s"} en registro</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{paddingLeft:24}}>Nombre</th><th>Categoría</th><th>DNI</th><th>Libreta</th><th>Documentación</th><th></th></tr></thead>
            <tbody>
              {lista.length===0 && <tr><td colSpan={6} className="empty-state">No hay {tipo}s registrados.</td></tr>}
              {lista.map(emp=>{
                const {ok,total,pct} = getPct(emp);
                const color = pct===100?"var(--accent2)":pct>=70?"var(--warn)":"var(--danger)";
                return (
                  <tr key={emp.id}>
                    <td style={{fontWeight:500,paddingLeft:24}}>{emp.apellido_nombre}</td>
                    <td className="text-muted">{catsLabel(emp)}</td>
                    <td className="text-mono">{emp.dni}</td>
                    <td className="text-mono">{emp.libreta}</td>
                    <td>
                      <div className="flex-gap">
                        <div className="kbar-track"><div className="kbar-fill" style={{width:`${pct}%`,background:color}}/></div>
                        <span className="text-mono" style={{fontSize:12,color}}>{ok}/{total}</span>
                      </div>
                    </td>
                    <td style={{paddingRight:24}}>
                      <div className="row-actions">
                        <button className="btn btn-sm btn-ghost" onClick={()=>setDetalle(emp)}>Ver legajo</button>
                        <button className="icon-btn" title="Editar tripulante" onClick={()=>setModalEmp(emp)}><Ico d={ICONS.pencil} size={15}/></button>
                        <button className="icon-btn danger" title="Dar de baja" onClick={()=>handleDelete(emp)}><Ico d={ICONS.trash} size={15}/></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modalEmp !== null && (
        <ModalEmpleado
          emp={modalEmp?.id ? modalEmp : null}
          onClose={()=>setModalEmp(null)}
          onSave={()=>{ onReload(); setModalEmp(null); notify("Tripulante guardado"); }}
          notify={notify}
        />
      )}
      {detalle && (
        <ModalDetalleEmpleado
          empleado={detalle}
          tiposDoc={tiposDoc}
          documentos={documentos}
          titulos={titulos}
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
  const conTalle = eppTipos.filter(t=>t.requiere_talle);

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
      <div className="filter-row">
        <input className="filter-input" placeholder="Buscar tripulante" value={filtro} onChange={e=>setFiltro(e.target.value)}/>
      </div>
      <div className="card flush">
        <div className="card-title">Talle registrado por tripulante · toque una celda para editar</div>
        <div className="table-wrap">
          <table className="items-edit">
            <thead>
              <tr>
                <th style={{paddingLeft:24}}>Tripulante</th>
                <th>Tipo</th>
                {conTalle.map(t=><th key={t.id} style={{minWidth:110}}>{t.nombre}</th>)}
              </tr>
            </thead>
            <tbody>
              {lista.length===0 && <tr><td colSpan={2+conTalle.length} className="empty-state">Sin tripulantes que coincidan.</td></tr>}
              {lista.map(emp=>(
                <tr key={emp.id}>
                  <td style={{fontWeight:500,paddingLeft:24}}>{emp.apellido_nombre}</td>
                  <td><span className={`badge ${emp.tipo==="efectivo"?"b-blue":"b-gray"}`}>{emp.tipo}</span></td>
                  {conTalle.map(t=>{
                    const talle = getTalle(emp.id, t.id);
                    const editing = editando?.emp.id===emp.id && editando?.tipo.id===t.id;
                    return (
                      <td key={t.id}>
                        {editing ? (
                          <div className="flex-gap" style={{gap:6}}>
                            <input style={{width:60}} value={talleVal} onChange={e=>setTalleVal(e.target.value)} autoFocus onKeyDown={e=>e.key==="Enter"&&handleSaveTalle()}/>
                            <button className="icon-btn" title="Guardar" onClick={handleSaveTalle}><Ico d={ICONS.check} size={14}/></button>
                            <button className="icon-btn" title="Cancelar" onClick={()=>setEditando(null)}><Ico d={ICONS.x} size={14}/></button>
                          </div>
                        ) : (
                          <span className={`badge click ${talle?"b-blue":"b-gray"}`} onClick={()=>handleEdit(emp,t,talle)}>{talle||"—"}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

  const loadEntregas = useCallback(async () => {
    setLoading(true);
    try { setEntregas(await api.getEntregas()); }
    catch(e) { notify("Error cargando entregas"); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(()=>{ loadEntregas(); },[loadEntregas]);

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
      <div className="filter-row">
        <input className="filter-input" placeholder="Buscar tripulante" value={filtro} onChange={e=>setFiltro(e.target.value)}/>
        <div className="filter-spacer" />
        <button className="btn btn-primary" onClick={()=>setModalEntrega("select")}>
          <Ico d={ICONS.plus} size={15}/>Nueva entrega
        </button>
      </div>

      {modalEntrega==="select" && (
        <div className="overlay">
          <div className="modal">
            <div className="mhdr">
              <div className="mtitle">Seleccionar tripulante</div>
              <button className="mclose" onClick={()=>setModalEntrega(null)}>✕</button>
            </div>
            <div className="mbody" style={{maxHeight:"60vh",overflowY:"auto"}}>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {empleados.filter(e=>e.activo).map(emp=>(
                  <button key={emp.id} className="ni" style={{border:"1px solid var(--border)",borderRadius:4,padding:"12px 14px",background:"var(--surface)"}}
                    onClick={()=>setModalEntrega(emp)}>
                    <span className="ni-label" style={{color:"var(--navy)",fontWeight:500}}>{emp.apellido_nombre}</span>
                    <span className="text-mono" style={{fontSize:11,color:"var(--muted)",letterSpacing:".06em",textTransform:"uppercase"}}>{catsLabel(emp)} · {emp.tipo}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="mftr">
              <button className="btn btn-ghost" onClick={()=>setModalEntrega(null)}>Cancelar</button>
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

      {loading ? <div className="loading">Cargando entregas...</div> : (
        <div className="card flush">
          <div className="card-title">{lista.length} entrega{lista.length===1?"":"s"} registrada{lista.length===1?"":"s"}</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th style={{paddingLeft:24}}>Tripulante</th><th>Fecha</th><th>Estado</th><th>Constancia</th><th></th></tr></thead>
              <tbody>
                {lista.length===0 && <tr><td colSpan={5} className="empty-state">No hay entregas registradas.</td></tr>}
                {lista.map(ent=>{
                  const emp = empleados.find(e=>e.id===ent.empleado_id);
                  return (
                    <tr key={ent.id}>
                      <td style={{fontWeight:500,paddingLeft:24}}>{emp?.apellido_nombre||"—"}</td>
                      <td className="text-mono">{fmtDate(ent.fecha_entrega)}</td>
                      <td>{ent.firmado ? <span className="badge b-green">Firmada</span> : <span className="badge b-amber">Pendiente firma</span>}</td>
                      <td>
                        {ent.constancia_url
                          ? <a className="link" href={ent.constancia_url} target="_blank" rel="noreferrer">Ver constancia</a>
                          : <span className="text-muted">Sin adjunto</span>}
                      </td>
                      <td style={{paddingRight:24}}>
                        {!ent.firmado && (
                          <div className="row-actions">
                            <input type="file" accept=".pdf,.jpg,.png" onChange={e=>setFileUpload(e.target.files[0])} style={{fontSize:12,maxWidth:180}}/>
                            <button className="btn btn-sm btn-primary" onClick={()=>handleUploadConstancia(ent.id)} disabled={!fileUpload||uploading===ent.id}>
                              {uploading===ent.id?"Subiendo...":"Subir firmada"}
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
        </div>
      )}
    </div>
  );
}

// ─── PAGE: PROYECCIÓN DE COMPRAS ───────────────────────────────────────────
function PageProyeccionCompras({ empleados, eppTipos, talles }) {
  const tiposConTalle = eppTipos.filter(t=>t.requiere_talle);
  const activos = empleados.filter(e=>e.activo).length;

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
        <div className="card-title">Distribución de talles · base {activos} tripulantes activos</div>
        {tiposConTalle.length===0 && <div className="empty-state">Ningún tipo de EPP requiere talle.</div>}
        {tiposConTalle.map((tipo,idx)=>{
          const dist = getDistribucion(tipo.id);
          const sinTalle = activos - talles.filter(t=>t.epp_tipo_id===tipo.id&&t.talle).length;
          return (
            <div key={tipo.id} style={{paddingBottom:24,marginBottom:24,borderBottom:idx===tiposConTalle.length-1?"none":"1px solid var(--border)"}}>
              <div style={{font:"600 15px/1.3 var(--sans)",color:"var(--navy)",marginBottom:14}}>{tipo.nombre}</div>
              {dist.length===0 ? (
                <div className="text-muted" style={{fontSize:14}}>Sin talles registrados.</div>
              ) : (
                <div className="dist-row">
                  {dist.map(({talle,count,pct})=>(
                    <div key={talle} className="dist-col">
                      <div className="dist-bar" style={{height:Math.max(4,pct*1.6)}}/>
                      <div className="dist-talle">{talle}</div>
                      <div className="dist-meta">{count} · {pct}%</div>
                    </div>
                  ))}
                  {sinTalle>0 && (
                    <div className="info-box warn" style={{marginLeft:16,alignSelf:"flex-end",fontSize:13}}>
                      {sinTalle} tripulante{sinTalle===1?"":"s"} sin talle registrado
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

// ─── MODAL ASIGNAR TRIPULANTE A PROYECTO ───────────────────────────────────
function ModalAsignar({ proyecto, empleadosDisponibles, onClose, onSave, notify }) {
  const [empleadoId, setEmpleadoId] = useState("");
  const [fechaDesde, setFechaDesde] = useState(fechaHoy());
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!empleadoId) { notify("Elegí un tripulante"); return; }
    setSaving(true);
    try {
      await api.insertAsignacion({ empleado_id: empleadoId, proyecto_id: proyecto.id, fecha_desde: fechaDesde });
      onSave(); onClose();
    } catch(e) { notify("Error: "+e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="overlay">
      <div className="modal">
        <div className="mhdr">
          <div>
            <div className="mtitle">Embarcar tripulante</div>
            <div className="msub">{proyecto.nombre} · {proyecto.buque}</div>
          </div>
          <button className="mclose" onClick={onClose}>✕</button>
        </div>
        <div className="mbody">
          <div className="form-single">
            <FG label="Tripulante *">
              <select value={empleadoId} onChange={e=>setEmpleadoId(e.target.value)}>
                <option value="">Seleccionar...</option>
                {empleadosDisponibles.map(e=><option key={e.id} value={e.id}>{e.apellido_nombre} — {catsLabel(e)} ({e.tipo})</option>)}
              </select>
            </FG>
            <FG label="Fecha de embarque"><input type="date" value={fechaDesde} onChange={e=>setFechaDesde(e.target.value)}/></FG>
          </div>
        </div>
        <div className="mftr">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?"Guardando...":"Embarcar"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL EDITAR FECHA DE EMBARQUE ─────────────────────────────────────────
function ModalEditarFecha({ asign, nombre, onClose, onSave, notify }) {
  const [fechaDesde, setFechaDesde] = useState(asign.fecha_desde);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!fechaDesde) { notify("Elegí una fecha"); return; }
    setSaving(true);
    try {
      await api.updateAsignacion(asign.id, { fecha_desde: fechaDesde });
      onSave(); onClose();
    } catch(e) { notify("Error: "+e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="overlay">
      <div className="modal">
        <div className="mhdr">
          <div>
            <div className="mtitle">Editar fecha de embarque</div>
            <div className="msub">{nombre}</div>
          </div>
          <button className="mclose" onClick={onClose}>✕</button>
        </div>
        <div className="mbody">
          <div className="form-single">
            <FG label="Fecha de embarque *"><input type="date" value={fechaDesde} onChange={e=>setFechaDesde(e.target.value)}/></FG>
          </div>
        </div>
        <div className="mftr">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?"Guardando...":"Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL NUEVO PROYECTO (rota el proyecto activo de un buque) ────────────
function ModalNuevoProyecto({ buque, proyectoAnterior, onClose, onSave, notify }) {
  const [nombre, setNombre] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!nombre.trim()) { notify("Ingresá el nombre del proyecto"); return; }
    setSaving(true);
    try {
      if (proyectoAnterior) {
        await api.upsertProyecto({ ...proyectoAnterior, activo: false, fecha_fin: fechaHoy() });
      }
      await api.upsertProyecto({ nombre: nombre.trim(), buque, fecha_inicio: fechaHoy(), activo: true });
      onSave(); onClose();
    } catch(e) { notify("Error: "+e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="overlay">
      <div className="modal">
        <div className="mhdr">
          <div className="mtitle">Nuevo proyecto — {buque}</div>
          <button className="mclose" onClick={onClose}>✕</button>
        </div>
        <div className="mbody">
          {proyectoAnterior && (
            <div className="info-box warn" style={{marginBottom:16}}>
              Esto cierra el proyecto actual ({proyectoAnterior.nombre}, desde {fmtDate(proyectoAnterior.fecha_inicio)}) con fecha de hoy.
              El rol actual no pasa automáticamente al proyecto nuevo — hay que volver a embarcar a cada tripulante.
            </div>
          )}
          <FG label="Nombre del proyecto *"><input value={nombre} onChange={e=>setNombre(e.target.value)} placeholder="Ej: Arendal"/></FG>
        </div>
        <div className="mftr">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?"Guardando...":"Crear proyecto"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── PAGE: ROL POR BUQUE ────────────────────────────────────────────────────
function PageRolBuque({ empleados, documentos, tiposDoc, proyectos, asignaciones, onReload, notify, onVerEmpleado }) {
  const [buque, setBuque] = useState(BUQUES[0]);
  const [fecha, setFecha] = useState(fechaHoy());
  const [tipoDocumento, setTipoDocumento] = useState("");
  const [modalAsignar, setModalAsignar] = useState(false);
  const [modalProyecto, setModalProyecto] = useState(false);
  const [editarFecha, setEditarFecha] = useState(null);

  const proyectoActivo = proyectos.find(p=>p.buque===buque && p.activo);
  const fechaEsHoy = fecha === fechaHoy();

  const rol = !proyectoActivo ? [] : asignaciones
    .filter(a => a.proyecto_id===proyectoActivo.id && a.fecha_desde<=fecha && (!a.fecha_hasta || a.fecha_hasta>fecha))
    .map(a => ({ asign: a, emp: empleados.find(e=>e.id===a.empleado_id) }))
    .filter(r => r.emp);

  const enRolIds = new Set(!proyectoActivo ? [] : asignaciones.filter(a=>a.proyecto_id===proyectoActivo.id && !a.fecha_hasta).map(a=>a.empleado_id));
  const empleadosDisponibles = empleados.filter(e=>e.activo && !enRolIds.has(e.id));

  const tiposConVto = tiposDoc.filter(t=>t.tiene_vencimiento);
  const tiposDocFiltrados = tipoDocumento ? tiposDoc.filter(t=>t.id===tipoDocumento) : tiposConVto;

  let vencidos=0, criticos=0, proximos=0, sinDoc=0;
  rol.forEach(({emp}) => {
    tiposDocFiltrados.forEach(t => {
      const doc = documentos.find(d=>d.empleado_id===emp.id&&d.tipo_documento_id===t.id);
      if (!doc) { sinDoc++; return; }
      if (!doc.fecha_vto) return;
      const color = getAlertColor(diasHasta(doc.fecha_vto));
      if (color==="vencido") vencidos++;
      else if (color==="critico") criticos++;
      else if (color==="proximo") proximos++;
    });
  });

  const handleDesembarcar = async (asign, nombre) => {
    if (!confirm(`¿Marcar a ${nombre} como desembarcado hoy?`)) return;
    try { await api.updateAsignacion(asign.id, { fecha_hasta: fechaHoy() }); onReload(); notify("Tripulante desembarcado"); }
    catch(e) { notify("Error: "+e.message); }
  };

  return (
    <div>
      <div className="filter-row">
        <select className="filter-select" value={buque} onChange={e=>setBuque(e.target.value)}>
          {BUQUES.map(b=><option key={b} value={b}>{b}</option>)}
        </select>
        {proyectoActivo ? (
          <div className="proyecto-tag">Proyecto: {proyectoActivo.nombre}</div>
        ) : (
          <div className="info-box warn" style={{padding:"7px 12px",fontSize:13}}>Este buque no tiene proyecto activo.</div>
        )}
        <select className="filter-select" value={tipoDocumento} onChange={e=>setTipoDocumento(e.target.value)}>
          <option value="">Todos los documentos</option>
          {tiposDoc.map(t=><option key={t.id} value={t.id}>{t.codigo} — {t.nombre}</option>)}
        </select>
        <FG label="Ver rol a la fecha"><input type="date" value={fecha} onChange={e=>setFecha(e.target.value)} style={{height:36}}/></FG>
        <div className="filter-spacer" />
        <button className="btn btn-ghost" onClick={()=>setModalProyecto(true)}>{proyectoActivo?"Nuevo proyecto":"Crear proyecto"}</button>
        {proyectoActivo && fechaEsHoy && (
          <button className="btn btn-primary" onClick={()=>setModalAsignar(true)}><Ico d={ICONS.plus} size={15}/>Embarcar tripulante</button>
        )}
      </div>

      {proyectoActivo && (
        <>
          <div className="stats stats-5">
            <div className="stat"><div className="stat-label">A bordo</div><div className="stat-value va">{rol.length}</div></div>
            <div className="stat"><div className="stat-label">Documentos vencidos</div><div className="stat-value vr">{vencidos}</div></div>
            <div className="stat"><div className="stat-label">Críticos · menos de 30 d</div><div className="stat-value vc">{criticos}</div></div>
            <div className="stat"><div className="stat-label">A vencer · menos de 90 d</div><div className="stat-value vm">{proximos}</div></div>
            <div className="stat"><div className="stat-label">Sin documentar</div><div className="stat-value vr">{sinDoc}</div></div>
          </div>

          {rol.length === 0 ? (
            <div className="card"><div className="empty-state">No hay tripulantes a bordo en esa fecha.</div></div>
          ) : (
            <div className="card flush">
              <div className="card-title">{rol.length} tripulante{rol.length===1?"":"s"} a bordo{fechaEsHoy?" · hoy":` · al ${fmtDate(fecha)}`}</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    {tipoDocumento
                      ? <tr><th style={{paddingLeft:24}}>Tripulante</th><th>Puesto</th><th>A bordo desde</th><th>Vencimiento</th><th>Estado</th><th></th></tr>
                      : <tr><th style={{paddingLeft:24}}>Tripulante</th><th>Puesto</th><th>A bordo desde</th><th>Documentación</th><th></th></tr>}
                  </thead>
                  <tbody>
                    {rol.map(({asign, emp}) => {
                      const bajo = asign.fecha_hasta && !fechaEsHoy;
                      if (tipoDocumento) {
                        const t = tiposDoc.find(x=>x.id===tipoDocumento);
                        const doc = documentos.find(d=>d.empleado_id===emp.id&&d.tipo_documento_id===tipoDocumento);
                        return (
                          <tr key={asign.id}>
                            <td style={{fontWeight:500,paddingLeft:24}}>{emp.apellido_nombre}{bajo && <span className="text-muted" style={{fontSize:11}}> (bajó {fmtDate(asign.fecha_hasta)})</span>}</td>
                            <td className="text-muted">{catsLabel(emp)}</td>
                            <td className="text-mono">{fmtDate(asign.fecha_desde)}</td>
                            <td className="text-mono">{doc?.fecha_vto ? fmtDate(doc.fecha_vto) : "—"}</td>
                            <td>{doc ? (doc.fecha_vto ? <DiasChip fechaStr={doc.fecha_vto}/> : <span className="badge b-green">Vigente</span>) : <span className="badge b-red">Sin cargar</span>}</td>
                            <td style={{paddingRight:24}}>
                              <div className="row-actions">
                                <button className="btn btn-sm btn-ghost" onClick={()=>onVerEmpleado(emp)}>Ver legajo</button>
                                {!asign.fecha_hasta && <button className="btn btn-sm btn-ghost" onClick={()=>setEditarFecha({asign, nombre:emp.apellido_nombre})}>Editar fecha</button>}
                                {!asign.fecha_hasta && <button className="btn btn-sm btn-danger" onClick={()=>handleDesembarcar(asign, emp.apellido_nombre)}>Desembarcar</button>}
                              </div>
                            </td>
                          </tr>
                        );
                      }
                      const total = tiposConVto.length;
                      const ok = tiposConVto.filter(t=>{
                        const doc = documentos.find(d=>d.empleado_id===emp.id&&d.tipo_documento_id===t.id);
                        return doc && getAlertColor(diasHasta(doc.fecha_vto))!=="vencido";
                      }).length;
                      const pct = total>0?Math.round(ok/total*100):0;
                      const color = pct===100?"var(--accent2)":pct>=70?"var(--warn)":"var(--danger)";
                      return (
                        <tr key={asign.id}>
                          <td style={{fontWeight:500,paddingLeft:24}}>{emp.apellido_nombre}{bajo && <span className="text-muted" style={{fontSize:11}}> (bajó {fmtDate(asign.fecha_hasta)})</span>}</td>
                          <td className="text-muted">{catsLabel(emp)}</td>
                          <td className="text-mono">{fmtDate(asign.fecha_desde)}</td>
                          <td>
                            <div className="flex-gap">
                              <div className="kbar-track"><div className="kbar-fill" style={{width:`${pct}%`,background:color}}/></div>
                              <span className="text-mono" style={{fontSize:12,color}}>{ok}/{total}</span>
                            </div>
                          </td>
                          <td style={{paddingRight:24}}>
                            <div className="row-actions">
                              <button className="btn btn-sm btn-ghost" onClick={()=>onVerEmpleado(emp)}>Ver legajo</button>
                              {!asign.fecha_hasta && <button className="btn btn-sm btn-danger" onClick={()=>handleDesembarcar(asign, emp.apellido_nombre)}>Desembarcar</button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {modalAsignar && proyectoActivo && (
        <ModalAsignar
          proyecto={proyectoActivo}
          empleadosDisponibles={empleadosDisponibles}
          onClose={()=>setModalAsignar(false)}
          onSave={()=>{ onReload(); notify("Tripulante embarcado"); }}
          notify={notify}
        />
      )}
      {editarFecha && (
        <ModalEditarFecha
          asign={editarFecha.asign}
          nombre={editarFecha.nombre}
          onClose={()=>setEditarFecha(null)}
          onSave={()=>{ onReload(); notify("Fecha actualizada"); }}
          notify={notify}
        />
      )}
      {modalProyecto && (
        <ModalNuevoProyecto
          buque={buque}
          proyectoAnterior={proyectoActivo}
          onClose={()=>setModalProyecto(false)}
          onSave={()=>{ onReload(); notify("Proyecto creado"); }}
          notify={notify}
        />
      )}
    </div>
  );
}

// ─── PAGE: PRESENTAR DOCUMENTACIÓN ──────────────────────────────────────────
// Junta documentos de un grupo de tripulantes (por buque/proyecto, o por
// tipo/puesto sin importar buque) para entregar a una autoridad: matriz
// tripulante × documento con su vencimiento, y descarga en ZIP de los
// archivos disponibles. Si hay vencidos o faltantes, avisa antes de bajar
// y deja elegir si igual se descarga lo que sí está.
function PagePresentarDocumentacion({ empleados, documentos, tiposDoc, proyectos, asignaciones, notify }) {
  const [buque, setBuque] = useState("");
  const [tipoPersona, setTipoPersona] = useState("");
  const [puesto, setPuesto] = useState("");
  const [docsSel, setDocsSel] = useState([]);
  const [zipping, setZipping] = useState(false);

  const puestosDisponibles = [...new Set(empleados.filter(e=>e.activo).flatMap(catsOf))].sort();
  const proyectoActivo = buque ? proyectos.find(p=>p.buque===buque && p.activo) : null;

  let base = empleados.filter(e=>e.activo &&
    (!tipoPersona || e.tipo===tipoPersona) &&
    (!puesto || catsOf(e).includes(puesto))
  );
  if (buque) {
    if (!proyectoActivo) base = [];
    else {
      const idsRol = new Set(asignaciones.filter(a=>a.proyecto_id===proyectoActivo.id && !a.fecha_hasta).map(a=>a.empleado_id));
      base = base.filter(e=>idsRol.has(e.id));
    }
  }

  const toggleDoc = (id) => setDocsSel(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);

  const filas = base.map(emp => ({
    emp,
    celdas: docsSel.map(docId => ({
      tipoDoc: tiposDoc.find(t=>t.id===docId),
      doc: documentos.find(d=>d.empleado_id===emp.id && d.tipo_documento_id===docId),
    })),
  }));

  let problemas = 0;
  filas.forEach(f => f.celdas.forEach(c => {
    if (!c.doc || !c.doc.archivo_url) problemas++;
    else if (c.doc.fecha_vto && getAlertColor(diasHasta(c.doc.fecha_vto))==="vencido") problemas++;
  }));

  const handleDescargarZip = async () => {
    const items = [];
    filas.forEach(f => f.celdas.forEach(c => {
      if (c.doc && c.doc.archivo_url) items.push({ nombre: f.emp.apellido_nombre, doc: c.tipoDoc.nombre, url: c.doc.archivo_url });
    }));
    if (items.length === 0) { notify("No hay archivos cargados para descargar"); return; }
    if (problemas > 0) {
      const seguir = confirm(`Hay ${problemas} documento${problemas===1?"":"s"} vencido${problemas===1?"":"s"} o sin cargar entre los seleccionados. ¿Descargar igual solo lo que está disponible?`);
      if (!seguir) return;
    }
    setZipping(true);
    try {
      const zip = new JSZip();
      let fallas = 0;
      for (const it of items) {
        try {
          const res = await fetch(it.url);
          if (!res.ok) throw new Error("no se pudo bajar");
          const blob = await res.blob();
          const ext = (it.url.split(".").pop() || "pdf").split("?")[0];
          zip.file(`${it.nombre} - ${it.doc}.${ext}`, blob);
        } catch(e) { fallas++; }
      }
      const contenido = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(contenido);
      const a = document.createElement("a");
      a.href = url; a.download = "presentacion_documentacion.zip";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify(fallas>0 ? `ZIP descargado (${fallas} archivo${fallas===1?"":"s"} no se pudo incluir)` : "ZIP descargado");
    } catch(e) { notify("Error armando el ZIP: "+e.message); }
    finally { setZipping(false); }
  };

  return (
    <div>
      <div className="filter-row">
        <select className="filter-select" value={buque} onChange={e=>setBuque(e.target.value)}>
          <option value="">Toda la empresa</option>
          {BUQUES.map(b=><option key={b} value={b}>{b}</option>)}
        </select>
        <select className="filter-select" value={tipoPersona} onChange={e=>setTipoPersona(e.target.value)}>
          <option value="">Efectivos y relevos</option>
          <option value="efectivo">Solo efectivos</option>
          <option value="relevo">Solo relevos</option>
        </select>
        <select className="filter-select" value={puesto} onChange={e=>setPuesto(e.target.value)}>
          <option value="">Todos los puestos</option>
          {puestosDisponibles.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {buque && !proyectoActivo && (
        <div className="info-box warn" style={{marginBottom:16}}>Este buque no tiene proyecto activo — no hay rol para acotar.</div>
      )}

      <div className="card" style={{marginBottom:16}}>
        <div className="card-title">Documentos a presentar</div>
        <div className="flex-gap">
          {tiposDoc.map(t=>(
            <label key={t.id} className="flex-gap" style={{gap:6,cursor:"pointer",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 10px",background:docsSel.includes(t.id)?"var(--surface2)":"var(--surface)"}}>
              <input type="checkbox" checked={docsSel.includes(t.id)} onChange={()=>toggleDoc(t.id)}/>
              <span style={{fontSize:13}}>{t.codigo} — {t.nombre}</span>
            </label>
          ))}
        </div>
      </div>

      {docsSel.length === 0 ? (
        <div className="card"><div className="empty-state">Elegí al menos un documento para armar la tabla.</div></div>
      ) : base.length === 0 ? (
        <div className="card"><div className="empty-state">No hay tripulantes que coincidan con estos filtros.</div></div>
      ) : (
        <>
          {problemas > 0 && (
            <div className="info-box warn" style={{marginBottom:16}}>
              {problemas} documento{problemas===1?"":"s"} vencido{problemas===1?"":"s"} o sin cargar en esta selección — revisalo antes de presentar.
            </div>
          )}
          <div className="card flush">
            <div className="flex-between" style={{padding:"16px 24px 0"}}>
              <div className="card-title" style={{marginBottom:0,padding:0,borderBottom:"none"}}>{filas.length} tripulante{filas.length===1?"":"s"}</div>
              <button className="btn btn-primary btn-sm" onClick={handleDescargarZip} disabled={zipping}>
                {zipping ? "Armando ZIP..." : <><Ico d={ICONS.upload} size={14}/>Descargar ZIP</>}
              </button>
            </div>
            <div className="table-wrap" style={{marginTop:12}}>
              <table>
                <thead>
                  <tr>
                    <th style={{paddingLeft:24}}>Tripulante</th><th>Puesto</th>
                    {docsSel.map(id=>{ const t=tiposDoc.find(x=>x.id===id); return <th key={id}>{t.nombre}</th>; })}
                  </tr>
                </thead>
                <tbody>
                  {filas.map(f=>(
                    <tr key={f.emp.id}>
                      <td style={{fontWeight:500,paddingLeft:24}}>{f.emp.apellido_nombre}</td>
                      <td className="text-muted">{catsLabel(f.emp)}</td>
                      {f.celdas.map((c,i)=>(
                        <td key={i}>
                          {!c.doc || !c.doc.archivo_url ? <span className="badge b-red">Sin cargar</span>
                            : c.doc.fecha_vto ? <DiasChip fechaStr={c.doc.fecha_vto}/>
                            : <span className="badge b-green">Vigente</span>}
                          {c.doc?.archivo_url && <div style={{marginTop:4}}><a className="link" href={c.doc.archivo_url} target="_blank" rel="noreferrer">Ver</a></div>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── LOGIN (estética INTEGRA / PL Offshore, igual al módulo Reparaciones) ──
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) return setError("Completá usuario y contraseña");
    setLoading(true); setError("");
    const { error: e } = await supabase.auth.signInWithPassword({ email, password });
    if (e) { setError("Usuario o contraseña incorrectos"); setLoading(false); }
  };
  const handleKey = (e) => { if (e.key === "Enter") handleLogin(); };

  const loginCSS = `
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
    .login-page{min-height:100vh;display:grid;grid-template-columns:minmax(0,1fr) 560px;background:#FFFFFF;font-family:'IBM Plex Sans',sans-serif;color:#0F1419;text-align:left}
    .login-split{display:contents}
    .login-left{display:flex;flex-direction:column;justify-content:space-between;gap:48px;padding:56px 64px;background:#002247;border:0;text-align:left}
    .login-left-integra-wrap{margin:0}
    .login-left-integra-img{height:52px;width:auto;object-fit:contain;opacity:1;display:block}
    .login-left-divider{width:100%;height:1px;background:rgba(255,255,255,.14);margin:24px 0}
    .login-left-company{display:flex;align-items:center;gap:14px;margin:0}
    .login-left-company-logo{width:40px;height:40px;border-radius:4px;object-fit:contain;border:0;background:rgba(255,255,255,.14);padding:4px}
    .login-left-company-name{font:600 24px/1.25 'IBM Plex Sans',sans-serif;color:#fff;letter-spacing:0}
    .login-left-line{width:56px;height:3px;background:#F8BC05;margin:24px 0}
    .login-left-sub{font:400 15px/1.55 'IBM Plex Sans',sans-serif;color:rgba(255,255,255,.82);max-width:420px;font-style:normal}
    .login-right{width:auto;display:flex;align-items:center;justify-content:center;padding:56px 64px;background:#FFFFFF}
    .login-card{width:100%;max-width:420px;background:transparent;border:0;border-radius:0;padding:0;backdrop-filter:none;text-align:left}
    .login-card-eyebrow{font:500 11px/1.2 'IBM Plex Mono',monospace;letter-spacing:.08em;color:#4A5560;text-transform:uppercase;margin-bottom:12px}
    .login-card-title{font:600 24px/1.25 'IBM Plex Sans',sans-serif;color:#082F4E;margin-bottom:8px}
    .login-card-sub{font:400 15px/1.55 'IBM Plex Sans',sans-serif;color:#4A5560;letter-spacing:0;margin-bottom:28px;text-transform:none}
    .login-fg{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}
    .login-fg label{font:500 11px/1.2 'IBM Plex Mono',monospace;color:#4A5560;letter-spacing:.08em;text-transform:uppercase}
    .login-fg input{border:1px solid #C9D0D6;border-radius:4px;height:40px;padding:0 12px;font:400 14px/1.2 'IBM Plex Sans',sans-serif;color:#0F1419;background:#FFFFFF;outline:none;transition:border-color 120ms cubic-bezier(.2,0,.38,.9)}
    .login-fg input::placeholder{color:#7A8792}
    .login-fg input:focus{border-width:2px;border-color:#002247;padding:0 11px}
    .login-btn{width:100%;height:44px;padding:0 16px;margin-top:24px;background:#F8BC05;color:#002247;border:none;border-radius:4px;font:600 15px/1.2 'IBM Plex Sans',sans-serif;cursor:pointer;transition:background-color 120ms cubic-bezier(.2,0,.38,.9);letter-spacing:0}
    .login-btn:hover{background:#DCA704}
    .login-btn:disabled{background:#E4E8EC;color:#7A8792;cursor:not-allowed}
    .login-error{background:#FFFFFF;color:#0F1419;border:1px solid #E4E8EC;border-left:3px solid #B3261E;border-radius:4px;padding:12px 16px;font:400 13px/1.45 'IBM Plex Sans',sans-serif;margin-bottom:16px}
    .login-footer{text-align:left;font:500 11px/1.2 'IBM Plex Mono',monospace;color:#4A5560;margin-top:32px;letter-spacing:.06em}
    @media(max-width:900px){
      .login-page{grid-template-columns:1fr}
      .login-left{padding:40px 24px;gap:32px}
      .login-left-integra-img{height:40px}
      .login-left-sub{max-width:100%}
      .login-right{padding:40px 24px}
    }
  `;

  return (
    <>
      <style>{loginCSS}</style>
      <div className="login-page">
        <div className="login-split">
          <div className="login-left">
            <div className="login-left-integra-wrap">
              <img src="/integra-logo-white-noclaim.svg" alt="INTEGRA" className="login-left-integra-img" />
            </div>
            <div className="login-left-divider" />
            <div className="login-left-company">
              <img src="/PL.png" alt="PL Offshore" className="login-left-company-logo" />
              <div className="login-left-company-name">PL Offshore | Control Documentario</div>
            </div>
            <div className="login-left-line" />
            <div className="login-left-sub">We Find the Way, or We Make One.</div>
          </div>

          <div className="login-right">
            <div className="login-card">
              <div className="login-card-eyebrow">PL Offshore | Control Documentario</div>
              <div className="login-card-title">Acceso al portal</div>
              <div className="login-card-sub">Solo personal autorizado</div>
              {error && <div className="login-error">{error}</div>}
              <div className="login-fg">
                <label>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={handleKey} placeholder="correo@paranalogistica.com.ar" autoFocus />
              </div>
              <div className="login-fg">
                <label>Contraseña</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKey} placeholder="••••••••" />
              </div>
              <button className="login-btn" onClick={handleLogin} disabled={loading || !email || !password}>
                {loading ? "Ingresando..." : "Ingresar →"}
              </button>
              <div className="login-footer">PL Offshore · Control Documentario · Confidencial</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* Título, bajada y grupo de cada pantalla. Un solo lugar que lo declara. */
const SECCIONES = {
  dashboard:  { grupo:"Control",  titulo:"Alerta de documentacion de Tripulantes", sub:"Documentos vencidos, por vencer y faltantes de la tripulación activa. Filtrable por tipo, puesto y tipo de documento." },
  efectivos:  { grupo:"Personal", titulo:"Tripulantes efectivos",    sub:"Legajo documental de cada tripulante embarcado, con el avance de la checklist obligatoria." },
  relevos:    { grupo:"Personal", titulo:"Tripulantes relevos",      sub:"Personal de relevo con legajo abierto, disponible para embarque." },
  epp_talles: { grupo:"EPP",      titulo:"Registro de talles",        sub:"Talle declarado por tripulante y por tipo de EPP. Es la base de la proyección de compras." },
  entregas:   { grupo:"EPP",      titulo:"Entregas de EPP",           sub:"Constancias de entrega, estado de firma y respaldo escaneado de cada acta." },
  proyeccion: { grupo:"EPP",      titulo:"Proyección de compras",     sub:"Distribución de talles registrados para dimensionar el stock mínimo por tipo de EPP." },
  rol_buque:  { grupo:"Embarque", titulo:"Rol por buque",             sub:"Tripulantes a bordo de cada buque/proyecto, hoy o a una fecha pasada, con su documentación." },
  presentar:  { grupo:"Embarque", titulo:"Presentar documentación",   sub:"Matriz de documentos por tripulante para entregar a una autoridad, con descarga en ZIP." },
};

// ─── APP PRINCIPAL ─────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(undefined);
  const [userEmail, setUserEmail] = useState("");
  const [page, setPage] = useState("dashboard");
  const [navOpen, setNavOpen] = useState(true);
  const [empleados, setEmpleados] = useState([]);
  const [documentos, setDocumentos] = useState([]);
  const [tiposDoc, setTiposDoc] = useState([]);
  const [eppTipos, setEppTipos] = useState([]);
  const [talles, setTalles] = useState([]);
  const [proyectos, setProyectos] = useState([]);
  const [asignaciones, setAsignaciones] = useState([]);
  const [titulos, setTitulos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notif, setNotif] = useState(null);
  const [detalleExterno, setDetalleExterno] = useState(null);

  const notify = useCallback((msg) => { setNotif(msg); }, []);

  // Instancia de marca: fija el navy y el color de acción de PL Offshore.
  useEffect(() => { document.documentElement.dataset.instance = "pl-offshore"; }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session || null);
      setUserEmail(session?.user?.email || "");
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess || null);
      setUserEmail(sess?.user?.email || "");
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => { await supabase.auth.signOut(); setSession(null); setUserEmail(""); };

  const loadAll = useCallback(async () => {
    try {
      const [emps, docs, tipos, eppT, tall, proys, asigs, tits] = await Promise.all([
        api.getEmpleados(), api.getDocumentos(), api.getTiposDoc(),
        api.getEppTipos(), api.getTalles(), api.getProyectos(), api.getAsignaciones(), api.getTitulos(),
      ]);
      setEmpleados(emps); setDocumentos(docs); setTiposDoc(tipos);
      setEppTipos(eppT); setTalles(tall); setProyectos(proys); setAsignaciones(asigs); setTitulos(tits);
    } catch(e) { notify("Error cargando datos: "+e.message); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { if (session) loadAll(); }, [session, loadAll]);

  const handleVerEmpleado = (emp) => { setDetalleExterno(emp); };

  const vencidos = documentos.filter(d => d.fecha_vto && diasHasta(d.fecha_vto) < 0).length;

  const NAV = [
    { titulo:"Control", items:[
      { id:"dashboard", icon:"gauge", label:"Alertas", count:vencidos, tone:"danger" },
    ]},
    { titulo:"Personal", items:[
      { id:"efectivos", icon:"user", label:"Efectivos", count:empleados.filter(e=>e.activo&&e.tipo==="efectivo").length },
      { id:"relevos",   icon:"swap", label:"Relevos",   count:empleados.filter(e=>e.activo&&e.tipo==="relevo").length },
    ]},
    { titulo:"EPP", items:[
      { id:"epp_talles", icon:"vest",  label:"Registro de talles",   count:0 },
      { id:"entregas",   icon:"box",   label:"Entregas de EPP",      count:0 },
      { id:"proyeccion", icon:"chart", label:"Proyección de compras", count:0 },
    ]},
    { titulo:"Embarque", items:[
      { id:"rol_buque", icon:"swap", label:"Rol por buque",           count:0 },
      { id:"presentar", icon:"file", label:"Presentar documentación", count:0 },
    ]},
  ];

  const seccion = SECCIONES[page] || { grupo:"Control Documentario", titulo:page, sub:"" };
  const inicial = (userEmail || "PL").replace(/@.*$/, "").slice(0, 2).toUpperCase();

  if (session === undefined) return (
    <>
      <style>{CSS}</style>
      <div className="loading" style={{height:"100vh",background:"var(--nav)",color:"rgba(255,255,255,.72)",fontFamily:"var(--mono)",fontSize:11,letterSpacing:".08em",textTransform:"uppercase"}}>
        Cargando...
      </div>
    </>
  );

  if (!session) return <LoginScreen />;

  if (loading) return (
    <>
      <style>{CSS}</style>
      <div className="loading" style={{height:"100vh"}}>Cargando módulo...</div>
    </>
  );

  return (
    <>
      <style>{CSS}</style>

      <header className="appbar">
        {/* Si Marketing entrega el isotipo suelto, cambiar por /integra-isotipo-white.svg */}
        <img src="/integra-logo-white-noclaim.svg" alt="INTEGRA" className="appbar-iso" />
        <span className="appbar-div" />
        <span className="appbar-instance">PL Offshore</span>
        <input className="appbar-search" type="search" disabled placeholder="Buscar en todo INTEGRA" aria-label="Buscar" />
        <div className="appbar-tools">
          <span style={{color:"rgba(255,255,255,.86)",display:"block"}}><Ico d={ICONS.bell} /></span>
          <span style={{color:"rgba(255,255,255,.86)",display:"block"}}><Ico d={ICONS.help} /></span>
          <span className="appbar-div" />
          <span className="appbar-avatar">{inicial}</span>
          <span className="appbar-user">{userEmail}</span>
          <button className="appbar-link" onClick={()=>window.location.href=PORTAL_URL}>Volver al portal</button>
        </div>
      </header>

      <div className={`shell ${navOpen ? "" : "is-collapsed"}`}>
        <nav className="sidebar">
          <div className="sidebar-header">
            <img src="/PL.png" alt="PL Offshore" className="sidebar-logo-img" />
            {navOpen && (
              <div>
                <div className="sidebar-logo-main">Control Documentario</div>
                <div className="sidebar-logo-sub">PL Offshore</div>
              </div>
            )}
          </div>

          <div className="sidebar-nav">
            {NAV.map(grupo=>(
              <div key={grupo.titulo} style={{marginBottom:8}}>
                {navOpen && <div className="nav-section">{grupo.titulo}</div>}
                {grupo.items.map(it=>(
                  <button key={it.id} className={`ni ${page===it.id?"active":""}`} onClick={()=>setPage(it.id)} title={it.label}>
                    <span className="ni-ico"><Ico d={ICONS[it.icon]} /></span>
                    {navOpen && <span className="ni-label">{it.label}</span>}
                    {it.count > 0 && <span className={`ni-badge ${it.tone||""}`}>{it.count}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="sidebar-foot">
            <button className="sidebar-foot-btn" onClick={()=>setNavOpen(v=>!v)}>
              <span style={{display:"block",color:"var(--muted2)"}}><Ico d={ICONS.panel} size={16} /></span>
              {navOpen && <span style={{flex:1,textAlign:"left"}}>Colapsar menú</span>}
            </button>
            <button className="sidebar-foot-btn" onClick={handleLogout}>
              <span style={{display:"block",color:"var(--muted2)"}}><Ico d={ICONS.logout} size={16} /></span>
              {navOpen && <span style={{flex:1,textAlign:"left"}}>Cerrar sesión</span>}
            </button>
            {navOpen && (
              <div className="sidebar-foot-meta">
                <div>CONTROL DOC v2.0</div>
                <div>POWERED BY INTEGRA</div>
              </div>
            )}
          </div>
        </nav>

        <div className="main">
          <div className="pagehead">
            <div className="crumb">
              <button onClick={()=>window.location.href=PORTAL_URL}>Portal</button>
              <span>/</span>
              <button onClick={()=>setPage("dashboard")}>Control Documentario</button>
              <span>/</span>
              <span className="crumb-current">{seccion.titulo}</span>
            </div>
            <div className="pagehead-row">
              <div>
                <h1>{seccion.titulo}</h1>
                {seccion.sub && <p>{seccion.sub}</p>}
              </div>
              <div className="pagehead-actions">
                <span className="text-mono" style={{fontSize:11,color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase",alignSelf:"center"}}>
                  {empleados.filter(e=>e.activo).length} tripulantes activos
                </span>
              </div>
            </div>
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
                tiposDoc={tiposDoc} titulos={titulos} onReload={loadAll} notify={notify}
              />
            )}
            {page==="relevos" && (
              <PageEmpleados tipo="relevo" empleados={empleados} documentos={documentos}
                tiposDoc={tiposDoc} titulos={titulos} onReload={loadAll} notify={notify}
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
            {page==="rol_buque" && (
              <PageRolBuque
                empleados={empleados} documentos={documentos} tiposDoc={tiposDoc}
                proyectos={proyectos} asignaciones={asignaciones}
                onReload={loadAll} notify={notify} onVerEmpleado={handleVerEmpleado}
              />
            )}
            {page==="presentar" && (
              <PagePresentarDocumentacion
                empleados={empleados} documentos={documentos} tiposDoc={tiposDoc}
                proyectos={proyectos} asignaciones={asignaciones} notify={notify}
              />
            )}
          </div>
        </div>
      </div>

      {notif && <Notif msg={notif} onClose={()=>setNotif(null)}/>}

      {/* Navegación inferior · solo mobile */}
      <nav className="mobile-nav">
        {[
          { id:"dashboard",  label:"Alertas",  icon:"gauge", count:vencidos },
          { id:"efectivos",  label:"Efectivos",icon:"user",  count:0 },
          { id:"relevos",    label:"Relevos",  icon:"swap",  count:0 },
          { id:"epp_talles", label:"Talles",   icon:"vest",  count:0 },
          { id:"entregas",   label:"Entregas", icon:"box",   count:0 },
        ].map(it=>(
          <div key={it.id} className={`mobile-nav-item ${page===it.id?"active":""}`} onClick={()=>setPage(it.id)}>
            <span style={{display:"block"}}><Ico d={ICONS[it.icon]} size={18} /></span>
            <span className="mobile-nav-label">{it.label}</span>
            {it.count > 0 && <span className="mobile-nav-badge">{it.count}</span>}
          </div>
        ))}
      </nav>

      {/* Legajo abierto desde las alertas */}
      {detalleExterno && (
        <ModalDetalleEmpleado
          empleado={detalleExterno}
          tiposDoc={tiposDoc}
          documentos={documentos}
          titulos={titulos}
          onClose={()=>setDetalleExterno(null)}
          onDocChange={loadAll}
          notify={notify}
        />
      )}
    </>
  );
}
