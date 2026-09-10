-- Alarcón Darío Osvaldo no puede embarcar en Atlantic Dama (no le da la
-- titulación) — la asignación con fecha_desde = fecha_hasta = 2026-09-03
-- es un dato mal cargado, nunca embarcó realmente. Se borra por completo.

-- 1) Verificación antes de borrar
select id, empleado_id, proyecto_id, fecha_desde, fecha_hasta
from asignaciones a
where empleado_id = (select id from empleados where apellido_nombre ilike '%alarcon%dario%')
  and proyecto_id = 'd01e9386-47b4-4a35-8669-452600dac349';

-- 2) Borrado
delete from asignaciones
where empleado_id = (select id from empleados where apellido_nombre ilike '%alarcon%dario%')
  and proyecto_id = 'd01e9386-47b4-4a35-8669-452600dac349'
  and fecha_desde = '2026-09-03'
  and fecha_hasta = '2026-09-03';

-- 3) Verificación final: no debe devolver ninguna fila
select id, fecha_desde, fecha_hasta
from asignaciones a
where empleado_id = (select id from empleados where apellido_nombre ilike '%alarcon%dario%')
  and proyecto_id = 'd01e9386-47b4-4a35-8669-452600dac349';
