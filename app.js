/**
 * Music Player — app.js
 * Features: IndexedDB local storage, audio playback, infinite play,
 *           live clock, sleep timer, drag-and-drop upload.
 */

'use strict';

/* ── IndexedDB ────────────────────────────────────────── */
const DB_NAME    = 'MusicPlayerDB';
const DB_VERSION = 1;
const STORE_NAME = 'tracks';

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        const store = d.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('addedAt', 'addedAt', { unique: false });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror   = (e) => reject(e.target.error);
  });
}

function dbSaveTrack(track) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).add(track);
    req.onsuccess = (e) => resolve(e.target.result); // returns new id
    req.onerror   = (e) => reject(e.target.error);
  });
}

function dbGetAllTracks() {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function dbDeleteTrack(id) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/* ── App State ────────────────────────────────────────── */
const state = {
  tracks:       [],
  currentIndex: -1,
  isPlaying:    false,
  isRepeat:     true,   // repeat-all by default → infinite play
  isShuffle:    false,
  volume:       1,
  currentView:  'library',
  timer: {
    endTime:    null,
    intervalId: null,
    minutes:    null,
  },
  blobUrls: {},        // id → objectURL cache
};

/* ── Audio Element ────────────────────────────────────── */
const audio = new Audio();
audio.preload = 'metadata';

audio.addEventListener('timeupdate',  onTimeUpdate);
audio.addEventListener('ended',       onTrackEnded);
audio.addEventListener('loadedmetadata', onMetadataLoaded);
audio.addEventListener('error',       onAudioError);
audio.addEventListener('play',        () => setPlayState(true));
audio.addEventListener('pause',       () => setPlayState(false));

/* ── DOM References ───────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const dom = {
  // Views
  viewLibrary:   $('view-library'),
  viewClock:     $('view-clock'),

  // Library
  tracksList:    $('tracks-list'),
  emptyState:    $('empty-state'),
  fileInput:     $('file-input'),

  // Player bar
  pbTrack:       $('pb-track'),
  pbArt:         $('pb-art'),
  pbName:        $('pb-name'),
  pbArtist:      $('pb-artist'),
  btnPlay:       $('btn-play'),
  btnPrev:       $('btn-prev'),
  btnNext:       $('btn-next'),
  btnShuffle:    $('btn-shuffle'),
  btnRepeat:     $('btn-repeat'),
  timeCur:       $('time-cur'),
  timeTot:       $('time-tot'),
  progressTrack: $('progress-track'),
  progressFill:  $('progress-fill'),
  progressThumb: $('progress-thumb'),
  pbClock:       $('pb-clock'),
  btnTimer:      $('btn-timer'),
  timerBadge:    $('timer-badge'),
  volumeSlider:  $('volume'),

  // Bottom nav
  bottomNav:     $('bottom-nav'),

  // Expanded player
  playerExpanded: $('player-expanded'),
  expArt:         $('exp-art'),
  expName:        $('exp-name'),
  expArtist:      $('exp-artist'),
  expBtnPlay:     $('exp-btn-play'),
  expBtnPrev:     $('exp-btn-prev'),
  expBtnNext:     $('exp-btn-next'),
  expBtnShuffle:  $('exp-btn-shuffle'),
  expBtnRepeat:   $('exp-btn-repeat'),
  expTimeCur:     $('exp-time-cur'),
  expTimeTot:     $('exp-time-tot'),
  expProgressTrack: $('exp-progress-track'),
  expProgressFill:  $('exp-progress-fill'),
  expProgressThumb: $('exp-progress-thumb'),
  expClose:       $('exp-close'),
  expClock:       $('exp-clock'),
  expBtnTimer:    $('exp-btn-timer'),
  expTimerBadge:  $('exp-timer-badge'),

  // Clock view
  clockBig:      $('clock-big'),
  clockDateBig:  $('clock-date-big'),
  clockNp:       $('clock-np'),

  // Sidebar clock
  sidebarTime:   $('sidebar-time'),
  sidebarDate:   $('sidebar-date'),

  // Timer modal
  timerOverlay:  $('timer-overlay'),
  timerClose:    $('timer-close'),
  timerPresets:  document.querySelectorAll('.timer-preset'),
  timerCustomIn: $('timer-custom-input'),
  btnSetCustom:  $('btn-set-custom'),
  timerRemaining:$('timer-remaining'),
  btnCancelTimer:$('btn-cancel-timer'),

  // Drop overlay
  dropOverlay:   $('drop-overlay'),
};

/* ── Clock ────────────────────────────────────────────── */
const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const DAYS_SHORT   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
                      'Jul','Aug','Sep','Oct','Nov','Dec'];

