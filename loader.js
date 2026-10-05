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
  var LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#2B593F"/><rect x="7" y="8" width="18" height="16" rx="3" fill="none" stroke="#DBEDDB" stroke-width="2"/><path d="M7 13h18" stroke="#DBEDDB" stroke-width="2"/><circle cx="16" cy="18.5" r="3" fill="#DBEDDB"/></svg>';

  function gate(html) {
    var app = $('app'); if (app) app.hidden = true;
    var g = $('gate');
    g.hidden = false;
    g.innerHTML = '<div class="gate-box"><div class="gate-logo">' + LOGO + '</div>' + html + '</div>';
    return g;
  }
  function button(g, onClick) { g.querySelector('#gate-go').addEventListener('click', onClick); }
  function reload() { location.reload(); }

  var pages = {
    notSetUp: function () {
      gate('<h1>Coredex is not set up yet</h1><p>It names no project to connect to. The setup guide says what goes there.</p>');
    },
    libraryMissing: function () {
      gate('<h1>Coredex could not start</h1><p>Its sign-in library did not load. Reload the page; if it keeps happening, the site needs republishing.</p>');
    },
    signIn: function (start) {
      var g = gate('<h1>Coredex</h1><p>The team\'s shared work, live.</p>' +
        '<button class="btn primary" id="gate-go">Sign in with Google</button>' +
        '<p class="gate-note">Only people an owner has added can open Coredex. Use the Google account of the address you were added with.</p>' +
        '<p class="gate-err" id="gate-err" role="alert" hidden></p>');
      var btn = g.querySelector('#gate-go'), err = g.querySelector('#gate-err');
      btn.addEventListener('click', function () {
        btn.disabled = true;
        Promise.resolve(start()).then(function (r) {
          if (r && r.error) { err.textContent = 'Google sign-in did not start: ' + r.error.message; err.hidden = false; btn.disabled = false; }
        }, function (e) { err.textContent = 'Google sign-in did not start: ' + ((e && e.message) || e); err.hidden = false; btn.disabled = false; });
      });
    },
    noAccess: function (email, signOut) {
      var g = gate('<h1>No access yet</h1><p><b>' + esc(email || 'This Google account') + '</b> has no access to Coredex. ' +
        'An owner adds your address; then reload this page.</p>' +
        '<p class="gate-note">Were you added with another address? Sign out, then sign in with that Google account.</p>' +
        '<button class="btn" id="gate-go">Sign out</button>');
      button(g, signOut);
    },
    unreachable: function () {
      var g = gate('<h1>Coredex cannot reach its data</h1><p>The connection failed, or Coredex is asleep after a week in ' +
        'which nobody used it. An owner wakes it, and nothing is lost. Then try again.</p><button class="btn" id="gate-go">Try again</button>');
      button(g, reload);
    },
    notPublished: function (signOut) {
      var g = gate('<h1>Coredex is not published yet</h1><p>You are signed in, but there is no version of Coredex to open yet. ' +
        'An owner publishes it; the setup guide says how.</p><button class="btn" id="gate-go">Sign out</button>');
      button(g, signOut);
    },
    failed: function (message) {
      var g = gate('<h1>Coredex stopped</h1><p>' + esc(message || 'Something went wrong.') + '</p><button class="btn" id="gate-go">Reload</button>');
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
      if (manifest && Array.isArray(manifest.files)) {
        return Promise.all(manifest.files.map(function (f) {
          return fetch('../app/' + f.path, { cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw new Error(f.path + ' did not load');
            return r.text();
          }).then(function (text) { return { path: f.path, kind: f.kind, content: text }; });
        })).then(function (files) { return { files: files, version: 'local' }; });
      }
      return sb.from('app_files').select('path,kind,position,content,version').order('position').then(function (res) {
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

  async function start() {
    var cfg = await loadConfig();
    if (!cfg) return pages.notSetUp();
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return pages.libraryMissing();
    var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

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
        return sb.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } }
        });
      });
    }
    async function signOut() {
      await sb.auth.signOut();
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
