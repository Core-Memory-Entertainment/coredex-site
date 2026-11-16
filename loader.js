/* Coredex's front door. It signs a person in with Google and, once they turn out to be someone an owner
   added, loads the app from the database and starts it. Nothing else lives here. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var LOGO = '<svg viewBox="-9 -8 128 138" aria-hidden="true"><g transform="rotate(-11 58 64)"><rect x="9" y="9" width="100" height="113" rx="1.6" fill="#000"/></g>' +
    '<g transform="rotate(-8.5 50 56.5)"><rect width="100" height="113" rx="1.6" fill="#fff"/><rect x="5.5" y="5.5" width="89" height="84" fill="#131313"/></g></svg>';

  function gate(html) {
    var app = $('app'); if (app) app.hidden = true;
    var g = $('gate');
    g.hidden = false;
    g.innerHTML = '<div class="gate-box"><div class="gate-logo">' + LOGO + '</div>' + html + '</div><div class="gate-edge" aria-hidden="true"></div>';
    return g;
  }
  function button(g, onClick) { g.querySelector('#gate-go').addEventListener('click', onClick); }
  function reload() { location.reload(); }

  var pages = {
    framed: function () {
      gate('<h1>Coredex opens in its own tab.</h1><p>It does not open inside another page.</p>' +
        '<a class="btn primary" href="' + esc(location.href) + '" target="_blank" rel="noopener noreferrer">Open Coredex</a>');
    },
    notSetUp: function () {
      gate('<h1>Coredex is not set up yet.</h1><p>It names no project to connect to. The setup guide says what goes there.</p>');
    },
    libraryMissing: function () {
      gate('<h1>Coredex could not start.</h1><p>Its sign-in library did not load. Reload the page; if it keeps happening, the site needs republishing.</p>');
    },
    signIn: function (start) {
      var g = gate('<h1>Coredex.</h1><p>The team\'s shared work, live.</p>' +
        '<button class="btn primary" id="gate-go">Sign in with Google</button>' +
        '<p class="gate-note">Only people an owner has added can open Coredex. Use the Google account of the address you were added with.</p>' +
        '<p class="gate-err" id="gate-err" role="alert" hidden></p>');
      var btn = g.querySelector('#gate-go'), err = g.querySelector('#gate-err');
      btn.addEventListener('click', function () {
        btn.disabled = true;
        Promise.resolve(start()).then(function (r) {
          if (r && r.error) { err.textContent = 'Signing in did not work: ' + r.error.message; err.hidden = false; btn.disabled = false; }
        }, function (e) { err.textContent = 'Signing in did not work: ' + ((e && e.message) || e); err.hidden = false; btn.disabled = false; });
      });
    },
    noAccess: function (email, signOut) {
      var g = gate('<h1>No access yet.</h1><p><b>' + esc(email || 'This Google account') + '</b> has no access to Coredex. ' +
        'An owner adds your address; then reload this page.</p>' +
        '<p class="gate-note">Were you added with another address? Sign out, then sign in with that Google account. If this page ' +
        'comes back with this address, the other one is a second address on this Google account: ask whoever invited you to add ' +
        'this one instead.</p>' +
        '<button class="btn" id="gate-go">Sign out</button>');
      button(g, signOut);
    },
    unreachable: function () {
      var g = gate('<h1>Coredex cannot reach its data.</h1><p>The connection failed, or Coredex is asleep after a week in ' +
        'which nobody used it. An owner wakes it, and nothing is lost. Then try again.</p><button class="btn" id="gate-go">Try again</button>');
      button(g, reload);
    },
    notPublished: function (signOut) {
      var g = gate('<h1>Coredex is not published yet.</h1><p>You are signed in, but there is no version of Coredex to open yet. ' +
        'An owner publishes it; the setup guide says how.</p><button class="btn" id="gate-go">Sign out</button>');
      button(g, signOut);
    },
    failed: function (message) {
      var g = gate('<h1>Coredex stopped.</h1><p>' + esc(message || 'Something went wrong.') + '</p><button class="btn" id="gate-go">Reload</button>');
      button(g, reload);
    }
  };
  window.CXLoader = pages;

  function isNetwork(error) {
    return !!error && !error.code && /fetch|network|load failed/i.test(String(error.message || error));
  }

  function loadConfig() {
    return fetch('config.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (cfg) {
      if (!cfg || typeof cfg.supabaseUrl !== 'string' || typeof cfg.publishableKey !== 'string') return null;
      if (!/^https:\/\//.test(cfg.supabaseUrl) || /your-project/i.test(cfg.supabaseUrl) || /^your/i.test(cfg.publishableKey)) return null;
      return cfg;
    }, function () { return null; });
  }

  /* On a computer working on Coredex itself, served from its repository, the app comes from its own
     folder; everywhere else it comes from the database, for people who have been added. */
  function appFiles(sb) {
    var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
      ? fetch('../app/manifest.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; })
      : Promise.resolve(null);
    return local.then(function (manifest) {
      /* a lazy file is published with the app but fetched only when the app asks for it */
      if (manifest && Array.isArray(manifest.files)) {
        return Promise.all(manifest.files.filter(function (f) { return f.kind !== 'lazy'; }).map(function (f) {
          return fetch('../app/' + f.path, { cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw new Error(f.path + ' did not load');
            return r.text();
          }).then(function (text) { return { path: f.path, kind: f.kind, content: text }; });
        })).then(function (files) { return { files: files, version: 'local' }; });
      }
      return sb.from('app_files').select('path,kind,position,content,version').in('kind', ['script', 'style']).order('position').then(function (res) {
        if (res.error) throw res.error;
        var files = res.data || [];
        return { files: files, version: files.length ? files[0].version : null };
      });
    });
  }

  function run(app) {
    app.files.filter(function (f) { return f.kind === 'style'; }).forEach(function (f) {
      var st = document.createElement('style');
      st.textContent = f.content;
      document.head.appendChild(st);
    });
    var code = app.files.filter(function (f) { return f.kind === 'script'; }).map(function (f) { return f.content; }).join('\n;\n');
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { URL.revokeObjectURL(url); resolve(); };
      s.onerror = function () { URL.revokeObjectURL(url); reject(new Error('The app did not start.')); };
      document.head.appendChild(s);
    });
  }

  /* A shared page's link, #v=<code>, opens as a visitor: a sign-in without an account, kept apart from a person's own,
     asks the database what the code opens, and runs what comes back for a valid code only. Nothing here says what that
     is. */
  function linkCode() {
    var m = /^#v=([A-Za-z0-9-]{12,20})$/.exec(location.hash || '');
    return m ? m[1] : null;
  }
  var linkPages = {
    off: function () { gate('<h1>This link has been turned off.</h1><p>Ask whoever sent it for a new one.</p>'); },
    none: function () { gate('<h1>This link opens nothing.</h1><p>Check that it was copied whole, or ask whoever sent it for a new one.</p>'); },
    tries: function () { gate('<h1>Too many tries.</h1><p>This browser tried too many links that open nothing. Try again in an hour.</p>'); },
    busy: function () { gate('<h1>Too many visitors right now.</h1><p>Too many people opened links from this connection in the last hour. Try again later.</p>'); }
  };
  window.CXLinkPages = linkPages;
  function filesFor(data) {
    var files = (data && Array.isArray(data.files) ? data.files : []).map(function (f) {
      return { path: f.path, kind: /\.css$/.test(f.path) ? 'style' : 'script', content: f.content };
    });
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return Promise.resolve(files);
    /* on a computer working on Coredex itself, the same files come from its own folder, as the app's do */
    return Promise.all(files.map(function (f) {
      return fetch('../app/' + f.path, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error(f.path + ' did not load');
        return r.text();
      }).then(function (text) { return { path: f.path, kind: f.kind, content: text }; });
    })).catch(function () { return files; });
  }
  async function visit(cfg, code) {
    var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey, {
      auth: { storageKey: 'coredex-visit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    async function guest(fresh) {
      if (!fresh) {
        var s = await sb.auth.getSession();
        if (!s.error && s.data && s.data.session) return;
      }
      try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* gone already */ }
      var a = await sb.auth.signInAnonymously();
      if (a.error) throw a.error;
    }
    /* a sign-in cleared out since, or run out, gets a new one, once */
    async function open(fresh) {
      await guest(fresh);
      var r = await sb.rpc('shared_open', { p_code: code });
      if (r.error && !fresh && !isNetwork(r.error)) return open(true);
      if (r.error) throw r.error;
      return r.data;
    }
    var data;
    try {
      data = await open(false);
    } catch (e) {
      if (e && (e.status === 429 || /rate limit/i.test(String(e.message || '')))) return linkPages.busy();
      return isNetwork(e) ? pages.unreachable() : pages.failed(e.message || String(e));
    }
    if (!data || data.refused) {
      var why = data && data.refused;
      return why === 'off' ? linkPages.off() : why === 'too-many-tries' ? linkPages.tries() : linkPages.none();
    }
    var files = await filesFor(data);
    if (!files.length) return pages.failed('This page cannot open yet.');
    await run({ files: files });
    if (!window.CXVisit || typeof window.CXVisit.start !== 'function') return pages.failed('The page did not start.');
    return window.CXVisit.start({ sb: sb, code: code, data: data, pages: linkPages, gate: gate });
  }

  /* Inside another site's frame, a page could lay itself over Coredex's buttons, so Coredex starts only in its own
     tab. A frame from Coredex's own address is its own. */
  function framed() {
    if (window.top === window.self) return false;
    try { return window.top.location.origin !== location.origin; } catch (e) { return true; }
  }

  async function start() {
    if (framed()) return pages.framed();
    var cfg = await loadConfig();
    if (!cfg) return pages.notSetUp();
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return pages.libraryMissing();
    var shared = linkCode();
    if (shared) return visit(cfg, shared);
    /* A program that shows Coredex and keeps its sign-in offers it here: the client keeps the sign-in with the program,
       and signing in goes through the program, since Google often refuses to sign in inside one. */
    var host = window.coredexHost;
    if (!host || !host.storage || typeof host.signIn !== 'function') host = null;
    var auth = { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: !host };
    if (host) auth.storage = host.storage;
    var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey, { auth: auth });

    var session = null;
    try {
      var r = await sb.auth.getSession();
      if (r.error) throw r.error;
      session = r.data.session;
    } catch (e) {
      return isNetwork(e) ? pages.unreachable() : pages.failed('Signing in did not finish: ' + (e.message || e));
    }
    if (!session) {
      return pages.signIn(function () {
        if (host) return host.signIn();
        return sb.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } }
        });
      });
    }
    /* Signing out ends this browser's sign-in (or the program's), and leaves the person's others signed in. */
    async function signOut() {
      await sb.auth.signOut({ scope: 'local' });
      history.replaceState(null, '', location.pathname);
      location.reload();
    }

    var claim, app;
    try {
      var c = await sb.rpc('claim_me');
      if (c.error) throw c.error;
      claim = c.data;
      if (!claim || !claim.person) return pages.noAccess(claim && claim.email, signOut);
      app = await appFiles(sb);
    } catch (e) {
      return isNetwork(e) ? pages.unreachable() : pages.failed(e.message || String(e));
    }
    if (!app.files.length) return pages.notPublished(signOut);
    await run(app);
    if (!window.CX || typeof window.CX.start !== 'function') return pages.failed('The app did not start.');
    return window.CX.start({ sb: sb, session: session, claim: claim, signOut: signOut, version: app.version, pages: pages });
  }

  start().catch(function (e) {
    if (window.console) console.error(e);
    pages.failed(e && e.message ? e.message : String(e));
  });
})();
