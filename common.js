/* My Video Browser - shared code (phase 1 test build) */
(function () {
  var API = "https://xgxswoaxalhdfjjxelyt.supabase.co/functions/v1/mvb-api";
  var TK = "mvb_token";
  var MVB = (window.MVB = {});
  MVB.API = API;
  MVB.token = function () { try { return localStorage.getItem(TK) || ""; } catch (e) { return ""; } };
  MVB.setToken = function (t) { try { t ? localStorage.setItem(TK, t) : localStorage.removeItem(TK); } catch (e) {} };

  MVB.call = function (path, opts) {
    opts = opts || {};
    var headers = { "content-type": "application/json" };
    var t = MVB.token();
    if (t) headers.authorization = "Bearer " + t;
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, opts.timeout || 20000);
    return fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctl.signal })
      .then(function (r) {
        clearTimeout(timer);
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.message || ("Server answered " + r.status)); e.kind = j.error || "server"; e.reason = j.reason || ""; e.status = r.status; throw e; }
          return j;
        });
      }, function (err) {
        clearTimeout(timer);
        var e = new Error("Could not reach the search server. Check the internet connection, or the filter may be blocking " + new URL(API).host + ".");
        e.kind = "network"; throw e;
      });
  };

  MVB.esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  MVB.dur = function (s) {
    if (!s) return "";
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
  };
  MVB.views = function (n) {
    if (n == null) return "";
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B views";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M views";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K views";
    return n + " views";
  };
  MVB.ago = function (iso) {
    var d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!(d > 0)) return "";
    var u = [[31536000, "year"], [2592000, "month"], [604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]];
    for (var i = 0; i < u.length; i++) if (d >= u[i][0]) { var n = Math.floor(d / u[i][0]); return n + " " + u[i][1] + (n > 1 ? "s" : "") + " ago"; }
    return "just now";
  };

  /* Official YouTube embed (youtube.com/embed) with the IFrame API's own postMessage protocol,
     so we can tell "player loaded", "playing", "owner blocked embedding" and "never loaded". */
  var ERR = {
    2: { kind: "bad", text: "This video link is not valid." },
    5: { kind: "player", text: "The player hit an error playing this video on this device." },
    100: { kind: "gone", text: "This video was removed or made private." },
    101: { kind: "embed", text: "The owner of this video does not allow it to play on other websites. This is not the filter; pick another video." },
    150: { kind: "embed", text: "The owner of this video does not allow it to play on other websites. This is not the filter; pick another video." },
    152: { kind: "embed", text: "This video can't play embedded (owner or region restriction). This is not the filter." },
    153: { kind: "embed", text: "The player refused this site (missing referrer). Try reloading the page." }
  };
  MVB.embedErrors = ERR;
  var uid = 0;
  MVB.embed = function (box, videoId, cb, opts) {
    opts = opts || {};
    cb = cb || function () {};
    box.innerHTML = "";
    var id = "mvbp" + (++uid);
    var origin = location.origin;
    var src = "https://www.youtube.com/embed/" + encodeURIComponent(videoId) +
      "?enablejsapi=1&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3" +
      (opts.autoplay ? "&autoplay=1" : "") +
      "&origin=" + encodeURIComponent(origin) + "&widget_referrer=" + encodeURIComponent(location.href);
    var f = document.createElement("iframe");
    f.id = id;
    f.src = src;
    f.title = "Video player";
    f.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen");
    f.setAttribute("allowfullscreen", "");
    f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    var st = { loaded: false, ready: false, state: null, time: 0, error: null, done: false, iframeOnload: false, startedAt: Date.now() };
    var listenTimer = null, giveUp = null;
    function send(o) { try { f.contentWindow && f.contentWindow.postMessage(JSON.stringify(o), "https://www.youtube.com"); } catch (e) {} }
    function hello() {
      send({ event: "listening", id: id, channel: "widget" });
      ["onReady", "onStateChange", "onError"].forEach(function (ev) { send({ event: "command", func: "addEventListener", args: [ev], id: id, channel: "widget" }); });
    }
    function onMsg(e) {
      if (e.source !== f.contentWindow) return;
      if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin)) return;
      var d; try { d = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch (x) { return; }
      if (!d || !d.event) return;
      if (!st.loaded) { st.loaded = true; clearTimeout(giveUp); cb("loaded", st); }
      if (d.event === "onReady" || d.event === "initialDelivery") { if (!st.ready) { st.ready = true; cb("ready", st); } }
      var info = d.info || {};
      if (d.event === "onStateChange") info = { playerState: d.info };
      if (d.event === "onError") {
        st.error = d.info; cb("error", st, ERR[d.info] || { kind: "player", text: "The player reported error " + d.info + "." });
        return;
      }
      if (typeof info.playerState === "number" && info.playerState !== st.state) { st.state = info.playerState; cb("state", st); }
      if (typeof info.currentTime === "number") { var before = st.time; st.time = info.currentTime; if (st.time > before + 0.2 && st.state === 1) cb("progress", st); }
      if (st.ready && listenTimer) { clearInterval(listenTimer); listenTimer = setInterval(hello, 3000); }
    }
    window.addEventListener("message", onMsg);
    f.addEventListener("load", function () { st.iframeOnload = true; hello(); });
    listenTimer = setInterval(hello, 400);
    giveUp = setTimeout(function () { if (!st.loaded) cb("timeout", st); }, opts.timeoutMs || 15000);
    box.appendChild(f);
    return {
      iframe: f, state: st,
      destroy: function () { clearInterval(listenTimer); clearTimeout(giveUp); window.removeEventListener("message", onMsg); box.innerHTML = ""; },
      play: function () { send({ event: "command", func: "playVideo", args: [], id: id, channel: "widget" }); },
      mute: function () { send({ event: "command", func: "mute", args: [], id: id, channel: "widget" }); }
    };
  };
})();