function pad(n) { return String(n).padStart(2, '0'); }

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${pad(s)}`;
}

function updateClock() {
  const now = new Date();
  const hh  = pad(now.getHours());
  const mm  = pad(now.getMinutes());
  const ss  = pad(now.getSeconds());
  const timeStr = `${hh}:${mm}:${ss}`;
  const miniStr = `${hh}:${mm}`;

  const dayName  = DAYS[now.getDay()];
  const monthAbb = MONTHS_SHORT[now.getMonth()];
  const dateStr  = `${dayName}, ${monthAbb} ${now.getDate()}`;
  const fullDate = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

  // Sidebar
  dom.sidebarTime.textContent = timeStr;
  dom.sidebarDate.textContent = dateStr;

  // Player bar mini clock
  dom.pbClock.textContent   = miniStr;
  dom.expClock.textContent  = miniStr;

  // Clock view
  dom.clockBig.textContent     = timeStr;
  dom.clockDateBig.textContent = fullDate;

  // Timer countdown
  if (state.timer.endTime) {
    const remaining = Math.max(0, state.timer.endTime - Date.now());
    if (remaining <= 0) {
      executeTimerStop();
    } else {
      updateTimerDisplay(remaining);
    }
  }
}

/* ── Views ────────────────────────────────────────────── */
function switchView(view) {
  state.currentView = view;

  // Main views
  dom.viewLibrary.classList.toggle('hidden', view !== 'library');
  dom.viewClock.classList.toggle('hidden',   view !== 'clock');

  // Player expanded (mobile)
  if (view === 'player') {
    dom.playerExpanded.classList.remove('hidden');
    updateExpandedPlayer();
  } else {
    dom.playerExpanded.classList.add('hidden');
  }

  // Update nav items (sidebar)
  document.querySelectorAll('.sidebar .nav-item').forEach(btn => {
    const v = btn.dataset.view;
    btn.classList.toggle('active', v === view || (v === 'library' && view === 'player'));
    btn.setAttribute('aria-current', btn.classList.contains('active') ? 'page' : 'false');
  });

  // Bottom nav
  document.querySelectorAll('.bnav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
}

/* ── Track Library ────────────────────────────────────── */
async function loadLibrary() {
  state.tracks = await dbGetAllTracks();
  renderTracks();
}

function renderTracks() {
  const { tracks, currentIndex, isPlaying } = state;

  if (tracks.length === 0) {
    dom.tracksList.innerHTML = '';
    dom.emptyState.classList.remove('hidden');
    updateNowPlayingClock('No track playing');
    return;
  }

  dom.emptyState.classList.add('hidden');

  dom.tracksList.innerHTML = tracks.map((t, i) => {
    const active  = i === currentIndex;
    const playing = active && isPlaying;
    return `
      <div class="track-item${active ? ' active' : ''}" data-index="${i}" role="listitem">
        <div class="ti-index">${i + 1}</div>
        <div class="ti-playing-anim${playing ? '' : ' paused'}">
          <span class="bar-anim"></span>
          <span class="bar-anim"></span>
          <span class="bar-anim"></span>
        </div>
        <div class="ti-art">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#b3b3b3" aria-hidden="true">
            <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
          </svg>
        </div>
        <div class="ti-meta">
          <div class="ti-name" title="${escHtml(t.name)}">${escHtml(t.name)}</div>
          <div class="ti-detail">${escHtml(t.artist || 'Unknown Artist')}</div>
        </div>
        <div class="ti-duration" data-id="${t.id}" data-dur="${t.duration || 0}">
          ${t.duration ? formatTime(t.duration) : '—'}
        </div>
        <div class="track-item-actions">
          <button class="ti-action-btn delete" data-id="${t.id}" data-index="${i}" aria-label="Delete ${escHtml(t.name)}" title="Delete">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── File Upload ──────────────────────────────────────── */
