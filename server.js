'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CHALLENGES_FILE = process.env.CHALLENGES_FILE || path.join(ROOT, 'challenges.json');
const CONFIG_FILE = process.env.CONFIG_FILE || path.join(ROOT, 'config.json');
const MAX_BODY = 16 * 1024 * 1024;
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_CUSTOM_CHALLENGES = 50;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Défis communs (challenges.json) et date limite (config.json)
// ---------------------------------------------------------------------------

function normalizeChallenge(c, id) {
  return {
    id,
    title: String(c.title || id),
    description: String(c.description || ''),
    target: Number(c.target) > 0 ? Number(c.target) : 1,
    unit: String(c.unit || ''),
    step: Number(c.step) > 0 ? Number(c.step) : 1,
    bonus: Boolean(c.bonus),
  };
}

function loadChallenges() {
  const list = JSON.parse(fs.readFileSync(CHALLENGES_FILE, 'utf8'));
  const seen = new Set();
  return list.map((c, i) => {
    const id = String(c.id || `defi-${i + 1}`);
    if (seen.has(id)) throw new Error(`Identifiant de défi en double : ${id}`);
    seen.add(id);
    return normalizeChallenge(c, id);
  });
}

const baseChallenges = loadChallenges();

// Période du challenge : `start` et `end` communs à toutes les équipes.
// Sans `end`, chaque équipe a `durationHours` heures après sa création.
// Avant `start`, on peut préparer (équipes, défis, répartition) mais pas avancer.
const config = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {};
function parseDate(key) {
  const value = config[key];
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error(`Date invalide pour « ${key} » : ${value}`);
  return time;
}
const startAt = parseDate('start');
const endAt = parseDate('end') ?? parseDate('deadline');
const durationMs = (Number(config.durationHours) > 0 ? Number(config.durationHours) : 72) * 3600 * 1000;
const deadlineOf = (team) => endAt ?? team.createdAt + durationMs;
const frDate = (time) =>
  new Date(time).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

// ---------------------------------------------------------------------------
// Stockage (fichier JSON, écriture atomique)
// ---------------------------------------------------------------------------

let db = { teams: {}, members: {} };
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
for (const team of Object.values(db.teams)) {
  team.customChallenges ??= [];
  team.assignments ??= {};
}

let saveTimer = null;
function writeDb() {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeDb();
  }, 50);
}
function flush() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  writeDb();
}

const newId = (bytes = 12) => crypto.randomBytes(bytes).toString('hex');

function newJoinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const taken = new Set(Object.values(db.teams).map((t) => t.code));
  let code;
  do {
    code = Array.from(crypto.randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
  } while (taken.has(code));
  return code;
}

const clean = (s, max) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const same = (a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }) === 0;
const round = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Équipes
// ---------------------------------------------------------------------------

function teamMembers(teamId) {
  return Object.values(db.members)
    .filter((m) => m.teamId === teamId)
    .sort((a, b) => a.joinedAt - b.joinedAt);
}

function teamChallenges(team) {
  return [...baseChallenges, ...team.customChallenges.map((c) => ({ ...c, custom: true }))];
}

function assigneesOf(team, challengeId) {
  return (team.assignments[challengeId] || []).filter((id) => db.members[id]?.teamId === team.id);
}

function teamProgress(team, challenges) {
  const progress = {};
  for (const c of challenges) progress[c.id] = 0;
  for (const k of team.contributions) {
    if (k.challengeId in progress) progress[k.challengeId] = round(progress[k.challengeId] + k.amount);
  }
  return progress;
}

function teamStatus(team, challenges, progress) {
  const required = challenges.filter((c) => !c.bonus);
  const done = required.filter((c) => progress[c.id] >= c.target).length;
  const deadline = deadlineOf(team);
  const now = Date.now();
  let status = 'ongoing';
  if (startAt && now < startAt) status = 'upcoming';
  else if (done === required.length) status = 'won';
  else if (now >= deadline) status = 'lost';
  return { done, total: required.length, start: startAt, deadline, status };
}

function teamView(team) {
  const challenges = teamChallenges(team).map((c) => ({ ...c, assignees: assigneesOf(team, c.id) }));
  const ids = new Set(challenges.map((c) => c.id));
  const progress = teamProgress(team, challenges);
  const names = Object.fromEntries(Object.values(db.members).map((m) => [m.id, m.name]));
  return {
    id: team.id,
    name: team.name,
    code: team.code,
    challenges,
    progress,
    status: teamStatus(team, challenges, progress),
    members: teamMembers(team.id).map((m) => ({
      id: m.id,
      name: m.name,
      contributions: team.contributions.filter((k) => k.memberId === m.id).length,
      assigned: challenges.filter((c) => c.assignees.includes(m.id)).length,
    })),
    contributions: team.contributions
      .filter((k) => ids.has(k.challengeId))
      .slice(-300)
      .reverse()
      .map((k) => ({
        id: k.id,
        challengeId: k.challengeId,
        memberId: k.memberId,
        memberName: names[k.memberId] || 'Ancien membre',
        amount: k.amount,
        note: k.note,
        photos: (k.photos || []).map((f) => `/uploads/${f}`),
        at: k.at,
      })),
  };
}

