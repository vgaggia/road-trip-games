/**
 * SHOTGUN! — Road Trip Party Games
 * Unified Engine for Pass-the-Phone & WiFi Hotspot Multiplayer (Host APK + Browser Clients)
 */
(function () {
  'use strict';

  const APK_DOWNLOAD_URL = 'https://github.com/vgaggia/road-trip-games/releases/latest/download/shotgun-road-trip-games.apk';
  const BINGO_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
    [0, 4, 8], [2, 4, 6]             // diags
  ];

  // Detect execution context
  const urlParams = new URLSearchParams(window.location.search);
  const isNativeApk = Boolean(window.RoadTripNative) || urlParams.get('native') === '1';

  // Persistent client identity per tab (survives page refresh / phone lock!)
  function getOrCreateTabPlayerId() {
    try {
      let id = sessionStorage.getItem('shotgun_pid');
      if (!id) {
        id = 'p_' + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem('shotgun_pid', id);
      }
      return id;
    } catch (_) {
      return 'p_' + Math.random().toString(36).slice(2, 10);
    }
  }

  function loadSavedProfile() {
    try {
      const raw = localStorage.getItem('shotgun_profile');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  function saveProfile(name, avatarIdx) {
    try {
      localStorage.setItem('shotgun_profile', JSON.stringify({ name, avatarIdx }));
    } catch (_) {}
  }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // Non-repeating deck drawer
  const deckState = {};
  function drawFromDeck(key, sourceArray) {
    if (!deckState[key] || deckState[key].length === 0) {
      deckState[key] = shuffle(sourceArray.map((_, i) => i));
    }
    const idx = deckState[key].pop();
    return sourceArray[idx];
  }

  // Wake Lock helper so mobile screens stay awake in the car
  let wakeLockSentinel = null;
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLockSentinel) {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockSentinel = null;
        });
      }
    } catch (_) {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestWakeLock();
      if (state.mode === 'hotspot-client' || state.mode === 'hotspot-host') {
        ensureWebSocket();
      }
    }
  });

  const savedProf = loadSavedProfile();

  // Master Application State
  const state = {
    screen: 'home', // 'home' | 'pass-setup' | 'hotspot-guide' | 'hotspot-host-lobby' | 'hotspot-client-join' | 'dashboard' | 'game'
    mode: 'none',   // 'none' | 'pass' | 'hotspot-host' | 'hotspot-client'
    myPlayerId: getOrCreateTabPlayerId(),

    // Hotspot server detection & info
    servedByHotspot: false,
    serverInfo: {
      port: Number(window.location.port) || 8080,
      ips: [],
      selectedUrl: '',
      roomCode: 'RIDE'
    },
    wsConnected: false,
    showInviteModal: false,
    joinIpInput: '192.168.43.1:8080',

    // Local setup inputs
    hostName: (savedProf && savedProf.name) || 'Captain',
    hostAvatarIdx: (savedProf && typeof savedProf.avatarIdx === 'number') ? savedProf.avatarIdx : 0,
    clientName: (savedProf && savedProf.name) || '',
    clientAvatarIdx: (savedProf && typeof savedProf.avatarIdx === 'number')
      ? savedProf.avatarIdx
      : Math.floor(Math.random() * GameData.AVATARS.length),
    clientJoined: false,

    // Authoritative Players & Game State (owned by local engine in 'pass' & 'hotspot-host')
    players: [
      { id: 'local_1', name: 'Shotgun', emoji: '🦊', color: '#ff7b39', score: 0, isDriver: false, connected: true, isHost: true },
      { id: 'local_2', name: 'Back Left', emoji: '🕶️', color: '#4cc9f0', score: 0, isDriver: false, connected: true, isHost: false },
      { id: 'local_3', name: 'Back Right', emoji: '🤠', color: '#ffd166', score: 0, isDriver: false, connected: true, isHost: false },
      { id: 'local_4', name: 'Driver', emoji: '🐸', color: '#06d6a0', score: 0, isDriver: true, connected: true, isHost: false }
    ],

    activeGame: null, // Authoritative game object (host / pass)

    // Synced snapshot received by 'hotspot-client'
    clientPublic: null,
    clientPrivate: null,
    clientTicketOpen: false
  };

  let ws = null;
  let wsReconnectTimer = null;
  let gameTickInterval = null;

  // Toast notifications
  function showToast(message, accent) {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast';
    if (accent) el.style.borderLeftColor = accent;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.2s ease';
      setTimeout(() => el.remove(), 220);
    }, 2600);
  }

  function findPlayer(list, id) {
    return (list || []).find((p) => p.id === id) || null;
  }

  // =========================================================================
  // HOTSPOT NETWORKING (Host & Passenger WebSocket Sync)
  // =========================================================================

  async function probeHotspotServer() {
    if (window.location.protocol !== 'http:') return;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch('/api/server-info', { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!res.ok) return;
      const info = await res.json();
      if (info && info.mode === 'hotspot') {
        state.servedByHotspot = true;
        applyServerInfo(info);
        if (!isNativeApk) {
          // Automatically bring passenger to the Join Car screen!
          state.mode = 'hotspot-client';
          state.screen = 'hotspot-client-join';
          ensureWebSocket();
          render();
        }
      }
    } catch (_) {
      // Running as static site without Hotspot API
    }
  }

  function applyServerInfo(info) {
    if (!info) return;
    const port = info.port || Number(window.location.port) || 8080;
    const ips = Array.isArray(info.ips) ? info.ips : [];
    const urls = ips.map((entry) => ({
      label: entry.label || 'Network',
      ip: entry.ip,
      url: `http://${entry.ip}:${port}`
    }));
    const prevSelected = state.serverInfo.selectedUrl;
    const stillValid = urls.find((u) => u.url === prevSelected);
    const primaryUrl = stillValid
      ? stillValid.url
      : (urls[0] ? urls[0].url : (info.primaryUrl || `http://192.168.43.1:${port}`));

    state.serverInfo = {
      port,
      ips: urls,
      selectedUrl: primaryUrl,
      roomCode: info.roomCode || 'RIDE'
    };
  }

  function refreshNativeServerInfo() {
    if (window.RoadTripNative && typeof window.RoadTripNative.getServerInfo === 'function') {
      try {
        const raw = window.RoadTripNative.getServerInfo();
        const parsed = JSON.parse(raw);
        applyServerInfo(parsed);
        render();
        return;
      } catch (_) {}
    }
    fetch('/api/server-info', { cache: 'no-store' })
      .then((r) => r.json())
      .then((info) => {
        applyServerInfo(info);
        render();
      })
      .catch(() => {});
  }

  function getWsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }

  function ensureWebSocket() {
    if (state.mode !== 'hotspot-host' && state.mode !== 'hotspot-client') return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    clearTimeout(wsReconnectTimer);
    try {
      ws = new WebSocket(getWsUrl());
    } catch (_) {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      state.wsConnected = true;
      if (state.mode === 'hotspot-host') {
        wsSend({ type: 'register_host', hostId: state.myPlayerId });
        syncHostToClients();
      } else if (state.mode === 'hotspot-client') {
        if (state.clientJoined && state.clientName.trim()) {
          sendClientJoin();
        }
      }
      render();
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (_) {
        return;
      }
      handleWsMessage(msg);
    };

    ws.onclose = () => {
      state.wsConnected = false;
      ws = null;
      if (state.mode === 'hotspot-host' || state.mode === 'hotspot-client') {
        render();
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will handle reconnect
    };
  }

  function scheduleReconnect() {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(() => {
      ensureWebSocket();
    }, 1200);
  }

  function wsSend(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function sendClientJoin() {
    const av = GameData.AVATARS[state.clientAvatarIdx % GameData.AVATARS.length];
    wsSend({
      type: 'join_client',
      playerId: state.myPlayerId,
      name: state.clientName.trim().slice(0, 16) || 'Passenger',
      emoji: av.emoji,
      color: av.color
    });
  }

  function sendClientAction(action) {
    if (state.mode === 'hotspot-host') {
      handlePlayerAction(state.myPlayerId, action);
    } else if (state.mode === 'hotspot-client') {
      wsSend({
        type: 'client_action',
        playerId: state.myPlayerId,
        action
      });
    }
  }

  function handleWsMessage(msg) {
    if (!msg || !msg.type) return;

    if (state.mode === 'hotspot-host') {
      if (msg.type === 'presence' && Array.isArray(msg.clients)) {
        mergeClientPresence(msg.clients);
      } else if (msg.type === 'client_action' && msg.playerId && msg.action) {
        handlePlayerAction(msg.playerId, msg.action);
      }
      return;
    }

    if (state.mode === 'hotspot-client') {
      if (msg.type === 'state_update') {
        const prevScreen = state.clientPublic && state.clientPublic.hostScreen;
        const prevGameId = state.clientPublic && state.clientPublic.game && state.clientPublic.game.id;
        state.clientPublic = msg.publicState || null;
        state.clientPrivate = msg.myState || null;

        if (state.clientPublic) {
          const me = findPlayer(state.clientPublic.players, state.myPlayerId);
          if (me) {
            state.clientJoined = true;
            if (state.screen === 'hotspot-client-join' && state.clientPublic.hostScreen !== 'hotspot-host-lobby') {
              state.screen = state.clientPublic.hostScreen === 'game' ? 'game' : 'dashboard';
            } else if (state.clientPublic.hostScreen === 'game') {
              state.screen = 'game';
            } else if (state.clientPublic.hostScreen === 'dashboard') {
              state.screen = 'dashboard';
            } else if (state.clientPublic.hostScreen === 'hotspot-host-lobby' && state.clientJoined) {
              state.screen = 'hotspot-client-join';
            }
          }
          const nextGameId = state.clientPublic.game && state.clientPublic.game.id;
          if (nextGameId && nextGameId !== prevGameId) {
            state.clientTicketOpen = false;
            SoundFX.pop();
          } else if (prevScreen !== state.clientPublic.hostScreen) {
            SoundFX.tap();
          }
        }
        render();
      } else if (msg.type === 'host_event' && msg.event) {
        onRemoteEvent(msg.event);
      }
    }
  }

  function onRemoteEvent(ev) {
    if (ev.sound && SoundFX[ev.sound]) {
      SoundFX[ev.sound]();
    }
    if (ev.toast) {
      showToast(ev.toast, ev.accent);
    }
  }

  function broadcastEvent(sound, toast, accent) {
    if (sound && SoundFX[sound]) SoundFX[sound]();
    if (toast) showToast(toast, accent);
    if (state.mode === 'hotspot-host') {
      wsSend({ type: 'host_event', event: { sound, toast, accent } });
    }
  }

  function mergeClientPresence(clients) {
    // Seat 0 is always the Host
    const hostAv = GameData.AVATARS[state.hostAvatarIdx % GameData.AVATARS.length];
    let hostPlayer = findPlayer(state.players, state.myPlayerId);
    if (!hostPlayer) {
      hostPlayer = {
        id: state.myPlayerId,
        name: state.hostName.trim() || 'Captain',
        emoji: hostAv.emoji,
        color: hostAv.color,
        score: 0,
        isDriver: false,
        connected: true,
        isHost: true
      };
    } else {
      hostPlayer.name = state.hostName.trim() || 'Captain';
      hostPlayer.emoji = hostAv.emoji;
      hostPlayer.color = hostAv.color;
      hostPlayer.connected = true;
      hostPlayer.isHost = true;
    }

    const existingMap = new Map(state.players.map((p) => [p.id, p]));
    const updated = [hostPlayer];
    let newlyJoinedName = null;

    for (const c of clients) {
      if (!c.playerId || c.playerId === state.myPlayerId) continue;
      const prev = existingMap.get(c.playerId);
      if (!prev && c.connected) {
        newlyJoinedName = `${c.emoji || '🚗'} ${c.name || 'Passenger'}`;
      }
      updated.push({
        id: c.playerId,
        name: c.name || (prev ? prev.name : 'Passenger'),
        emoji: c.emoji || (prev ? prev.emoji : '🕶️'),
        color: c.color || (prev ? prev.color : '#4cc9f0'),
        score: prev ? prev.score : 0,
        isDriver: false,
        connected: Boolean(c.connected),
        isHost: false
      });
    }

    // Keep any disconnected players who already earned score/game roles so reconnect restores them!
    for (const oldP of state.players) {
      if (oldP.id !== state.myPlayerId && !updated.find((u) => u.id === oldP.id)) {
        if (state.activeGame || oldP.score > 0) {
          updated.push(Object.assign({}, oldP, { connected: false }));
        }
      }
    }

    state.players = updated;
    if (newlyJoinedName) {
      broadcastEvent('honk', `${newlyJoinedName} hopped in the car!`, '#06d6a0');
    }
    syncHostToClients();
    render();
  }

  // Build sanitized public state + per-player private state (protects secret roles & targets!)
  function syncHostToClients() {
    if (state.mode !== 'hotspot-host') return;
    const publicState = {
      hostScreen: state.screen,
      roomCode: state.serverInfo.roomCode,
      players: state.players,
      game: sanitizeGameForPublic(state.activeGame)
    };
    const privateStates = {};
    for (const p of state.players) {
      privateStates[p.id] = buildPrivateStateForPlayer(state.activeGame, p.id);
    }
    wsSend({
      type: 'host_sync',
      publicState,
      privateStates
    });
  }

  function sanitizeGameForPublic(g) {
    if (!g) return null;
    if (g.id === 'undercover') {
      const showSecrets = g.phase === 'result';
      const showImpostor = g.phase === 'steal' || g.phase === 'result';
      return {
        id: g.id,
        phase: g.phase,
        category: g.category,
        allWords: (g.phase === 'steal' || g.phase === 'result') ? g.allWords : [],
        secretWord: showSecrets ? g.secretWord : null,
        impostorId: showImpostor ? g.impostorId : null,
        firstSpeakerId: g.firstSpeakerId,
        clueLaps: g.clueLaps,
        secondsLeft: g.secondsLeft,
        readyIds: Object.keys(g.readyMap || {}),
        votedIds: Object.keys(g.votes || {}),
        votes: g.phase === 'result' ? g.votes : null,
        stealGuess: g.stealGuess,
        outcomeText: g.outcomeText,
        scoreDeltas: g.scoreDeltas
      };
    }
    if (g.id === 'vibe-check') {
      return {
        id: g.id,
        round: g.round,
        totalRounds: g.totalRounds,
        phase: g.phase,
        giverId: g.giverId,
        spectrum: g.spectrum,
        clueReady: g.clueReady,
        target: g.phase === 'reveal' ? g.target : null,
        guessedIds: Object.keys(g.guesses || {}),
        guesses: g.phase === 'reveal' ? g.guesses : null,
        scoreDeltas: g.scoreDeltas
      };
    }
    if (g.id === 'hot-seat') {
      return {
        id: g.id,
        round: g.round,
        totalRounds: g.totalRounds,
        phase: g.phase,
        flavor: g.flavor,
        prompt: g.prompt,
        spotlightId: g.spotlightId,
        options: g.options,
        votedIds: Object.keys(g.votes || {}),
        votes: g.phase === 'reveal' ? g.votes : null,
        spotlightPick: g.phase === 'reveal' ? g.spotlightPick : null,
        spotlightLocked: g.spotlightPick !== null && g.spotlightPick !== undefined,
        summaryText: g.summaryText,
        scoreDeltas: g.scoreDeltas
      };
    }
    if (g.id === 'speed-trap') {
      return {
        id: g.id,
        round: g.round,
        totalRounds: g.totalRounds,
        phase: g.phase,
        speakerId: g.speakerId,
        copId: g.copId,
        secondsLeft: g.secondsLeft,
        turnScore: g.turnScore,
        gotCount: g.gotCount,
        buzzCount: g.buzzCount,
        history: g.history
      };
    }
    // window-wars is 100% public board
    return g;
  }

  function buildPrivateStateForPlayer(g, pid) {
    if (!g) return null;
    if (g.id === 'undercover') {
      const isImpostor = g.impostorId === pid;
      return {
        isImpostor,
        secretWord: isImpostor ? null : g.secretWord,
        myReady: Boolean(g.readyMap && g.readyMap[pid]),
        myVote: g.votes ? g.votes[pid] || null : null
      };
    }
    if (g.id === 'vibe-check') {
      return {
        isGiver: g.giverId === pid,
        secretTarget: g.giverId === pid ? g.target : null,
        myGuess: g.guesses && g.guesses[pid] !== undefined ? g.guesses[pid] : null
      };
    }
    if (g.id === 'hot-seat') {
      return {
        myVote: g.votes && g.votes[pid] !== undefined ? g.votes[pid] : null,
        mySpotlightPick: g.spotlightId === pid ? g.spotlightPick : null
      };
    }
    if (g.id === 'speed-trap') {
      const canSeeCard = pid === g.speakerId || pid === g.copId;
      return {
        role: pid === g.speakerId ? 'speaker' : (pid === g.copId ? 'cop' : 'guesser'),
        currentCard: canSeeCard ? g.currentCard : null
      };
    }
    return null;
  }

  // =========================================================================
  // GAME INITIALIZERS & ACTION HANDLERS (Authoritative on Pass / Hotspot-Host)
  // =========================================================================

  function awardScore(playerId, delta) {
    const p = findPlayer(state.players, playerId);
    if (p) {
      p.score = Math.max(0, (p.score || 0) + delta);
    }
  }

  function startGame(gameId) {
    clearInterval(gameTickInterval);
    gameTickInterval = null;

    if (gameId === 'window-wars') {
      state.activeGame = createWindowWarsGame();
    } else if (gameId === 'undercover') {
      state.activeGame = createUndercoverGame();
    } else if (gameId === 'hot-seat') {
      state.activeGame = createHotSeatGame(1);
    } else if (gameId === 'vibe-check') {
      state.activeGame = createVibeCheckGame(1);
    } else if (gameId === 'speed-trap') {
      state.activeGame = createSpeedTrapGame(1);
    }

    state.screen = 'game';
    requestWakeLock();
    SoundFX.pop();
    syncHostToClients();
    render();
  }

  // ---- 1. WINDOW WARS ----
  function createWindowWarsGame() {
    const easy = shuffle(GameData.WINDOW_WARS_SIGHTS.filter((s) => s.tier === 'easy')).slice(0, 5);
    const med = shuffle(GameData.WINDOW_WARS_SIGHTS.filter((s) => s.tier === 'med')).slice(0, 3);
    const rare = shuffle(GameData.WINDOW_WARS_SIGHTS.filter((s) => s.tier === 'rare')).slice(0, 1);
    const nine = shuffle([...easy, ...med, ...rare]).map((s) => ({
      id: s.id,
      label: s.label,
      icon: s.icon,
      tier: s.tier,
      pts: s.pts,
      claimedBy: null
    }));
    return {
      id: 'window-wars',
      tiles: nine,
      completedLines: [],
      lastClaim: null,
      pickingTileIdx: null
    };
  }

  function claimBingoTile(tileIdx, playerId) {
    const g = state.activeGame;
    if (!g || g.id !== 'window-wars') return;
    const tile = g.tiles[tileIdx];
    if (!tile || tile.claimedBy) return;
    const claimant = findPlayer(state.players, playerId);
    if (!claimant) return;

    tile.claimedBy = playerId;
    let totalEarned = tile.pts;
    const newlyCompleted = [];

    BINGO_LINES.forEach((line, lIdx) => {
      if (g.completedLines.includes(lIdx)) return;
      if (line.every((idx) => g.tiles[idx].claimedBy !== null)) {
        g.completedLines.push(lIdx);
        newlyCompleted.push(lIdx);
        totalEarned += 250;
      }
    });

    awardScore(playerId, totalEarned);
    g.lastClaim = {
      tileIdx,
      playerId,
      ptsDelta: totalEarned,
      linesAdded: newlyCompleted
    };
    g.pickingTileIdx = null;

    if (newlyCompleted.length > 0) {
      broadcastEvent('fanfare', `🎉 BINGO LINE! ${claimant.emoji} ${claimant.name} +${totalEarned} pts!`, '#06d6a0');
    } else {
      broadcastEvent('score', `${tile.icon} ${claimant.name} spotted ${tile.label} (+${totalEarned})`, claimant.color);
    }
    syncHostToClients();
    render();
  }

  function undoLastBingoClaim() {
    const g = state.activeGame;
    if (!g || g.id !== 'window-wars' || !g.lastClaim) return;
    const { tileIdx, playerId, ptsDelta, linesAdded } = g.lastClaim;
    const tile = g.tiles[tileIdx];
    if (tile) tile.claimedBy = null;
    g.completedLines = g.completedLines.filter((l) => !linesAdded.includes(l));
    awardScore(playerId, -ptsDelta);
    const p = findPlayer(state.players, playerId);
    g.lastClaim = null;
    broadcastEvent('buzz', `↩️ Vetoed ${p ? p.name : 'last'} claim!`, '#ff4d6d');
    syncHostToClients();
    render();
  }

  // ---- 2. UNDERCOVER PASSENGER ----
  function createUndercoverGame() {
    const pack = drawFromDeck('undercover', GameData.UNDERCOVER_PACKS);
    const words = shuffle(pack.words);
    const secretWord = words[Math.floor(Math.random() * words.length)];
    const activePlayers = getActivePlayers();
    const impostor = activePlayers[Math.floor(Math.random() * activePlayers.length)];
    const firstSpeaker = activePlayers[Math.floor(Math.random() * activePlayers.length)];

    return {
      id: 'undercover',
      phase: 'peek', // 'peek' | 'discuss' | 'vote' | 'steal' | 'result'
      category: pack.category,
      allWords: words,
      secretWord,
      impostorId: impostor.id,
      firstSpeakerId: firstSpeaker.id,
      clueLaps: activePlayers.length <= 3 ? 2 : 1,
      turnIdx: 0,
      cardOpen: false,
      readyMap: {},
      votes: {},
      secondsLeft: 90,
      stealGuess: null,
      outcomeText: '',
      scoreDeltas: {}
    };
  }

  function startUndercoverTimer() {
    clearInterval(gameTickInterval);
    gameTickInterval = setInterval(() => {
      const g = state.activeGame;
      if (!g || g.id !== 'undercover' || g.phase !== 'discuss') {
        clearInterval(gameTickInterval);
        return;
      }
      if (g.secondsLeft > 0) {
        g.secondsLeft--;
        if (g.secondsLeft === 10) SoundFX.tick();
        if (g.secondsLeft === 0) broadcastEvent('honk', '⏰ Time! Cast your Impostor votes!', '#ff9f1c');
        syncHostToClients();
        render();
      }
    }, 1000);
  }

  function resolveUndercoverVotes() {
    const g = state.activeGame;
    if (!g || g.id !== 'undercover') return;
    clearInterval(gameTickInterval);

    const counts = {};
    Object.values(g.votes).forEach((suspectId) => {
      counts[suspectId] = (counts[suspectId] || 0) + 1;
    });

    let maxVotes = 0;
    let topSuspects = [];
    for (const [sid, cnt] of Object.entries(counts)) {
      if (cnt > maxVotes) {
        maxVotes = cnt;
        topSuspects = [sid];
      } else if (cnt === maxVotes) {
        topSuspects.push(sid);
      }
    }

    const impostorCaught = topSuspects.length === 1 && topSuspects[0] === g.impostorId;
    const impPlayer = findPlayer(state.players, g.impostorId);

    if (impostorCaught) {
      // Award Insiders who voted accurately, then give Impostor Last-Chance Word Steal!
      g.scoreDeltas = {};
      for (const [voterId, targetId] of Object.entries(g.votes)) {
        if (voterId !== g.impostorId && targetId === g.impostorId) {
          awardScore(voterId, 200);
          g.scoreDeltas[voterId] = 200;
        }
      }
      g.phase = 'steal';
      broadcastEvent('reveal', `🚨 ${impPlayer ? impPlayer.name : 'Impostor'} was caught! Last-chance word steal!`, '#ff4d6d');
    } else {
      // Impostor escaped!
      awardScore(g.impostorId, 350);
      g.scoreDeltas = { [g.impostorId]: 350 };
      g.outcomeText = `🕵️ ${impPlayer ? impPlayer.name : 'The Impostor'} blended right in and escaped! (+350 pts)`;
      g.phase = 'result';
      broadcastEvent('fanfare', g.outcomeText, '#ff4d6d');
    }
    syncHostToClients();
    render();
  }

  function resolveUndercoverSteal(wordGuess) {
    const g = state.activeGame;
    if (!g || g.id !== 'undercover' || g.phase !== 'steal') return;
    g.stealGuess = wordGuess;
    const impPlayer = findPlayer(state.players, g.impostorId);
    if (wordGuess === g.secretWord) {
      awardScore(g.impostorId, 200);
      g.scoreDeltas[g.impostorId] = 200;
      g.outcomeText = `🤯 Caught, BUT ${impPlayer ? impPlayer.name : 'Impostor'} guessed "${g.secretWord}" for a +200 steal!`;
      broadcastEvent('fanfare', g.outcomeText, '#ffd166');
    } else {
      g.outcomeText = `✅ Car Crew wins! ${impPlayer ? impPlayer.name : 'Impostor'} guessed "${wordGuess}" — secret was "${g.secretWord}"!`;
      broadcastEvent('score', '✅ Insiders win the round!', '#06d6a0');
    }
    g.phase = 'result';
    syncHostToClients();
    render();
  }

  // ---- 3. HOT SEAT HIGHWAY ----
  function createHotSeatGame(roundNum) {
    const activePlayers = getActivePlayers();
    const totalRounds = 5;
    const isSpotlight = roundNum % 2 === 0;

    if (!isSpotlight) {
      const prompt = drawFromDeck('most_likely', GameData.MOST_LIKELY_PROMPTS);
      return {
        id: 'hot-seat',
        round: roundNum,
        totalRounds,
        phase: 'vote',
        flavor: 'majority',
        prompt,
        spotlightId: null,
        options: null,
        turnIdx: 0,
        cardOpen: false,
        votes: {},
        spotlightPick: null,
        summaryText: '',
        scoreDeltas: {}
      };
    } else {
      const spotPlayer = activePlayers[(Math.floor(roundNum / 2) - 1) % activePlayers.length];
      const item = drawFromDeck('spotlight', GameData.SPOTLIGHT_DILEMMAS);
      return {
        id: 'hot-seat',
        round: roundNum,
        totalRounds,
        phase: 'vote',
        flavor: 'spotlight',
        prompt: item.prompt.replace(/\{name\}/g, spotPlayer.name),
        spotlightId: spotPlayer.id,
        options: item.options,
        turnIdx: 0,
        cardOpen: false,
        votes: {},
        spotlightPick: null,
        summaryText: '',
        scoreDeltas: {}
      };
    }
  }

  function checkAndResolveHotSeat() {
    const g = state.activeGame;
    if (!g || g.id !== 'hot-seat' || g.phase !== 'vote') return;
    const activePlayers = getActivePlayers();

    if (g.flavor === 'majority') {
      if (activePlayers.some((p) => !g.votes[p.id])) return;
      const counts = {};
      Object.values(g.votes).forEach((pid) => {
        counts[pid] = (counts[pid] || 0) + 1;
      });
      const maxCnt = Math.max(...Object.values(counts));
      const winners = Object.keys(counts).filter((pid) => counts[pid] === maxCnt);
      const unanimous = winners.length === 1 && maxCnt === activePlayers.length;
      const bonus = unanimous ? 250 : 150;
      g.scoreDeltas = {};
      for (const [voterId, choiceId] of Object.entries(g.votes)) {
        if (winners.includes(choiceId)) {
          awardScore(voterId, bonus);
          g.scoreDeltas[voterId] = bonus;
        }
      }
      const winnerNames = winners.map((id) => {
        const p = findPlayer(state.players, id);
        return p ? `${p.emoji} ${p.name}` : 'Player';
      }).join(' & ');
      g.summaryText = unanimous
        ? `🎯 UNANIMOUS SWEEP! Everyone picked ${winnerNames}! (+250 pts each)`
        : `🏆 Car Majority Pick: ${winnerNames} (${maxCnt} votes)!`;
      g.phase = 'reveal';
      broadcastEvent('fanfare', g.summaryText, '#ff9f1c');
    } else {
      if (g.spotlightPick === null || g.spotlightPick === undefined) return;
      const guessers = activePlayers.filter((p) => p.id !== g.spotlightId);
      if (guessers.some((p) => g.votes[p.id] === undefined)) return;

      g.scoreDeltas = {};
      let correctCount = 0;
      for (const gp of guessers) {
        if (g.votes[gp.id] === g.spotlightPick) {
          correctCount++;
          awardScore(gp.id, 200);
          g.scoreDeltas[gp.id] = 200;
        }
      }
      if (correctCount > 0) {
        const spotBonus = correctCount * 100;
        awardScore(g.spotlightId, spotBonus);
        g.scoreDeltas[g.spotlightId] = spotBonus;
      }
      const spotP = findPlayer(state.players, g.spotlightId);
      g.summaryText = correctCount > 0
        ? `🧠 ${correctCount}/${guessers.length} read ${spotP ? spotP.name : 'passenger'}'s mind!`
        : `😈 Plot twist! Nobody predicted ${spotP ? spotP.name : 'that'}'s true answer!`;
      g.phase = 'reveal';
      broadcastEvent('reveal', g.summaryText, '#06d6a0');
    }
    syncHostToClients();
    render();
  }

  // ---- 4. VIBE CHECK 1-10 ----
  function createVibeCheckGame(roundNum) {
    const activePlayers = getActivePlayers();
    const giver = activePlayers[(roundNum - 1) % activePlayers.length];
    const spectrum = drawFromDeck('vibe', GameData.VIBE_SPECTRUMS);
    const target = Math.floor(Math.random() * 10) + 1;

    // Build turn order of guessers (excluding giver)
    const guessers = activePlayers.filter((p) => p.id !== giver.id);

    return {
      id: 'vibe-check',
      round: roundNum,
      totalRounds: activePlayers.length,
      phase: state.mode === 'pass' ? 'clue' : 'guess', // on hotspot, giver sees target immediately while guessers dial!
      giverId: giver.id,
      guesserIds: guessers.map((p) => p.id),
      turnIdx: 0,
      cardOpen: false,
      clueReady: false,
      spectrum,
      target,
      guesses: {},
      scoreDeltas: {}
    };
  }

  function checkAndResolveVibeCheck() {
    const g = state.activeGame;
    if (!g || g.id !== 'vibe-check' || g.phase === 'reveal') return;
    const activeGuessers = getActivePlayers().filter((p) => p.id !== g.giverId);
    if (activeGuessers.some((p) => g.guesses[p.id] === undefined)) return;

    g.scoreDeltas = {};
    let bestDiff = 99;
    for (const gp of activeGuessers) {
      const val = g.guesses[gp.id];
      const diff = Math.abs(val - g.target);
      if (diff < bestDiff) bestDiff = diff;
      let pts = 0;
      if (diff === 0) pts = 300;
      else if (diff === 1) pts = 200;
      else if (diff === 2) pts = 100;
      if (pts > 0) {
        awardScore(gp.id, pts);
        g.scoreDeltas[gp.id] = pts;
      }
    }
    let giverPts = 0;
    if (bestDiff === 0) giverPts = 150;
    else if (bestDiff === 1) giverPts = 100;
    else if (bestDiff === 2) giverPts = 50;
    if (giverPts > 0) {
      awardScore(g.giverId, giverPts);
      g.scoreDeltas[g.giverId] = giverPts;
    }

    g.phase = 'reveal';
    broadcastEvent(bestDiff === 0 ? 'fanfare' : 'reveal', `🎯 Secret Target was ${g.target}/10!`, '#4cc9f0');
    syncHostToClients();
    render();
  }

  // ---- 5. SPEED TRAP ----
  function createSpeedTrapGame(roundNum) {
    const activePlayers = getActivePlayers();
    const speakerIdx = (roundNum - 1) % activePlayers.length;
    const speaker = activePlayers[speakerIdx];
    const cop = activePlayers.length >= 2
      ? activePlayers[(speakerIdx + 1) % activePlayers.length]
      : speaker;

    return {
      id: 'speed-trap',
      round: roundNum,
      totalRounds: activePlayers.length,
      phase: 'ready', // 'ready' | 'active' | 'summary'
      speakerId: speaker.id,
      copId: cop.id,
      secondsLeft: 35,
      currentCard: drawFromDeck('speed_trap', GameData.SPEED_TRAP_CARDS),
      turnScore: 0,
      gotCount: 0,
      buzzCount: 0,
      history: []
    };
  }

  function startSpeedTrapCountdown() {
    const g = state.activeGame;
    if (!g || g.id !== 'speed-trap') return;
    g.phase = 'active';
    g.secondsLeft = 35;
    broadcastEvent('honk', '🚦 GO! 35 seconds on the clock!', '#06d6a0');
    syncHostToClients();
    render();

    clearInterval(gameTickInterval);
    gameTickInterval = setInterval(() => {
      const cur = state.activeGame;
      if (!cur || cur.id !== 'speed-trap' || cur.phase !== 'active') {
        clearInterval(gameTickInterval);
        return;
      }
      cur.secondsLeft--;
      if (cur.secondsLeft <= 5 && cur.secondsLeft > 0) {
        SoundFX.tick();
      }
      if (cur.secondsLeft <= 0) {
        clearInterval(gameTickInterval);
        cur.phase = 'summary';
        broadcastEvent('honk', `🏁 Time's up! ${cur.gotCount} words nailed!`, '#ffd166');
      }
      syncHostToClients();
      render();
    }, 1000);
  }

  function handleSpeedTrapCardOutcome(outcome) {
    const g = state.activeGame;
    if (!g || g.id !== 'speed-trap' || g.phase !== 'active') return;
    const word = g.currentCard.word;
    const activePlayers = getActivePlayers();

    if (outcome === 'got') {
      g.gotCount++;
      g.turnScore += 150;
      awardScore(g.speakerId, 150);
      // Guessers in the car also earn +50 assist points!
      activePlayers.forEach((p) => {
        if (p.id !== g.speakerId && (activePlayers.length <= 2 || p.id !== g.copId)) {
          awardScore(p.id, 50);
        }
      });
      g.history.push({ word, outcome: 'got' });
      broadcastEvent('score', `✅ "${word}" (+150)!`, '#06d6a0');
    } else if (outcome === 'buzz') {
      g.buzzCount++;
      g.turnScore = Math.max(0, g.turnScore - 50);
      awardScore(g.speakerId, -50);
      if (g.copId && g.copId !== g.speakerId) {
        awardScore(g.copId, 50); // Good catch bonus for the Road Cop!
      }
      g.history.push({ word, outcome: 'buzz' });
      broadcastEvent('buzz', `🚨 BUSTED on "${word}"! Forbidden word!`, '#ff3b5c');
    } else {
      g.history.push({ word, outcome: 'skip' });
      SoundFX.tap();
    }

    g.currentCard = drawFromDeck('speed_trap', GameData.SPEED_TRAP_CARDS);
    syncHostToClients();
    render();
  }

  function getActivePlayers() {
    if (state.mode === 'hotspot-host') {
      const online = state.players.filter((p) => p.connected);
      return online.length >= 2 ? online : state.players;
    }
    return state.players;
  }

  // Unified Action Router for Hotspot & Local actions
  function handlePlayerAction(playerId, action) {
    if (!action || !action.kind) return;
    const sender = findPlayer(state.players, playerId);

    if (action.kind === 'reaction') {
      const sound = action.emoji === '📯' ? 'honk' : 'pop';
      broadcastEvent(sound, `${sender ? sender.emoji + ' ' + sender.name : 'Passenger'}: ${action.label}`, sender ? sender.color : '#ffd166');
      return;
    }

    const g = state.activeGame;
    if (!g) return;

    if (g.id === 'window-wars' && action.kind === 'bingo_claim') {
      claimBingoTile(Number(action.tileIdx), playerId);
    } else if (g.id === 'undercover') {
      if (action.kind === 'uc_ready' && g.phase === 'peek') {
        g.readyMap[playerId] = true;
        const active = getActivePlayers();
        if (active.every((p) => g.readyMap[p.id])) {
          g.phase = 'discuss';
          startUndercoverTimer();
          broadcastEvent('pop', '🗣️ Everyone saw their ticket! Give 1-word clues!', '#4cc9f0');
        }
        syncHostToClients();
        render();
      } else if (action.kind === 'uc_vote' && g.phase === 'vote') {
        if (action.suspectId && action.suspectId !== playerId) {
          g.votes[playerId] = action.suspectId;
          SoundFX.tap();
          const active = getActivePlayers();
          if (active.every((p) => g.votes[p.id])) {
            resolveUndercoverVotes();
          } else {
            syncHostToClients();
            render();
          }
        }
      } else if (action.kind === 'uc_steal' && g.phase === 'steal' && playerId === g.impostorId) {
        resolveUndercoverSteal(action.word);
      }
    } else if (g.id === 'hot-seat' && g.phase === 'vote') {
      if (g.flavor === 'majority' && action.kind === 'hs_vote') {
        g.votes[playerId] = action.targetId;
        SoundFX.tap();
        checkAndResolveHotSeat();
        syncHostToClients();
        render();
      } else if (g.flavor === 'spotlight' && action.kind === 'hs_option') {
        const optIdx = Number(action.optIdx);
        if (playerId === g.spotlightId) {
          g.spotlightPick = optIdx;
        } else {
          g.votes[playerId] = optIdx;
        }
        SoundFX.tap();
        checkAndResolveHotSeat();
        syncHostToClients();
        render();
      }
    } else if (g.id === 'vibe-check' && g.phase !== 'reveal') {
      if (action.kind === 'vc_clue_ready' && playerId === g.giverId) {
        g.clueReady = true;
        broadcastEvent('pop', `🗣️ ${sender ? sender.name : 'Clue Giver'} gave the clue — lock in 1 to 10!`, '#4cc9f0');
        syncHostToClients();
        render();
      } else if (action.kind === 'vc_guess' && playerId !== g.giverId) {
        const num = Number(action.val);
        if (num >= 1 && num <= 10) {
          g.guesses[playerId] = num;
          SoundFX.tap();
          checkAndResolveVibeCheck();
          syncHostToClients();
          render();
        }
      }
    } else if (g.id === 'speed-trap') {
      if (action.kind === 'st_start' && g.phase === 'ready' && (playerId === g.speakerId || playerId === state.myPlayerId)) {
        startSpeedTrapCountdown();
      } else if (action.kind === 'st_outcome' && g.phase === 'active') {
        if (action.outcome === 'buzz' && (playerId === g.copId || playerId !== g.speakerId)) {
          handleSpeedTrapCardOutcome('buzz');
        } else if ((action.outcome === 'got' || action.outcome === 'skip') && (playerId === g.speakerId || playerId === g.copId)) {
          handleSpeedTrapCardOutcome(action.outcome);
        }
      }
    }
  }

  // =========================================================================
  // UI RENDERING
  // =========================================================================

  function renderTopBar() {
    const showBack = state.screen !== 'home';
    const isHotspotActive = state.mode === 'hotspot-host' && state.screen !== 'hotspot-host-lobby' && state.screen !== 'home';
    const muted = SoundFX.isMuted();

    return `
      <header class="topbar">
        <div style="display:flex;align-items:center;gap:8px;">
          ${showBack ? `<button class="icon-btn" data-action="nav-back" aria-label="Back">←</button>` : ''}
          <div class="brand-pill">
            <span class="dot" style="background:${state.mode === 'hotspot-client' && !state.wsConnected ? '#ff4d6d' : '#06d6a0'}"></span>
            <span>SHOTGUN!</span>
          </div>
        </div>
        <div class="topbar-actions">
          ${isHotspotActive ? `<button class="icon-btn" data-action="open-invite" title="Hotspot QR & Players">📡 ${state.players.filter((p) => p.connected).length}</button>` : ''}
          <button class="icon-btn" data-action="honk" title="Car Horn">📯</button>
          <button class="icon-btn" data-action="toggle-mute" aria-label="Toggle Sound">${muted ? '🔇' : '🔊'}</button>
        </div>
      </header>
    `;
  }

  function renderScoreStrip(players) {
    if (!players || players.length === 0) return '';
    const maxScore = Math.max(...players.map((p) => p.score || 0));
    return `
      <section class="score-strip" aria-label="Car Cup Scoreboard">
        ${players.map((p) => `
          <div class="score-chip ${maxScore > 0 && p.score === maxScore ? 'leader' : ''}" style="${p.connected === false ? 'opacity:0.5;' : ''}">
            <div class="sc-avatar">${esc(p.emoji)}${p.isDriver ? '🛞' : ''}</div>
            <div class="sc-name">${esc(p.name)}</div>
            <div class="sc-pts">${p.score || 0}</div>
          </div>
        `).join('')}
      </section>
    `;
  }

  function renderHome() {
    const canHostHotspot = isNativeApk;
    return `
      <section class="hero-card">
        <span class="hero-badge">🚗 3–4 Player Car Party Pack</span>
        <h1 class="hero-title">SHOTGUN!</h1>
        <p class="hero-sub">5 road-trip games made for highways, backseats &amp; zero boredom.</p>
        <div class="road-divider"><span></span><span></span><span></span><span></span></div>
      </section>

      <button class="mode-card primary" data-action="choose-pass">
        <div class="mode-icon">📱</div>
        <div class="mode-body">
          <h2 class="mode-title">
            Pass the Phone
            <span class="pill-badge amber">Works Offline</span>
          </h2>
          <p class="mode-desc">1 phone shared in the car for 3–4 players. Privacy shields between turns + hands-free Driver toggle!</p>
        </div>
      </button>

      <button class="mode-card hotspot" data-action="choose-hotspot">
        <div class="mode-icon">📡</div>
        <div class="mode-body">
          <h2 class="mode-title">
            WiFi Hotspot Party
            <span class="pill-badge cyan">${canHostHotspot ? 'Host Ready' : 'Multi-Phone'}</span>
          </h2>
          <p class="mode-desc">${canHostHotspot
            ? 'Start the built-in WiFi Hotspot server on this phone — friends join right in their browser!'
            : 'Host from the Android APK over your phone\'s WiFi Hotspot — passengers join in their browser, no data or Bluetooth needed!'
          }</p>
        </div>
      </button>

      ${state.servedByHotspot && !isNativeApk ? `
        <div class="card" style="border-color:var(--mint);">
          <div class="card-header">
            <h3 class="card-title">🟢 Hotspot Car Detected!</h3>
          </div>
          <p class="card-subtitle" style="margin-bottom:12px;">You're connected to a Shotgun! Host phone on this Wi-Fi.</p>
          <button class="btn btn-mint" data-action="reenter-client">Hop Into Hotspot Lobby →</button>
        </div>
      ` : ''}

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🎒 What's Inside (5 Games)</h3>
          <span class="pill-badge">No Zoom Needed</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
          ${GameData.GAMES_META.map((gm) => `<span class="status-pill">${esc(gm.tag.split(' ')[0])} ${esc(gm.title)}</span>`).join('')}
        </div>
      </div>
    `;
  }

  function renderPassSetup() {
    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">🚗 Car Crew Setup</h2>
            <p class="card-subtitle">Sweet spot: 3 to 4 players. Tap 🛞 if someone is driving hands-free!</p>
          </div>
        </div>

        <div class="btn-row" style="margin-bottom:10px;">
          <button class="btn btn-surface btn-sm" data-action="preset-3p">3-Player Crew</button>
          <button class="btn btn-surface btn-sm" data-action="preset-4p">4-Player Crew</button>
        </div>

        <div class="player-list">
          ${state.players.map((p, idx) => `
            <div class="player-edit-row">
              <button class="avatar-cycle-btn" style="background:${esc(p.color)}26;border-color:${esc(p.color)};" data-action="cycle-avatar" data-idx="${idx}" title="Tap to change icon">
                ${esc(p.emoji)}
              </button>
              <input
                type="text"
                class="text-input"
                maxlength="16"
                value="${esc(p.name)}"
                placeholder="Player ${idx + 1}"
                data-input="player-name"
                data-idx="${idx}"
                aria-label="Player ${idx + 1} Name"
              />
              <button class="driver-toggle ${p.isDriver ? 'active' : ''}" data-action="toggle-driver" data-idx="${idx}" title="Hands-free Driver Assist">
                <span>🛞</span>
                <span>Drive</span>
              </button>
              ${state.players.length > 2 ? `
                <button class="remove-player-btn" data-action="remove-player" data-idx="${idx}" aria-label="Remove player">✕</button>
              ` : ''}
            </div>
          `).join('')}
        </div>

        ${state.players.length < 6 ? `
          <button class="btn btn-surface" style="margin-bottom:12px;" data-action="add-player">+ Add Another Passenger (${state.players.length}/6)</button>
        ` : ''}

        <button class="btn btn-amber" data-action="start-pass-session">Hit the Road! (${state.players.length} Players) →</button>
      </div>
    `;
  }

  function renderHotspotGuide() {
    return `
      <div class="card">
        <span class="pill-badge cyan" style="margin-bottom:8px;">📡 WiFi Hotspot Mode</span>
        <h2 class="card-title">Host From Android, Friends Join via Browser</h2>
        <p class="card-subtitle" style="margin-top:8px;">
          Websites on HTTPS (like GitHub Pages) aren't allowed by phone browsers to open a local WiFi server.
          Install the lightweight <strong>Shotgun! Android APK</strong> on <strong>1 phone</strong> to host the entire car offline!
        </p>

        <div class="helper-note" style="margin:14px 0;">
          <strong>How it works in 20 seconds:</strong><br/>
          1️⃣ Host phone turns on <strong>Wi-Fi Hotspot</strong> &amp; opens the <strong>Shotgun! APK</strong>.<br/>
          2️⃣ Friends connect to that Wi-Fi &amp; scan the QR code (or open <code>http://&lt;host-ip&gt;:8080</code> in Safari/Chrome).<br/>
          3️⃣ No Bluetooth &amp; zero mobile data required!
        </div>

        <a class="btn btn-cyan" href="${APK_DOWNLOAD_URL}" target="_blank" rel="noopener">
          ⬇️ Download Android Host APK
        </a>
      </div>

      <div class="card">
        <h3 class="card-title">Already Connected to a Friend's Hotspot?</h3>
        <p class="card-subtitle" style="margin-bottom:10px;">Enter the Host address shown on their phone screen:</p>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <input
            type="text"
            class="text-input"
            value="${esc(state.joinIpInput)}"
            placeholder="192.168.43.1:8080"
            data-input="join-ip"
            aria-label="Host IP and Port"
          />
        </div>
        <button class="btn btn-mint" data-action="go-host-ip">Join Friend's Car →</button>
      </div>

      <button class="btn btn-amber" data-action="choose-pass">📱 Play Pass-the-Phone on This Device Instead</button>
    `;
  }

  function renderHotspotHostLobby() {
    const url = state.serverInfo.selectedUrl || `http://192.168.43.1:${state.serverInfo.port || 8080}`;
    let qrSvg = '';
    try {
      qrSvg = QRCodeSVG.renderSVG(url);
    } catch (_) {}

    const hostAv = GameData.AVATARS[state.hostAvatarIdx % GameData.AVATARS.length];
    const connectedCount = state.players.filter((p) => p.connected).length;

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <span class="pill-badge cyan">📡 Hosting on WiFi Hotspot</span>
            <h2 class="card-title" style="margin-top:6px;">Scan or Open Link to Join</h2>
          </div>
          <button class="icon-btn" data-action="refresh-ip" title="Refresh Hotspot IP">🔄</button>
        </div>

        <p class="card-subtitle">
          1. Enable your phone's <strong>Wi-Fi Hotspot</strong>.<br/>
          2. Passengers join your Wi-Fi &amp; scan below:
        </p>

        ${qrSvg ? `<div class="qr-wrap">${qrSvg}</div>` : ''}
        <div class="url-box">${esc(url)}</div>

        ${state.serverInfo.ips.length > 1 ? `
          <div class="ip-chips">
            ${state.serverInfo.ips.map((item) => `
              <button class="ip-chip ${item.url === url ? 'active' : ''}" data-action="select-ip-url" data-url="${esc(item.url)}">
                ${esc(item.label)}: ${esc(item.ip)}
              </button>
            `).join('')}
          </div>
        ` : ''}

        <div class="btn-row" style="margin-top:10px;">
          ${window.RoadTripNative ? `
            <button class="btn btn-surface btn-sm" data-action="open-hotspot-settings">⚙️ Hotspot Settings</button>
          ` : ''}
          <button class="btn btn-surface btn-sm" data-action="copy-join-url">📋 Copy Link</button>
          <button class="btn btn-surface btn-sm" data-action="refresh-ip">🔄 Refresh IP</button>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">👑 Your Host Seat (Player 1)</h3>
        <div class="player-edit-row" style="margin-top:8px;">
          <button class="avatar-cycle-btn" style="background:${esc(hostAv.color)}26;border-color:${esc(hostAv.color)};" data-action="cycle-host-avatar">
            ${esc(hostAv.emoji)}
          </button>
          <input
            type="text"
            class="text-input"
            maxlength="16"
            value="${esc(state.hostName)}"
            placeholder="Your Name"
            data-input="host-name"
          />
        </div>

        <h3 class="card-title" style="margin-top:16px;">🚗 Passengers in Car (${connectedCount})</h3>
        <p class="card-subtitle">Best with 3–4 players (2–6 supported)!</p>
        <div class="status-row">
          ${state.players.map((p) => `
            <span class="status-pill ${p.connected ? 'done' : ''}">
              ${esc(p.emoji)} ${esc(p.name)} ${p.isHost ? '(Host)' : (p.connected ? '✓' : '(away)')}
            </span>
          `).join('')}
        </div>

        <button class="btn btn-amber" style="margin-top:12px;" ${connectedCount < 2 ? 'disabled' : ''} data-action="host-enter-dashboard">
          ${connectedCount < 2 ? 'Waiting for at least 1 passenger...' : `Start Road Trip (${connectedCount} Players) →`}
        </button>
      </div>
    `;
  }

  function renderHotspotClientJoin() {
    const av = GameData.AVATARS[state.clientAvatarIdx % GameData.AVATARS.length];
    const pubPlayers = (state.clientPublic && state.clientPublic.players) || [];

    return `
      <div class="card">
        <span class="pill-badge ${state.wsConnected ? '' : 'coral'}">
          ${state.wsConnected ? '🟢 Connected to Car Host' : '🔄 Reconnecting to Host...'}
        </span>
        <h2 class="card-title" style="margin-top:8px;">Hop Into the Car!</h2>
        <p class="card-subtitle">Pick your avatar &amp; name for this road trip:</p>

        <div class="player-edit-row" style="margin:14px 0;">
          <button class="avatar-cycle-btn" style="background:${esc(av.color)}26;border-color:${esc(av.color)};" data-action="cycle-client-avatar">
            ${esc(av.emoji)}
          </button>
          <input
            type="text"
            class="text-input"
            maxlength="16"
            value="${esc(state.clientName)}"
            placeholder="Your Nickname"
            data-input="client-name"
          />
        </div>

        <button class="btn btn-mint" data-action="submit-client-join">
          ${state.clientJoined ? '✅ Update My Seat' : '🚗 Join Car Lobby!'}
        </button>
      </div>

      ${pubPlayers.length > 0 ? `
        <div class="card">
          <h3 class="card-title">Crew in the Car (${pubPlayers.filter((p) => p.connected).length})</h3>
          <div class="status-row">
            ${pubPlayers.map((p) => `
              <span class="status-pill ${p.connected ? 'done' : ''}">${esc(p.emoji)} ${esc(p.name)}</span>
            `).join('')}
          </div>
          ${state.clientJoined ? `
            <p class="helper-note" style="margin-bottom:0;">Waiting for the Host to pick the next game — tap a reaction below!</p>
          ` : ''}
        </div>
      ` : ''}

      ${state.clientJoined ? renderReactionBar() : ''}
    `;
  }

  function renderDashboard() {
    const isClient = state.mode === 'hotspot-client';
    const players = isClient ? ((state.clientPublic && state.clientPublic.players) || []) : state.players;

    return `
      ${renderScoreStrip(players)}

      <div class="card" style="padding:14px 16px;">
        <div class="card-header" style="margin-bottom:4px;">
          <div>
            <h2 class="card-title">${isClient ? '🎮 Host Is Choosing a Game...' : '🎮 Pick Next Car Game'}</h2>
            <p class="card-subtitle">${isClient ? 'Scores carry over across all games in the Car Cup!' : 'Scores carry over in the Car Cup! Play in any order:'}</p>
          </div>
          ${!isClient && players.some((p) => p.score > 0) ? `
            <button class="btn btn-surface btn-sm" data-action="reset-scores">Reset Pts</button>
          ` : ''}
        </div>
      </div>

      <div class="game-list">
        ${GameData.GAMES_META.map((gm) => `
          <button
            class="game-card"
            style="border-left-color:${esc(gm.accent)};${isClient ? 'opacity:0.92;cursor:default;' : ''}"
            ${isClient ? 'disabled' : `data-action="launch-game" data-game="${esc(gm.id)}"`}
          >
            <div class="game-card-top">
              <h3 class="game-card-title">${esc(gm.title)}</h3>
              <span class="pill-badge" style="border-color:${esc(gm.accent)}88;color:${esc(gm.accent)};background:${esc(gm.accent)}1f;">${esc(gm.tag)}</span>
            </div>
            <p class="game-card-desc">${esc(gm.summary)}</p>
          </button>
        `).join('')}
      </div>

      ${isClient ? renderReactionBar() : ''}
    `;
  }

  function renderReactionBar() {
    return `
      <div class="reaction-bar">
        <button class="react-btn" data-action="react" data-emoji="📯" data-label="BEEP BEEP! 📯">📯 Honk</button>
        <button class="react-btn" data-action="react" data-emoji="🔥" data-label="LET'S GO! 🔥">🔥 Hype</button>
        <button class="react-btn" data-action="react" data-emoji="🤨" data-label="Kinda SUS 🤨">🤨 Sus</button>
        <button class="react-btn" data-action="react" data-emoji="😂" data-label="DYING 😂">😂 LOL</button>
      </div>
    `;
  }

  function renderPassPrivacyShield(player, subtitle, buttonLabel, actionName) {
    if (!player) return '';
    return `
      <div class="pass-shield">
        <div class="pass-avatar-big" style="background:${esc(player.color)}26;border-color:${esc(player.color)};">
          ${esc(player.emoji)}
        </div>
        ${player.isDriver ? `
          <span class="pill-badge amber" style="margin-bottom:8px;">🛞 HANDS-FREE DRIVER ASSIST</span>
          <h2 class="card-title">Keep ${esc(player.name)}'s Eyes on the Road!</h2>
          <p class="card-subtitle" style="margin:8px 0 18px;">Co-Pilot: Hold the phone privately and help ${esc(player.name)} by voice.</p>
        ` : `
          <span class="pill-badge cyan" style="margin-bottom:8px;">🔒 No Peeking!</span>
          <h2 class="card-title">Pass Phone to ${esc(player.name)}</h2>
          <p class="card-subtitle" style="margin:8px 0 18px;">${esc(subtitle)}</p>
        `}
        <button class="btn btn-amber" data-action="${esc(actionName)}">${esc(buttonLabel)}</button>
      </div>
    `;
  }

  // =========================================================================
  // INDIVIDUAL GAME RENDERERS
  // =========================================================================

  function renderGameScreen() {
    const isClient = state.mode === 'hotspot-client';
    const players = isClient ? ((state.clientPublic && state.clientPublic.players) || []) : state.players;
    const g = isClient ? (state.clientPublic && state.clientPublic.game) : state.activeGame;

    if (!g) {
      return `
        <div class="card">
          <h2 class="card-title">Waiting for Game...</h2>
          <button class="btn btn-surface" style="margin-top:12px;" data-action="back-to-dashboard">Back to Dashboard</button>
        </div>
      `;
    }

    let body = '';
    if (g.id === 'window-wars') body = renderWindowWars(g, players, isClient);
    else if (g.id === 'undercover') body = renderUndercover(g, players, isClient);
    else if (g.id === 'hot-seat') body = renderHotSeat(g, players, isClient);
    else if (g.id === 'vibe-check') body = renderVibeCheck(g, players, isClient);
    else if (g.id === 'speed-trap') body = renderSpeedTrap(g, players, isClient);

    return `
      ${renderScoreStrip(players)}
      ${body}
      ${state.mode !== 'pass' ? renderReactionBar() : ''}
    `;
  }

  // 1. Render Window Wars
  function renderWindowWars(g, players, isClient) {
    return `
      <div class="card">
        <div class="card-header">
          <div>
            <span class="pill-badge">👀 Window Wars • +250 Line Bonus</span>
            <h2 class="card-title" style="margin-top:4px;">Spot It Out the Window!</h2>
          </div>
        </div>
        <p class="card-subtitle">Call it out loud &amp; tap the sight to claim points!</p>

        <div class="bingo-grid">
          ${g.tiles.map((t, idx) => {
            const owner = t.claimedBy ? findPlayer(players, t.claimedBy) : null;
            return `
              <button
                class="bingo-tile tier-${esc(t.tier)} ${owner ? 'claimed' : ''}"
                ${owner ? 'disabled' : `data-action="tap-bingo-tile" data-idx="${idx}"`}
              >
                <span class="bt-pts">+${t.pts}</span>
                <span class="bt-icon">${esc(t.icon)}</span>
                <span class="bt-label">${esc(t.label)}</span>
                ${owner ? `<span class="bingo-owner" title="Claimed by ${esc(owner.name)}">${esc(owner.emoji)}</span>` : ''}
              </button>
            `;
          }).join('')}
        </div>

        ${!isClient && g.lastClaim ? `
          <button class="btn btn-coral" style="margin-bottom:10px;" data-action="bingo-veto">
            ↩️ Veto / Undo Last Claim
          </button>
        ` : ''}

        ${!isClient ? `
          <div class="btn-row">
            <button class="btn btn-surface btn-sm" data-action="bingo-new-board">🔄 Fresh Board</button>
            <button class="btn btn-amber btn-sm" data-action="back-to-dashboard">🏁 More Games</button>
          </div>
        ` : ''}
      </div>

      ${state.mode === 'pass' && g.pickingTileIdx !== null && g.tiles[g.pickingTileIdx] ? `
        <div class="modal-backdrop" data-action="close-bingo-picker">
          <div class="modal-sheet" onclick="event.stopPropagation()">
            <h3 class="card-title">${esc(g.tiles[g.pickingTileIdx].icon)} Who Spotted "${esc(g.tiles[g.pickingTileIdx].label)}"?</h3>
            <div class="choice-grid" style="margin-top:14px;">
              ${players.map((p) => `
                <button class="choice-btn" data-action="confirm-bingo-claim" data-pid="${esc(p.id)}">
                  <span style="font-size:1.5rem;">${esc(p.emoji)}</span>
                  <span>${esc(p.name)} (+${g.tiles[g.pickingTileIdx].pts} pts)</span>
                </button>
              `).join('')}
            </div>
            <button class="btn btn-surface" data-action="close-bingo-picker">Cancel</button>
          </div>
        </div>
      ` : ''}
    `;
  }

  // 2. Render Undercover Passenger
  function renderUndercover(g, players, isClient) {
    const myPriv = isClient ? state.clientPrivate : buildPrivateStateForPlayer(state.activeGame, state.myPlayerId);
    const activePlayers = state.mode === 'pass' ? players : players.filter((p) => p.connected !== false);

    // PASS-THE-PHONE PEEK
    if (g.phase === 'peek' && state.mode === 'pass') {
      const curP = activePlayers[g.turnIdx];
      if (!g.cardOpen) {
        return renderPassPrivacyShield(curP, 'Tap below when nobody else can see the screen.', `👁️ I'm ${curP.name} — View Ticket`, 'uc-pass-open');
      }
      const isImp = curP.id === g.impostorId;
      return `
        <div class="card">
          <span class="pill-badge amber">Category: ${esc(g.category)}</span>
          <div class="role-card ${isImp ? 'impostor' : ''}">
            <div style="font-size:2.4rem;">${isImp ? '🕵️' : '🎟️'}</div>
            <h2 class="card-title">${isImp ? 'YOU ARE THE IMPOSTOR!' : 'INSIDER PASSENGER'}</h2>
            <div class="role-word">${isImp ? '???' : esc(g.secretWord)}</div>
            <p class="card-subtitle">
              ${isImp
                ? `Everyone else sees one specific "${esc(g.category)}" word. Listen to clues & blend in!`
                : 'Give a 1-word clue clever enough to prove you know it without tipping off the Impostor!'}
            </p>
          </div>
          <button class="btn btn-mint" data-action="uc-pass-next">
            🔒 Hide Ticket &amp; ${g.turnIdx + 1 < activePlayers.length ? 'Pass Phone →' : 'Start Clues!'}
          </button>
        </div>
      `;
    }

    // HOTSPOT PEEK
    if (g.phase === 'peek' && state.mode !== 'pass') {
      const isImp = myPriv && myPriv.isImpostor;
      const myReady = myPriv && myPriv.myReady;
      const readyIds = isClient ? (g.readyIds || []) : Object.keys(g.readyMap || {});
      return `
        <div class="card">
          <span class="pill-badge amber">Category: ${esc(g.category)}</span>
          <div class="role-card ${isImp ? 'impostor' : ''}">
            <div style="font-size:2.3rem;">${isImp ? '🕵️' : '🎟️'}</div>
            <h2 class="card-title">${isImp ? 'YOU ARE THE IMPOSTOR!' : 'SECRET WORD'}</h2>
            <div class="role-word">${isImp ? 'BLEND IN!' : esc(myPriv && myPriv.secretWord)}</div>
            <p class="card-subtitle">
              ${isImp
                ? `Listen closely to everyone's clues about "${esc(g.category)}" and fake your clue!`
                : 'Don\'t let anyone peek at your screen!'}
            </p>
          </div>

          <button class="btn ${myReady ? 'btn-surface' : 'btn-mint'}" ${myReady ? 'disabled' : ''} data-action="uc-hotspot-ready">
            ${myReady ? '✅ Waiting for Car Crew...' : '✅ Got My Role — Ready!'}
          </button>

          <div class="status-row" style="margin-top:12px;">
            ${activePlayers.map((p) => `
              <span class="status-pill ${readyIds.includes(p.id) ? 'done' : ''}">${esc(p.emoji)} ${esc(p.name)}</span>
            `).join('')}
          </div>

          ${!isClient ? `
            <button class="btn btn-surface btn-sm" style="width:100%;margin-top:8px;" data-action="uc-force-discuss">Skip Wait &amp; Start Clues →</button>
          ` : ''}
        </div>
      `;
    }

    // DISCUSSION / CLUES
    if (g.phase === 'discuss') {
      const starter = findPlayer(players, g.firstSpeakerId) || activePlayers[0];
      const isImp = myPriv && myPriv.isImpostor;
      return `
        <div class="card">
          <div class="timer-banner ${g.secondsLeft <= 15 ? 'urgent' : ''}">⏱️ ${g.secondsLeft}s • Clue Time</div>
          <span class="pill-badge amber">Category: ${esc(g.category)}</span>
          <h2 class="card-title" style="margin-top:8px;">Speak Out Loud Around the Car!</h2>
          <p class="card-subtitle" style="margin-top:6px;">
            Start with <strong>${esc(starter ? starter.emoji + ' ' + starter.name : 'Player 1')}</strong> and go around the car
            for <strong>${g.clueLaps} ${g.clueLaps > 1 ? 'laps' : 'lap'}</strong> (1 clue word per turn).
          </p>

          ${state.mode !== 'pass' && myPriv ? `
            <div style="margin:14px 0;">
              <button class="btn btn-surface btn-sm" style="width:100%;" data-action="toggle-ticket-peek">
                ${state.clientTicketOpen ? '🙈 Hide My Secret Ticket' : '👁️ Peek at My Ticket Again'}
              </button>
              ${state.clientTicketOpen ? `
                <div class="role-card ${isImp ? 'impostor' : ''}" style="padding:14px;margin-top:8px;">
                  <strong>${isImp ? '🕵️ YOU ARE THE IMPOSTOR' : `🎟️ Word: ${esc(myPriv.secretWord)}`}</strong>
                </div>
              ` : ''}
            </div>
          ` : ''}

          ${!isClient ? `
            <button class="btn btn-coral" style="margin-top:12px;" data-action="uc-open-voting">🗳️ Ready — Vote for Impostor!</button>
          ` : `
            <p class="helper-note">Debate who sounded suspicious! Host will open voting when ready.</p>
          `}
        </div>
      `;
    }

    // VOTING
    if (g.phase === 'vote') {
      if (state.mode === 'pass') {
        const voter = activePlayers[g.turnIdx];
        if (!g.cardOpen) {
          return renderPassPrivacyShield(voter, 'Time to secretly accuse the Impostor!', `🗳️ ${voter.name} — Cast Secret Vote`, 'uc-pass-open');
        }
        return `
          <div class="card">
            <span class="pill-badge coral">Secret Vote • ${esc(voter.emoji)} ${esc(voter.name)}</span>
            <h2 class="card-title" style="margin-top:6px;">Who Is the Impostor?</h2>
            <div class="choice-grid">
              ${activePlayers.filter((p) => p.id !== voter.id).map((suspect) => `
                <button class="choice-btn" data-action="uc-pass-vote" data-suspect="${esc(suspect.id)}">
                  <span style="font-size:1.5rem;">${esc(suspect.emoji)}</span>
                  <span>Accuse ${esc(suspect.name)}</span>
                </button>
              `).join('')}
            </div>
          </div>
        `;
      } else {
        const myVote = myPriv && myPriv.myVote;
        const votedIds = isClient ? (g.votedIds || []) : Object.keys(g.votes || {});
        return `
          <div class="card">
            <span class="pill-badge coral">🗳️ Secret Accusation</span>
            <h2 class="card-title" style="margin-top:6px;">Tap Who You Think Is Faking!</h2>
            <div class="choice-grid">
              ${activePlayers.filter((p) => p.id !== state.myPlayerId).map((suspect) => `
                <button class="choice-btn ${myVote === suspect.id ? 'selected' : ''}" data-action="uc-hotspot-vote" data-suspect="${esc(suspect.id)}">
                  <span style="font-size:1.5rem;">${esc(suspect.emoji)}</span>
                  <span>${esc(suspect.name)} ${myVote === suspect.id ? '✓' : ''}</span>
                </button>
              `).join('')}
            </div>
            <div class="status-row">
              ${activePlayers.map((p) => `
                <span class="status-pill ${votedIds.includes(p.id) ? 'done' : ''}">${esc(p.emoji)} ${esc(p.name)}</span>
              `).join('')}
            </div>
          </div>
        `;
      }
    }

    // IMPOSTOR LAST-CHANCE STEAL
    if (g.phase === 'steal') {
      const imp = findPlayer(players, g.impostorId);
      const canAct = state.mode === 'pass' || state.myPlayerId === g.impostorId;
      return `
        <div class="card">
          <span class="pill-badge coral">🚨 IMPOSTOR CAUGHT!</span>
          <h2 class="card-title" style="margin-top:8px;">
            ${esc(imp ? imp.emoji + ' ' + imp.name : 'Impostor')}'s Last-Chance Steal!
          </h2>
          <p class="card-subtitle">
            ${canAct
              ? `Guess the exact Secret Word in "${esc(g.category)}" from the clues to steal +200 pts!`
              : `Stay quiet! Watching ${esc(imp ? imp.name : 'the Impostor')} try to guess the secret word...`}
          </p>

          <div class="choice-grid two-col" style="margin-top:14px;">
            ${(g.allWords || []).map((w) => `
              <button class="choice-btn" style="justify-content:center;text-align:center;" ${canAct ? `data-action="uc-steal-pick" data-word="${esc(w)}"` : 'disabled'}>
                <span>${esc(w)}</span>
              </button>
            `).join('')}
          </div>
        </div>
      `;
    }

    // RESULT
    const imp = findPlayer(players, g.impostorId);
    return `
      <div class="card">
        <span class="pill-badge amber">Round Complete</span>
        <h2 class="card-title" style="margin-top:8px;">${esc(g.outcomeText)}</h2>
        <div class="role-card" style="margin:12px 0;">
          <div class="card-subtitle">Category: <strong>${esc(g.category)}</strong></div>
          <div class="role-word">${esc(g.secretWord)}</div>
          <div class="card-subtitle">Impostor was <strong>${esc(imp ? imp.emoji + ' ' + imp.name : 'Unknown')}</strong></div>
        </div>

        ${g.votes ? `
          <div class="status-row">
            ${Object.entries(g.votes).map(([vid, tid]) => {
              const vp = findPlayer(players, vid);
              const tp = findPlayer(players, tid);
              return `<span class="status-pill">${esc(vp ? vp.name : '?')} ➔ ${esc(tp ? tp.emoji + ' ' + tp.name : '?')}</span>`;
            }).join('')}
          </div>
        ` : ''}

        ${!isClient ? `
          <div class="btn-row" style="margin-top:12px;">
            <button class="btn btn-mint" data-action="uc-play-again">🔄 Next Word</button>
            <button class="btn btn-surface" data-action="back-to-dashboard">🏁 Games</button>
          </div>
        ` : ''}
      </div>
    `;
  }

  // 3. Render Hot Seat Highway
  function renderHotSeat(g, players, isClient) {
    const myPriv = isClient ? state.clientPrivate : buildPrivateStateForPlayer(state.activeGame, state.myPlayerId);
    const activePlayers = state.mode === 'pass' ? players : players.filter((p) => p.connected !== false);
    const spotPlayer = g.spotlightId ? findPlayer(players, g.spotlightId) : null;

    if (g.phase === 'vote') {
      if (state.mode === 'pass') {
        const curP = activePlayers[g.turnIdx];
        if (!g.cardOpen) {
          return renderPassPrivacyShield(curP, `Round ${g.round}/${g.totalRounds} — Lock in your secret pick!`, `🔥 ${curP.name} — Open Question`, 'hs-pass-open');
        }
        const isSpotSelf = g.flavor === 'spotlight' && curP.id === g.spotlightId;
        return `
          <div class="card">
            <span class="pill-badge amber">Round ${g.round}/${g.totalRounds} • ${isSpotSelf ? '🎯 YOU Are in the Hot Seat!' : (g.flavor === 'spotlight' ? `Predict ${spotPlayer ? spotPlayer.name : ''}` : 'Most Likely')}</span>
            <h2 class="card-title" style="margin-top:8px;">${esc(g.prompt)}</h2>
            <p class="card-subtitle">
              ${isSpotSelf ? 'Pick your honest answer — everyone else is trying to predict what you choose!' : ''}
            </p>
            <div class="choice-grid">
              ${g.flavor === 'majority'
                ? activePlayers.map((p) => `
                    <button class="choice-btn" data-action="hs-pass-majority" data-target="${esc(p.id)}">
                      <span style="font-size:1.5rem;">${esc(p.emoji)}</span>
                      <span>${esc(p.name)}</span>
                    </button>
                  `).join('')
                : (g.options || []).map((opt, idx) => `
                    <button class="choice-btn" data-action="hs-pass-option" data-opt="${idx}">
                      <span>${esc(opt)}</span>
                    </button>
                  `).join('')
              }
            </div>
          </div>
        `;
      } else {
        // Hotspot simultaneous voting
        const isSpotSelf = g.flavor === 'spotlight' && state.myPlayerId === g.spotlightId;
        const myChoice = isSpotSelf ? (myPriv && myPriv.mySpotlightPick) : (myPriv && myPriv.myVote);
        const votedIds = isClient ? (g.votedIds || []) : Object.keys(g.votes || {});
        const spotLocked = isClient ? g.spotlightLocked : (g.spotlightPick !== null && g.spotlightPick !== undefined);

        return `
          <div class="card">
            <span class="pill-badge amber">Round ${g.round}/${g.totalRounds} • ${isSpotSelf ? '🎯 Hot Seat (Be Honest!)' : (g.flavor === 'spotlight' ? `Read ${spotPlayer ? spotPlayer.name : ''}'s Mind` : 'Car Crew Vote')}</span>
            <h2 class="card-title" style="margin-top:8px;">${esc(g.prompt)}</h2>
            <div class="choice-grid">
              ${g.flavor === 'majority'
                ? activePlayers.map((p) => `
                    <button class="choice-btn ${myChoice === p.id ? 'selected' : ''}" data-action="hs-hotspot-majority" data-target="${esc(p.id)}">
                      <span style="font-size:1.5rem;">${esc(p.emoji)}</span>
                      <span>${esc(p.name)} ${myChoice === p.id ? '✓' : ''}</span>
                    </button>
                  `).join('')
                : (g.options || []).map((opt, idx) => `
                    <button class="choice-btn ${myChoice === idx ? 'selected' : ''}" data-action="hs-hotspot-option" data-opt="${idx}">
                      <span>${esc(opt)} ${myChoice === idx ? '✓' : ''}</span>
                    </button>
                  `).join('')
              }
            </div>
            <div class="status-row">
              ${activePlayers.map((p) => {
                const done = (g.flavor === 'spotlight' && p.id === g.spotlightId) ? spotLocked : votedIds.includes(p.id);
                return `<span class="status-pill ${done ? 'done' : ''}">${esc(p.emoji)} ${esc(p.name)}</span>`;
              }).join('')}
            </div>
          </div>
        `;
      }
    }

    // REVEAL
    return `
      <div class="card">
        <span class="pill-badge">Round ${g.round}/${g.totalRounds} Results</span>
        <h2 class="card-title" style="margin-top:8px;">${esc(g.summaryText)}</h2>
        <p class="card-subtitle" style="margin-bottom:12px;">${esc(g.prompt)}</p>

        ${g.flavor === 'spotlight' && g.options ? `
          <div class="role-card" style="padding:14px;margin-bottom:12px;">
            <div class="card-subtitle">${esc(spotPlayer ? spotPlayer.emoji + ' ' + spotPlayer.name : 'Spotlight')} actually picked:</div>
            <div style="font-size:1.2rem;font-weight:900;margin-top:4px;">${esc(g.options[g.spotlightPick])}</div>
          </div>
        ` : ''}

        <div class="status-row" style="margin-bottom:14px;">
          ${Object.entries(g.votes || {}).map(([vid, val]) => {
            const vp = findPlayer(players, vid);
            let label = '';
            if (g.flavor === 'majority') {
              const tp = findPlayer(players, val);
              label = tp ? `${tp.emoji} ${tp.name}` : '?';
            } else {
              label = g.options && g.options[val] ? g.options[val].split(' ').slice(0, 3).join(' ') : '?';
            }
            return `<span class="status-pill ${g.scoreDeltas && g.scoreDeltas[vid] ? 'done' : ''}">${esc(vp ? vp.name : '?')} ➔ ${esc(label)}</span>`;
          }).join('')}
        </div>

        ${!isClient ? (
          g.round < g.totalRounds
            ? `<button class="btn btn-amber" data-action="hs-next-round">Next Question (${g.round + 1}/${g.totalRounds}) →</button>
               <button class="btn btn-surface" style="margin-top:8px;" data-action="back-to-dashboard">🏁 Switch Game</button>`
            : `<div class="btn-row">
                <button class="btn btn-mint" data-action="hs-restart">🔄 5 More Rounds</button>
                <button class="btn btn-surface" data-action="back-to-dashboard">🏁 Games</button>
              </div>`
        ) : ''}
      </div>
    `;
  }

  // 4. Render Vibe Check 1-10
  function renderVibeCheck(g, players, isClient) {
    const myPriv = isClient ? state.clientPrivate : buildPrivateStateForPlayer(state.activeGame, state.myPlayerId);
    const giver = findPlayer(players, g.giverId);
    const activePlayers = state.mode === 'pass' ? players : players.filter((p) => p.connected !== false);

    const spectrumHtml = `
      <div class="spectrum-ends">
        <div class="spectrum-box left">
          <div class="sp-num">1 = LOW END</div>
          <div class="sp-text">${esc(g.spectrum.left)}</div>
        </div>
        <div class="spectrum-box right">
          <div class="sp-num">10 = HIGH END</div>
          <div class="sp-text">${esc(g.spectrum.right)}</div>
        </div>
      </div>
    `;

    // PASS-THE-PHONE CLUE GIVER PEEK
    if (g.phase === 'clue' && state.mode === 'pass') {
      if (!g.cardOpen) {
        return renderPassPrivacyShield(giver, `Turn ${g.round}/${g.totalRounds}: You're the Clue Giver!`, `🎚️ ${giver.name} — See Secret Number`, 'vc-pass-open');
      }
      return `
        <div class="card">
          <span class="pill-badge cyan">Turn ${g.round}/${g.totalRounds} • Clue Giver: ${esc(giver.name)}</span>
          ${spectrumHtml}
          <div class="role-card">
            <div class="card-subtitle">Your Secret Target Number:</div>
            <div class="role-word" style="font-size:2.8rem;color:var(--yellow);">${g.target} / 10</div>
            <p class="card-subtitle">${esc(g.spectrum.hint)} Say ONE clue out loud that feels like a <strong>${g.target}</strong> on this scale (don't say numbers!).</p>
          </div>
          <button class="btn btn-amber" data-action="vc-pass-start-guessing">🔒 Hide Number &amp; Pass to Guessers →</button>
        </div>
      `;
    }

    // GUESSING PHASE
    if (g.phase === 'guess') {
      if (state.mode === 'pass') {
        const guesserId = g.guesserIds[g.turnIdx];
        const guesser = findPlayer(players, guesserId);
        if (!g.cardOpen) {
          return renderPassPrivacyShield(guesser, `Listen to ${giver ? giver.name : 'the'}'s clue & dial 1–10!`, `🎚️ ${guesser.name} — Lock Guess`, 'vc-pass-open');
        }
        return `
          <div class="card">
            <span class="pill-badge cyan">Guesser: ${esc(guesser.emoji)} ${esc(guesser.name)}</span>
            <h2 class="card-title" style="margin-top:6px;">Where Does ${esc(giver ? giver.name : '')}'s Clue Land?</h2>
            ${spectrumHtml}
            <div class="dial-grid">
              ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `
                <button class="dial-btn" data-action="vc-pass-dial" data-val="${n}">${n}</button>
              `).join('')}
            </div>
          </div>
        `;
      } else {
        // Hotspot Mode
        const isGiver = myPriv && myPriv.isGiver;
        const myGuess = myPriv && myPriv.myGuess;
        const guessedIds = isClient ? (g.guessedIds || []) : Object.keys(g.guesses || {});

        return `
          <div class="card">
            <span class="pill-badge cyan">Turn ${g.round}/${g.totalRounds} • DJ: ${esc(giver ? giver.emoji + ' ' + giver.name : '')}</span>
            ${spectrumHtml}
            ${isGiver ? `
              <div class="role-card">
                <div class="card-subtitle">Your Secret Target:</div>
                <div class="role-word" style="font-size:2.7rem;color:var(--yellow);">${myPriv.secretTarget} / 10</div>
                <p class="card-subtitle">${esc(g.spectrum.hint)} Say ONE clue out loud matching <strong>${myPriv.secretTarget}/10</strong>!</p>
              </div>
              <button class="btn ${g.clueReady ? 'btn-surface' : 'btn-amber'}" ${g.clueReady ? 'disabled' : ''} data-action="vc-hotspot-clue-said">
                ${g.clueReady ? '🗣️ Clue Announced — Crew Is Guessing!' : '🗣️ Tap After Saying Your Clue!'}
              </button>
            ` : `
              <h3 class="card-title" style="margin-top:8px;">Listen to ${esc(giver ? giver.name : 'DJ')}'s Clue &amp; Tap 1–10:</h3>
              <div class="dial-grid">
                ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `
                  <button class="dial-btn ${myGuess === n ? 'selected' : ''}" data-action="vc-hotspot-dial" data-val="${n}">${n}</button>
                `).join('')}
              </div>
            `}
            <div class="status-row">
              ${activePlayers.filter((p) => p.id !== g.giverId).map((p) => `
                <span class="status-pill ${guessedIds.includes(p.id) ? 'done' : ''}">${esc(p.emoji)} ${esc(p.name)}</span>
              `).join('')}
            </div>
          </div>
        `;
      }
    }

    // REVEAL
    return `
      <div class="card">
        <span class="pill-badge">🎯 Spectrum Reveal</span>
        ${spectrumHtml}
        <div class="dial-grid">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `
            <div class="dial-btn ${n === g.target ? 'target-hit' : ''}" style="opacity:${n === g.target ? '1' : '0.45'};">${n}</div>
          `).join('')}
        </div>
        <h2 class="card-title" style="text-align:center;">Exact Target: <span style="color:var(--mint);">${g.target} / 10</span></h2>

        <div class="status-row" style="justify-content:center;margin:12px 0;">
          ${Object.entries(g.guesses || {}).map(([pid, val]) => {
            const p = findPlayer(players, pid);
            const pts = (g.scoreDeltas && g.scoreDeltas[pid]) || 0;
            return `<span class="status-pill ${pts > 0 ? 'done' : ''}">${esc(p ? p.emoji + ' ' + p.name : '?')}: ${val} ${pts ? `(+${pts})` : ''}</span>`;
          }).join('')}
        </div>

        ${!isClient ? (
          g.round < g.totalRounds
            ? `<button class="btn btn-cyan" data-action="vc-next-round">Next Clue Giver (${g.round + 1}/${g.totalRounds}) →</button>
               <button class="btn btn-surface" style="margin-top:8px;" data-action="back-to-dashboard">🏁 Switch Game</button>`
            : `<div class="btn-row">
                <button class="btn btn-mint" data-action="vc-restart">🔄 Play Again</button>
                <button class="btn btn-surface" data-action="back-to-dashboard">🏁 Games</button>
              </div>`
        ) : ''}
      </div>
    `;
  }

  // 5. Render Speed Trap
  function renderSpeedTrap(g, players, isClient) {
    const myPriv = isClient ? state.clientPrivate : buildPrivateStateForPlayer(state.activeGame, state.myPlayerId);
    const speaker = findPlayer(players, g.speakerId);
    const cop = findPlayer(players, g.copId);

    if (g.phase === 'ready') {
      const canStart = state.mode === 'pass' || state.myPlayerId === g.speakerId || !isClient;
      return `
        <div class="card" style="text-align:center;">
          <span class="pill-badge coral">Turn ${g.round}/${g.totalRounds} • 35s Hot-Seat</span>
          <div class="pass-avatar-big" style="margin-top:14px;background:${esc(speaker ? speaker.color : '#ff9f1c')}26;border-color:${esc(speaker ? speaker.color : '#ff9f1c')};">
            ${esc(speaker ? speaker.emoji : '🎤')}
          </div>
          <h2 class="card-title">${esc(speaker ? speaker.name : 'Speaker')} Is Up!</h2>
          <p class="card-subtitle" style="margin:8px 0 14px;">
            ${state.mode === 'pass'
              ? `Sit next to ${esc(cop && cop.id !== speaker.id ? cop.name : 'a referee')} so they can watch the 4 Forbidden Words while the rest of the car shouts guesses!`
              : `🚓 <strong>${esc(cop ? cop.emoji + ' ' + cop.name : 'Referee')}</strong> has the live Forbidden-Word Buzzer on their phone! Everyone else: shout guesses fast!`
            }
          </p>
          ${canStart ? `
            <button class="btn btn-amber" data-action="st-start">🚦 START 35s BLITZ!</button>
          ` : `
            <p class="helper-note">Get ready to shout guesses when ${esc(speaker ? speaker.name : 'Speaker')} hits Start!</p>
          `}
        </div>
      `;
    }

    if (g.phase === 'active') {
      const card = state.mode === 'pass' ? g.currentCard : (myPriv && myPriv.currentCard);
      const role = state.mode === 'pass' ? 'both' : (myPriv && myPriv.role);

      return `
        <div class="card">
          <div class="timer-banner ${g.secondsLeft <= 8 ? 'urgent' : ''}">
            ⏱️ ${g.secondsLeft}s • ✅ ${g.gotCount} (${g.turnScore} pts)
          </div>

          ${role === 'guesser' ? `
            <div style="text-align:center;padding:22px 10px;">
              <div style="font-size:3rem;">🗣️</div>
              <h2 class="card-title" style="margin-top:8px;">SHOUT OUT GUESSES!</h2>
              <p class="card-subtitle" style="margin-top:6px;">
                Listen to <strong>${esc(speaker ? speaker.name : 'Speaker')}</strong>! Every word the car gets gives you <strong>+50 Assist pts</strong>!
              </p>
              <div class="helper-note" style="margin-top:14px;">
                🚓 Officer <strong>${esc(cop ? cop.name : 'Cop')}</strong> is watching the 4 Forbidden Words with the red buzzer!
              </div>
            </div>
          ` : `
            <div class="taboo-card">
              <div style="font-size:0.76rem;font-weight:800;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px;">
                ${role === 'cop' ? `🚓 Watch ${esc(speaker ? speaker.name : 'Speaker')} — Forbidden Words:` : 'Describe Without Saying:'}
              </div>
              <div class="taboo-target">${esc(card ? card.word : '')}</div>
              <div class="taboo-list">
                ${(card ? card.taboo : []).map((tw) => `<div class="taboo-word">🚫 ${esc(tw)}</div>`).join('')}
              </div>
            </div>

            ${role === 'both' ? `
              <div class="btn-row" style="margin-bottom:10px;">
                <button class="btn btn-mint" data-action="st-outcome" data-outcome="got">✅ Got It (+150)</button>
                <button class="btn btn-surface" data-action="st-outcome" data-outcome="skip">⏭️ Skip</button>
              </div>
              <button class="btn btn-coral" data-action="st-outcome" data-outcome="buzz">🚨 Said Forbidden Word (-50)</button>
            ` : role === 'speaker' ? `
              <div class="btn-row">
                <button class="btn btn-mint" data-action="st-outcome" data-outcome="got">✅ Car Got It! (+150)</button>
                <button class="btn btn-surface" data-action="st-outcome" data-outcome="skip">⏭️ Skip</button>
              </div>
            ` : `
              <button class="giant-buzzer" data-action="st-outcome" data-outcome="buzz">
                <span>🚨 BUZZ!</span>
                <span style="font-size:0.9rem;font-weight:700;">Said a Forbidden Word!</span>
              </button>
              <button class="btn btn-mint" style="margin-top:10px;" data-action="st-outcome" data-outcome="got">✅ Car Guessed It! (+150)</button>
            `}
          `}
        </div>
      `;
    }

    // SUMMARY
    return `
      <div class="card">
        <span class="pill-badge">🏁 Turn ${g.round}/${g.totalRounds} Complete</span>
        <h2 class="card-title" style="margin-top:8px;">
          ${esc(speaker ? speaker.emoji + ' ' + speaker.name : 'Speaker')} nailed ${g.gotCount} ${g.gotCount === 1 ? 'word' : 'words'}! (${g.turnScore >= 0 ? '+' : ''}${g.turnScore} pts)
        </h2>

        ${(g.history && g.history.length > 0) ? `
          <div class="status-row" style="margin:12px 0;">
            ${g.history.map((h) => `
              <span class="status-pill ${h.outcome === 'got' ? 'done' : ''}">
                ${h.outcome === 'got' ? '✅' : (h.outcome === 'buzz' ? '🚨' : '⏭️')} ${esc(h.word)}
              </span>
            `).join('')}
          </div>
        ` : `<p class="card-subtitle" style="margin:10px 0;">Tough deck! Ready for the next driver?</p>`}

        ${!isClient ? (
          g.round < g.totalRounds
            ? `<button class="btn btn-amber" data-action="st-next-round">Next Speaker (${g.round + 1}/${g.totalRounds}) →</button>
               <button class="btn btn-surface" style="margin-top:8px;" data-action="back-to-dashboard">🏁 Switch Game</button>`
            : `<div class="btn-row">
                <button class="btn btn-mint" data-action="st-restart">🔄 Another Lap</button>
                <button class="btn btn-surface" data-action="back-to-dashboard">🏁 Games</button>
              </div>`
        ) : ''}
      </div>
    `;
  }

  function renderInviteModal() {
    if (!state.showInviteModal || state.mode !== 'hotspot-host') return '';
    const url = state.serverInfo.selectedUrl || `http://192.168.43.1:${state.serverInfo.port || 8080}`;
    let qrSvg = '';
    try {
      qrSvg = QRCodeSVG.renderSVG(url);
    } catch (_) {}
    return `
      <div class="modal-backdrop" data-action="close-invite">
        <div class="modal-sheet" onclick="event.stopPropagation()">
          <div class="card-header">
            <h3 class="card-title">📡 Hotspot Join Link</h3>
            <button class="icon-btn" data-action="close-invite">✕</button>
          </div>
          ${qrSvg ? `<div class="qr-wrap">${qrSvg}</div>` : ''}
          <div class="url-box">${esc(url)}</div>
          <div class="status-row" style="justify-content:center;">
            ${state.players.map((p) => `<span class="status-pill ${p.connected ? 'done' : ''}">${esc(p.emoji)} ${esc(p.name)}</span>`).join('')}
          </div>
          <button class="btn btn-surface" style="margin-top:10px;" data-action="close-invite">Done</button>
        </div>
      </div>
    `;
  }

  function render() {
    const root = document.getElementById('app');
    if (!root) return;

    let content = '';
    if (state.screen === 'home') content = renderHome();
    else if (state.screen === 'pass-setup') content = renderPassSetup();
    else if (state.screen === 'hotspot-guide') content = renderHotspotGuide();
    else if (state.screen === 'hotspot-host-lobby') content = renderHotspotHostLobby();
    else if (state.screen === 'hotspot-client-join') content = renderHotspotClientJoin();
    else if (state.screen === 'dashboard') content = renderDashboard();
    else if (state.screen === 'game') content = renderGameScreen();

    root.innerHTML = renderTopBar() + content + renderInviteModal();
  }

  // =========================================================================
  // EVENT DELEGATION (Clicks & Smooth Non-Rerendering Inputs!)
  // =========================================================================

  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (!el || !el.dataset) return;
    const kind = el.dataset.input;
    if (kind === 'player-name') {
      const idx = Number(el.dataset.idx);
      if (state.players[idx]) state.players[idx].name = el.value;
    } else if (kind === 'host-name') {
      state.hostName = el.value;
      saveProfile(state.hostName, state.hostAvatarIdx);
      const hp = findPlayer(state.players, state.myPlayerId);
      if (hp) hp.name = state.hostName.trim() || 'Captain';
      syncHostToClients();
    } else if (kind === 'client-name') {
      state.clientName = el.value;
      saveProfile(state.clientName, state.clientAvatarIdx);
    } else if (kind === 'join-ip') {
      state.joinIpInput = el.value;
    }
  });

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;

    switch (action) {
      case 'toggle-mute':
        SoundFX.toggleMute();
        render();
        break;

      case 'honk':
        if (state.mode === 'hotspot-client' || state.mode === 'hotspot-host') {
          sendClientAction({ kind: 'reaction', emoji: '📯', label: 'BEEP BEEP! 📯' });
        } else {
          SoundFX.honk();
          showToast('📯 BEEP BEEP! Keep eyes on the road!', '#ffd166');
        }
        break;

      case 'nav-back':
        handleBackNavigation();
        break;

      case 'open-invite':
        state.showInviteModal = true;
        SoundFX.tap();
        render();
        break;

      case 'close-invite':
        state.showInviteModal = false;
        render();
        break;

      case 'choose-pass':
        SoundFX.tap();
        stopHotspotIfHosting();
        state.mode = 'pass';
        // Ensure clean local crew if coming from hotspot
        if (state.players.length < 2) {
          resetPassCrew(4);
        }
        state.screen = 'pass-setup';
        render();
        break;

      case 'preset-3p':
        SoundFX.tap();
        resetPassCrew(3);
        render();
        break;

      case 'preset-4p':
        SoundFX.tap();
        resetPassCrew(4);
        render();
        break;

      case 'cycle-avatar': {
        SoundFX.tap();
        const idx = Number(btn.dataset.idx);
        const p = state.players[idx];
        if (p) {
          const curAvIdx = GameData.AVATARS.findIndex((a) => a.emoji === p.emoji);
          const next = GameData.AVATARS[(curAvIdx + 1) % GameData.AVATARS.length];
          p.emoji = next.emoji;
          p.color = next.color;
          render();
        }
        break;
      }

      case 'toggle-driver': {
        SoundFX.tap();
        const idx = Number(btn.dataset.idx);
        if (state.players[idx]) {
          state.players[idx].isDriver = !state.players[idx].isDriver;
          render();
        }
        break;
      }

      case 'add-player': {
        if (state.players.length < 6) {
          SoundFX.tap();
          const n = state.players.length;
          const av = GameData.AVATARS[n % GameData.AVATARS.length];
          state.players.push({
            id: 'local_' + Date.now() + '_' + n,
            name: `Player ${n + 1}`,
            emoji: av.emoji,
            color: av.color,
            score: 0,
            isDriver: false,
            connected: true,
            isHost: false
          });
          render();
        }
        break;
      }

      case 'remove-player': {
        const idx = Number(btn.dataset.idx);
        if (state.players.length > 2) {
          SoundFX.tap();
          state.players.splice(idx, 1);
          render();
        }
        break;
      }

      case 'start-pass-session':
        SoundFX.pop();
        state.players.forEach((p, i) => {
          p.name = p.name.trim() || `Player ${i + 1}`;
        });
        requestWakeLock();
        state.screen = 'dashboard';
        render();
        break;

      case 'choose-hotspot':
        SoundFX.tap();
        if (isNativeApk) {
          enterHotspotHostMode();
        } else if (state.servedByHotspot) {
          state.mode = 'hotspot-client';
          state.screen = 'hotspot-client-join';
          ensureWebSocket();
          render();
        } else {
          state.screen = 'hotspot-guide';
          render();
        }
        break;

      case 'reenter-client':
        SoundFX.tap();
        state.mode = 'hotspot-client';
        state.screen = 'hotspot-client-join';
        ensureWebSocket();
        render();
        break;

      case 'go-host-ip': {
        let raw = state.joinIpInput.trim();
        if (!raw) return;
        if (!/^https?:\/\//i.test(raw)) {
          if (!raw.includes(':')) raw += ':8080';
          raw = 'http://' + raw;
        }
        window.location.href = raw;
        break;
      }

      case 'refresh-ip':
        SoundFX.tap();
        refreshNativeServerInfo();
        showToast('🔄 Refreshed network interfaces', '#4cc9f0');
        break;

      case 'select-ip-url':
        SoundFX.tap();
        state.serverInfo.selectedUrl = btn.dataset.url;
        render();
        break;

      case 'open-hotspot-settings':
        SoundFX.tap();
        if (window.RoadTripNative && typeof window.RoadTripNative.openHotspotSettings === 'function') {
          window.RoadTripNative.openHotspotSettings();
        }
        break;

      case 'copy-join-url': {
        const u = state.serverInfo.selectedUrl;
        if (navigator.clipboard && u) {
          navigator.clipboard.writeText(u).then(() => showToast('📋 Join URL copied!', '#06d6a0')).catch(() => {});
        }
        break;
      }

      case 'cycle-host-avatar': {
        SoundFX.tap();
        state.hostAvatarIdx = (state.hostAvatarIdx + 1) % GameData.AVATARS.length;
        saveProfile(state.hostName, state.hostAvatarIdx);
        const av = GameData.AVATARS[state.hostAvatarIdx];
        const hp = findPlayer(state.players, state.myPlayerId);
        if (hp) {
          hp.emoji = av.emoji;
          hp.color = av.color;
        }
        syncHostToClients();
        render();
        break;
      }

      case 'host-enter-dashboard':
        SoundFX.fanfare();
        state.screen = 'dashboard';
        syncHostToClients();
        render();
        break;

      case 'cycle-client-avatar':
        SoundFX.tap();
        state.clientAvatarIdx = (state.clientAvatarIdx + 1) % GameData.AVATARS.length;
        saveProfile(state.clientName, state.clientAvatarIdx);
        render();
        break;

      case 'submit-client-join':
        if (!state.clientName.trim()) {
          state.clientName = 'Rider ' + Math.floor(10 + Math.random() * 89);
        }
        saveProfile(state.clientName, state.clientAvatarIdx);
        state.clientJoined = true;
        SoundFX.pop();
        ensureWebSocket();
        sendClientJoin();
        render();
        break;

      case 'react':
        sendClientAction({
          kind: 'reaction',
          emoji: btn.dataset.emoji,
          label: btn.dataset.label
        });
        break;

      case 'reset-scores':
        SoundFX.tap();
        state.players.forEach((p) => { p.score = 0; });
        syncHostToClients();
        render();
        break;

      case 'launch-game':
        startGame(btn.dataset.game);
        break;

      case 'back-to-dashboard':
        clearInterval(gameTickInterval);
        state.activeGame = null;
        state.screen = 'dashboard';
        SoundFX.tap();
        syncHostToClients();
        render();
        break;

      // ---- Window Wars Actions ----
      case 'tap-bingo-tile': {
        const idx = Number(btn.dataset.idx);
        if (state.mode === 'pass') {
          SoundFX.tap();
          state.activeGame.pickingTileIdx = idx;
          render();
        } else {
          sendClientAction({ kind: 'bingo_claim', tileIdx: idx });
        }
        break;
      }

      case 'close-bingo-picker':
        if (state.activeGame) {
          state.activeGame.pickingTileIdx = null;
          render();
        }
        break;

      case 'confirm-bingo-claim':
        claimBingoTile(state.activeGame.pickingTileIdx, btn.dataset.pid);
        break;

      case 'bingo-veto':
        undoLastBingoClaim();
        break;

      case 'bingo-new-board':
        SoundFX.pop();
        state.activeGame = createWindowWarsGame();
        syncHostToClients();
        render();
        break;

      // ---- Undercover Actions ----
      case 'uc-pass-open':
        SoundFX.tap();
        state.activeGame.cardOpen = true;
        render();
        break;

      case 'uc-pass-next': {
        SoundFX.tap();
        const g = state.activeGame;
        g.cardOpen = false;
        g.turnIdx++;
        if (g.turnIdx >= state.players.length) {
          g.phase = 'discuss';
          g.turnIdx = 0;
          startUndercoverTimer();
        }
        render();
        break;
      }

      case 'uc-hotspot-ready':
        sendClientAction({ kind: 'uc_ready' });
        break;

      case 'uc-force-discuss':
        if (state.activeGame) {
          state.activeGame.phase = 'discuss';
          startUndercoverTimer();
          syncHostToClients();
          render();
        }
        break;

      case 'toggle-ticket-peek':
        SoundFX.tap();
        state.clientTicketOpen = !state.clientTicketOpen;
        render();
        break;

      case 'uc-open-voting':
        clearInterval(gameTickInterval);
        state.activeGame.phase = 'vote';
        state.activeGame.turnIdx = 0;
        state.activeGame.cardOpen = false;
        broadcastEvent('pop', '🗳️ Voting is open! Pick the Impostor!', '#ff4d6d');
        syncHostToClients();
        render();
        break;

      case 'uc-pass-vote': {
        SoundFX.tap();
        const g = state.activeGame;
        const voter = state.players[g.turnIdx];
        g.votes[voter.id] = btn.dataset.suspect;
        g.cardOpen = false;
        g.turnIdx++;
        if (g.turnIdx >= state.players.length) {
          resolveUndercoverVotes();
        } else {
          render();
        }
        break;
      }

      case 'uc-hotspot-vote':
        sendClientAction({ kind: 'uc_vote', suspectId: btn.dataset.suspect });
        break;

      case 'uc-steal-pick':
        if (state.mode === 'pass') {
          resolveUndercoverSteal(btn.dataset.word);
        } else {
          sendClientAction({ kind: 'uc_steal', word: btn.dataset.word });
        }
        break;

      case 'uc-play-again':
        startGame('undercover');
        break;

      // ---- Hot Seat Actions ----
      case 'hs-pass-open':
        SoundFX.tap();
        state.activeGame.cardOpen = true;
        render();
        break;

      case 'hs-pass-majority': {
        SoundFX.tap();
        const g = state.activeGame;
        const voter = state.players[g.turnIdx];
        g.votes[voter.id] = btn.dataset.target;
        g.cardOpen = false;
        g.turnIdx++;
        if (g.turnIdx >= state.players.length) {
          checkAndResolveHotSeat();
        } else {
          render();
        }
        break;
      }

      case 'hs-pass-option': {
        SoundFX.tap();
        const g = state.activeGame;
        const voter = state.players[g.turnIdx];
        const optIdx = Number(btn.dataset.opt);
        if (voter.id === g.spotlightId) {
          g.spotlightPick = optIdx;
        } else {
          g.votes[voter.id] = optIdx;
        }
        g.cardOpen = false;
        g.turnIdx++;
        if (g.turnIdx >= state.players.length) {
          checkAndResolveHotSeat();
        } else {
          render();
        }
        break;
      }

      case 'hs-hotspot-majority':
        sendClientAction({ kind: 'hs_vote', targetId: btn.dataset.target });
        break;

      case 'hs-hotspot-option':
        sendClientAction({ kind: 'hs_option', optIdx: Number(btn.dataset.opt) });
        break;

      case 'hs-next-round':
        SoundFX.pop();
        state.activeGame = createHotSeatGame(state.activeGame.round + 1);
        syncHostToClients();
        render();
        break;

      case 'hs-restart':
        startGame('hot-seat');
        break;

      // ---- Vibe Check Actions ----
      case 'vc-pass-open':
        SoundFX.tap();
        state.activeGame.cardOpen = true;
        render();
        break;

      case 'vc-pass-start-guessing':
        SoundFX.tap();
        state.activeGame.phase = 'guess';
        state.activeGame.turnIdx = 0;
        state.activeGame.cardOpen = false;
        render();
        break;

      case 'vc-pass-dial': {
        SoundFX.tap();
        const g = state.activeGame;
        const guesserId = g.guesserIds[g.turnIdx];
        g.guesses[guesserId] = Number(btn.dataset.val);
        g.cardOpen = false;
        g.turnIdx++;
        if (g.turnIdx >= g.guesserIds.length) {
          checkAndResolveVibeCheck();
        } else {
          render();
        }
        break;
      }

      case 'vc-hotspot-clue-said':
        sendClientAction({ kind: 'vc_clue_ready' });
        break;

      case 'vc-hotspot-dial':
        sendClientAction({ kind: 'vc_guess', val: Number(btn.dataset.val) });
        break;

      case 'vc-next-round':
        SoundFX.pop();
        state.activeGame = createVibeCheckGame(state.activeGame.round + 1);
        syncHostToClients();
        render();
        break;

      case 'vc-restart':
        startGame('vibe-check');
        break;

      // ---- Speed Trap Actions ----
      case 'st-start':
        if (state.mode === 'pass') {
          startSpeedTrapCountdown();
        } else {
          sendClientAction({ kind: 'st_start' });
        }
        break;

      case 'st-outcome':
        if (state.mode === 'pass') {
          handleSpeedTrapCardOutcome(btn.dataset.outcome);
        } else {
          sendClientAction({ kind: 'st_outcome', outcome: btn.dataset.outcome });
        }
        break;

      case 'st-next-round':
        SoundFX.pop();
        state.activeGame = createSpeedTrapGame(state.activeGame.round + 1);
        syncHostToClients();
        render();
        break;

      case 'st-restart':
        startGame('speed-trap');
        break;
    }
  });

  function resetPassCrew(count) {
    const defaults = [
      { name: 'Shotgun', isDriver: false },
      { name: 'Back Left', isDriver: false },
      { name: 'Back Right', isDriver: false },
      { name: 'Driver', isDriver: true }
    ];
    state.players = Array.from({ length: count }, (_, i) => {
      const av = GameData.AVATARS[i % GameData.AVATARS.length];
      const d = defaults[i] || { name: `Player ${i + 1}`, isDriver: false };
      return {
        id: 'local_' + (i + 1),
        name: d.name,
        emoji: av.emoji,
        color: av.color,
        score: 0,
        isDriver: i === count - 1 ? d.isDriver : false,
        connected: true,
        isHost: i === 0
      };
    });
  }

  function enterHotspotHostMode() {
    state.mode = 'hotspot-host';
    const av = GameData.AVATARS[state.hostAvatarIdx % GameData.AVATARS.length];
    state.players = [
      {
        id: state.myPlayerId,
        name: state.hostName.trim() || 'Captain',
        emoji: av.emoji,
        color: av.color,
        score: 0,
        isDriver: false,
        connected: true,
        isHost: true
      }
    ];
    if (window.RoadTripNative && typeof window.RoadTripNative.setHotspotEnabled === 'function') {
      try {
        window.RoadTripNative.setHotspotEnabled(true);
      } catch (_) {}
    }
    state.screen = 'hotspot-host-lobby';
    requestWakeLock();
    refreshNativeServerInfo();
    ensureWebSocket();
    render();
  }

  function stopHotspotIfHosting() {
    if (state.mode === 'hotspot-host') {
      if (window.RoadTripNative && typeof window.RoadTripNative.setHotspotEnabled === 'function') {
        try {
          window.RoadTripNative.setHotspotEnabled(false);
        } catch (_) {}
      }
      if (ws) {
        try { ws.close(); } catch (_) {}
        ws = null;
      }
    }
  }

  function handleBackNavigation() {
    SoundFX.tap();
    if (state.showInviteModal) {
      state.showInviteModal = false;
      render();
      return true;
    }
    if (state.activeGame && state.activeGame.pickingTileIdx !== null && state.activeGame.pickingTileIdx !== undefined) {
      state.activeGame.pickingTileIdx = null;
      render();
      return true;
    }
    if (state.screen === 'game') {
      if (state.mode === 'hotspot-client') {
        state.screen = 'hotspot-client-join';
      } else {
        clearInterval(gameTickInterval);
        state.activeGame = null;
        state.screen = 'dashboard';
        syncHostToClients();
      }
      render();
      return true;
    }
    if (state.screen === 'dashboard') {
      if (state.mode === 'pass') state.screen = 'pass-setup';
      else if (state.mode === 'hotspot-host') {
        state.screen = 'hotspot-host-lobby';
        syncHostToClients();
      } else {
        state.screen = 'home';
      }
      render();
      return true;
    }
    if (state.screen !== 'home') {
      stopHotspotIfHosting();
      state.mode = 'none';
      state.screen = 'home';
      render();
      return true;
    }
    return false;
  }

  // Native Android callbacks
  window.onAndroidBackPressed = function () {
    return handleBackNavigation();
  };

  window.onNativeNetworkChanged = function () {
    if (state.mode === 'hotspot-host') {
      refreshNativeServerInfo();
    }
  };

  // Boot!
  render();
  probeHotspotServer();
})();