async function handleFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('audio/'));
  if (!files.length) { showToast('No audio files found'); return; }

  showToast(`Adding ${files.length} track${files.length > 1 ? 's' : ''}…`);

  for (const file of files) {
    try {
      const buf  = await file.arrayBuffer();
      const dur  = await getAudioDuration(file);
      const name = cleanFileName(file.name);
      const track = {
        name,
        artist:    '',
        type:      file.type,
        size:      file.size,
        duration:  dur,
        addedAt:   Date.now(),
        buffer:    buf,
      };
      const newId = await dbSaveTrack(track);
      track.id = newId;
      state.tracks.push(track);
    } catch (err) {
      console.warn('Failed to add track:', file.name, err);
    }
  }

  renderTracks();
  showToast(`Added ${files.length} track${files.length > 1 ? 's' : ''}`);
}

function cleanFileName(name) {
  return name
    .replace(/\.[^/.]+$/, '')       // remove extension
    .replace(/[-_]+/g, ' ')         // hyphens/underscores → spaces
    .replace(/\s{2,}/g, ' ')        // collapse multiple spaces
    .trim();
}

function getAudioDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a   = new Audio(url);
    a.addEventListener('loadedmetadata', () => {
      resolve(isFinite(a.duration) ? a.duration : 0);
      URL.revokeObjectURL(url);
    });
    a.addEventListener('error', () => { resolve(0); URL.revokeObjectURL(url); });
  });
}

/* ── Playback ─────────────────────────────────────────── */
function getBlobUrl(track) {
  if (!state.blobUrls[track.id]) {
    const blob = new Blob([track.buffer], { type: track.type });
    state.blobUrls[track.id] = URL.createObjectURL(blob);
  }
  return state.blobUrls[track.id];
}

function playTrack(index) {
  if (index < 0 || index >= state.tracks.length) return;

  const track = state.tracks[index];
  state.currentIndex = index;

  audio.src = getBlobUrl(track);
  audio.currentTime = 0;
  audio.play().catch(err => console.warn('Playback error:', err));

  updatePlayerUI();
}

function togglePlay() {
  if (state.tracks.length === 0) return;
  if (state.currentIndex < 0) { playTrack(0); return; }

  if (audio.paused) {
    audio.play().catch(err => console.warn('Playback error:', err));
  } else {
    audio.pause();
  }
}

function playNext() {
  if (state.tracks.length === 0) return;

  let next;
  if (state.isShuffle) {
    next = randomTrackIndex();
  } else {
    next = state.currentIndex + 1;
    if (next >= state.tracks.length) next = 0;
  }
  playTrack(next);
}

function playPrev() {
  if (state.tracks.length === 0) return;

  // If > 3 seconds into track, restart it; else go to previous
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  let prev;
  if (state.isShuffle) {
    prev = randomTrackIndex();
  } else {
    prev = state.currentIndex - 1;
    if (prev < 0) prev = state.tracks.length - 1;
  }
  playTrack(prev);
}

function randomTrackIndex() {
  if (state.tracks.length === 1) return 0;
  let idx;
  do { idx = Math.floor(Math.random() * state.tracks.length); }
  while (idx === state.currentIndex);
  return idx;
}

function onTrackEnded() {
  if (state.tracks.length === 0) return;

  if (state.isShuffle) {
    playTrack(randomTrackIndex());
  } else if (state.isRepeat) {
    // Repeat all — infinite play
    const next = (state.currentIndex + 1) % state.tracks.length;
    playTrack(next);
  }
  // If neither, just stop (no auto-advance)
}

function onMetadataLoaded() {
  if (isFinite(audio.duration)) {
    dom.timeTot.textContent    = formatTime(audio.duration);
    dom.expTimeTot.textContent = formatTime(audio.duration);
  }
}

function onAudioError() {
  console.warn('Audio error for track index', state.currentIndex);
  // Try next track on unrecoverable error
  if (state.tracks.length > 1) {
    setTimeout(playNext, 500);
  }
}

function onTimeUpdate() {
  const cur = audio.currentTime;
  const tot = audio.duration;

  dom.timeCur.textContent    = formatTime(cur);
  dom.expTimeCur.textContent = formatTime(cur);

  if (isFinite(tot) && tot > 0) {
    const pct = (cur / tot) * 100;
    setProgressFill(pct);
  }
}

