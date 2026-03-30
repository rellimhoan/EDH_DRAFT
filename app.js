// ===== MTG Commander Viewer — app.js =====

const SCRYFALL_SETS_URL = 'https://api.scryfall.com/sets';
const SCRYFALL_SEARCH_URL = 'https://api.scryfall.com/cards/search';

// Set types we care about (skip tokens, promos, etc.)
const ALLOWED_SET_TYPES = new Set([
  'core',
  'expansion',
  'masters',
  'draft_innovation',
  'commander',
  'funny',
]);

// Cache of fetched commanders per set code
const commanderCache = {};

// Rate-limit helper — Scryfall asks for 50-100ms between requests
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequestTime = 0;

async function scryfallFetch(url) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 100) {
    await delay(100 - elapsed);
  }
  lastRequestTime = Date.now();
  const res = await fetch(url);
  if (res.status === 404) return null; // no results
  if (!res.ok) throw new Error(`Scryfall error: ${res.status}`);
  return res.json();
}

// ===== Fetch all sets, filter & sort =====
async function loadSets() {
  const data = await scryfallFetch(SCRYFALL_SETS_URL);
  if (!data || !data.data) return [];

  return data.data
    .filter((s) => ALLOWED_SET_TYPES.has(s.set_type) && !s.digital)
    .sort((a, b) => new Date(a.released_at) - new Date(b.released_at));
}

// ===== Fetch commanders for a set (with pagination) =====
async function fetchCommanders(setCode) {
  if (commanderCache[setCode]) return commanderCache[setCode];

  const cards = [];
  let url = `${SCRYFALL_SEARCH_URL}?q=t%3Alegendary+t%3Acreature+set%3A${encodeURIComponent(setCode)}&order=name&unique=cards`;

  try {
    while (url) {
      const data = await scryfallFetch(url);
      if (!data) break;
      cards.push(...data.data);
      url = data.has_more ? data.next_page : null;
    }
  } catch (e) {
    // 404 == no results, anything else log
    if (!e.message.includes('404')) console.warn(`Error fetching commanders for ${setCode}:`, e);
  }

  commanderCache[setCode] = cards;
  return cards;
}

// ===== SVG chevron icon =====
function chevronSVG() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('set-chevron');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
  return svg;
}

// ===== Format release date =====
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ===== Get best image URI from a card =====
function getCardImage(card) {
  if (card.image_uris && card.image_uris.normal) return card.image_uris.normal;
  // Double-faced cards store images on card_faces
  if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
    return card.card_faces[0].image_uris.normal;
  }
  return null;
}

// ===== Build a single set section =====
function createSetSection(set) {
  const section = document.createElement('div');
  section.className = 'set-section';
  section.id = `set-${set.code}`;

  // Header
  const header = document.createElement('div');
  header.className = 'set-header';

  const left = document.createElement('div');
  left.className = 'set-header-left';

  // Set icon
  if (set.icon_svg_uri) {
    const icon = document.createElement('img');
    icon.className = 'set-icon';
    icon.src = set.icon_svg_uri;
    icon.alt = '';
    icon.loading = 'lazy';
    left.appendChild(icon);
  }

  const name = document.createElement('span');
  name.className = 'set-name';
  name.textContent = set.name;
  left.appendChild(name);

  const date = document.createElement('span');
  date.className = 'set-date';
  date.textContent = `(${formatDate(set.released_at)})`;
  left.appendChild(date);

  // Commander count badge (shown after fetch)
  const badge = document.createElement('span');
  badge.className = 'commander-count';
  badge.dataset.setCode = set.code;
  left.appendChild(badge);

  header.appendChild(left);

  // Chevron
  header.appendChild(chevronSVG());

  section.appendChild(header);

  // Body (collapsible)
  const body = document.createElement('div');
  body.className = 'set-body';
  const inner = document.createElement('div');
  inner.className = 'set-body-inner';
  body.appendChild(inner);
  section.appendChild(body);

  // Click handler
  let fetched = false;
  header.addEventListener('click', async () => {
    const isOpen = section.classList.contains('open');

    if (isOpen) {
      // Collapse
      body.style.maxHeight = body.scrollHeight + 'px';
      requestAnimationFrame(() => {
        body.style.maxHeight = '0';
      });
      section.classList.remove('open');
      return;
    }

    // Expand
    section.classList.add('open');

    if (!fetched) {
      fetched = true;
      inner.innerHTML = `
        <div class="set-loading">
          <div class="spinner"></div>
          <span>Fetching commanders…</span>
        </div>`;
      body.style.maxHeight = body.scrollHeight + 'px';

      const cards = await fetchCommanders(set.code);
      renderCards(inner, cards);
      badge.textContent = cards.length;
      badge.classList.add('visible');
    }

    // Animate open
    body.style.maxHeight = body.scrollHeight + 'px';
    // After transition, allow natural height for dynamically loaded images
    const onEnd = () => {
      if (section.classList.contains('open')) {
        body.style.maxHeight = 'none';
      }
      body.removeEventListener('transitionend', onEnd);
    };
    body.addEventListener('transitionend', onEnd);
  });

  return section;
}

// ===== Render cards inside a set body =====
function renderCards(container, cards) {
  container.innerHTML = '';

  if (!cards || cards.length === 0) {
    container.innerHTML = '<p class="set-message">No legendary creatures found in this set.</p>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'card-grid';

  cards.forEach((card) => {
    const imgUrl = getCardImage(card);
    if (!imgUrl) return;

    const link = document.createElement('a');
    link.className = 'card-link';
    link.href = card.scryfall_uri;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = card.name;

    const img = document.createElement('img');
    img.src = imgUrl;
    img.alt = card.name;
    img.loading = 'lazy';

    link.appendChild(img);
    grid.appendChild(link);
  });

  container.appendChild(grid);
}

// ===== State =====
let allSets = [];
let sortAsc = true; // true = oldest first

// ===== Render sets into DOM =====
function renderSets() {
  const container = document.getElementById('sets-container');
  container.innerHTML = '';

  const sorted = [...allSets].sort((a, b) => {
    const diff = new Date(a.released_at) - new Date(b.released_at);
    return sortAsc ? diff : -diff;
  });

  const fragment = document.createDocumentFragment();
  sorted.forEach((set) => {
    fragment.appendChild(createSetSection(set));
  });
  container.appendChild(fragment);
}

// ===== Sort toggle =====
function initSortToggle() {
  const btn = document.getElementById('sort-toggle');
  if (!btn) return;

  btn.addEventListener('click', () => {
    sortAsc = !sortAsc;
    btn.classList.toggle('desc', !sortAsc);
    btn.querySelector('.sort-label').textContent = sortAsc ? 'Oldest First' : 'Newest First';
    renderSets();
  });
}

// ===== Init =====
async function init() {
  const spinner = document.getElementById('loading-spinner');
  const container = document.getElementById('sets-container');

  initSortToggle();

  try {
    const data = await scryfallFetch(SCRYFALL_SETS_URL);
    if (!data || !data.data) {
      spinner.classList.add('hidden');
      container.innerHTML = '<p class="set-message">No sets found.</p>';
      return;
    }

    allSets = data.data.filter((s) => ALLOWED_SET_TYPES.has(s.set_type) && !s.digital);
    spinner.classList.add('hidden');

    if (allSets.length === 0) {
      container.innerHTML = '<p class="set-message">No sets found.</p>';
      return;
    }

    renderSets();
  } catch (err) {
    spinner.classList.add('hidden');
    container.innerHTML = `<p class="set-message">Failed to load sets. Please try again later.<br><small>${err.message}</small></p>`;
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', init);
