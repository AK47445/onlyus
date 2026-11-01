import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, query, orderBy, onSnapshot, addDoc, setDoc,
  updateDoc, deleteDoc, doc, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

/* ---------------- flags ---------------- */
function indiaFlag(){
  let spokes = "";
  for (let i = 0; i < 24; i++){
    spokes += `<line x1="450" y1="300" x2="450" y2="210" transform="rotate(${i * 15} 450 300)"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600">
    <rect width="900" height="200" fill="#FF9933"/>
    <rect y="200" width="900" height="200" fill="#FFFFFF"/>
    <rect y="400" width="900" height="200" fill="#138808"/>
    <g stroke="#000080" fill="none"><circle cx="450" cy="300" r="88" stroke-width="8"/><g stroke-width="3.5">${spokes}</g></g>
    <circle cx="450" cy="300" r="16" fill="#000080"/></svg>`;
}
function salvadorFlag(){
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 507">
    <rect width="900" height="169" fill="#0F47AF"/>
    <rect y="169" width="900" height="169" fill="#FFFFFF"/>
    <rect y="338" width="900" height="169" fill="#0F47AF"/>
    <text x="450" y="268" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="52" letter-spacing="4" fill="#C9A227">DIOS UNIÓN LIBERTAD</text></svg>`;
}
document.querySelectorAll("[data-flag]").forEach((el) => {
  el.innerHTML = el.getAttribute("data-flag") === "in" ? indiaFlag() : salvadorFlag();
});

/* ---------------- helpers ---------------- */
const pad = (n) => (n < 10 ? "0" + n : "" + n);
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
function dayLabel(dateStr){
  if (dateStr === todayStr()) return "Today";
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (dateStr === ymd(y)) return "Yesterday";
  const [Y, M, D] = dateStr.split("-").map(Number);
  const d = new Date(Y, M - 1, D);
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
const dayDomId = (s) => "day-" + s.replace(/[^0-9]/g, "");
const show = (el, on) => { el.hidden = !on; };

/* Resize + compress a photo so it fits in one Firestore document (< ~900 KB). */
async function compressImage(blob){
  let bitmap;
  try { bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
  catch (e) {
    bitmap = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(blob);
    });
  }
  const w0 = bitmap.width, h0 = bitmap.height;
  let maxSide = 1600, quality = 0.82, dataUrl = "";
  for (let attempt = 0; attempt < 8; attempt++){
    const scale = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length < 900000) return dataUrl;
    if (quality > 0.6) quality -= 0.08; else maxSide = Math.round(maxSide * 0.8);
  }
  return dataUrl;
}

/* ---------------- setup check ---------------- */
const configured = firebaseConfig && firebaseConfig.apiKey && !/PASTE/i.test(firebaseConfig.apiKey);
if (!configured){
  show($("gate-setup"), true);
  throw new Error("Firebase config not set");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

/* ---------------- state ---------------- */
let me = null;
let unsubscribe = null;
let editing = null;
let freshId = null;
let previewUrl = null;
let currentItems = [];
const imageCache = new Map();   // imageId -> dataUrl

const PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

/* lazy image loading */
const io = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    io.unobserve(en.target);
    loadImage(en.target);
  });
}, { rootMargin: "400px 0px" });

async function fetchImage(imageId){
  if (imageCache.has(imageId)) return imageCache.get(imageId);
  const snap = await getDoc(doc(db, "images", imageId));
  const url = snap.exists() ? snap.data().data : "";
  if (url) imageCache.set(imageId, url);
  return url;
}
async function loadImage(img){
  const id = img.dataset.imageId;
  try {
    const url = await fetchImage(id);
    if (url){ img.src = url; img.classList.remove("loading"); }
  } catch (e) { /* leave placeholder */ }
}

/* ---------------- auth ---------------- */
$("signin-btn").addEventListener("click", async () => {
  $("signin-error").hidden = true;
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err && (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment" || err.code === "auth/cancelled-popup-request")){
      await signInWithRedirect(auth, provider);
    } else if (err && err.code !== "auth/popup-closed-by-user"){
      $("signin-error").textContent = "Couldn't sign in — try again.";
      $("signin-error").hidden = false;
    }
  }
});
getRedirectResult(auth).catch(() => {});
$("signout-btn").addEventListener("click", () => signOut(auth));
$("denied-signout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  me = user;
  if (unsubscribe){ unsubscribe(); unsubscribe = null; }
  show($("gate-denied"), false);
  if (!user){
    show($("gate-signin"), true);
    show($("app"), false);
    show($("add-btn"), false);
    return;
  }
  show($("gate-signin"), false);
  show($("app"), true);
  show($("loading-state"), true);
  show($("feed"), false);
  show($("empty-state"), false);
  subscribe();
});

function subscribe(){
  const q = query(collection(db, "entries"), orderBy("addedAt", "desc"));
  unsubscribe = onSnapshot(q, (snap) => {
    show($("add-btn"), true);
    render(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => {
    show($("app"), false);
    show($("add-btn"), false);
    if (err && err.code === "permission-denied"){
      $("denied-msg").textContent = `${me && me.email ? me.email : "this account"} isn't one of the two that can open OnlyUs.`;
      show($("gate-denied"), true);
    } else {
      show($("app"), true);
      show($("loading-state"), false);
      show($("empty-state"), true);
      $("empty-state").textContent = "couldn't load the photos right now.";
    }
  });
}