function setProgressFill(pct) {
  pct = Math.max(0, Math.min(100, pct));
  dom.progressFill.style.width       = pct + '%';
  dom.expProgressFill.style.width    = pct + '%';
  dom.progressThumb.style.left       = pct + '%';
  dom.expProgressThumb.style.left    = pct + '%';
  dom.progressTrack.setAttribute('aria-valuenow', Math.round(pct));
  dom.expProgressTrack.setAttribute('aria-valuenow', Math.round(pct));
}

function seekFromEvent(e, trackEl) {
  const rect = trackEl.getBoundingClientRect();
  const x    = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const pct  = Math.max(0, Math.min(1, x / rect.width));
  if (isFinite(audio.duration)) {
    audio.currentTime = pct * audio.duration;
  }
}

function setPlayState(playing) {
  state.isPlaying = playing;
  renderTracks();
  updatePlayButtons(playing);
}

function updatePlayButtons(playing) {
  [dom.btnPlay, dom.expBtnPlay].forEach(btn => {
    btn.querySelector('.icon-play').classList.toggle('hidden', playing);
    btn.querySelector('.icon-pause').classList.toggle('hidden', !playing);
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  });
}

/* ── Player UI Updates ────────────────────────────────── */
function updatePlayerUI() {
  const track = state.tracks[state.currentIndex];
  if (!track) return;

  const name   = track.name || '—';
  const artist = track.artist || 'Unknown Artist';

  dom.pbName.textContent    = name;
  dom.pbArtist.textContent  = artist;
  dom.expName.textContent   = name;
  dom.expArtist.textContent = artist;

  dom.timeTot.textContent    = track.duration ? formatTime(track.duration) : '—';
  dom.expTimeTot.textContent = track.duration ? formatTime(track.duration) : '—';

  setProgressFill(0);
  dom.timeCur.textContent    = '0:00';
  dom.expTimeCur.textContent = '0:00';

  updateNowPlayingClock(name);
}

function updateExpandedPlayer() {
  if (state.currentIndex >= 0) {
    updatePlayerUI();
  }
  updatePlayButtons(state.isPlaying);
  updateRepeatButton();
  updateShuffleButton();
}

function updateNowPlayingClock(text) {
  dom.clockNp.textContent = state.isPlaying ? `♪  ${text}` : text;
}

function updateRepeatButton() {
  [dom.btnRepeat, dom.expBtnRepeat].forEach(btn => {
    btn.classList.toggle('active', state.isRepeat);
  });
}

function updateShuffleButton() {
  [dom.btnShuffle, dom.expBtnShuffle].forEach(btn => {
    btn.classList.toggle('active', state.isShuffle);
  });
}

/* ── Timer ────────────────────────────────────────────── */
function setTimer(minutes) {
  clearTimer();
  state.timer.minutes = minutes;
  state.timer.endTime = Date.now() + minutes * 60 * 1000;
  showTimerBadge(true);
  updateTimerDisplay(minutes * 60 * 1000);
  highlightSelectedPreset(minutes);
}

function clearTimer() {
  state.timer.endTime  = null;
  state.timer.minutes  = null;
  showTimerBadge(false);
  dom.timerRemaining.textContent = '—';
  document.querySelectorAll('.timer-preset').forEach(b => b.classList.remove('selected'));
}

function executeTimerStop() {
  audio.pause();
  clearTimer();
  showToast('Sleep timer — music stopped');
}

function updateTimerDisplay(remainingMs) {
  const totalSec = Math.ceil(remainingMs / 1000);
  const h   = Math.floor(totalSec / 3600);
  const m   = Math.floor((totalSec % 3600) / 60);
  const s   = totalSec % 60;
  dom.timerRemaining.textContent = h > 0
    ? `${h}:${pad(m)}:${pad(s)}`
    : `${m}:${pad(s)}`;
}

function showTimerBadge(show) {
  dom.timerBadge.classList.toggle('hidden', !show);
  dom.expTimerBadge.classList.toggle('hidden', !show);
}

function highlightSelectedPreset(minutes) {
  document.querySelectorAll('.timer-preset').forEach(b => {
    b.classList.toggle('selected', parseInt(b.dataset.min, 10) === minutes);
  });
}

