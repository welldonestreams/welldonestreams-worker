// ============================================================
// Well Done Streams - Worker API  (worker.js)  — consolidated build
// Public:   /api/submit, /api/recent, /api/recent-push, /api/poll, /api/vote,
//           /api/request-status, /api/requests
// Admin:    /api/admin/pending, /api/admin/invite, /api/admin/dismiss,
//           /api/admin/set-votes, /api/poll/admin, /api/poll/lookup
//           (all Bearer ADMIN_POLL_TOKEN)
// Casino:   /api/casino/balance, /api/casino/claim, /api/casino/play,
//           /api/casino/trivia-question, /api/casino/trivia-answer, /api/casino/trivia-cashout
//
// Fixes in this build:
//  - getFromCache is type-aware ("json" actually parses; cache stores parsed)
//  - casino balance falsy bug fixed (0 chips no longer auto-refills to 1000)
//  - roulette validates total stake from the bets array (bet field is unused there)
//  - coinflip/slots validate bet is a positive number <= balance
//  - blackjack netWin validated + loss clamped to current balance
//  - anonymous casino users key to "casino:default-user" (not "casino:")
// ============================================================

const RECENT_MAX = 12;
const ORIGIN = 'https://welldonestreams.com';
const CASINO_START = 1000;
const CASINO_DAILY = 500;

// ---------- KV in-memory cache ----------
const kvCache = new Map();
const KV_TTL = 60000;

// type-aware: pass 'json' to get a parsed object back (and cache the parsed form)
async function getFromCache(env, namespace, key, type) {
  const cacheKey = `${namespace}:${key}:${type || 'text'}`;
  const cached = kvCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached.value;
  const raw = await env[namespace].get(key);
  let value = raw;
  if (type === 'json') {
    value = safeJSONParse(raw, null);
  }
  kvCache.set(cacheKey, { value, expiry: Date.now() + KV_TTL });
  return value;
}

// invalidate both text+json cache entries on write so reads never go stale
async function putToCache(env, namespace, key, value, options) {
  await env[namespace].put(key, value, options);
  kvCache.delete(`${namespace}:${key}:text`);
  kvCache.delete(`${namespace}:${key}:json`);
}

const listCache = new Map();
const LIST_TTL = 30000;

async function deleteFromCache(env, namespace, key) {
  await env[namespace].delete(key);
  kvCache.delete(`${namespace}:${key}:text`);
  kvCache.delete(`${namespace}:${key}:json`);
}

