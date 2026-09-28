'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const storage = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

const state = {
  token: storage.get('wei.token'),
  memberId: null,
  team: null,
  proofs: [],
  tab: ['challenges', 'activity', 'members'].includes(storage.get('wei.tab')) ? storage.get('wei.tab') : 'challenges',
  hideDone: storage.get('wei.hideDone') === '1',
  openChallenge: null,
};

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

const challenges = () => state.team?.challenges || [];
const findChallenge = (id) => challenges().find((c) => c.id === id);

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const fmt = (n) => nf.format(n);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function withUnit(n, unit) {
  return unit ? `${fmt(n)} ${unit}` : fmt(n);
}

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
function ago(ts) {
  const s = Math.round((ts - Date.now()) / 1000);
  if (s > -45) return "à l'instant";
  const m = Math.round(s / 60);
  if (m > -60) return rtf.format(m, 'minute');
  const h = Math.round(m / 60);
  if (h > -24) return rtf.format(h, 'hour');
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function initials(name) {
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) {
    logout();
    throw new Error(data.error || 'Session expirée.');
  }
  if (!res.ok) throw new Error(data.error || 'Une erreur est survenue.');
  return data;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

function setSession({ token, memberId, team }) {
  state.token = token ?? state.token;
  state.memberId = memberId ?? state.memberId;
  state.team = team;
  storage.set('wei.token', state.token);
  render();
}

function logout() {
  state.token = null;
  state.memberId = null;
  state.team = null;
  storage.set('wei.token', null);
  closeSheet();
  render();
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

function progressOf(c) {
  const value = state.team?.progress[c.id] || 0;
  return { value, ratio: Math.min(1, value / c.target), done: value >= c.target };
}

function render() {
  const loggedIn = Boolean(state.team);
  $('#view-welcome').hidden = loggedIn;
  $('#view-team').hidden = !loggedIn;
  $('#menu-btn').hidden = !loggedIn;
  if (!loggedIn) return;

  const { team } = state;
  $('#team-name').textContent = team.name;
  $('#team-done').textContent = `${team.status.done}/${team.status.total}`;
  $('#team-bar').style.width = `${team.status.total ? (team.status.done / team.status.total) * 100 : 0}%`;
  renderStatus();

  $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  for (const t of ['challenges', 'activity', 'members']) $(`#tab-${t}`).hidden = t !== state.tab;

  renderChallenges();
  renderActivity();
  renderMembers();
  if (state.openChallenge) renderSheet();
}

// Réussi dès que tous les défis (hors bonus) sont terminés, perdu si la date limite passe avant.
function currentStatus() {
  const { status, deadline } = state.team.status;
  if (status === 'won') return 'won';
  return Date.now() >= deadline ? 'lost' : 'ongoing';
}

const pad = (n) => String(n).padStart(2, '0');
function countdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d ? `${d} j ` : ''}${pad(h)} h ${pad(m)} min ${pad(s % 60)} s`;
}

function renderStatus() {
  if (!state.team) return;
  const { done, total, deadline } = state.team.status;
  const status = currentStatus();
  const left = total - done;
  const end = new Date(deadline).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  $('#summary').className = `card summary ${status}`;
  $('#team-status').className = `status ${status}`;
  $('#challenge-list').classList.toggle('closed', status === 'lost');
  $('#new-challenge-btn').hidden = status === 'lost';
  if (status === 'won') {
    $('#status-title').textContent = 'Défis réussis !';
    $('#status-sub').textContent = "L'équipe a relevé tous les défis.";
  } else if (status === 'lost') {
    $('#status-title').textContent = 'Défis perdus';
    $('#status-sub').textContent = `Temps écoulé avec ${left} défi${left > 1 ? 's' : ''} non réussi${left > 1 ? 's' : ''}.`;
  } else {
    $('#status-title').textContent = `Il reste ${countdown(deadline - Date.now())}`;
    $('#status-sub').textContent = `Encore ${left} défi${left > 1 ? 's' : ''} à réussir · fin ${end}`;
  }
  if (state.wasOpen !== (status === 'ongoing')) {
    state.wasOpen = status === 'ongoing';
    if (state.openChallenge) renderSheet();
  }
}

function renderChallenges() {
  $('#hide-done').checked = state.hideDone;
  const visible = challenges().filter((c) => !(state.hideDone && progressOf(c).done));
  $('#challenge-list').innerHTML = visible.length
    ? visible.map((c) => {
        const p = progressOf(c);
        return `
          <li>
            <button class="challenge${p.done ? ' is-done' : ''}" data-challenge="${esc(c.id)}">
              <div class="challenge-body">
                <div class="challenge-top">
                  <span class="challenge-title">${esc(c.title)}${c.bonus ? '<span class="tag">Bonus</span>' : ''}${c.custom ? '<span class="tag">Ajouté</span>' : ''}</span>
                  <span class="challenge-count"><b>${fmt(p.value)}</b> / ${esc(withUnit(c.target, c.unit))}</span>
                </div>
                ${c.description ? `<p class="challenge-desc">${esc(c.description)}</p>` : ''}
                <div class="bar${p.done ? ' done' : ''}"><span style="width:${p.ratio * 100}%"></span></div>
              </div>
              <span class="add" aria-hidden="true">${p.done ? checkIcon : plusIcon}</span>
            </button>
          </li>`;
      }).join('')
    : '<li class="empty">Tous les défis sont terminés. Bravo !</li>';
}

function contributionItem(k, { showChallenge }) {
  const c = findChallenge(k.challengeId);
  const mine = k.memberId === state.memberId && currentStatus() !== 'lost';
  const what = showChallenge
    ? `<b>+${esc(withUnit(k.amount, c?.unit))}</b> · ${esc(c?.title || '')}`
    : `<b>+${esc(withUnit(k.amount, c?.unit))}</b>`;
  return `
    <li class="item">
      <span class="avatar" aria-hidden="true">${esc(initials(k.memberName))}</span>
      <div class="item-main">
        <p>${what}</p>
        <p class="muted small">${esc(k.memberName)} · ${esc(ago(k.at))}${k.note ? ` · ${esc(k.note)}` : ''}</p>
        ${k.photos.length ? `<div class="thumbs">${k.photos.map((url) => `<button class="thumb" data-photo="${esc(url)}" aria-label="Voir la preuve"><img src="${esc(url)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
      </div>
      ${mine ? `<button class="link-btn" data-undo="${esc(k.id)}">Annuler</button>` : ''}
    </li>`;
}

function renderActivity() {
  const items = state.team.contributions;
  $('#activity-list').innerHTML = items.length
    ? items.map((k) => contributionItem(k, { showChallenge: true })).join('')
    : '<li class="empty">Aucune contribution pour l\'instant. Choisis un défi dans l\'onglet « Défis » pour commencer.</li>';
}

function renderMembers() {
  const { team } = state;
  $('#invite-code').textContent = team.code;
  $('#member-list').innerHTML = team.members.map((m) => `
    <li class="item">
      <span class="avatar" aria-hidden="true">${esc(initials(m.name))}</span>
      <div class="item-main">
        <p><b>${esc(m.name)}</b>${m.id === state.memberId ? ' <span class="muted">(toi)</span>' : ''}</p>
      </div>
      <span class="item-side">${m.contributions} contribution${m.contributions > 1 ? 's' : ''}</span>
    </li>`).join('');
}

const plusIcon = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const checkIcon = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---------------------------------------------------------------------------
// Feuille de contribution
// ---------------------------------------------------------------------------

function quickAmounts(c) {
  if (c.step < 1) return [c.step, 1, 2, 5];
  if (c.target <= 5) return [1];
  if (c.target <= 30) return [1, 2, 5];
  if (c.target <= 300) return [1, 5, 10, 20];
  return [1, 10, 50, 100];
}

function openSheet(id) {
  const c = findChallenge(id);
  if (!c) return;
  state.openChallenge = id;
  const form = $('#form-contrib');
  form.reset();
  form.amount.step = String(c.step);
  form.amount.min = String(c.step);
  $('#sheet-quick').innerHTML = quickAmounts(c)
    .map((n) => `<button type="button" data-amount="${n}">+${fmt(n)}</button>`)
    .join('');
  setAmount(quickAmounts(c)[0]);
  state.proofs = [];
  renderProofs();
  renderSheet();
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
}

function setAmount(n) {
  $('#form-contrib').amount.value = n;
  $$('#sheet-quick [data-amount]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.amount) === Number(n))));
}

function renderSheet() {
  const c = findChallenge(state.openChallenge);
  if (!c) return closeSheet();
  const p = progressOf(c);
  $('#sheet-title').textContent = c.title;
  $('#sheet-desc').textContent = c.description || (c.bonus ? 'Défi bonus' : '');
  $('#sheet-desc').hidden = !$('#sheet-desc').textContent;
  $('#sheet-current').textContent = fmt(p.value);
  $('#sheet-target').textContent = `/ ${withUnit(c.target, c.unit)}${p.done ? ' · terminé ✓' : ''}`;
  $('#sheet-bar').style.width = `${p.ratio * 100}%`;
  $('#sheet-bar').parentElement.classList.toggle('done', p.done);
  const closed = currentStatus() === 'lost';
  $('#form-contrib').hidden = closed;
  $('#sheet-closed').hidden = !closed;
  $('#delete-challenge-btn').hidden = !c.custom || closed;
  const history = state.team.contributions.filter((k) => k.challengeId === c.id);
  $('#sheet-history').innerHTML = history.length
    ? history.map((k) => contributionItem(k, { showChallenge: false })).join('')
    : '<li class="empty">Personne n\'a encore contribué à ce défi.</li>';
}

function closeSheet() {
  state.openChallenge = null;
  state.proofs = [];
  $('#sheet').hidden = true;
  $('#sheet-new').hidden = true;
  document.body.style.overflow = '';
}

// ---------------------------------------------------------------------------
// Preuves : les images sont réduites et compressées sur le téléphone avant l'envoi
// ---------------------------------------------------------------------------

const MAX_PROOFS = 4;
const MAX_SIDE = 2000;

async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderProofs() {
  $('#proof-thumbs').innerHTML = state.proofs
    .map((src, i) => `<span class="thumb"><img src="${src}" alt=""><button type="button" class="remove" data-remove-proof="${i}" aria-label="Retirer">×</button></span>`)
    .join('');
  $('#proof-btn').disabled = state.proofs.length >= MAX_PROOFS;
}

function openLightbox(url) {
  $('#lightbox img').src = url;
  $('#lightbox').hidden = false;
}

function closeLightbox() {
  $('#lightbox').hidden = true;
  $('#lightbox img').removeAttribute('src');
}

// ---------------------------------------------------------------------------
// Chargement et rafraîchissement
// ---------------------------------------------------------------------------

async function refresh() {
  if (!state.token) return;
  try {
    setSession(await api('GET', '/api/me'));
  } catch (err) {
    if (state.token) console.warn(err);
  }
}

async function init() {
  if (state.token) await refresh();
  render();
  setInterval(() => { if (!document.hidden) refresh(); }, 10000);
  setInterval(renderStatus, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------

$$('[data-auth-tab]').forEach((btn) => btn.addEventListener('click', () => {
  const tab = btn.dataset.authTab;
  $$('[data-auth-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
  $('#form-join').hidden = tab !== 'join';
  $('#form-create').hidden = tab !== 'create';
}));

async function submitForm(form, url) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const data = await api('POST', url, Object.fromEntries(new FormData(form)));
    setSession(data);
    form.reset();
    refresh();
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
  }
}

$('#form-join').addEventListener('submit', (e) => { e.preventDefault(); submitForm(e.target, '/api/join'); });
$('#form-create').addEventListener('submit', (e) => { e.preventDefault(); submitForm(e.target, '/api/teams'); });

$$('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
  state.tab = btn.dataset.tab;
  storage.set('wei.tab', state.tab);
  render();
}));

$('#hide-done').addEventListener('change', (e) => {
  state.hideDone = e.target.checked;
  storage.set('wei.hideDone', state.hideDone ? '1' : '0');
  renderChallenges();
});

$('#challenge-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-challenge]');
  if (btn) openSheet(btn.dataset.challenge);
});

$('#sheet').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeSheet();
  const quick = e.target.closest('[data-amount]');
  if (quick) setAmount(quick.dataset.amount);
});

$('#form-contrib').amount.addEventListener('input', (e) => setAmount(e.target.value));

$('#sheet-new').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeSheet();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#lightbox').hidden) closeLightbox();
  else closeSheet();
});

$('#proof-btn').addEventListener('click', () => $('#proof-input').click());

$('#proof-input').addEventListener('change', async (e) => {
  const files = [...e.target.files].slice(0, MAX_PROOFS - state.proofs.length);
  e.target.value = '';
  for (const file of files) {
    try {
      state.proofs.push(await compressImage(file));
    } catch {
      toast("Impossible de lire cette image.", true);
    }
  }
  renderProofs();
});

$('#proof-thumbs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-proof]');
  if (!btn) return;
  state.proofs.splice(Number(btn.dataset.removeProof), 1);
  renderProofs();
});

document.addEventListener('click', (e) => {
  const photo = e.target.closest('[data-photo]');
  if (photo) openLightbox(photo.dataset.photo);
});

$('#lightbox').addEventListener('click', closeLightbox);

$('#new-challenge-btn').addEventListener('click', () => {
  $('#form-new').reset();
  $('#sheet-new').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#form-new').elements.title.focus();
});

$('#form-new').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const data = await api('POST', '/api/challenges', {
      title: form.elements.title.value,
      target: Number(form.target.value),
      unit: form.unit.value,
      description: form.description.value,
      bonus: form.bonus.checked,
    });
    setSession(data);
    closeSheet();
    toast('Défi ajouté');
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
  }
});

$('#delete-challenge-btn').addEventListener('click', async () => {
  const c = findChallenge(state.openChallenge);
  if (!c || !confirm(`Supprimer le défi « ${c.title} » et toutes ses contributions ?`)) return;
  try {
    const data = await api('DELETE', `/api/challenges/${encodeURIComponent(c.id)}`);
    closeSheet();
    setSession(data);
    toast('Défi supprimé');
  } catch (err) {
    toast(err.message, true);
  }
});

$('#form-contrib').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const id = state.openChallenge;
  const c = findChallenge(id);
  const amount = Number(form.amount.value);
  const wasDone = progressOf(c).done;
  const wasWon = currentStatus() === 'won';
  const button = $('#sheet-submit');
  button.disabled = true;
  button.textContent = state.proofs.length ? 'Envoi…' : 'Ajouter';
  try {
    const data = await api('POST', `/api/challenges/${encodeURIComponent(id)}/contributions`, {
      amount,
      note: form.note.value,
      photos: state.proofs,
    });
    setSession(data);
    form.note.value = '';
    state.proofs = [];
    renderProofs();
    const nowDone = progressOf(c).done;
    toast(
      currentStatus() === 'won' && !wasWon ? 'Tous les défis sont réussis !'
        : !wasDone && nowDone ? `Défi « ${c.title} » réussi !`
        : `+${withUnit(amount, c.unit)} ajouté`,
    );
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Ajouter';
  }
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-undo]');
  if (!btn) return;
  if (!confirm('Annuler cette contribution ?')) return;
  btn.disabled = true;
  try {
    setSession(await api('DELETE', `/api/contributions/${encodeURIComponent(btn.dataset.undo)}`));
    toast('Contribution annulée');
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
  }
});

$('#copy-code').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.team.code);
    toast('Code copié');
  } catch {
    toast(`Code : ${state.team.code}`);
  }
});

$('#menu-btn').addEventListener('click', () => {
  state.tab = 'members';
  storage.set('wei.tab', state.tab);
  render();
});

$('#leave-btn').addEventListener('click', async () => {
  const alone = state.team.members.length <= 1;
  const msg = alone
    ? "Tu es le dernier membre : l'équipe et toute sa progression seront supprimées. Continuer ?"
    : "Quitter l'équipe ? Tes contributions restent comptées pour l'équipe.";
  if (!confirm(msg)) return;
  try {
    await api('POST', '/api/leave');
  } catch {}
  logout();
});

init();
