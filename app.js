/* =========================================================
   CAJA EVENTO — POS sencillo con persistencia en GitHub
   ========================================================= */

const RUTA_VENTAS = "data/ventas.json";
const RUTA_CIERRES = "data/cierres.json";
const CONFIG_KEY = "caja_evento_config";

let config = cargarConfig();
let ticket = [];          // [{nombre, precio, cantidad}]
let cacheVentas = null;   // {sha, data:[...]}
let cacheCierres = null;  // {sha, data:[...]}

/* ---------------- Config ---------------- */

function cargarConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function guardarConfig(c) {
  config = c;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
}

function configCompleta() {
  return config.owner && config.repo && config.branch && config.token;
}

/* ---------------- Utilidades base64 (UTF-8 safe) ---------------- */

function b64Encode(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (m, p1) =>
    String.fromCharCode("0x" + p1)
  ));
}

function b64Decode(str) {
  return decodeURIComponent(
    atob(str)
      .split("")
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("")
  );
}

/* ---------------- GitHub API ---------------- */

function apiUrl(path) {
  return `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`;
}

async function validarConexion() {
  const resRepo = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (resRepo.status === 401) {
    throw new Error("Token inválido o caducado (401).");
  }
  if (resRepo.status === 404) {
    throw new Error("Repositorio no encontrado, o el token no tiene acceso a él (404). Revisa usuario y repositorio.");
  }
  if (!resRepo.ok) {
    throw new Error(`Error comprobando el repositorio (${resRepo.status}).`);
  }
  const repoJson = await resRepo.json();
  if (repoJson.permissions && repoJson.permissions.push === false) {
    throw new Error("El token no tiene permiso de escritura (push) en este repositorio.");
  }

  const resBranch = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/branches/${encodeURIComponent(config.branch)}`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
      },
    }
  );
  if (resBranch.status === 404) {
    throw new Error(`La rama "${config.branch}" no existe en este repositorio.`);
  }
  if (!resBranch.ok) {
    throw new Error(`Error comprobando la rama (${resBranch.status}).`);
  }

  // Comprobación real de escritura: el permiso "push" del repo (arriba) refleja el
  // rol de la cuenta, no lo que el token en sí tiene concedido. Un fine-grained PAT
  // puede leer perfectamente y aun así no tener permiso de Contents: Read and write,
  // lo cual solo se detecta intentando escribir de verdad.
  const RUTA_TEST = "data/.conexion_test.json";
  let shaTest = null;
  const resGetTest = await fetch(`${apiUrl(RUTA_TEST)}?ref=${encodeURIComponent(config.branch)}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (resGetTest.ok) {
    shaTest = (await resGetTest.json()).sha;
  }

  const bodyTest = {
    message: "Test de conexión (Probar conexión en Ajustes)",
    content: b64Encode(JSON.stringify({ ok: true, ts: new Date().toISOString() })),
    branch: config.branch,
  };
  if (shaTest) bodyTest.sha = shaTest;

  const resPutTest = await fetch(apiUrl(RUTA_TEST), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyTest),
  });
  if (resPutTest.status === 403) {
    throw new Error(
      'El token no tiene permiso de escritura en Contents (403 "Resource not accessible by personal access token"). ' +
        "Revisa en GitHub el token: Repository permissions → Contents debe estar en \"Read and write\"."
    );
  }
  if (!resPutTest.ok) {
    const texto = await resPutTest.text().catch(() => "");
    throw new Error(`Error probando escritura (${resPutTest.status}): ${texto}`);
  }
}