// ---------- Trivia (WellDoneBets) ----------
// 105 static questions (6th-10th grade) + an infinite math generator.
// Answers never leave the server; the active answer sits in KV for 20s.
const TRIVIA = [
  ["What is the capital of France?", ["paris"]],
  ["What is the capital of Japan?", ["tokyo"]],
  ["What is the capital of Italy?", ["rome"]],
  ["What is the capital of Spain?", ["madrid"]],
  ["What is the capital of Germany?", ["berlin"]],
  ["What is the capital of Russia?", ["moscow"]],
  ["What is the capital of China?", ["beijing"]],
  ["What is the capital of Canada?", ["ottawa"]],
  ["What is the capital of Australia?", ["canberra"]],
  ["What is the capital of Egypt?", ["cairo"]],
  ["What is the capital of Brazil?", ["brasilia"]],
  ["What is the capital of Mexico?", ["mexico city"]],
  ["What is the capital of the United Kingdom?", ["london"]],
  ["What is the capital of Greece?", ["athens"]],
  ["What is the capital of Portugal?", ["lisbon"]],
  ["What is the capital of South Korea?", ["seoul"]],
  ["What is the capital of India?", ["new delhi", "delhi"]],
  ["What is the capital of Turkey?", ["ankara"]],
  ["What is the capital of Norway?", ["oslo"]],
  ["What is the capital of Sweden?", ["stockholm"]],
  ["What is the capital of Poland?", ["warsaw"]],
  ["What is the capital of the Netherlands?", ["amsterdam"]],
  ["What is the capital of Ireland?", ["dublin"]],
  ["What is the capital of Argentina?", ["buenos aires"]],
  ["What is the capital of Thailand?", ["bangkok"]],
  ["What is the largest ocean on Earth?", ["pacific", "pacific ocean"]],
  ["What is the longest river in Africa?", ["nile", "the nile"]],
  ["What is the largest hot desert in the world?", ["sahara", "the sahara"]],
  ["Mount Everest is on which continent?", ["asia"]],
  ["How many continents are there?", ["7", "seven"]],
  ["How many states are in the USA?", ["50", "fifty"]],
  ["What is the capital of California?", ["sacramento"]],
  ["What is the capital of Texas?", ["austin"]],
  ["What is the capital of New York state?", ["albany"]],
  ["Which US state is nicknamed the Sunshine State?", ["florida"]],
  ["The Grand Canyon is in which US state?", ["arizona"]],
  ["Which river runs through Egypt?", ["nile", "the nile"]],
  ["What is the largest US state by area?", ["alaska"]],
  ["What is the smallest US state by area?", ["rhode island"]],
  ["The Great Barrier Reef is off the coast of which country?", ["australia"]],
  ["What is H2O commonly known as?", ["water"]],
  ["What element has the chemical symbol O?", ["oxygen"]],
  ["What element has the chemical symbol Au?", ["gold"]],
  ["What element has the chemical symbol Fe?", ["iron"]],
  ["What element has the chemical symbol Na?", ["sodium"]],
  ["How many planets are in our solar system?", ["8", "eight"]],
  ["Which planet is closest to the sun?", ["mercury"]],
  ["Which planet is known as the Red Planet?", ["mars"]],
  ["What is the largest planet in our solar system?", ["jupiter"]],
  ["What gas do plants absorb from the air?", ["carbon dioxide", "co2"]],
  ["What gas do humans need to breathe to survive?", ["oxygen", "o2"]],
  ["What is the largest organ of the human body?", ["skin", "the skin"]],
  ["How many bones are in the adult human body?", ["206"]],
  ["What is the center of an atom called?", ["nucleus", "the nucleus"]],
  ["What force pulls objects toward the Earth?", ["gravity"]],
  ["Which egg-laying mammal has a duck bill?", ["platypus", "the platypus"]],
  ["What is the fastest land animal?", ["cheetah", "the cheetah"]],
  ["What is the largest mammal on Earth?", ["blue whale", "the blue whale", "whale"]],
  ["At what temperature does water boil in Celsius?", ["100", "100 degrees"]],
  ["At what temperature does water freeze in Celsius?", ["0", "zero", "0 degrees"]],
  ["How many items are in a dozen?", ["12", "twelve"]],
  ["How many degrees are in a right angle?", ["90"]],
  ["The angles of a triangle add up to how many degrees?", ["180"]],
  ["How many sides does a hexagon have?", ["6", "six"]],
  ["How many sides does an octagon have?", ["8", "eight"]],
  ["What are the first three digits of pi?", ["3.14", "314"]],
  ["What is 15% of 200?", ["30"]],
  ["What is the square root of 144?", ["12"]],
  ["What is 7 times 8?", ["56"]],
  ["What is the smallest prime number?", ["2", "two"]],
  ["Who was the first US president?", ["george washington", "washington"]],
  ["In what year did the US declare independence?", ["1776"]],
  ["In what year did World War 2 end?", ["1945"]],
  ["In what year did World War 1 begin?", ["1914"]],
  ["Who painted the Mona Lisa?", ["leonardo da vinci", "da vinci", "leonardo"]],
  ["In what year did the Titanic sink?", ["1912"]],
  ["Who was the first person to walk on the moon?", ["neil armstrong", "armstrong"]],
  ["In what year did humans first land on the moon?", ["1969"]],
  ["The ancient pyramids of Giza are in which country?", ["egypt"]],
  ["Who was the main author of the Declaration of Independence?", ["thomas jefferson", "jefferson"]],
  ["Who was the 16th US president?", ["abraham lincoln", "lincoln"]],
  ["In what year did the American Civil War end?", ["1865"]],
  ["In what year did the Berlin Wall fall?", ["1989"]],
  ["In what year did Columbus first sail to the Americas?", ["1492"]],
  ["What is the famous ancient arena in Rome called?", ["colosseum", "the colosseum", "coliseum"]],
  ["What is the plural of 'mouse'?", ["mice"]],
  ["Who wrote Romeo and Juliet?", ["william shakespeare", "shakespeare"]],
  ["Who wrote the Harry Potter books?", ["jk rowling", "j.k. rowling", "rowling", "j k rowling"]],
  ["What part of speech describes an action?", ["verb", "a verb"]],
  ["How many letters are in the English alphabet?", ["26"]],
  ["What is a baby dog called?", ["puppy", "a puppy", "pup"]],
  ["What is a baby cat called?", ["kitten", "a kitten"]],
  ["What is a baby sheep called?", ["lamb", "a lamb"]],
  ["What is a group of lions called?", ["pride", "a pride"]],
  ["What do you call a period of 100 years?", ["century", "a century"]],
  ["How many players are on a soccer team on the field?", ["11", "eleven"]],
  ["How many points is a free throw worth in basketball?", ["1", "one"]],
  ["How many innings are in a standard baseball game?", ["9", "nine"]],
  ["How many rings are on the Olympic flag?", ["5", "five"]],
  ["The Super Bowl is the championship of which sport?", ["football", "american football", "nfl"]],
  ["How many holes are in a full round of golf?", ["18", "eighteen"]],
  ["Pizza originally comes from which country?", ["italy"]],
  ["What is the currency of Japan?", ["yen", "the yen", "japanese yen"]],
  ["What is the currency of the United Kingdom?", ["pound", "pound sterling", "british pound", "the pound"]],
  ["What is the currency of the United States?", ["dollar", "us dollar", "the dollar", "usd"]],
];

function genMathQuestion() {
  const t = Math.floor(Math.random() * 6);
  let q, a;
  if (t === 0) { const x = 2 + Math.floor(Math.random() * 11), y = 2 + Math.floor(Math.random() * 18); q = `What is ${x} × ${y}?`; a = x * y; }
  else if (t === 1) { const x = 25 + Math.floor(Math.random() * 875), y = 25 + Math.floor(Math.random() * 875); q = `What is ${x} + ${y}?`; a = x + y; }
  else if (t === 2) { const x = 100 + Math.floor(Math.random() * 900), y = Math.floor(Math.random() * x); q = `What is ${x} − ${y}?`; a = x - y; }
  else if (t === 3) { const x = 3 + Math.floor(Math.random() * 17); q = `What is ${x} squared?`; a = x * x; }
  else if (t === 4) { const p = [10, 20, 25, 50][Math.floor(Math.random() * 4)]; const base = [40, 60, 80, 120, 200, 240, 300, 400, 500, 800][Math.floor(Math.random() * 10)]; q = `What is ${p}% of ${base}?`; a = base * p / 100; }
  else { const y = 2 + Math.floor(Math.random() * 11); const ans = 2 + Math.floor(Math.random() * 12); q = `What is ${y * ans} ÷ ${y}?`; a = ans; }
  return { q, a: [String(a)] };
}

function pickTriviaQuestion() {
  if (Math.random() < 0.5) return genMathQuestion();
  const p = TRIVIA[Math.floor(Math.random() * TRIVIA.length)];
  return { q: p[0], a: p[1] };
}

