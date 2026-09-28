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
  challenges: [],
  leaderboard: null,
  tab: storage.get('wei.tab') || 'challenges',
  hideDone: storage.get('wei.hideDone') === '1',
  openChallenge: null,
};

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------


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
  const main = state.challenges.filter((c) => !c.bonus);
  $('#team-name').textContent = team.name;
  $('#team-done').textContent = `${team.stats.done}/${main.length}`;
  $('#team-done-label').textContent = ' défis';
  $('#team-bar').style.width = `${team.stats.percent}%`;
  $('#team-percent').textContent =
    `${team.stats.percent} % de l'objectif global` + (team.stats.bonusDone ? ` · ${team.stats.bonusDone} bonus réussi${team.stats.bonusDone > 1 ? 's' : ''}` : '');

  $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  for (const t of ['challenges', 'activity', 'leaderboard', 'members']) $(`#tab-${t}`).hidden = t !== state.tab;

  renderChallenges();
  renderActivity();
  renderLeaderboard();
  renderMembers();
  if (state.openChallenge) renderSheet();
}

function renderChallenges() {
  $('#hide-done').checked = state.hideDone;
  const visible = state.challenges.filter((c) => !(state.hideDone && progressOf(c).done));
  $('#challenge-list').innerHTML = visible.length
    ? visible.map((c) => {
        const p = progressOf(c);
        return `
          <li>
            <button class="challenge${p.done ? ' is-done' : ''}" data-challenge="${esc(c.id)}">
              <div class="challenge-body">
                <div class="challenge-top">
                  <span class="challenge-title">${esc(c.title)}${c.bonus ? '<span class="tag">Bonus</span>' : ''}</span>
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
  const c = state.challenges.find((x) => x.id === k.challengeId);
  const mine = k.memberId === state.memberId;
  const what = showChallenge
    ? `<b>+${esc(withUnit(k.amount, c?.unit))}</b> · ${esc(c?.title || '')}`
    : `<b>+${esc(withUnit(k.amount, c?.unit))}</b>`;
  return `
    <li class="item">
      <span class="avatar" aria-hidden="true">${esc(initials(k.memberName))}</span>
      <div class="item-main">
        <p>${what}</p>
        <p class="muted small">${esc(k.memberName)} · ${esc(ago(k.at))}${k.note ? ` · ${esc(k.note)}` : ''}</p>
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

function renderLeaderboard() {
  const lb = state.leaderboard;
  if (!lb) {
    $('#leaderboard-list').innerHTML = '<li class="empty">Chargement…</li>';
    return;
  }
  $('#leaderboard-list').innerHTML = lb.teams.length
    ? lb.teams.map((t, i) => `
        <li class="item${t.id === state.team.id ? ' is-me' : ''}">
          <span class="rank">${i + 1}</span>
          <div class="item-main">
            <p><b>${esc(t.name)}</b></p>
            <p class="muted small">${t.members} membre${t.members > 1 ? 's' : ''}${t.bonusDone ? ` · ${t.bonusDone} bonus` : ''}</p>
            <div class="bar leader-bar"><span style="width:${t.percent}%"></span></div>
          </div>
          <div class="item-side"><b style="color:var(--text)">${t.done}/${lb.totalChallenges}</b><br>${t.percent} %</div>
        </li>`).join('')
    : '<li class="empty">Aucune équipe.</li>';
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
  const c = state.challenges.find((x) => x.id === id);
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
  renderSheet();
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
}

function setAmount(n) {
  $('#form-contrib').amount.value = n;
  $$('#sheet-quick [data-amount]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.amount) === Number(n))));
}

function renderSheet() {
  const c = state.challenges.find((x) => x.id === state.openChallenge);
  if (!c) return closeSheet();
  const p = progressOf(c);
  $('#sheet-title').textContent = c.title;
  $('#sheet-desc').textContent = c.description || (c.bonus ? 'Défi bonus' : '');
  $('#sheet-desc').hidden = !$('#sheet-desc').textContent;
  $('#sheet-current').textContent = fmt(p.value);
  $('#sheet-target').textContent = `/ ${withUnit(c.target, c.unit)}${p.done ? ' · terminé ✓' : ''}`;
  $('#sheet-bar').style.width = `${p.ratio * 100}%`;
  $('#sheet-bar').parentElement.classList.toggle('done', p.done);
  const history = state.team.contributions.filter((k) => k.challengeId === c.id);
  $('#sheet-history').innerHTML = history.length
    ? history.map((k) => contributionItem(k, { showChallenge: false })).join('')
    : '<li class="empty">Personne n\'a encore contribué à ce défi.</li>';
}

function closeSheet() {
  state.openChallenge = null;
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
}

// ---------------------------------------------------------------------------
// Chargement et rafraîchissement
// ---------------------------------------------------------------------------

async function refresh() {
  if (!state.token) return;
  try {
    const [me, lb] = await Promise.all([api('GET', '/api/me'), api('GET', '/api/leaderboard')]);
    state.leaderboard = lb;
    setSession(me);
  } catch (err) {
    if (state.token) console.warn(err);
  }
}

async function init() {
  try {
    ({ challenges: state.challenges } = await api('GET', '/api/challenges'));
  } catch (err) {
    toast(err.message, true);
  }
  if (state.token) await refresh();
  render();
  setInterval(() => { if (!document.hidden) refresh(); }, 10000);
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
  if (state.tab === 'leaderboard') refresh();
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

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.openChallenge) closeSheet(); });

$('#form-contrib').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const id = state.openChallenge;
  const c = state.challenges.find((x) => x.id === id);
  const amount = Number(form.amount.value);
  const wasDone = progressOf(c).done;
  const button = $('#sheet-submit');
  button.disabled = true;
  try {
    const data = await api('POST', `/api/challenges/${encodeURIComponent(id)}/contributions`, { amount, note: form.note.value });
    setSession(data);
    form.note.value = '';
    const nowDone = progressOf(c).done;
    toast(!wasDone && nowDone ? `Défi « ${c.title} » terminé !` : `+${withUnit(amount, c.unit)} ajouté`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
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
