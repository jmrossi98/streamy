/**
 * The browser half of auto-apply: a userscript (Tampermonkey/Violentmonkey)
 * that runs on Greenhouse and Ashby application pages, fetches the packet
 * Streamy prepared for that job, and fills the form -- text, selects, yes/no,
 * the resume file. What it cannot answer it outlines in amber and lists.
 *
 * It never submits. Both providers put a CAPTCHA on submit, and the final
 * click -- after a look at what was filled -- is the applicant's.
 *
 * Plain ES2017 in a string, served with the token baked in, so installing it
 * is one click from the admin page and there is nothing to configure.
 */

const SCRIPT_BODY = String.raw`
(function () {
  "use strict";
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var norm = function (s) { return String(s || "").replace(/\s+/g, " ").trim().toLowerCase(); };
  var done = {};

  function api(method, path, cb) {
    GM_xmlhttpRequest({
      method: method,
      url: CONFIG.base + path,
      headers: { "X-Apply-Token": CONFIG.token },
      onload: function (res) {
        var body = null;
        try { body = JSON.parse(res.responseText); } catch (e) {}
        cb(res.status, body);
      },
      onerror: function () { cb(0, null); }
    });
  }

  // ------------------------------------------------------------------ panel
  var panel;
  function show(html, tone) {
    if (!panel) {
      panel = document.createElement("div");
      panel.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;max-height:60vh;overflow:auto;" +
        "font:13px/1.45 system-ui,sans-serif;color:#fff;background:#141414;border:1px solid #444;border-radius:8px;padding:12px 14px;box-shadow:0 8px 24px rgba(0,0,0,.5)";
      document.body.appendChild(panel);
    }
    panel.style.borderColor = tone === "warn" ? "#d97706" : tone === "ok" ? "#16a34a" : "#444";
    panel.innerHTML = '<div style="font-weight:600;margin-bottom:6px;color:#e50914">Streamy apply</div>' + html +
      '<div style="margin-top:8px;text-align:right"><a href="#" id="streamy-apply-close" style="color:#aaa">hide</a></div>';
    panel.querySelector("#streamy-apply-close").onclick = function (e) { e.preventDefault(); panel.remove(); panel = null; };
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ------------------------------------------------------------- DOM finds
  function byKey(key) {
    try { return document.getElementById(key) || document.querySelector('[name="' + CSS.escape(key) + '"]'); } catch (e) { return null; }
  }
  function labelFor(answer) {
    var want = norm(answer.label);
    if (!want) return null;
    var labels = document.querySelectorAll("label, legend");
    for (var i = 0; i < labels.length; i++) {
      var t = norm(labels[i].textContent).replace(/\*$/, "").trim();
      if (t === want || t.indexOf(want) === 0) return labels[i];
    }
    return null;
  }
  function container(answer) {
    var el = byKey(answer.key);
    var lab = labelFor(answer);
    var start = el || lab;
    if (!start) return null;
    return start.closest('[class*="fieldEntry"], .field-wrapper, .select, fieldset, .application-question, [class*="question"]') || start.parentElement;
  }
  function control(answer) {
    var el = byKey(answer.key);
    if (el) return el;
    var lab = labelFor(answer);
    if (lab && lab.htmlFor) { var f = document.getElementById(lab.htmlFor); if (f) return f; }
    var box = container(answer);
    return box ? box.querySelector("input:not([type=hidden]), textarea, select") : null;
  }

  // ---------------------------------------------------------------- setters
  function setValue(el, value) {
    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function listboxOf(input) {
    var id = input.getAttribute("aria-controls") || input.getAttribute("aria-owns");
    var lb = id && document.getElementById(id);
    return lb || null;
  }

  async function openCombo(input) {
    input.focus();
    var ctl = input.closest('[class*="control"]') || input.parentElement;
    ctl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await sleep(250);
    if (!listboxOf(input)) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
      await sleep(250);
    }
    return listboxOf(input);
  }

  function optionMatch(options, wanted) {
    var w = norm(wanted);
    for (var i = 0; i < options.length; i++) if (norm(options[i].textContent) === w) return options[i];
    for (var j = 0; j < options.length; j++) if (norm(options[j].textContent).indexOf(w) === 0) return options[j];
    return null;
  }

  async function pickCombo(input, labels, typeFirst) {
    var picked = 0;
    for (var i = 0; i < labels.length; i++) {
      if (typeFirst) setValue(input, labels[i].slice(0, 40));
      var lb = await openCombo(input);
      if (typeFirst) await sleep(1200); // location lookups are remote
      var scope = lb || input.closest('[class*="fieldEntry"], .select') || document;
      var options = scope.querySelectorAll('[role="option"]');
      var hit = typeFirst && options.length ? options[0] : optionMatch(options, labels[i]);
      if (!hit) continue;
      hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      hit.click();
      picked++;
      await sleep(200);
    }
    return picked === labels.length;
  }

  function clickChoice(box, wanted) {
    if (!box) return false;
    var w = norm(wanted);
    var buttons = box.querySelectorAll("button, [role=radio], [role=checkbox], label");
    for (var i = 0; i < buttons.length; i++) {
      if (norm(buttons[i].textContent) === w) {
        var input = buttons[i].tagName === "LABEL" && buttons[i].htmlFor ? document.getElementById(buttons[i].htmlFor) : null;
        (input || buttons[i]).click();
        return true;
      }
    }
    return false;
  }

  function attach(input, file) {
    if (!input || input.type !== "file") return false;
    var dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function pdfFile(resume) {
    var bin = atob(resume.base64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], resume.fileName, { type: "application/pdf" });
  }

  function mark(answer) {
    var box = container(answer) || control(answer);
    if (box) { box.style.outline = "2px solid #d97706"; box.style.outlineOffset = "4px"; box.style.borderRadius = "4px"; }
  }

  // ------------------------------------------------------------------- fill
  async function fillOne(a, packet) {
    var labels = a.display ? String(a.display).split(", ") : [];
    if (a.kind === "file") {
      var input = control(a);
      if (a.fileRole === "resume" && packet.resume) return attach(input, pdfFile(packet.resume));
      if (typeof a.value === "string" && a.value) return attach(input, new File([a.value], "Cover Letter.txt", { type: "text/plain" }));
      return false;
    }
    if (a.kind === "boolean") return clickChoice(container(a), a.value ? "Yes" : "No");
    if (a.kind === "select" || a.kind === "multiselect") {
      var el = control(a);
      if (el && el.tagName === "SELECT") {
        var opt = Array.prototype.find.call(el.options, function (o) { return norm(o.textContent) === norm(labels[0]); });
        if (!opt) return false;
        setValue(el, opt.value);
        return true;
      }
      if (el && (el.getAttribute("role") === "combobox" || el.closest('[class*="select"]'))) return pickCombo(el, labels, false);
      var box = container(a);
      return labels.length > 0 && labels.every(function (l) { return clickChoice(box, l); });
    }
    if (a.kind === "location") {
      var loc = control(a) || (container(a) && container(a).querySelector("input[type=text]"));
      if (!loc) return false;
      if (loc.getAttribute("role") === "combobox" || !loc.id) return pickCombo(loc, [String(a.value)], true);
      setValue(loc, String(a.value));
      return true;
    }
    var field = control(a);
    if (!field) return false;
    if (field.getAttribute("role") === "combobox") return pickCombo(field, [String(a.value)], true);
    setValue(field, String(a.value));
    return true;
  }

  async function fill(packet) {
    var filled = 0;
    var needYou = [];
    var failed = [];
    for (var i = 0; i < packet.answers.length; i++) {
      var a = packet.answers[i];
      var answered = a.value !== null && a.value !== "" && a.source !== "you";
      if (!answered) {
        if (a.required || a.source === "you") { needYou.push(a); mark(a); }
        continue;
      }
      var ok = false;
      try { ok = await fillOne(a, packet); } catch (e) { ok = false; }
      if (ok) filled++;
      else { failed.push(a); mark(a); }
      await sleep(60);
    }
    var list = function (items) {
      return "<ul style=\"margin:4px 0 0 16px;padding:0\">" + items.map(function (a) { return "<li>" + esc(a.label || a.key) + "</li>"; }).join("") + "</ul>";
    };
    var html = "<div>" + esc(packet.title) + " at " + esc(packet.company) + "</div>" +
      "<div style=\"margin-top:6px\">Filled <b>" + filled + "</b> field" + (filled === 1 ? "" : "s") + ".</div>";
    if (needYou.length) html += "<div style=\"margin-top:6px;color:#fbbf24\">Yours to answer (outlined):</div>" + list(needYou);
    if (failed.length) html += "<div style=\"margin-top:6px;color:#f87171\">Couldn't fill these automatically (outlined):</div>" + list(failed);
    html += "<div style=\"margin-top:8px;color:#aaa\">Review the form, then press the page's own Submit.</div>";
    show(html, needYou.length || failed.length ? "warn" : "ok");
    watchForSubmit(packet.id);
  }

  function watchForSubmit(id) {
    if (done[id]) return;
    var obs = new MutationObserver(function () {
      var text = document.body.innerText || "";
      if (/thank you for (applying|your application)|application (has been )?(submitted|received)|we.ve received your application/i.test(text)) {
        obs.disconnect();
        if (done[id]) return;
        done[id] = true;
        api("POST", "/api/apply/packet/" + encodeURIComponent(id) + "/submitted", function () {
          show("Application sent -- marked as applied in Streamy.", "ok");
        });
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // ------------------------------------------------------------------- boot
  var lastUrl = "";
  async function boot() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    if (location.hostname === "jobs.ashbyhq.com" && !/\/application\b/.test(location.pathname)) return;
    // Wait for the form to render: these are client-side apps.
    for (var i = 0; i < 40 && !document.querySelector("form input, form textarea"); i++) await sleep(250);
    await sleep(600);
    api("GET", "/api/apply/packet?url=" + encodeURIComponent(location.href), function (status, packet) {
      if (status === 404) return; // No packet for this job: stay out of the way.
      if (status !== 200 || !packet) { show("Couldn't reach Streamy (HTTP " + status + ").", "warn"); return; }
      if (packet.status === "submitted") show("Already applied to this one (marked in Streamy).", "ok");
      fill(packet);
    });
  }
  boot();
  // Ashby is a single-page app: the Application tab changes the URL without a load.
  setInterval(boot, 1000);
})();
`;

export function buildUserscript(base: string, token: string): string {
  const host = new URL(base).hostname;
  return `// ==UserScript==
// @name         Streamy apply
// @namespace    ${base}
// @version      1.0
// @description  Fills Greenhouse and Ashby applications from the packet Streamy prepared. Never submits.
// @match        https://job-boards.greenhouse.io/*
// @match        https://boards.greenhouse.io/*
// @match        https://jobs.ashbyhq.com/*
// @grant        GM_xmlhttpRequest
// @connect      ${host}
// @run-at       document-idle
// ==/UserScript==

var CONFIG = ${JSON.stringify({ base: base.replace(/\/$/, ""), token })};
${SCRIPT_BODY}`;
}