// Fixes Tautulli pushes where the show name arrives doubled ("The PenguinThe Penguin - Season 1")
function dedupeTitle(t) {
  t = String(t || '').trim();
  for (let i = Math.floor(t.length / 2); i >= 4; i--) {
    if (t.slice(0, i) === t.slice(i, 2 * i)) return t.slice(i).trim();
  }
  return t;
}

function normAnswer(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9. ]/g, '').replace(/\s+/g, ' ');
}

function levDist(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}

function answerMatches(userAns, variants) {
  const u = normAnswer(userAns);
  if (!u) return false;
  const uNum = parseFloat(u);
  return variants.some((v) => {
    const nv = normAnswer(v);
    if (nv === u) return true;
    const vNum = parseFloat(nv);
    if (!isNaN(uNum) && !isNaN(vNum) && uNum === vNum && /^[0-9.]+$/.test(u)) return true;
    // typo forgiveness: 1 edit for short answers, 2 edits for longer ones (text answers only)
    if (isNaN(vNum) && nv.length >= 4) {
      const allowed = nv.length > 6 ? 2 : 1;
      if (levDist(u, nv) <= allowed) return true;
    }
    return false;
  });
}


async function listWithCache(env, namespace, ...args) {
  const cacheKey = `${namespace}:list:${JSON.stringify(args)}`;
  const cached = listCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached.value;
  const result = await env[namespace].list(...args);
  listCache.set(cacheKey, { value: result, expiry: Date.now() + LIST_TTL });
  return result;
}

// ---------- Helpers ----------
const symbols = ['🍒', '🍋', '🔔', '7️⃣', '💎', '🍀'];

function safeJSONParse(str, fallback) {
  try {
    return str ? JSON.parse(str) : fallback;
  } catch (e) {
    return fallback;
  }
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...extra } });
}

function text(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain', ...extra } });
}

function mapSeerrStatus(s) {
  const statuses = { 0: 'Pending Approval', 1: 'Pending', 2: 'Approved', 3: 'Declined', 4: 'Available', 5: 'Processing' };
  return statuses[s] || 'Unknown';
}

async function markInvited(env, id) {
  const key = `request:${id}`;
  const entry = await env.ACCESS_REQUESTS.get(key, 'json');
  if (entry) {
    entry.status = 'invited';
    entry.invitedAt = new Date().toISOString();
    await env.ACCESS_REQUESTS.put(key, JSON.stringify(entry));
  }
}

function getMediaTitle(media, type) {
  if (!media) return 'Untitled request';
  if (type === 'movie') {
    const dl2 = media.downloadStatus?.[0];
    if (dl2?.title) {
      const clean = dl2.title.split('.').slice(0, -1).join(' ').replace(/(1080p|2160p|4K|BluRay|WEB-DL|HDR|REMUX)/gi, '').trim();
      return clean || dl2.title;
    }
  }
  if (type === 'tv' && media.externalServiceSlug) {
    return media.externalServiceSlug.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }
  const dl = media.downloadStatus?.[0];
  if (dl?.title) return dl.title;
  return 'Untitled request';
}

