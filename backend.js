/* Sauvegarde Supabase de Mon Budget : même interface que le stockage Claude utilisé par budget.html. */
(function () {
  "use strict";
  const C = window.BUDGET_CONFIG || {};
  const KEY = "budget.session", TABLE = "/rest/v1/budget_docs";
  const lsGet = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
  const lsSet = v => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) { /* stockage indisponible */ } };
  const offline = { code: "unavailable" };
  let session = lsGet(), refreshing = null, loginPromise = null, generation = 0;
  const listeners = {};

  function keepSession(s) {
    session = { access_token: s.access_token, refresh_token: s.refresh_token, user_id: (s.user && s.user.id) || (session && session.user_id), expires_at: Date.now() + (s.expires_in || 3600) * 1000 };
    lsSet(session);
  }
  async function authCall(grant, body) {
    let res;
    try {
      res = await fetch(C.url + "/auth/v1/token?grant_type=" + grant, { method: "POST", headers: { apikey: C.key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) { throw offline; }
    if (res.status >= 500 || res.status === 429) throw offline;
    if (!res.ok) throw { code: "denied" };
    keepSession(await res.json());
  }
  function refresh() {
    if (!refreshing) {
      refreshing = authCall("refresh_token", { refresh_token: session.refresh_token })
        .catch(e => { if (e.code === "denied") { lsSet(null); session = null; showLogin(); throw offline; } throw e; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }
  async function api(path, opts, retried) {
    if (!session) throw offline;
    if (session.expires_at < Date.now() + 30000) await refresh();
    let res;
    try {
      res = await fetch(C.url + path, Object.assign({}, opts, { headers: Object.assign({ apikey: C.key, Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" }, opts && opts.headers) }));
    } catch (e) { throw offline; }
    if (res.status === 401 && !retried) { await refresh(); return api(path, opts, true); }
    if (res.status === 401 || res.status >= 500 || res.status === 429) throw offline;
    if (!res.ok) throw { code: "invalid_argument", message: "Erreur " + res.status };
    return res;
  }

  /* Lecture de tous les documents, puis envoi aux deux listes (dépenses et mois). */
  let pulling = false, pullAgain = false;
  async function pull() {
    if (!session) return;
    if (pulling) { pullAgain = true; return; }
    pulling = true;
    const started = generation;
    try {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const res = await api(TABLE + "?select=col,id,data&order=col,id&limit=1000&offset=" + from, { method: "GET" });
        const page = await res.json();
        rows.push(...page);
        if (page.length < 1000) break;
      }
      if (started !== generation) pullAgain = true;
      else Object.keys(listeners).forEach(col => {
        const docs = rows.filter(r => r.col === col).map(r => ({ id: r.id, exists: true, data: () => r.data }));
        listeners[col].forEach(l => l.next({ docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false } }));
      });
    } catch (e) {
      Object.keys(listeners).forEach(col => listeners[col].forEach(l => { if (l.error) l.error(e); }));
    }
    pulling = false;
    if (pullAgain) { pullAgain = false; pull(); }
  }
  let pullTimer = 0;
  const pullSoon = () => { clearTimeout(pullTimer); pullTimer = setTimeout(pull, 400); };
  addEventListener("online", pullSoon);
  addEventListener("focus", pullSoon);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pullSoon(); });
  setInterval(() => { if (document.visibilityState === "visible") pull(); }, 60000);

  const db = {
    collection(col) {
      return {
        doc(id) {
          return {
            async set(data) {
              await api(TABLE + "?on_conflict=user_id,col,id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ user_id: session && session.user_id, col, id, data, updated_at: new Date().toISOString() }) });
              generation++; pullSoon();
            },
            async delete() {
              await api(TABLE + "?col=eq." + encodeURIComponent(col) + "&id=eq." + encodeURIComponent(id), { method: "DELETE", headers: { Prefer: "return=minimal" } });
              generation++; pullSoon();
            }
          };
        },
        onSnapshot(next, error) {
          const l = { next, error };
          (listeners[col] = listeners[col] || []).push(l);
          pullSoon();
          return () => { listeners[col] = listeners[col].filter(x => x !== l); };
        }
      };
    }
  };

  /* Écran de connexion : le mot de passe n'est jamais gardé, seulement le jeton de session. */
  function showLogin() {
    if (loginPromise) return loginPromise;
    loginPromise = new Promise(resolve => {
      const box = document.createElement("div");
      box.className = "login";
      box.innerHTML = `<form class="loginform" novalidate>
        <h1>Mon Budget</h1>
        <label class="f">E-mail<input class="inp" id="l-email" type="email" autocomplete="username" autocapitalize="none" required></label>
        <label class="f">Mot de passe<input class="inp" id="l-pass" type="password" autocomplete="current-password" required></label>
        <div class="err" id="l-err" hidden></div>
        <button class="btn" type="submit">Me connecter</button>
      </form>`;
      document.body.appendChild(box);
      box.querySelector("form").addEventListener("submit", async ev => {
        ev.preventDefault();
        const err = box.querySelector("#l-err"), btn = box.querySelector("button");
        err.hidden = true; btn.disabled = true;
        try {
          await authCall("password", { email: box.querySelector("#l-email").value.trim(), password: box.querySelector("#l-pass").value });
          box.remove(); loginPromise = null; pullSoon(); resolve();
        } catch (e) {
          err.textContent = e.code === "denied" ? "E-mail ou mot de passe incorrect." : "Pas de réseau : il en faut pour te connecter la première fois.";
          err.hidden = false; btn.disabled = false;
        }
      });
    });
    return loginPromise;
  }

  window.BudgetBackend = {
    async ready() { if (!session) await showLogin(); return db; },
    logout() { lsSet(null); session = null; location.reload(); }
  };

  if ("serviceWorker" in navigator) addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => { /* l'appli marche quand même en ligne */ }); });
})();