/* ── Toast ────────────────────────────────────────────── */
function showToast(msg, duration = 2500) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/* ── Seek drag helpers ────────────────────────────────── */
function attachSeek(trackEl, progressFillEl, progressThumbEl, timeCurEl) {
  let dragging = false;

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const rect = trackEl.getBoundingClientRect();
    const x    = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const pct  = Math.max(0, Math.min(1, x / rect.width));
    progressFillEl.style.width  = (pct * 100) + '%';
    progressThumbEl.style.left  = (pct * 100) + '%';
    if (timeCurEl && isFinite(audio.duration)) {
      timeCurEl.textContent = formatTime(pct * audio.duration);
    }
  }

  function onEnd(e) {
    if (!dragging) return;
    dragging = false;
    const rect = trackEl.getBoundingClientRect();
    const x    = (e.changedTouches ? e.changedTouches[0].clientX : e.clientX) - rect.left;
    const pct  = Math.max(0, Math.min(1, x / rect.width));
    if (isFinite(audio.duration)) {
      audio.currentTime = pct * audio.duration;
    }
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend',  onEnd);
  }

  trackEl.addEventListener('mousedown', (e) => {
    dragging = true;
    onMove(e);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onEnd);
  });
  trackEl.addEventListener('touchstart', (e) => {
    dragging = true;
    onMove(e);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend',  onEnd);
  }, { passive: true });

  // Keyboard seek
  trackEl.addEventListener('keydown', (e) => {
    if (!isFinite(audio.duration)) return;
    if (e.key === 'ArrowRight') { audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); }
    if (e.key === 'ArrowLeft')  { audio.currentTime = Math.max(0, audio.currentTime - 5); }
  });
}

/* ── Event Listeners ──────────────────────────────────── */
function initEventListeners() {
  // File input
  dom.fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  });

  // Drag and drop on whole document
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    dom.dropOverlay.classList.remove('hidden');
  });
  document.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) dom.dropOverlay.classList.add('hidden');
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dom.dropOverlay.classList.add('hidden');
    handleFiles(e.dataTransfer.files);
  });

  // Track list click (play / delete)
  dom.tracksList.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.ti-action-btn.delete');
    if (deleteBtn) {
      e.stopPropagation();
      const id  = parseInt(deleteBtn.dataset.id, 10);
      const idx = parseInt(deleteBtn.dataset.index, 10);
      confirmDeleteTrack(id, idx);
      return;
    }
    const item = e.target.closest('.track-item');
    if (item) {
      const idx = parseInt(item.dataset.index, 10);
      if (idx === state.currentIndex) {
        togglePlay();
      } else {
        playTrack(idx);
      }
    }
  });

  // Player bar track area — expand on mobile
  dom.pbTrack.addEventListener('click', () => {
    if (window.innerWidth <= 768) switchView('player');
  });

  // Play / pause buttons
  dom.btnPlay.addEventListener('click',    togglePlay);
  dom.expBtnPlay.addEventListener('click', togglePlay);

  // Prev / next
  dom.btnPrev.addEventListener('click',    playPrev);
  dom.btnNext.addEventListener('click',    playNext);
  dom.expBtnPrev.addEventListener('click', playPrev);
  dom.expBtnNext.addEventListener('click', playNext);

  // Shuffle
  [dom.btnShuffle, dom.expBtnShuffle].forEach(btn => {
    btn.addEventListener('click', () => {
      state.isShuffle = !state.isShuffle;
      updateShuffleButton();
      showToast(state.isShuffle ? 'Shuffle on' : 'Shuffle off');
    });
  });

  // Repeat
  [dom.btnRepeat, dom.expBtnRepeat].forEach(btn => {
    btn.addEventListener('click', () => {
      state.isRepeat = !state.isRepeat;
      updateRepeatButton();
      showToast(state.isRepeat ? 'Repeat all on' : 'Repeat off');
    });
  });

  // Progress seek
  attachSeek(dom.progressTrack, dom.progressFill, dom.progressThumb, dom.timeCur);
  attachSeek(dom.expProgressTrack, dom.expProgressFill, dom.expProgressThumb, dom.expTimeCur);

  // Volume
  dom.volumeSlider.addEventListener('input', (e) => {
    state.volume = parseFloat(e.target.value);
    audio.volume = state.volume;
  });

  // Timer modal open
  [dom.btnTimer, dom.expBtnTimer].forEach(btn => {
    btn.addEventListener('click', () => {
      dom.timerOverlay.classList.remove('hidden');
    });
  });

  // Timer modal close
  dom.timerClose.addEventListener('click', () => {
    dom.timerOverlay.classList.add('hidden');
  });
  dom.timerOverlay.addEventListener('click', (e) => {
    if (e.target === dom.timerOverlay) dom.timerOverlay.classList.add('hidden');
  });

  // Timer presets
  dom.timerPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      const min = parseInt(btn.dataset.min, 10);
      setTimer(min);
      showToast(`Timer set for ${formatTimerLabel(min)}`);
    });
  });

  // Custom timer
  dom.btnSetCustom.addEventListener('click', () => {
    const min = parseInt(dom.timerCustomIn.value, 10);
    if (!min || min < 1 || min > 360) {
      showToast('Enter a value between 1 and 360 minutes');
      return;
    }
    setTimer(min);
    dom.timerCustomIn.value = '';
    showToast(`Timer set for ${formatTimerLabel(min)}`);
  });
  dom.timerCustomIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') dom.btnSetCustom.click();
  });

  // Cancel timer
  dom.btnCancelTimer.addEventListener('click', () => {
    clearTimer();
    showToast('Timer cancelled');
  });

  // Bottom nav
  dom.bottomNav.querySelectorAll('.bnav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Sidebar nav
  document.querySelectorAll('.sidebar .nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Expanded player close
  dom.expClose.addEventListener('click', () => {
    switchView('library');
  });

  // Media Session API (lock screen / notification controls)
  setupMediaSession();

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Space = play/pause (when not typing in an input)
    if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      togglePlay();
    }
    // Arrow keys for prev/next
    if (e.altKey && e.code === 'ArrowRight') { e.preventDefault(); playNext(); }
    if (e.altKey && e.code === 'ArrowLeft')  { e.preventDefault(); playPrev(); }
  });
}