async function githubGetFile(path) {
  const res = await fetch(`${apiUrl(path)}?ref=${encodeURIComponent(config.branch)}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (res.status === 404) {
    return { sha: null, data: [] };
  }
  if (!res.ok) {
    throw new Error(`Error leyendo ${path}: ${res.status}`);
  }
  const json = await res.json();
  const contenido = b64Decode(json.content.replace(/\n/g, ""));
  let data;
  try {
    data = JSON.parse(contenido);
  } catch (e) {
    data = [];
  }
  return { sha: json.sha, data };
}

async function githubPutFile(path, data, sha, mensaje) {
  const body = {
    message: mensaje,
    content: b64Encode(JSON.stringify(data, null, 2)),
    branch: config.branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(apiUrl(path), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new Error(`Error guardando ${path}: ${res.status} ${texto}`);
  }
  const json = await res.json();
  return json.content.sha;
}

/* Guarda con reintento si el sha ha cambiado entre-tanto (409) */
async function guardarConReintento(path, mutarFn, mensaje, cache) {
  for (let intento = 0; intento < 3; intento++) {
    const actual = cache.get();
    const nuevoData = mutarFn(JSON.parse(JSON.stringify(actual.data)));
    try {
      const nuevoSha = await githubPutFile(path, nuevoData, actual.sha, mensaje);
      cache.set({ sha: nuevoSha, data: nuevoData });
      return nuevoData;
    } catch (e) {
      if (String(e.message).includes("409") && intento < 2) {
        const fresco = await githubGetFile(path);
        cache.set(fresco);
        continue;
      }
      throw e;
    }
  }
}

const cacheVentasApi = {
  get: () => cacheVentas,
  set: (v) => (cacheVentas = v),
};
const cacheCierresApi = {
  get: () => cacheCierres,
  set: (v) => (cacheCierres = v),
};

async function asegurarCacheVentas() {
  if (!cacheVentas) cacheVentas = await githubGetFile(RUTA_VENTAS);
  return cacheVentas;
}
async function asegurarCacheCierres() {
  if (!cacheCierres) cacheCierres = await githubGetFile(RUTA_CIERRES);
  return cacheCierres;
}

/* ---------------- UI: navegación de pantallas ---------------- */

const pantallas = ["venta", "historial", "cierre", "ajustes"];

function mostrarPantalla(nombre) {
  pantallas.forEach((p) => {
    document.getElementById(`pantalla-${p}`).classList.toggle("activa", p === nombre);
  });
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("activa", btn.dataset.pantalla === nombre);
  });
  if (nombre === "historial") refrescarHistorial();
  if (nombre === "cierre") refrescarCierre();
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => mostrarPantalla(btn.dataset.pantalla));
});
document.getElementById("btn-ajustes").addEventListener("click", () => {
  document.querySelectorAll(".pantalla").forEach((p) => p.classList.remove("activa"));
  document.getElementById("pantalla-ajustes").classList.add("activa");
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("activa"));
});

/* ---------------- Toast / loading ---------------- */

let toastTimeout;
function mostrarToast(mensaje, esError = false) {
  const el = document.getElementById("toast");
  el.textContent = mensaje;
  el.classList.toggle("error", esError);
  el.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove("visible"), 3200);
}

function setCargando(activo) {
  document.getElementById("loading-overlay").classList.toggle("visible", activo);
}

/* ---------------- Pantalla: Venta ---------------- */

function renderTicket() {
  const lista = document.getElementById("ticket-lista");
  lista.innerHTML = "";

  if (ticket.length === 0) {
    lista.innerHTML = `<li class="ticket-vacio">Toca un artículo para empezar</li>`;
  } else {
    ticket.forEach((item, idx) => {
      const li = document.createElement("li");
      li.className = "ticket-item";
      li.innerHTML = `
        <span class="ticket-item-nombre">${item.nombre}</span>
        <div class="ticket-item-controles">
          <button class="qty-btn" data-idx="${idx}" data-accion="restar">−</button>
          <span class="qty-valor">${item.cantidad}</span>
          <button class="qty-btn" data-idx="${idx}" data-accion="sumar">+</button>
        </div>
        <span class="ticket-item-subtotal">${item.precio * item.cantidad} CHF</span>
      `;
      lista.appendChild(li);
    });
  }

  const total = ticket.reduce((s, i) => s + i.precio * i.cantidad, 0);
  document.getElementById("ticket-total-valor").textContent = `${total} CHF`;
  document.getElementById("btn-pago-cash").disabled = total === 0;
  document.getElementById("btn-pago-twint").disabled = total === 0;
}

document.querySelectorAll(".producto-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const nombre = btn.dataset.nombre;
    const precio = Number(btn.dataset.precio);
    const existente = ticket.find((i) => i.nombre === nombre);
    if (existente) {
      existente.cantidad += 1;
    } else {
      ticket.push({ nombre, precio, cantidad: 1 });
    }
    renderTicket();
  });
});

document.getElementById("ticket-lista").addEventListener("click", (e) => {
  const btn = e.target.closest(".qty-btn");
  if (!btn) return;
  const idx = Number(btn.dataset.idx);
  const item = ticket[idx];
  if (btn.dataset.accion === "sumar") item.cantidad += 1;
  if (btn.dataset.accion === "restar") item.cantidad -= 1;
  if (item.cantidad <= 0) ticket.splice(idx, 1);
  renderTicket();
});

document.getElementById("btn-vaciar-ticket").addEventListener("click", () => {
  ticket = [];
  renderTicket();
});

async function registrarVenta(metodoPago) {
  if (!configCompleta()) {
    mostrarToast("Configura primero la conexión en Ajustes", true);
    mostrarPantalla("ajustes");
    return;
  }
  if (ticket.length === 0) return;

  const total = ticket.reduce((s, i) => s + i.precio * i.cantidad, 0);
  const venta = {
    id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fecha: new Date().toISOString(),
    items: ticket.map((i) => ({ ...i })),
    total,
    metodo_pago: metodoPago,
    anulada: false,
    cierre_id: null,
  };

  setCargando(true);
  try {
    await asegurarCacheVentas();
    await guardarConReintento(
      RUTA_VENTAS,
      (data) => {
        data.push(venta);
        return data;
      },
      `Venta ${venta.id} (${metodoPago}, ${total} CHF)`,
      cacheVentasApi
    );
    ticket = [];
    renderTicket();
    mostrarToast(`Venta registrada: ${total} CHF (${metodoPago})`);
  } catch (e) {
    console.error(e);
    mostrarToast(`No se pudo guardar la venta: ${e.message}`, true);
  } finally {
    setCargando(false);
  }
}

document.getElementById("btn-pago-cash").addEventListener("click", () => registrarVenta("Cash"));
document.getElementById("btn-pago-twint").addEventListener("click", () => registrarVenta("Twint"));

/* ---------------- Pantalla: Historial ---------------- */

function formatoHora(iso) {
  const d = new Date(iso);
  return d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function resumenItems(items) {
  return items.map((i) => `${i.cantidad}× ${i.nombre}`).join(", ");
}

async function refrescarHistorial() {
  if (!configCompleta()) return;
  const lista = document.getElementById("historial-lista");
  setCargando(true);
  try {
    cacheVentas = await githubGetFile(RUTA_VENTAS);
    const ventas = [...cacheVentas.data].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    lista.innerHTML = "";
    if (ventas.length === 0) {
      lista.innerHTML = `<li class="vacio-nota">Todavía no hay ventas registradas</li>`;
      return;
    }

    ventas.forEach((v) => {
      const li = document.createElement("li");
      li.className = "historial-item" + (v.anulada ? " anulada" : "");
      const badgeMetodo = v.metodo_pago === "Cash" ? "badge-cash" : "badge-twint";
      li.innerHTML = `
        <div class="historial-item-top">
          <span>${formatoHora(v.fecha)}</span>
          <span class="badge ${badgeMetodo}">${v.metodo_pago}</span>
        </div>
        <div class="historial-item-items">${resumenItems(v.items)}</div>
        <div class="historial-item-bottom">
          <span class="historial-item-total">${v.total} CHF</span>
          ${
            v.anulada
              ? `<span class="badge badge-anulada">Anulada</span>`
              : v.cierre_id
              ? `<span class="badge badge-cerrada">Cerrada</span>`
              : `<button class="btn-anular" data-id="${v.id}">Anular</button>`
          }
        </div>
      `;
      lista.appendChild(li);
    });
  } catch (e) {
    console.error(e);
    mostrarToast("No se pudo cargar el historial.", true);
  } finally {
    setCargando(false);
  }
}

document.getElementById("historial-lista").addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-anular");
  if (!btn) return;
  const id = btn.dataset.id;
  if (!confirm("¿Anular esta venta? Quedará marcada como anulada en el historial.")) return;

  setCargando(true);
  try {
    await asegurarCacheVentas();
    await guardarConReintento(
      RUTA_VENTAS,
      (data) => {
        const v = data.find((x) => x.id === id);
        if (v) v.anulada = true;
        return data;
      },
      `Anular venta ${id}`,
      cacheVentasApi
    );
    mostrarToast("Venta anulada");
    refrescarHistorial();
  } catch (err) {
    console.error(err);
    mostrarToast("No se pudo anular la venta.", true);
  } finally {
    setCargando(false);
  }
});

document.getElementById("btn-refrescar-historial").addEventListener("click", refrescarHistorial);

/* ---------------- Pantalla: Cierre de caja ---------------- */

function ventasPendientes(ventas) {
  return ventas.filter((v) => !v.anulada && !v.cierre_id);
}

async function refrescarCierre() {
  if (!configCompleta()) return;
  setCargando(true);
  try {
    cacheVentas = await githubGetFile(RUTA_VENTAS);
    cacheCierres = await githubGetFile(RUTA_CIERRES);

    const pendientes = ventasPendientes(cacheVentas.data);
    const totalCash = pendientes.filter((v) => v.metodo_pago === "Cash").reduce((s, v) => s + v.total, 0);
    const totalTwint = pendientes.filter((v) => v.metodo_pago === "Twint").reduce((s, v) => s + v.total, 0);

    document.getElementById("cierre-num-ventas").textContent = pendientes.length;
    document.getElementById("cierre-total-cash").textContent = `${totalCash} CHF`;
    document.getElementById("cierre-total-twint").textContent = `${totalTwint} CHF`;
    document.getElementById("cierre-total").textContent = `${totalCash + totalTwint} CHF`;
    document.getElementById("btn-cerrar-caja").disabled = pendientes.length === 0;

    const lista = document.getElementById("cierres-lista");
    const cierresOrdenados = [...cacheCierres.data].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    lista.innerHTML = "";
    if (cierresOrdenados.length === 0) {
      lista.innerHTML = `<li class="vacio-nota">Todavía no hay cierres</li>`;
    } else {
      cierresOrdenados.forEach((c) => {
        const li = document.createElement("li");
        li.className = "historial-item";
        li.innerHTML = `
          <div class="historial-item-top">
            <span>${formatoHora(c.fecha)}</span>
            <span>${c.num_ventas} ventas</span>
          </div>
          <div class="historial-item-items">💶 ${c.total_cash} CHF · 📱 ${c.total_twint} CHF</div>
          <div class="historial-item-bottom">
            <span class="historial-item-total">${c.total} CHF</span>
          </div>
        `;
        lista.appendChild(li);
      });
    }
  } catch (e) {
    console.error(e);
    mostrarToast("No se pudo cargar el cierre.", true);
  } finally {
    setCargando(false);
  }
}

document.getElementById("btn-refrescar-cierre").addEventListener("click", refrescarCierre);

document.getElementById("btn-cerrar-caja").addEventListener("click", async () => {
  await asegurarCacheVentas();
  const pendientes = ventasPendientes(cacheVentas.data);
  if (pendientes.length === 0) return;

  const totalCash = pendientes.filter((v) => v.metodo_pago === "Cash").reduce((s, v) => s + v.total, 0);
  const totalTwint = pendientes.filter((v) => v.metodo_pago === "Twint").reduce((s, v) => s + v.total, 0);
  const total = totalCash + totalTwint;

  if (!confirm(`¿Cerrar caja con ${pendientes.length} ventas (${total} CHF)? Esto pondrá el contador a cero.`)) return;

  setCargando(true);
  try {
    const cierre = {
      id: `c_${Date.now()}`,
      fecha: new Date().toISOString(),
      total_cash: totalCash,
      total_twint: totalTwint,
      total,
      num_ventas: pendientes.length,
      venta_ids: pendientes.map((v) => v.id),
    };

    await asegurarCacheCierres();
    await guardarConReintento(
      RUTA_CIERRES,
      (data) => {
        data.push(cierre);
        return data;
      },
      `Cierre de caja ${cierre.id} (${total} CHF)`,
      cacheCierresApi
    );

    await guardarConReintento(
      RUTA_VENTAS,
      (data) => {
        data.forEach((v) => {
          if (cierre.venta_ids.includes(v.id)) v.cierre_id = cierre.id;
        });
        return data;
      },
      `Marcar ventas del cierre ${cierre.id}`,
      cacheVentasApi
    );

    mostrarToast("Caja cerrada y puesta a cero");
    refrescarCierre();
  } catch (e) {
    console.error(e);
    mostrarToast(`No se pudo cerrar la caja: ${e.message}`, true);
  } finally {
    setCargando(false);
  }
});

/* ---------------- Pantalla: Ajustes ---------------- */

function rellenarFormularioAjustes() {
  document.getElementById("input-owner").value = config.owner || "";
  document.getElementById("input-repo").value = config.repo || "";
  document.getElementById("input-branch").value = config.branch || "main";
  document.getElementById("input-token").value = config.token || "";
}

function limpiarOwnerRepo(ownerRaw, repoRaw) {
  let owner = ownerRaw.trim();
  let repo = repoRaw.trim();
  const match = owner.match(/github\.com\/([^\/\s]+)\/([^\/\s]+)/i) || repo.match(/github\.com\/([^\/\s]+)\/([^\/\s]+)/i);
  if (match) {
    owner = match[1];
    repo = match[2];
  }
  owner = owner.replace(/^@/, "");
  repo = repo.replace(/\.git$/i, "").replace(/^\//, "");
  return { owner, repo };
}

document.getElementById("btn-guardar-ajustes").addEventListener("click", () => {
  const { owner, repo } = limpiarOwnerRepo(
    document.getElementById("input-owner").value,
    document.getElementById("input-repo").value
  );
  const nuevo = {
    owner,
    repo,
    branch: document.getElementById("input-branch").value.trim() || "main",
    token: document.getElementById("input-token").value.trim(),
  };
  guardarConfig(nuevo);
  cacheVentas = null;
  cacheCierres = null;
  document.getElementById("ajustes-estado").textContent = "Guardado.";
  document.getElementById("ajustes-estado").className = "ajustes-estado ok";
  mostrarToast("Ajustes guardados");
});

document.getElementById("btn-probar-conexion").addEventListener("click", async () => {
  const estado = document.getElementById("ajustes-estado");
  estado.textContent = "Probando...";
  estado.className = "ajustes-estado";
  setCargando(true);
  try {
    await validarConexion();
    estado.textContent = "Conexión correcta ✔";
    estado.className = "ajustes-estado ok";
  } catch (e) {
    console.error(e);
    estado.textContent = e.message || "No se pudo conectar. Revisa usuario, repo, rama y token.";
    estado.className = "ajustes-estado error";
  } finally {
    setCargando(false);
  }
});

/* ---------------- Inicio ---------------- */

rellenarFormularioAjustes();
renderTicket();

if (!configCompleta()) {
  mostrarPantalla("ajustes");
} else {
  mostrarPantalla("venta");
}
