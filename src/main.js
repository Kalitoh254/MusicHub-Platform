import { initAuthUI } from './auth/ui.js';
import { initAccountManagement } from './account/ui.js';
import './styles/main.css';

const $ = (selector) => document.querySelector(selector);
const audio = $('#audio');
const library = [];
let currentIndex = -1;
let activeObjectUrl = null;

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
};

function showView(view) {
  const titles = { home: 'Your music space', library: 'My Library', playlists: 'Your playlists', upload: 'Upload music' };
  $('#section-title').textContent = titles[view] || titles.home;
  $('#upload-panel').hidden = view !== 'upload';
  $('#view-content').hidden = view === 'upload';
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  if (view === 'playlists') {
    $('#view-content').innerHTML = '<div class="empty-state"><div class="empty-icon">▤</div><h3>Your playlists are waiting</h3><p>Playlist creation and sharing will be connected to your account in the database phase.</p></div>';
  } else if (view === 'home' || view === 'library') renderLibrary();
  $('#navigation').classList.remove('open');
  $('#menu-toggle').setAttribute('aria-expanded', 'false');
}

function renderLibrary() {
  $('#track-count').textContent = `${library.length} ${library.length === 1 ? 'track' : 'tracks'}`;
  if (!library.length) {
    $('#view-content').innerHTML = '<div class="empty-state"><div class="empty-icon">♫</div><h3>Your library begins here</h3><p>Choose an audio file to listen locally, or open Upload Music to prepare your collection.</p><button class="secondary-button" data-go="upload">Choose music +</button></div>';
    return;
  }
  $('#view-content').innerHTML = `<div class="track-list">${library.map((track, index) => `<article class="track-row"><button class="track-play" data-play="${index}" aria-label="Play ${escapeHtml(track.title)}">${index === currentIndex && !audio.paused ? 'Ⅱ' : '▶'}</button><div class="track-cover small-cover">♫</div><div class="track-text"><strong>${escapeHtml(track.title)}</strong><span>Local preview · This device</span></div><span class="track-duration">${formatTime(track.duration)}</span></article>`).join('')}</div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function playTrack(index) {
  if (!library.length) return;
  currentIndex = (index + library.length) % library.length;
  const track = library[currentIndex];
  audio.src = track.url;
  $('#player-title').textContent = track.title;
  $('#player-artist').textContent = 'Local preview · MusicHub';
  $('#current-time').textContent = '0:00';
  $('#duration').textContent = formatTime(track.duration);
  $('#seek').value = '0';
  renderLibrary();
  try {
    await audio.play();
    $('#play-pause').textContent = 'Ⅱ';
    $('#play-pause').setAttribute('aria-label', 'Pause');
  } catch {
    $('#upload-status').textContent = 'Playback could not start. Tap Play to try again.';
  }
}

document.addEventListener('click', event => {
  const navigation = event.target.closest('[data-view]');
  const go = event.target.closest('[data-go]');
  const play = event.target.closest('[data-play]');
  if (navigation) showView(navigation.dataset.view);
  if (go) showView(go.dataset.go);
  if (play) {
    const index = Number(play.dataset.play);
    if (index === currentIndex && !audio.paused) audio.pause();
    else void playTrack(index);
  }
});

$('#menu-toggle').addEventListener('click', () => {
  const open = $('#navigation').classList.toggle('open');
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
});

$('#audio-upload').addEventListener('change', event => {
  const files = Array.from(event.target.files || []);
  for (const file of files) {
    if (!file.type.startsWith('audio/')) continue;
    const url = URL.createObjectURL(file);
    const track = { title: file.name.replace(/\.[^.]+$/, ''), url, duration: 0, file };
    library.push(track);
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.src = url;
    probe.addEventListener('loadedmetadata', () => {
      track.duration = probe.duration;
      if (library.includes(track)) renderLibrary();
      if (library[currentIndex] === track) $('#duration').textContent = formatTime(track.duration);
      probe.src = '';
    }, { once: true });
    probe.addEventListener('error', () => { probe.src = ''; }, { once: true });
  }
  if (files.length) {
    $('#upload-status').textContent = `${files.length} file(s) selected for local preview. Cloud upload is not enabled yet.`;
    showView('library');
    if (library.length) void playTrack(library.length - files.length);
  }
  event.target.value = '';
});

$('#play-pause').addEventListener('click', () => {
  if (!audio.src && library.length) { void playTrack(0); return; }
  if (audio.paused) void audio.play().catch(() => {});
  else audio.pause();
});
$('#previous').addEventListener('click', () => { if (currentIndex >= 0) void playTrack(currentIndex - 1); });
$('#next').addEventListener('click', () => { if (currentIndex >= 0) void playTrack(currentIndex + 1); });
$('#volume').addEventListener('input', event => { audio.volume = Number(event.target.value); });
$('#seek').addEventListener('input', event => {
  if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = (Number(event.target.value) / 1000) * audio.duration;
});
audio.volume = 0.8;
audio.addEventListener('timeupdate', () => {
  $('#current-time').textContent = formatTime(audio.currentTime);
  if (Number.isFinite(audio.duration) && audio.duration > 0) $('#seek').value = String(Math.round(audio.currentTime / audio.duration * 1000));
});
audio.addEventListener('loadedmetadata', () => { $('#duration').textContent = formatTime(audio.duration); });
audio.addEventListener('play', () => { $('#play-pause').textContent = 'Ⅱ'; $('#play-pause').setAttribute('aria-label', 'Pause'); renderLibrary(); });
audio.addEventListener('pause', () => { $('#play-pause').textContent = '▶'; $('#play-pause').setAttribute('aria-label', 'Play'); renderLibrary(); });
audio.addEventListener('ended', () => { if (library.length > 1) void playTrack(currentIndex + 1); });
window.addEventListener('beforeunload', () => {
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
  library.forEach(track => URL.revokeObjectURL(track.url));
});

fetch('/api/v1/health').then(response => {
  if (!response.ok) throw new Error('API unavailable');
  return response.json();
}).then(data => {
  if (data.status !== 'ok') throw new Error('API unavailable');
  document.documentElement.dataset.api = 'connected';
}).catch(() => {
  document.documentElement.dataset.api = 'offline';
});

showView('home');

initAuthUI();
initAccountManagement();