function formatTimerLabel(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h} hour${h > 1 ? 's' : ''}`;
}

/* ── Delete Track ─────────────────────────────────────── */
async function confirmDeleteTrack(id, index) {
  const track = state.tracks[index];
  if (!track) return;

  // If currently playing this track, stop
  if (index === state.currentIndex) {
    audio.pause();
    audio.src = '';
    state.currentIndex = -1;
    dom.pbName.textContent    = '—';
    dom.pbArtist.textContent  = 'No track selected';
    dom.expName.textContent   = '—';
    dom.expArtist.textContent = 'No track selected';
    setProgressFill(0);
    dom.timeCur.textContent    = '0:00';
    dom.timeTot.textContent    = '0:00';
    dom.expTimeCur.textContent = '0:00';
    dom.expTimeTot.textContent = '0:00';
    updateNowPlayingClock('No track playing');
  } else if (index < state.currentIndex) {
    state.currentIndex--;
  }

  // Revoke cached blob URL
  if (state.blobUrls[id]) {
    URL.revokeObjectURL(state.blobUrls[id]);
    delete state.blobUrls[id];
  }

  await dbDeleteTrack(id);
  state.tracks.splice(index, 1);
  renderTracks();
  showToast('Track removed');
}

/* ── Media Session API ────────────────────────────────── */
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.setActionHandler('play',         () => { if (audio.paused) audio.play(); });
  navigator.mediaSession.setActionHandler('pause',        () => { if (!audio.paused) audio.pause(); });
  navigator.mediaSession.setActionHandler('previoustrack', playPrev);
  navigator.mediaSession.setActionHandler('nexttrack',     playNext);
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime !== undefined && isFinite(audio.duration)) {
      audio.currentTime = details.seekTime;
    }
  });

  audio.addEventListener('play', updateMediaSessionMeta);
}

function updateMediaSessionMeta() {
  if (!('mediaSession' in navigator)) return;
  const track = state.tracks[state.currentIndex];
  if (!track) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title:  track.name   || 'Unknown Track',
    artist: track.artist || 'Unknown Artist',
    album:  'Music Player',
  });
  navigator.mediaSession.playbackState = 'playing';
}

/* ── Init ─────────────────────────────────────────────── */
async function init() {
  try {
    await openDB();
    await loadLibrary();
  } catch (err) {
    console.error('Failed to initialize DB:', err);
    showToast('Storage unavailable — tracks will not persist');
  }

  updateClock();
  setInterval(updateClock, 1000);

  initEventListeners();
  updateRepeatButton();
  updateShuffleButton();
  updatePlayButtons(false);
}

document.addEventListener('DOMContentLoaded', init);