/* ---------------- render ---------------- */
function render(rows){
  show($("loading-state"), false);
  const items = rows.filter((x) => x.imageId).map((x) => ({
    id: x.id, imageId: x.imageId, caption: x.caption || "", date: x.date || todayStr(),
    addedBy: x.addedBy || null, addedByName: x.addedByName || "", addedAt: Number(x.addedAt) || 0
  }));
  currentItems = items;
  const feed = $("feed"), nav = $("day-nav");
  if (!items.length){
    show($("empty-state"), true);
    $("empty-state").textContent = "the first photos are on their way.";
    show(feed, false); show(nav, false); feed.innerHTML = "";
    return;
  }
  show($("empty-state"), false);
  show(feed, true);

  items.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.addedAt - a.addedAt));
  const groups = {}, order = [];
  items.forEach((it) => { if (!groups[it.date]){ groups[it.date] = []; order.push(it.date); } groups[it.date].push(it); });

  feed.innerHTML = ""; nav.innerHTML = "";
  show(nav, order.length >= 2);

  order.forEach((day) => {
    const domId = dayDomId(day);
    const chip = document.createElement("button");
    chip.type = "button"; chip.className = "day-chip"; chip.textContent = dayLabel(day);
    chip.addEventListener("click", () => { const t = $(domId); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); });
    nav.appendChild(chip);

    const section = document.createElement("div");
    section.className = "day-section"; section.id = domId;
    const heading = document.createElement("div");
    heading.className = "day-heading";
    const hl = document.createElement("span"); hl.textContent = dayLabel(day);
    const hc = document.createElement("span"); hc.className = "count";
    hc.textContent = groups[day].length + (groups[day].length === 1 ? " photo" : " photos");
    heading.append(hl, hc);
    section.appendChild(heading);

    const row = document.createElement("div");
    row.className = "day-photos";
    groups[day].forEach((it) => {
      const fig = document.createElement("figure");
      fig.className = "photo-card editable" + (it.id === freshId ? " fresh" : "");
      const img = document.createElement("img");
      img.alt = it.caption || "a photo of us";
      img.dataset.imageId = it.imageId;
      const cached = imageCache.get(it.imageId);
      if (cached) img.src = cached; else { img.classList.add("loading"); io.observe(img); }
      fig.appendChild(img);
      if (it.caption){
        const cap = document.createElement("figcaption");
        cap.textContent = it.caption;
        fig.appendChild(cap);
      }
      const by = document.createElement("span");
      by.className = "by";
      by.textContent = me && it.addedBy === me.uid ? "you" : (it.addedByName || "us");
      fig.appendChild(by);

      const eb = document.createElement("button");
      eb.type = "button"; eb.className = "edit-badge";
      eb.setAttribute("aria-label", "Edit or remove this photo");
      eb.innerHTML = PENCIL;
      eb.addEventListener("click", (e) => { e.stopPropagation(); openEdit(it); });
      fig.appendChild(eb);
      fig.addEventListener("click", () => openEdit(it));
      row.appendChild(fig);
    });
    section.appendChild(row);
    feed.appendChild(section);
  });
  freshId = null;
}

/* ---------------- add ---------------- */
async function savePhoto(blob, { caption, date, addedAt, importKey }){
  const dataUrl = await compressImage(blob);
  const imageRef = doc(collection(db, "images"));
  await setDoc(imageRef, { data: dataUrl, addedBy: me.uid });
  imageCache.set(imageRef.id, dataUrl);
  const entry = {
    imageId: imageRef.id,
    caption: caption || "",
    date: date || todayStr(),
    addedBy: me.uid,
    addedByName: (me.displayName || "").split(" ")[0] || "",
    addedAt: addedAt || Date.now()
  };
  if (importKey) entry.importKey = importKey;
  return addDoc(collection(db, "entries"), entry);
}

function clearPreview(){
  if (previewUrl){ URL.revokeObjectURL(previewUrl); previewUrl = null; }
  $("add-preview").hidden = true; $("add-preview").removeAttribute("src");
}
function openAdd(){ $("add-form").reset(); clearPreview(); $("form-error").hidden = true; show($("add-panel"), true); }
function closeAdd(){ show($("add-panel"), false); clearPreview(); }