function createMember(team, name) {
  const member = { id: newId(), token: newId(24), teamId: team.id, name, joinedAt: Date.now() };
  db.members[member.id] = member;
  return member;
}

// ---------------------------------------------------------------------------
// Preuves (images)
// ---------------------------------------------------------------------------

const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function savePhotos(list) {
  if (!Array.isArray(list)) return [];
  if (list.length > MAX_PHOTOS) throw new HttpError(400, `${MAX_PHOTOS} images maximum par contribution.`);
  const decoded = list.map((dataUrl) => {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
    if (!match) throw new HttpError(400, "Format d'image non pris en charge.");
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > MAX_PHOTO_BYTES) throw new HttpError(413, 'Image trop lourde.');
    return { buffer, ext: PHOTO_TYPES[match[1]] };
  });
  return decoded.map(({ buffer, ext }) => {
    const file = `${newId(16)}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, file), buffer);
    return file;
  });
}

function removePhotos(contributions) {
  for (const k of contributions) {
    for (const file of k.photos || []) fs.rm(path.join(UPLOAD_DIR, path.basename(file)), { force: true }, () => {});
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Envoi trop volumineux.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Requête invalide.'));
      }
    });
    req.on('error', reject);
  });
}

function auth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const member = token && Object.values(db.members).find((m) => m.token === token);
  if (!member) throw new HttpError(401, 'Session expirée, reconnecte-toi.');
  const team = db.teams[member.teamId];
  if (!team) throw new HttpError(401, "Ton équipe n'existe plus.");
  return { member, team };
}

function ensureOpen(team) {
  if (Date.now() >= deadlineOf(team)) throw new HttpError(403, 'Le temps est écoulé, les défis sont clos.');
}

function ensureStarted() {
  if (startAt && Date.now() < startAt) throw new HttpError(403, `Les défis commencent ${frDate(startAt)}.`);
}

const routes = {
  'POST /api/teams': async (req) => {
    const body = await readJson(req);
    const teamName = clean(body.teamName, 40);
    const memberName = clean(body.memberName, 30);
    if (!teamName) throw new HttpError(400, 'Donne un nom à ton équipe.');
    if (!memberName) throw new HttpError(400, 'Indique ton prénom ou pseudo.');
    if (Object.values(db.teams).some((t) => same(t.name, teamName)))
      throw new HttpError(409, "Ce nom d'équipe est déjà pris.");
    const team = {
      id: newId(),
      name: teamName,
      code: newJoinCode(),
      createdAt: Date.now(),
      contributions: [],
      customChallenges: [],
      assignments: {},
    };
    db.teams[team.id] = team;
    const member = createMember(team, memberName);
    save();
    return { token: member.token, memberId: member.id, team: teamView(team) };
  },

  'POST /api/join': async (req) => {
    const body = await readJson(req);
    const code = clean(body.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const memberName = clean(body.memberName, 30);
    if (!memberName) throw new HttpError(400, 'Indique ton prénom ou pseudo.');
    const team = Object.values(db.teams).find((t) => t.code === code);
    if (!team) throw new HttpError(404, 'Aucune équipe ne correspond à ce code.');
    // Un pseudo déjà présent dans l'équipe permet de retrouver son compte (autre appareil).
    const existing = teamMembers(team.id).find((m) => same(m.name, memberName));
    const member = existing || createMember(team, memberName);
    save();
    return { token: member.token, memberId: member.id, team: teamView(team) };
  },

  'GET /api/me': (req) => {
    const { member, team } = auth(req);
    return { memberId: member.id, team: teamView(team) };
  },

  'POST /api/leave': (req) => {
    const { member, team } = auth(req);
    delete db.members[member.id];
    for (const ids of Object.values(team.assignments)) {
      const i = ids.indexOf(member.id);
      if (i !== -1) ids.splice(i, 1);
    }
    if (!teamMembers(team.id).length) {
      removePhotos(team.contributions);
      delete db.teams[team.id];
    }
    save();
    return { ok: true };
  },

  'POST /api/challenges': async (req) => {
    const { member, team } = auth(req);
    ensureOpen(team);
    const body = await readJson(req);
    const title = clean(body.title, 60);
    const target = round(Number(body.target));
    if (!title) throw new HttpError(400, 'Donne un nom au défi.');
    if (!Number.isFinite(target) || target <= 0 || target > 1e6) throw new HttpError(400, "L'objectif doit être un nombre positif.");
    if (team.customChallenges.length >= MAX_CUSTOM_CHALLENGES) throw new HttpError(400, 'Trop de défis ajoutés.');
    if (teamChallenges(team).some((c) => same(c.title, title))) throw new HttpError(409, 'Un défi porte déjà ce nom.');
    team.customChallenges.push({
      ...normalizeChallenge(
        { title, target, unit: clean(body.unit, 12), description: clean(body.description, 200), bonus: body.bonus, step: Number.isInteger(target) ? 1 : 0.1 },
        `perso-${newId(6)}`,
      ),
      createdBy: member.id,
      createdAt: Date.now(),
    });
    save();
    return { team: teamView(team) };
  },
};

async function addContribution(req, challengeId) {
  const { member, team } = auth(req);
  const challenge = teamChallenges(team).find((c) => c.id === challengeId);
  if (!challenge) throw new HttpError(404, 'Défi introuvable.');
  ensureStarted();
  ensureOpen(team);
  const body = await readJson(req);
  const amount = round(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'La quantité doit être positive.');
  if (amount > challenge.target * 10) throw new HttpError(400, 'Quantité trop grande.');
  const photos = savePhotos(body.photos);
  team.contributions.push({
    id: newId(8),
    challengeId,
    memberId: member.id,
    amount,
    note: clean(body.note, 200),
    photos,
    at: Date.now(),
  });
  save();
  return { team: teamView(team) };
}

function removeContribution(req, contributionId) {
  const { member, team } = auth(req);
  const index = team.contributions.findIndex((k) => k.id === contributionId);
  if (index === -1) throw new HttpError(404, 'Contribution introuvable.');
  if (team.contributions[index].memberId !== member.id)
    throw new HttpError(403, 'Tu ne peux annuler que tes propres contributions.');
  ensureOpen(team);
  removePhotos(team.contributions.splice(index, 1));
  save();
  return { team: teamView(team) };
}

function removeChallenge(req, challengeId) {
  const { team } = auth(req);
  const index = team.customChallenges.findIndex((c) => c.id === challengeId);
  if (index === -1) throw new HttpError(404, "Seuls les défis ajoutés par l'équipe peuvent être supprimés.");
  ensureOpen(team);
  team.customChallenges.splice(index, 1);
  removePhotos(team.contributions.filter((k) => k.challengeId === challengeId));
  team.contributions = team.contributions.filter((k) => k.challengeId !== challengeId);
  delete team.assignments[challengeId];
  save();
  return { team: teamView(team) };
}

// « Je m'en charge » : un membre se positionne (ou se retire) sur un défi.
async function assignChallenge(req, challengeId) {
  const { member, team } = auth(req);
  if (!teamChallenges(team).some((c) => c.id === challengeId)) throw new HttpError(404, 'Défi introuvable.');
  ensureOpen(team);
  const body = await readJson(req);
  const ids = assigneesOf(team, challengeId).filter((id) => id !== member.id);
  if (body.assigned) ids.push(member.id);
  if (ids.length) team.assignments[challengeId] = ids;
  else delete team.assignments[challengeId];
  save();
  return { team: teamView(team) };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function serveFile(res, baseDir, relPath, cache) {
  const file = path.join(baseDir, path.normalize(relPath));
  if (!file.startsWith(baseDir + path.sep)) return send(res, 404, { error: 'Introuvable' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'Introuvable' });
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

    if (pathname.startsWith('/api/')) {
      const key = `${req.method} ${pathname}`;
      const contribMatch = /^\/api\/challenges\/([^/]+)\/contributions$/.exec(pathname);
      const assignMatch = /^\/api\/challenges\/([^/]+)\/assign$/.exec(pathname);
      const challengeMatch = /^\/api\/challenges\/([^/]+)$/.exec(pathname);
      const delMatch = /^\/api\/contributions\/([^/]+)$/.exec(pathname);
      let result;
      if (routes[key]) result = await routes[key](req);
      else if (contribMatch && req.method === 'POST') result = await addContribution(req, contribMatch[1]);
      else if (assignMatch && req.method === 'POST') result = await assignChallenge(req, assignMatch[1]);
      else if (challengeMatch && req.method === 'DELETE') result = removeChallenge(req, challengeMatch[1]);
      else if (delMatch && req.method === 'DELETE') result = removeContribution(req, delMatch[1]);
      else throw new HttpError(404, 'Route inconnue.');
      return send(res, 200, result, { 'Cache-Control': 'no-store' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée.');

    if (pathname.startsWith('/uploads/'))
      return serveFile(res, UPLOAD_DIR, path.basename(pathname), 'private, max-age=31536000, immutable');

    return serveFile(res, PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname, 'no-cache');
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : 'Erreur interne du serveur.';
    if (!res.headersSent) send(res, status, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`WEI Défis : http://localhost:${PORT} (${baseChallenges.length} défis communs)`);
  if (startAt) console.log(`Début : ${frDate(startAt)}`);
  if (endAt) console.log(`Fin : ${frDate(endAt)}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    flush();
    process.exit(0);
  });
}