async function tmdbPosterById(tmdbId, type, apiKey) {
  try {
    const kind = type === 'Movie' ? 'movie' : 'tv';
    const res = await fetch(`https://api.themoviedb.org/3/${kind}/${encodeURIComponent(tmdbId)}?api_key=${apiKey}`);
    if (!res.ok) return '';
    const data = await res.json();
    return data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : '';
  } catch (e) {
    return '';
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    const isAdmin = () => (request.headers.get('Authorization') || '') === `Bearer ${env.ADMIN_POLL_TOKEN}`;

    try {
      // ============ PUBLIC: ACCESS REQUEST FORM ============
      if (path === '/api/submit' && method === 'POST') {
        const { name, email } = await request.json();
        if (!name || !email) return json({ error: 'Name and email are required.' }, 400, corsHeaders);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Please enter a valid email address.' }, 400, corsHeaders);
        if (name.length > 200 || email.length > 200) return json({ error: 'Input too long.' }, 400, corsHeaders);

        const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rateKey = `rate:submit:${clientIP}`;
        const rateData = await getFromCache(env, 'CACHE', rateKey, 'json');
        const now = Date.now();

        if (rateData && now < rateData.reset) {
          if (rateData.count >= 3) return json({ error: 'Too many requests. Please try again later.' }, 429, corsHeaders);
          rateData.count++;
          await putToCache(env, 'CACHE', rateKey, JSON.stringify(rateData), { expirationTtl: 3600 });
        } else {
          await putToCache(env, 'CACHE', rateKey, JSON.stringify({ count: 1, reset: now + 3600000 }), { expirationTtl: 3600 });
        }

        const id = crypto.randomUUID();
        const entry = { id, name, email, created: new Date().toISOString(), status: 'pending' };
        await env.ACCESS_REQUESTS.put(`request:${id}`, JSON.stringify(entry));

        if (env.RESEND_API_KEY) {
          try {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: 'Well Done Streams <noreply@welldonestreams.com>',
                to: ['chanceweldon11@gmail.com'],
                subject: `New access request from ${name}`,
                html: `<p><strong>${name}</strong> (${email}) wants access to Plex.</p>
                       <p>Use the <a href="https://welldonestreams.com/admin.html">admin panel</a> to invite them.</p>`,
              }),
            });
          } catch (e) {}
        }

        if (env.DISCORD_WEBHOOK) {
          try {
            await fetch(env.DISCORD_WEBHOOK, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: `New access request from **${name}** (${email})` }),
            });
          } catch (e) {}
        }
        return text('You will be added within 24 hours.', 200, corsHeaders);
      }

      // ============ PUBLIC: RECENTLY ADDED (Tautulli pipeline) ============
      if (path === '/api/recent-push' && method === 'POST') {
        if ((request.headers.get('Authorization') || '') !== `Bearer ${env.TAUTULLI_PUSH_TOKEN}`)
          return json({ error: 'Unauthorized' }, 401, corsHeaders);
        let body;
        try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400, corsHeaders); }
        const title = dedupeTitle((body.title || '').toString());
        if (!title) return json({ error: 'title is required.' }, 400, corsHeaders);
        const type = (body.type || '').toString().toLowerCase() === 'movie' ? 'Movie' : 'Show';
        let poster = (body.poster_url || '').toString().trim();
        const tmdbId = (body.tmdb_id || '').toString().trim();
        if (!poster && tmdbId && env.TMDB_API_KEY) {
          poster = await tmdbPosterById(tmdbId, type, env.TMDB_API_KEY);
        }

        const current = (await getFromCache(env, 'CACHE', 'recently_added', 'json')) || [];
        const filtered = current.filter((i) => i.title.toLowerCase() !== title.toLowerCase());
        const updated = [{ title, type, poster, added: Date.now() }, ...filtered].slice(0, RECENT_MAX);
        await putToCache(env, 'CACHE', 'recently_added', JSON.stringify(updated));
        return text('ok', 200, corsHeaders);
      }

      if (path === '/api/recent' && method === 'GET') {
        const items = (await getFromCache(env, 'CACHE', 'recently_added', 'json')) || [];
        return json(items.map((i) => ({ ...i, title: dedupeTitle(i.title) })), 200, corsHeaders);
      }

      // ============ PUBLIC: POLL ============
      if (path === '/api/poll' && method === 'GET') {
        const options = (await getFromCache(env, 'POLL_DATA', 'options', 'json')) || [];
        const counts = (await getFromCache(env, 'POLL_DATA', 'counts', 'json')) || {};
        const version = (await getFromCache(env, 'POLL_DATA', 'version')) || '0';
        return json({ options, counts, version }, 200, corsHeaders);
      }

      if (path === '/api/vote' && method === 'POST') {
        const { option } = await request.json();
        if (!option) return json({ error: 'No option selected.' }, 400, corsHeaders);
        const options = await getFromCache(env, 'POLL_DATA', 'options', 'json');
        if (!options || !options.find((o) => (o.name || o) === option))
          return json({ error: 'That option is not on the current poll.' }, 400, corsHeaders);
        const version = (await getFromCache(env, 'POLL_DATA', 'version')) || '0';
        const cookie = request.headers.get('cookie') || '';
        if (cookie.includes(`pollvote_v${version}=`)) return json({ error: 'You already voted on this poll. Thanks!' }, 429, corsHeaders);
        const counts = (await getFromCache(env, 'POLL_DATA', 'counts', 'json')) || {};
        counts[option] = (counts[option] || 0) + 1;
        await putToCache(env, 'POLL_DATA', 'counts', JSON.stringify(counts));
        const cookieVal = `pollvote_v${version}=${encodeURIComponent(option)}; Max-Age=31536000; Path=/; Secure; SameSite=Lax`;
        return new Response('Vote recorded!', {
          status: 200,
          headers: { 'Content-Type': 'text/plain', 'Set-Cookie': cookieVal, ...corsHeaders },
        });
      }

      // ============ PUBLIC: SEERR REQUEST STATUS ============
      if (path === '/api/request-status' && method === 'GET') {
        const email = url.searchParams.get('email');
        if (!email) return json({ error: 'Email is required.' }, 400, corsHeaders);
        if (!env.SEERR_URL || !env.SEERR_API_KEY) return json({ error: 'Request status is not configured.' }, 500, corsHeaders);
        const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
        const limitKey = `rate:status:${clientIP}`;
        const current = await getFromCache(env, 'CACHE', limitKey, 'json');
        if (current && current.count >= 5) return json({ error: 'Too many lookups. Try again in a minute.' }, 429, corsHeaders);
        await putToCache(env, 'CACHE', limitKey, JSON.stringify({ count: (current?.count || 0) + 1 }), { expirationTtl: 60 });
        try {
          const res = await fetch(`${env.SEERR_URL}/api/v1/request?take=200&skip=0&sort=modified`, {
            headers: { 'X-Api-Key': env.SEERR_API_KEY, 'Content-Type': 'application/json' },
          });
          if (!res.ok) return json({ error: 'Could not reach the request server.' }, 502, corsHeaders);
          const data = await res.json();
          const wanted = email.toLowerCase();
          const mine = (data.results || [])
            .filter((r) => {
              const e = r.requestedBy?.email || r.requestedBy?.plexUsername || '';
              return String(e).toLowerCase() === wanted;
            })
            .map((r) => ({
              title: getMediaTitle(r.media, r.type),
              status: mapSeerrStatus(r.status),
              type: r.type === 'movie' ? 'Movie' : 'Show',
            }));
          return json({ requests: mine }, 200, corsHeaders);
        } catch (e) {
          return json({ error: 'Could not reach the request server.' }, 502, corsHeaders);
        }
      }

      // ============ HOMEPAGE WIDGET (Bearer HOMEPAGE_TOKEN) ============
      if (path === '/api/requests' && method === 'GET') {
        if ((request.headers.get('Authorization') || '') !== `Bearer ${env.HOMEPAGE_TOKEN}`)
          return json({ error: 'Unauthorized' }, 401, corsHeaders);
        const list = await listWithCache(env, 'ACCESS_REQUESTS', { prefix: 'request:' });
        const pending = [];
        for (const key of list.keys) {
          const entry = await env.ACCESS_REQUESTS.get(key.name, 'json');
          if (entry && entry.status === 'pending') {
            pending.push({ name: entry.name, email: String(entry.email).replace(/(.{2}).+(?=@)/, '$1***'), created: entry.created });
          }
        }
        pending.sort((a, b) => new Date(b.created) - new Date(a.created));
        return json({ count: pending.length, pending: pending.slice(0, 10) }, 200, corsHeaders);
      }

      // ============ CASINO API (fake chips) ============
      if (path.startsWith('/api/casino/')) {
        const userId = url.searchParams.get('user') || request.headers.get('x-user-id') || 'default-user';
        const action = path.split('/api/casino/')[1];
        const userKey = `casino:${userId}`;

        let userData = (await getFromCache(env, 'CACHE', userKey, 'json')) || {};
        // FIX: typeof check — a balance of 0 must stay 0, not refill
        if (typeof userData.balance !== 'number' || !Number.isFinite(userData.balance)) userData.balance = CASINO_START;
        if (typeof userData.lastClaim !== 'string') userData.lastClaim = '';
        if (typeof userData.triviaStreak !== 'number') userData.triviaStreak = 0;
        if (typeof userData.triviaPot !== 'number') userData.triviaPot = 0;

        const nowDate = new Date().toISOString().split('T')[0];

        if (action === 'balance' && method === 'GET') {
          return json({ balance: userData.balance }, 200, corsHeaders);
        }

        if (action === 'claim' && method === 'POST') {
          if (userData.lastClaim === nowDate) {
            return json({ error: 'Already claimed your daily chips today.' }, 400, corsHeaders);
          }
          userData.balance += CASINO_DAILY;
          userData.lastClaim = nowDate;
          await putToCache(env, 'CACHE', userKey, JSON.stringify(userData));
          return json({ reward: CASINO_DAILY, balance: userData.balance }, 200, corsHeaders);
        }

        // ---- Trivia "Brain Bets": double-or-nothing pot. Correct answers BANK into a pot;
        // cash out anytime, but a wrong answer, timeout, or skip forfeits the whole pot.
        // Free to play — this is the broke-player comeback path. 10s server-enforced clock.
        if (action === 'trivia-question' && method === 'GET') {
          const pendingKey = `trivia:${userId}`;
          const pending = await getFromCache(env, 'CACHE', pendingKey, 'json');
          if (pending) {
            // Abandoning an unanswered question forfeits the pot (blocks skip-cheesing hard ones)
            userData.triviaStreak = 0;
            userData.triviaPot = 0;
            await putToCache(env, 'CACHE', userKey, JSON.stringify(userData));
            await deleteFromCache(env, 'CACHE', pendingKey);
          }
          const picked = pickTriviaQuestion();
          await putToCache(env, 'CACHE', pendingKey, JSON.stringify({ a: picked.a, t: Date.now() }), { expirationTtl: 90 });
          return json({ question: picked.q, seconds: 10, streak: userData.triviaStreak, pot: userData.triviaPot }, 200, corsHeaders);
        }

        if (action === 'trivia-answer' && method === 'POST') {
          let body;
          try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400, corsHeaders); }
          const pendingKey = `trivia:${userId}`;
          const pending = await getFromCache(env, 'CACHE', pendingKey, 'json');
          await deleteFromCache(env, 'CACHE', pendingKey);

          const forfeit = async () => {
            const lostPot = userData.triviaPot;
            userData.triviaStreak = 0;
            userData.triviaPot = 0;
            await putToCache(env, 'CACHE', userKey, JSON.stringify(userData));
            return lostPot;
          };

          if (!pending) {
            const lostPot = await forfeit();
            return json({ correct: false, timeout: true, lostPot, pot: 0, streak: 0, newBalance: userData.balance, message: 'No active question — grab a new one.' }, 200, corsHeaders);
          }
          if (Date.now() - pending.t > 11000) { // 10s + 1s network grace
            const lostPot = await forfeit();
            return json({ correct: false, timeout: true, answer: pending.a[0], lostPot, pot: 0, streak: 0, newBalance: userData.balance, message: "Time's up!" }, 200, corsHeaders);
          }

          if (answerMatches(body.answer, pending.a)) {
            userData.triviaStreak += 1;
            const reward = Math.min(Math.round(500 * Math.pow(1.5, userData.triviaStreak - 1)), 100000);
            userData.triviaPot += reward;
            await putToCache(env, 'CACHE', userKey, JSON.stringify(userData));
            return json({ correct: true, reward, pot: userData.triviaPot, streak: userData.triviaStreak, newBalance: userData.balance }, 200, corsHeaders);
          } else {
            const lostPot = await forfeit();
            return json({ correct: false, answer: pending.a[0], lostPot, pot: 0, streak: 0, newBalance: userData.balance }, 200, corsHeaders);
          }
        }

        if (action === 'trivia-cashout' && method === 'POST') {
          const amount = userData.triviaPot;
          if (amount <= 0) return json({ error: 'No pot to cash out.' }, 400, corsHeaders);
          userData.balance += amount;
          userData.triviaPot = 0;
          userData.triviaStreak = 0;
          await putToCache(env, 'CACHE', userKey, JSON.stringify(userData));
          // also clear any pending question so cashing out doesn't leave a skip-trap behind
          await deleteFromCache(env, 'CACHE', `trivia:${userId}`);
          return json({ cashedOut: amount, newBalance: userData.balance }, 200, corsHeaders);
        }

        if (action === 'play' && method === 'POST') {
          let body;
          try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400, corsHeaders); }
          const { game, choice, action: bjAction, playerCards, dealerCards } = body;
          const bet = Number(body.bet);

          let result = '';
          let win = 0;

          switch (game) {
            case 'roulette': {
              // FIX: validate the actual stake — roulette sends a bets[] array, not `bet`
              const bets = Array.isArray(body.bets) ? body.bets.filter((b) => b && Number(b.amt) > 0) : [];
              const stake = bets.reduce((s, b) => s + Number(b.amt), 0);
              if (stake <= 0) return json({ error: 'No valid bets placed.' }, 400, corsHeaders);
              if (stake > userData.balance) return json({ error: 'Not enough chips for all bets.' }, 400, corsHeaders);

              const spin = Math.floor(Math.random() * 37);
              const redNums = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
              const spinColor = spin === 0 ? 'green' : (redNums.includes(spin) ? 'red' : 'black');
              let netWin = 0;

              for (const b of bets) {
                const amt = Number(b.amt);
                let isWin = false;
                let mult = 0;
                if (b.choice === 'number' && Number(b.number) === spin) { isWin = true; mult = 35; }
                else if (b.choice === spinColor) { isWin = true; mult = 1; }
                else if (b.choice === 'even' && spin !== 0 && spin % 2 === 0) { isWin = true; mult = 1; }
                else if (b.choice === 'odd' && spin !== 0 && spin % 2 !== 0) { isWin = true; mult = 1; }
                else if (b.choice === '1-18' && spin >= 1 && spin <= 18) { isWin = true; mult = 1; }
                else if (b.choice === '19-36' && spin >= 19 && spin <= 36) { isWin = true; mult = 1; }
                else if (b.choice === '1-12' && spin >= 1 && spin <= 12) { isWin = true; mult = 2; }
                else if (b.choice === '13-24' && spin >= 13 && spin <= 24) { isWin = true; mult = 2; }
                else if (b.choice === '25-36' && spin >= 25 && spin <= 36) { isWin = true; mult = 2; }
                else if (b.choice === 'col1' && spin !== 0 && spin % 3 === 1) { isWin = true; mult = 2; }
                else if (b.choice === 'col2' && spin !== 0 && spin % 3 === 2) { isWin = true; mult = 2; }
                else if (b.choice === 'col3' && spin !== 0 && spin % 3 === 0) { isWin = true; mult = 2; }

                if (isWin) netWin += amt * mult;
                else netWin -= amt;
              }
              win = netWin;
              result = `Landed on ${spin} (${spinColor}). You ${netWin >= 0 ? 'won' : 'lost'} ${Math.abs(netWin)} chips.`;
              // extra fields so the frontend can animate to the real pocket
              userData.balance += win;
              await putToCache(env, 'CACHE', userKey, JSON.stringify(userData));
              return json({ result, spin, spinColor, netWin, newBalance: userData.balance, game: 'roulette' }, 200, corsHeaders);
            }

            case 'coinflip': {
              if (!Number.isFinite(bet) || bet <= 0) return json({ error: 'Invalid bet.' }, 400, corsHeaders);
              if (bet > userData.balance) return json({ error: 'Not enough chips.' }, 400, corsHeaders);
              const flip = Math.random() < 0.5 ? 'heads' : 'tails';
              win = flip === choice ? bet : -bet;
              result = `It's ${flip}! You ${win >= 0 ? 'won' : 'lost'} ${Math.abs(win)} chips.`;
              userData.balance += win;
              await putToCache(env, 'CACHE', userKey, JSON.stringify(userData));
              return json({ result, flip, newBalance: userData.balance, game: 'coinflip' }, 200, corsHeaders);
            }

            case 'slots': {
              if (!Number.isFinite(bet) || bet <= 0) return json({ error: 'Invalid bet.' }, 400, corsHeaders);
              if (bet > userData.balance) return json({ error: 'Not enough chips.' }, 400, corsHeaders);
              // 3x3 grid, 5 paylines (3 rows + 2 diagonals). grid[col][row]
              const grid = [0,1,2].map(() => [0,1,2].map(() => symbols[Math.floor(Math.random() * symbols.length)]));
              const LINES = [
                { name: 'Top row',    cells: [[0,0],[1,0],[2,0]] },
                { name: 'Middle row', cells: [[0,1],[1,1],[2,1]] },
                { name: 'Bottom row', cells: [[0,2],[1,2],[2,2]] },
                { name: 'Diagonal \\', cells: [[0,0],[1,1],[2,2]] },
                { name: 'Diagonal /',  cells: [[0,2],[1,1],[2,0]] },
              ];
              const PREMIUM = ['7\uFE0F\u20E3', '\u{1F48E}'];
              let gross = 0;
              const hits = [];
              LINES.forEach((ln, li) => {
                const s = ln.cells.map(([c, r]) => grid[c][r]);
                if (s[0] === s[1] && s[1] === s[2]) {
                  const mult = PREMIUM.includes(s[0]) ? 12 : 6;
                  gross += bet * mult;
                  hits.push({ line: li, name: ln.name, sym: s[0], kind: 3, mult });
                } else if (s[0] === s[1]) {
                  gross += bet * 0.4;
                  hits.push({ line: li, name: ln.name, sym: s[0], kind: 2, mult: 0.4 });
                }
              });
              gross = Math.round(gross);
              win = gross - bet;
              if (hits.length === 0) result = `No match — you lost ${bet} chips.`;
              else if (win >= 0) result = `${hits.length} winning line${hits.length > 1 ? 's' : ''}! You won ${win} chips.`;
              else result = `${hits.length} small hit — back ${gross}, net ${win} chips.`;
              userData.balance += win;
              await putToCache(env, 'CACHE', userKey, JSON.stringify(userData));
              return json({ result, grid, hits, gross, win, newBalance: userData.balance, game: 'slots' }, 200, corsHeaders);
            }

            case 'craps': {
              // Pass line. Entire hand resolved server-side; frontend animates the roll sequence.
              if (!Number.isFinite(bet) || bet <= 0) return json({ error: 'Invalid bet.' }, 400, corsHeaders);
              if (bet > userData.balance) return json({ error: 'Not enough chips.' }, 400, corsHeaders);
              const roll = () => { const a = 1 + Math.floor(Math.random() * 6), b = 1 + Math.floor(Math.random() * 6); return { a, b, t: a + b }; };
              const rolls = [];
              let point = null, won = null;
              const come = roll(); rolls.push(come);
              if (come.t === 7 || come.t === 11) won = true;
              else if (come.t === 2 || come.t === 3 || come.t === 12) won = false;
              else {
                point = come.t;
                for (let i = 0; i < 200 && won === null; i++) {
                  const r = roll(); rolls.push(r);
                  if (r.t === point) won = true;
                  else if (r.t === 7) won = false;
                }
                if (won === null) won = false;
              }
              win = won ? bet : -bet;
              result = point
                ? (won ? `Point was ${point} — you hit it! +${bet} chips.` : `Point was ${point} — seven out. -${bet} chips.`)
                : (won ? `Natural ${come.t}! +${bet} chips.` : `Craps ${come.t}. -${bet} chips.`);
              userData.balance += win;
              await putToCache(env, 'CACHE', userKey, JSON.stringify(userData));
              return json({ result, rolls, point, won, win, newBalance: userData.balance, game: 'craps' }, 200, corsHeaders);
            }

            case 'baccarat': {
              // choice: 'player' | 'banker' | 'tie'. Standard punto banco drawing rules.
              if (!Number.isFinite(bet) || bet <= 0) return json({ error: 'Invalid bet.' }, 400, corsHeaders);
              if (bet > userData.balance) return json({ error: 'Not enough chips.' }, 400, corsHeaders);
              if (!['player', 'banker', 'tie'].includes(choice)) return json({ error: 'Pick player, banker, or tie.' }, 400, corsHeaders);
              const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
              const SUITS = ['\u2665','\u2666','\u2663','\u2660'];
              const draw = () => { const v = RANKS[Math.floor(Math.random() * 13)]; const s = SUITS[Math.floor(Math.random() * 4)]; return { v, s, red: s === '\u2665' || s === '\u2666' }; };
              const pip = (c) => (c.v === 'A' ? 1 : (['10','J','Q','K'].includes(c.v) ? 0 : parseInt(c.v)));
              const tot = (cs) => cs.reduce((a, c) => a + pip(c), 0) % 10;
              const P = [draw(), draw()], B = [draw(), draw()];
              let pThird = null;
              if (tot(P) <= 7 && tot(B) <= 7) {
                if (tot(P) <= 5) { pThird = draw(); P.push(pThird); }
                const bt = tot(B);
                let bDraws = false;
                if (pThird === null) bDraws = bt <= 5;
                else {
                  const p3 = pip(pThird);
                  if (bt <= 2) bDraws = true;
                  else if (bt === 3) bDraws = p3 !== 8;
                  else if (bt === 4) bDraws = p3 >= 2 && p3 <= 7;
                  else if (bt === 5) bDraws = p3 >= 4 && p3 <= 7;
                  else if (bt === 6) bDraws = p3 === 6 || p3 === 7;
                }
                if (bDraws) B.push(draw());
              }
              const pt = tot(P), bt2 = tot(B);
              const outcome = pt > bt2 ? 'player' : (bt2 > pt ? 'banker' : 'tie');
              if (choice === outcome) {
                if (outcome === 'tie') win = bet * 8;
                else if (outcome === 'banker') win = Math.round(bet * 0.95);
                else win = bet;
              } else if (outcome === 'tie') {
                win = 0; // bets on player/banker push on a tie
              } else {
                win = -bet;
              }
              result = `Player ${pt} \u2014 Banker ${bt2}. ${outcome.toUpperCase()} wins. ${win > 0 ? '+' + win : win} chips.`;
              userData.balance += win;
              await putToCache(env, 'CACHE', userKey, JSON.stringify(userData));
              return json({ result, playerCards: P, bankerCards: B, playerTotal: pt, bankerTotal: bt2, outcome, win, newBalance: userData.balance, game: 'baccarat' }, 200, corsHeaders);
            }

            case 'blackjack': {
              // Blackjack logic runs client-side; the client reports the net result.
              // FIX: validate it's a real number and clamp losses to the balance.
              if (!Number.isFinite(Number(body.netWin))) return json({ error: 'Invalid payload.' }, 400, corsHeaders);
              win = Number(body.netWin);
              if (win < 0 && Math.abs(win) > userData.balance) win = -userData.balance;
              result = body.resultMsg || (win >= 0 ? `You won ${win} chips.` : `You lost ${Math.abs(win)} chips.`);
              userData.balance += win;
              await putToCache(env, 'CACHE', userKey, JSON.stringify(userData));
              const response = { result, newBalance: userData.balance, game: 'blackjack' };
              response.playerCards = playerCards;
              response.dealerCards = dealerCards;
              if (bjAction === 'stand' || (bjAction === 'hit' && win < 0)) response.gameOver = true;
              return json(response, 200, corsHeaders);
            }

            default:
              return json({ error: 'Unknown game.' }, 400, corsHeaders);
          }
        }

        return json({ error: 'Endpoint not found.' }, 404, corsHeaders);
      }

      // ============ ADMIN: POLL ============
      if (path === '/api/poll/admin' && method === 'PUT') {
        if (!isAdmin()) return json({ error: 'Forbidden.' }, 403, corsHeaders);
        const { options } = await request.json();
        if (!Array.isArray(options) || options.length === 0) return json({ error: 'options must be a non-empty array.' }, 400, corsHeaders);
        const normalized = options.map((opt) => (typeof opt === 'string' ? { name: opt, poster: null } : opt));
        await putToCache(env, 'POLL_DATA', 'options', JSON.stringify(normalized));
        const counts = {};
        normalized.forEach((o) => { counts[o.name] = 0; });
        await putToCache(env, 'POLL_DATA', 'counts', JSON.stringify(counts));
        const curV = parseInt((await getFromCache(env, 'POLL_DATA', 'version')) || '0', 10);
        await putToCache(env, 'POLL_DATA', 'version', String(curV + 1));
        return text('Poll updated.', 200, corsHeaders);
      }

      if (path === '/api/admin/set-votes' && method === 'POST') {
        if (!isAdmin()) return json({ error: 'Unauthorized' }, 401, corsHeaders);
        const { name, count } = await request.json();
        if (!name || typeof count !== 'number' || count < 0) return json({ error: 'name and non-negative count required.' }, 400, corsHeaders);
        const counts = (await getFromCache(env, 'POLL_DATA', 'counts', 'json')) || {};
        counts[name] = Math.floor(count);
        await putToCache(env, 'POLL_DATA', 'counts', JSON.stringify(counts));
        return json({ ok: true, name, count: counts[name] }, 200, corsHeaders);
      }

      if (path === '/api/poll/lookup' && method === 'POST') {
        if (!isAdmin()) return json({ error: 'Unauthorized' }, 401, corsHeaders);
        const { query } = await request.json();
        if (!query) return json({ error: 'Query required.' }, 400, corsHeaders);
        if (!env.TMDB_API_KEY) return json({ error: 'TMDb not configured.' }, 500, corsHeaders);
        try {
          let title, poster;
          const movieMatch = query.match(/themoviedb\.org\/movie\/(\d+)/);
          const tvMatch = query.match(/themoviedb\.org\/tv\/(\d+)/);
          if (movieMatch) {
            const res = await fetch(`https://api.themoviedb.org/3/movie/${movieMatch[1]}?api_key=${env.TMDB_API_KEY}`);
            if (res.ok) {
              const data = await res.json();
              title = data.title;
              poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null;
            }
          } else if (tvMatch) {
            const res = await fetch(`https://api.themoviedb.org/3/tv/${tvMatch[1]}?api_key=${env.TMDB_API_KEY}`);
            if (res.ok) {
              const data = await res.json();
              title = data.name;
              poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null;
            }
          } else {
            const movieSearch = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}`);
            const movieData = await movieSearch.json();
            if (movieData.results && movieData.results.length > 0) {
              title = movieData.results[0].title;
              poster = movieData.results[0].poster_path ? `https://image.tmdb.org/t/p/w500${movieData.results[0].poster_path}` : null;
            } else {
              const tvSearch = await fetch(`https://api.themoviedb.org/3/search/tv?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}`);
              const tvData = await tvSearch.json();
              if (tvData.results && tvData.results.length > 0) {
                title = tvData.results[0].name;
                poster = tvData.results[0].poster_path ? `https://image.tmdb.org/t/p/w500${tvData.results[0].poster_path}` : null;
              }
            }
          }
          if (!title) return json({ error: 'No results found.' }, 404, corsHeaders);
          return json({ name: title, poster }, 200, corsHeaders);
        } catch (e) {
          return json({ error: 'TMDb lookup failed.' }, 502, corsHeaders);
        }
      }

      // ============ ADMIN: ACCESS REQUESTS ============
      if (path === '/api/admin/pending' && method === 'GET') {
        if (!isAdmin()) return json({ error: 'Unauthorized' }, 401, corsHeaders);
        const list = await listWithCache(env, 'ACCESS_REQUESTS', { prefix: 'request:' });
        const pending = [];
        for (const key of list.keys) {
          const entry = await env.ACCESS_REQUESTS.get(key.name, 'json');
          if (entry && entry.status === 'pending') {
            pending.push({ id: entry.id, name: entry.name, email: entry.email, created: entry.created });
          }
        }
        pending.sort((a, b) => new Date(b.created) - new Date(a.created));
        return json({ pending }, 200, corsHeaders);
      }

      if (path === '/api/admin/invite' && method === 'POST') {
        if (!isAdmin()) return json({ error: 'Unauthorized' }, 401, corsHeaders);
        let body;
        try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400, corsHeaders); }
        const email = (body.email || '').toString().trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Valid email required.' }, 400, corsHeaders);
        if (!env.PLEX_TOKEN || !env.PLEX_MACHINE_ID) return json({ error: 'Plex not configured on the server.' }, 500, corsHeaders);
        const clientId = env.PLEX_CLIENT_ID || 'welldonestreams-admin';
        const plexUrl = `https://plex.tv/api/v2/shared_servers?X-Plex-Client-Identifier=${encodeURIComponent(clientId)}&X-Plex-Token=${encodeURIComponent(env.PLEX_TOKEN)}`;
        const plexBody = {
          machineIdentifier: env.PLEX_MACHINE_ID,
          invitedEmail: email,
          librarySectionIds: [],
          settings: { allowSync: '1', allowChannels: '0', allowTuners: '0' },
        };
        let plexRes, plexText;
        try {
          plexRes = await fetch(plexUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(plexBody),
          });
          plexText = await plexRes.text();
        } catch (e) {
          return json({ error: 'Could not reach Plex: ' + e.message }, 502, corsHeaders);
        }
        if (plexRes.status === 422) {
          if (body.id) await markInvited(env, body.id);
          return json({ ok: true, already: true, message: 'Already shared with that account.' }, 200, corsHeaders);
        }
        if (!plexRes.ok) {
          return json({ error: `Plex returned ${plexRes.status}: ${plexText.slice(0, 300)}` }, 502, corsHeaders);
        }
        if (body.id) await markInvited(env, body.id);
        return json({ ok: true, message: 'Invite sent!' }, 200, corsHeaders);
      }

      if (path === '/api/admin/dismiss' && method === 'POST') {
        if (!isAdmin()) return json({ error: 'Unauthorized' }, 401, corsHeaders);
        const { id } = await request.json();
        if (!id) return json({ error: 'id required.' }, 400, corsHeaders);
        await env.ACCESS_REQUESTS.delete(`request:${id}`);
        return json({ ok: true }, 200, corsHeaders);
      }

      return json({ error: 'Not found.' }, 404, corsHeaders);
    } catch (e) {
      return json({ error: 'Server error: ' + e.message }, 500, corsHeaders);
    }
  },
};