$("photo-file").addEventListener("change", () => {
  clearPreview();
  const f = $("photo-file").files && $("photo-file").files[0];
  if (f){ previewUrl = URL.createObjectURL(f); $("add-preview").src = previewUrl; $("add-preview").hidden = false; }
});
$("add-btn").addEventListener("click", openAdd);
$("cancel-btn").addEventListener("click", closeAdd);
$("add-panel").addEventListener("click", (e) => { if (e.target === $("add-panel")) closeAdd(); });

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("photo-file").files && $("photo-file").files[0];
  if (!file){ $("form-error").textContent = "Pick a photo first."; $("form-error").hidden = false; return; }
  const btn = $("submit-btn");
  btn.disabled = true; btn.textContent = "Adding…"; $("form-error").hidden = true;
  try {
    const ref = await savePhoto(file, { caption: $("photo-caption").value.trim() });
    freshId = ref.id;
    closeAdd();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    $("form-error").textContent = "That didn't go through — try again.";
    $("form-error").hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "Add it";
  }
});

/* ---------------- edit / remove ---------------- */
async function openEdit(it){
  editing = it;
  const pv = $("edit-preview");
  pv.alt = it.caption || "a photo of us";
  pv.src = imageCache.get(it.imageId) || "";
  if (!imageCache.has(it.imageId)) fetchImage(it.imageId).then((u) => { if (editing === it && u) pv.src = u; }).catch(() => {});
  $("edit-caption").value = it.caption || "";
  $("edit-error").hidden = true;
  show($("confirm-box"), false);
  show($("remove-btn"), true);
  show($("edit-panel"), true);
}
function closeEdit(){ show($("edit-panel"), false); editing = null; }

$("edit-cancel").addEventListener("click", closeEdit);
$("edit-panel").addEventListener("click", (e) => { if (e.target === $("edit-panel")) closeEdit(); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("edit-panel").hidden) closeEdit(); else if (!$("add-panel").hidden) closeAdd();
});

$("edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editing) return;
  const next = $("edit-caption").value.trim();
  if (next === (editing.caption || "")){ closeEdit(); return; }
  const btn = $("edit-save");
  btn.disabled = true; btn.textContent = "Saving…"; $("edit-error").hidden = true;
  try {
    await updateDoc(doc(db, "entries", editing.id), { caption: next });
    closeEdit();
  } catch (err) {
    $("edit-error").textContent = "Couldn't save that — try again.";
    $("edit-error").hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "Save";
  }
});

$("remove-btn").addEventListener("click", () => { show($("remove-btn"), false); show($("confirm-box"), true); });
$("confirm-no").addEventListener("click", () => { show($("confirm-box"), false); show($("remove-btn"), true); });
$("confirm-yes").addEventListener("click", async () => {
  if (!editing) return;
  const target = editing;
  const btn = $("confirm-yes");
  btn.disabled = true; btn.textContent = "Removing…"; $("edit-error").hidden = true;
  try {
    await deleteDoc(doc(db, "entries", target.id));
    try { await deleteDoc(doc(db, "images", target.imageId)); } catch (e2) {}
    imageCache.delete(target.imageId);
    closeEdit();
  } catch (err) {
    $("edit-error").textContent = "Couldn't remove that — try again.";
    $("edit-error").hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "Remove";
  }
});

/* ---------------- import from the Claude export (.zip) ---------------- */
function loadJSZip(){
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = () => res(window.JSZip);
    s.onerror = rej;
    document.head.appendChild(s);
  });
}
const importStatus = (t) => { $("import-status").textContent = t; $("import-status").hidden = !t; };

$("import-btn").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async () => {
  const file = $("import-file").files && $("import-file").files[0];
  $("import-file").value = "";
  if (!file) return;
  const btn = $("import-btn");
  btn.disabled = true;
  importStatus("opening the zip…");
  try {
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(file);
    const manifestFile = zip.file("captions.json");
    if (!manifestFile) throw new Error("no manifest");
    const manifest = JSON.parse(await manifestFile.async("string"));
    const photos = (manifest.photos || []).slice().sort((a, b) => a.order - b.order);

    const existing = await getDocs(collection(db, "entries"));
    const already = new Set(existing.docs.map((d) => d.data().importKey).filter(Boolean));

    let added = 0, skipped = 0;
    for (let i = 0; i < photos.length; i++){
      const p = photos[i];
      const key = "claude:" + p.file;
      if (already.has(key)){ skipped++; continue; }
      const entry = zip.file(p.file);
      if (!entry){ skipped++; continue; }
      importStatus(`importing ${i + 1} of ${photos.length}…`);
      const blob = await entry.async("blob");
      const base = p.date ? new Date(p.date + "T12:00:00").getTime() : Date.now();
      await savePhoto(blob, { caption: p.caption, date: p.date || todayStr(), addedAt: base + (p.order || i) * 1000, importKey: key });
      added++;
    }
    importStatus(added ? `imported ${added} photo${added === 1 ? "" : "s"}${skipped ? ` (${skipped} already here)` : ""}.` : "those photos are already here.");
  } catch (err) {
    importStatus("couldn't read that zip — use the one from the Claude page's “Download all photos” button.");
  } finally {
    btn.disabled = false;
  }
});
