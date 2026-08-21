# Caja Evento — POS sencillo

App web sencilla (sin instalación, sin build) para registrar ventas de un
evento desde el móvil. Cada venta se guarda directamente como un commit en
este repositorio de GitHub (`data/ventas.json`), y el cierre de caja genera
un registro en `data/cierres.json`.

Artículos fijos: **Pincho (6 CHF)**, **Rebujito (6 CHF)**, **Tortilla Entera (39 CHF)**.
Métodos de pago: **Cash** y **Twint**.

## 1. Crear el repositorio

1. En GitHub, crea un repositorio nuevo (puede ser privado) y sube estos archivos
   (`index.html`, `style.css`, `app.js`, `README.md`, `data/ventas.json`, `data/cierres.json`)
   a la raíz, en la rama `main`.

   ```bash
   cd pos-evento
   git init
   git add .
   git commit -m "POS inicial"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```

## 2. Activar GitHub Pages

1. En el repo: **Settings → Pages**.
2. En "Source" elige **Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. Guarda. En un par de minutos tendrás la app en
   `https://TU_USUARIO.github.io/TU_REPO/`.
4. Abre esa URL desde el móvil y añádela a la pantalla de inicio (en
   Safari/Chrome: "Añadir a pantalla de inicio") para que se abra como una app.

## 3. Crear el token de acceso

La app necesita un token para poder escribir en el repo desde el navegador.

1. Ve a **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access**: selecciona solo este repositorio.
3. **Permissions → Repository permissions → Contents**: pon **Read and write**.
4. Genera el token y **cópialo** (solo se muestra una vez).

⚠️ Este token da acceso de escritura a este repo. No lo compartas ni lo pegues
en ningún sitio salvo en los Ajustes de esta app. La app lo guarda únicamente
en el `localStorage` del navegador de tu móvil, nunca se sube al repositorio.

## 4. Configurar la app

1. Abre la app en el móvil y entra en el icono ⚙ (Ajustes).
2. Rellena:
   - **Usuario u organización**: tu usuario de GitHub.
   - **Repositorio**: el nombre del repo (p. ej. `pos-evento`).
   - **Rama**: `main`.
   - **Token**: el token del paso 3.
3. Pulsa **Guardar** y luego **Probar conexión** para confirmar que todo
   funciona.

## 5. Uso durante el evento

- **Venta**: toca los artículos para añadirlos al ticket (toca varias veces
  para sumar cantidad, usa +/− para ajustar). Cuando el ticket esté completo,
  pulsa **Cash** o **Twint** para cerrar la venta — se guarda al momento en
  el repositorio.
- **Historial**: lista todas las ventas registradas. Si una venta se ha
  cobrado o apuntado mal, pulsa **Anular** — queda marcada como anulada
  (no se borra, para mantener trazabilidad) y deja de contar en el cierre.
- **Caja**: muestra el total pendiente de cierre, desglosado por Cash/Twint.
  Al pulsar **Cerrar caja y poner a cero**, se guarda un registro del cierre
  en `data/cierres.json` con los totales y las ventas incluidas, y el
  contador de "pendiente de cierre" vuelve a cero (las ventas ya cerradas
  siguen visibles en el historial, marcadas como "Cerrada").

## Notas técnicas

- No hay backend: todo son ficheros estáticos + llamadas directas a la API
  de GitHub (`api.github.com/repos/.../contents/...`) desde el navegador.
- Requiere conexión a internet en el móvil en el momento de cada venta
  (usa los datos móviles o el wifi del local).
- Si dos ventas se guardan casi a la vez y hay conflicto de commit, la app
  reintenta automáticamente releyendo el fichero antes de reescribirlo.
- Anular una venta después de que ya esté incluida en un cierre no
  recalcula ese cierre automáticamente (para mantener el cierre como
  registro histórico fijo); queda reflejado en el historial igualmente.
