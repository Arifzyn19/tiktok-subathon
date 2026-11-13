<script lang="ts">
  import { onMount } from "svelte";
  import { io, type Socket } from "socket.io-client";
  import { apiUrl, type Activity, type Settings, type TimerState } from "$lib/types";

  let token = "";
  let authenticated = false;
  let timer: TimerState = { remainingMs: 3_600_000, status: "idle", totalCoins: 0, totalDonations: 0, totalAddedMs: 0, serverTime: Date.now() };
  let settings: Settings = { tiktokUsername: "", tiktokCoinSeconds: 10, saweriaMinimumRupiah: 1000, saweriaRupiahStep: 1000, saweriaMinutesPerStep: 15 };
  let activity: Activity[] = [];
  let activityFilter: "all" | "gift" | "donation" = "all";
  let tiktokStatus = "disconnected";
  let saweriaStatus = "not_configured";
  let busy = false;
  let error = "";
  let adjustment = 60;
  let displayNow = Date.now();
  let socket: Socket | undefined;
  $: remaining = timer.status === "running" ? Math.max(0, timer.remainingMs - (displayNow - timer.serverTime)) : timer.remainingMs;
  $: visibleActivity = activityFilter === "all" ? activity : activity.filter((item) => item.type === activityFilter);

  function formatTime(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function formatAdded(ms: number): string {
    const minutes = Math.round(ms / 60_000);
    return minutes >= 1 ? `+${minutes} mnt` : `+${Math.round(ms / 1000)} dtk`;
  }

  async function request(path: string, method = "GET", body?: unknown): Promise<any> {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `Request gagal (${response.status})`);
    return result;
  }

  async function loadDashboard(): Promise<void> {
    error = "";
    try {
      const state = await request("/api/state");
      timer = state.timer;
      settings = state.settings;
      tiktokStatus = state.connections.tiktok;
      saweriaStatus = state.connections.saweria;
      const history = await request("/api/history");
      activity = [
        ...history.gifts.map((item: any) => ({ type: "gift", id: item.id, senderName: item.senderName, description: `${item.name} · ${item.amount} coin`, amount: item.amount, addedMs: item.addedMs, createdAt: item.createdAt })),
        ...history.donations.map((item: any) => ({ type: "donation", id: item.id, senderName: item.senderName, description: item.message || "Donasi Saweria", amount: item.amount, addedMs: item.addedMs, createdAt: item.createdAt }))
      ].sort((a: Activity, b: Activity) => b.createdAt - a.createdAt).slice(0, 40);
      authenticated = true;
      localStorage.setItem("subathon-admin-token", token);
      if (!socket) {
        socket = io(apiUrl, { transports: ["websocket", "polling"] });
        socket.on("timer:update", (value: TimerState) => { timer = value; });
        socket.on("connection:status", (value: { tiktok: string; saweria: string }) => {
          tiktokStatus = value.tiktok;
          saweriaStatus = value.saweria;
        });
        socket.on("activity:new", (item: Activity) => { activity = [item, ...activity.filter((entry) => entry.id !== item.id)].slice(0, 40); });
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Tidak dapat memuat dashboard";
      authenticated = false;
    }
  }

  async function timerAction(action: string, body?: unknown): Promise<void> {
    busy = true;
    error = "";
    try { timer = await request(`/api/timer/${action}`, "POST", body); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Aksi timer gagal"; }
    finally { busy = false; }
  }

  async function saveSettings(): Promise<void> {
    busy = true;
    error = "";
    try {
      const result = await request("/api/settings", "PUT", settings);
      settings = result.settings;
      tiktokStatus = result.connections.tiktok;
      saweriaStatus = result.connections.saweria;
    } catch (cause) { error = cause instanceof Error ? cause.message : "Pengaturan gagal disimpan"; }
    finally { busy = false; }
  }

  function connect(): void { void loadDashboard(); }

  onMount(() => {
    token = localStorage.getItem("subathon-admin-token") ?? "";
    if (token) void loadDashboard();
    const interval = window.setInterval(() => { displayNow = Date.now(); }, 250);
    return () => { window.clearInterval(interval); socket?.disconnect(); };
  });
</script>

<style>
  :global(body) { color: #e7ece8; }
  .app-shell { display: flex; min-height: 100vh; }
  .sidebar { position: fixed; inset: 0 auto 0 0; z-index: 3; display: flex; width: 244px; flex-direction: column; padding: 27px 16px 18px; border-right: 1px solid #252b27; background: #131815; }
  .brand { display: flex; align-items: center; gap: 11px; padding: 0 8px; }
  .brand-mark { display: grid; width: 35px; height: 35px; place-items: center; border: 1px solid #3c6348; border-radius: 11px; color: #a4d5b3; background: #1a2a20; font-size: 19px; font-weight: 750; }
  .brand strong { display: block; color: #edf2ee; font-size: 15px; letter-spacing: -.04em; }
  .brand small { display: block; margin-top: 2px; color: #718078; font-size: 8px; font-weight: 700; letter-spacing: .16em; }
  .workspace-label { margin: 48px 10px 12px; color: #647169; font-size: 9px; font-weight: 750; letter-spacing: .14em; }
  .nav-item { display: flex; height: 41px; align-items: center; gap: 11px; margin: 2px 0; padding: 0 10px; border-radius: 8px; color: #9aa59e; font-size: 12px; text-decoration: none; }
  .nav-item.active { color: #dcf0e2; background: #1b2820; }
  .nav-icon { width: 17px; color: #8daf97; font-size: 17px; text-align: center; }
  .nav-dot { width: 6px; height: 6px; margin-left: auto; border-radius: 50%; background: #6bc48d; box-shadow: 0 0 10px #6bc48d55; }
  .sidebar-bottom { margin-top: auto; }
  .live-status { display: flex; align-items: center; gap: 10px; padding: 11px 9px; border-top: 1px solid #222a25; }
  .live-status > span { width: 7px; height: 7px; border-radius: 50%; background: #6b756e; }
  .live-status > span.online { background: #6bc48d; box-shadow: 0 0 9px #6bc48d66; }
  .live-status b, .live-status small { display: block; }
  .live-status b { color: #cbd4ce; font-size: 11px; font-weight: 600; }
  .live-status small { margin-top: 2px; color: #758179; font-size: 9px; text-transform: capitalize; }
  .logout { display: flex; width: 100%; justify-content: space-between; margin-top: 13px; padding: 13px 10px 0; border: 0; border-top: 1px solid #222a25; color: #849087; background: transparent; font-size: 11px; }
  .main-content { width: min(100% - 244px, 1120px); margin-left: 244px; padding: 32px 54px 25px; }
  .topbar { display: flex; min-height: 66px; align-items: center; justify-content: space-between; margin-bottom: 27px; }
  .eyebrow { margin: 0; color: #77847a; font-size: 9px; font-weight: 750; letter-spacing: .15em; }
  .topbar h1 { margin: 6px 0 0; color: #f0f3f1; font-size: 23px; font-weight: 620; letter-spacing: -.05em; }
  .top-actions { display: flex; align-items: center; gap: 12px; }
  .live-pill, .feed-live { display: inline-flex; align-items: center; gap: 7px; padding: 7px 9px; border: 1px solid #35443a; border-radius: 6px; color: #95bd9f; font-size: 8px; font-weight: 750; letter-spacing: .1em; }
  .live-pill i, .feed-live i { width: 5px; height: 5px; border-radius: 50%; background: #6bc48d; }
  .overlay-link { color: #aab7ad; font-size: 10px; text-decoration: none; }
  .overlay-link span { color: #83b193; }
  .mobile-brand { display: none; }
  .timer-panel { position: relative; overflow: hidden; padding: 22px 26px 18px; border: 1px solid #2a342d; border-radius: 13px; background: #171d19; }
  .timer-meta { display: flex; justify-content: space-between; }
  .timer-meta > div { display: flex; align-items: center; gap: 8px; }
  .live-pulse { width: 6px; height: 6px; border-radius: 50%; background: #72c890; box-shadow: 0 0 9px #72c89088; }
  .state-label { color: #7d8b81; font-size: 8px; font-weight: 700; letter-spacing: .1em; }
  .timer-display { margin: 25px 0 0; color: #edf4ee; font-size: clamp(62px, 9vw, 91px); font-weight: 560; letter-spacing: -.075em; line-height: 1.08; text-align: center; text-shadow: 0 0 38px #76bf8c0d; }
  .timer-subtitle { margin-top: 4px; color: #75827a; font-size: 11px; text-align: center; }
  .timer-controls { display: flex; justify-content: center; gap: 8px; margin-top: 22px; }
  .button { display: inline-flex; min-height: 35px; align-items: center; justify-content: center; gap: 9px; padding: 0 13px; border: 1px solid transparent; border-radius: 7px; font-size: 10px; font-weight: 650; transition: background .15s, border-color .15s, transform .15s; }
  .button:active { transform: translateY(1px); }
  .button:disabled, .adjust-button:disabled { cursor: not-allowed; opacity: .6; }
  .button.primary { border-color: #60916d; color: #102016; background: #88c699; }
  .button.primary:hover { background: #9ad5a9; }
  .button.secondary { border-color: #343e37; color: #c0c9c2; background: #1a211c; }
  .button.secondary:hover { border-color: #526457; }
  .manual-adjust { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 20px; padding-top: 16px; border-top: 1px solid #262f29; color: #819087; font-size: 10px; }
  .adjust-control { display: flex; align-items: center; gap: 4px; margin-left: 4px; color: #748078; }
  .adjust-control input { width: 55px; border: 0; color: #d3ded5; background: transparent; text-align: right; outline: none; }
  .adjust-button { width: 25px; height: 25px; border: 1px solid #38433b; border-radius: 6px; color: #bdc8c0; background: #202821; font-size: 15px; }
  .adjust-button.add { border-color: #456a4e; color: #a7d6b3; background: #203326; }
  .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 13px; }
  .stat { min-height: 105px; padding: 15px 16px 13px; border: 1px solid #29322c; border-radius: 10px; background: #171d19; }
  .stat-title { display: flex; align-items: center; justify-content: space-between; color: #829087; font-size: 8px; font-weight: 750; letter-spacing: .11em; }
  .stat-icon { color: #84bc93; font-size: 11px; }
  .stat > strong { display: block; overflow: hidden; margin-top: 10px; color: #e7eee8; font-size: 22px; font-weight: 620; letter-spacing: -.04em; text-overflow: ellipsis; white-space: nowrap; }
  .stat > small { display: block; margin-top: 2px; color: #748078; font-size: 9px; }
  .activity-panel, .settings-panel { margin-top: 27px; }
  .section-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 11px; }
  .section-heading h2 { margin: 5px 0 0; color: #e6ece7; font-size: 15px; font-weight: 600; letter-spacing: -.02em; }
  .activity-tools { display: flex; align-items: center; gap: 9px; }
  .feed-tabs { display: flex; gap: 2px; padding: 2px; border: 1px solid #2e3931; border-radius: 7px; background: #171d19; }
  .feed-tabs button { padding: 5px 7px; border: 0; border-radius: 5px; color: #839087; background: transparent; font-size: 8px; }
  .feed-tabs button.chosen { color: #cae5d1; background: #26372b; }
  .feed-live { padding: 5px 7px; font-size: 7px; }
  .activity-list { max-height: 460px; overflow: auto; border: 1px solid #29322c; border-radius: 10px; background: #171d19; }
  .activity-row { display: flex; min-height: 56px; align-items: center; gap: 11px; padding: 9px 13px; border-bottom: 1px solid #242c27; }
  .activity-row:last-child { border-bottom: 0; }
  .activity-icon { display: grid; width: 31px; height: 31px; flex: 0 0 auto; place-items: center; border-radius: 9px; color: #9dd5ac; background: #213327; font-size: 11px; font-weight: 700; }
  .activity-icon.donation { color: #c5b88a; background: #302c20; font-size: 9px; }
  .activity-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
  .activity-copy strong { color: #dce5de; font-size: 10px; font-weight: 620; }
  .activity-copy span { overflow: hidden; color: #7d8981; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
  .activity-value { min-width: 75px; text-align: right; }
  .activity-value strong, .activity-value small { display: block; }
  .activity-value strong { color: #c8d3ca; font-size: 9px; font-weight: 600; }
  .activity-value small { margin-top: 3px; color: #86ba94; font-size: 8px; }
  .activity-row time { min-width: 35px; color: #68756c; font-size: 8px; text-align: right; }
  .empty-state { display: flex; min-height: 118px; flex-direction: column; align-items: center; justify-content: center; border: 1px solid #29322c; border-radius: 10px; color: #77847b; background: #171d19; }
  .empty-state > span { color: #86bb94; font-size: 21px; }
  .empty-state p { margin: 7px 0 3px; color: #c3cdc5; font-size: 10px; }
  .empty-state small { font-size: 9px; }
  .settings-panel { padding: 17px; border: 1px solid #29322c; border-radius: 10px; background: #171d19; }
  .settings-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 13px; }
  .settings-grid label { display: flex; flex-direction: column; gap: 6px; color: #919d94; font-size: 9px; }
  .field-with-prefix, .field-prefix, .field-suffix { display: flex; min-height: 34px; align-items: center; gap: 7px; padding: 0 9px; border: 1px solid #303a33; border-radius: 6px; color: #7e8c82; background: #131915; }
  .field-with-prefix input, .field-prefix input, .field-suffix input { width: 100%; min-width: 0; border: 0; outline: 0; color: #d7e0d9; background: transparent; font-size: 10px; }
  .field-suffix span { flex: 0 0 auto; color: #748178; font-size: 8px; }
  .settings-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; padding-top: 13px; border-top: 1px solid #252e28; }
  .settings-footer p { max-width: 360px; margin: 0; color: #77837a; font-size: 9px; line-height: 1.6; }
  .notice { margin: -12px 0 15px; padding: 10px 12px; border: 1px solid #66423c; border-radius: 7px; color: #e4a397; background: #261b19; font-size: 10px; }
  footer { margin-top: 25px; color: #606c63; font-size: 9px; text-align: center; }
  footer span { padding: 0 4px; }
  .login-shell { display: grid; min-height: 100vh; place-items: center; padding: 20px; background: radial-gradient(ellipse at 50% 42%, #1b2820 0%, #111513 58%); }
  .login-panel { width: min(390px, 100%); padding: 29px; border: 1px solid #303c33; border-radius: 14px; background: #171d19; box-shadow: 0 20px 70px #0003; }
  .login-panel .brand-mark { margin-bottom: 24px; }
  .login-panel h1 { margin: 7px 0; color: #e9f0eb; font-size: 22px; letter-spacing: -.04em; }
  .muted { margin: 0 0 20px; color: #839087; font-size: 11px; line-height: 1.6; }
  .login-panel form { display: flex; flex-direction: column; gap: 8px; }
  .login-panel label { color: #a1ada4; font-size: 10px; }
  .login-panel input { height: 38px; padding: 0 11px; border: 1px solid #344037; border-radius: 6px; outline: 0; color: #dce5de; background: #111713; font-size: 11px; }
  .login-panel input:focus { border-color: #699475; }
  .full { width: 100%; margin-top: 5px; }
  .login-foot { margin: 18px 0 0; color: #6e7a71; font-size: 9px; text-align: center; }
  .error { color: #e3a299; font-size: 10px; }
  @media (min-width: 1300px) { .main-content { margin-right: auto; } }
  @media (max-width: 900px) { .main-content { width: calc(100% - 210px); margin-left: 210px; padding: 27px 25px; } .sidebar { width: 210px; } .settings-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 650px) {
    .sidebar { display: none; }
    .main-content { width: 100%; margin: 0; padding: 18px 15px 22px; }
    .topbar { min-height: 42px; margin-bottom: 17px; }
    .topbar > div:nth-child(2) { display: none; }
    .mobile-brand { display: flex; align-items: center; gap: 8px; color: #e7eee8; font-size: 13px; }
    .mobile-brand .brand-mark { width: 30px; height: 30px; font-size: 16px; }
    .top-actions { gap: 9px; }
    .overlay-link { font-size: 9px; }
    .timer-panel { padding: 17px 13px 14px; }
    .timer-display { margin-top: 27px; font-size: clamp(54px, 16vw, 76px); }
    .timer-controls { margin-top: 19px; }
    .manual-adjust { flex-wrap: wrap; margin-top: 16px; padding-top: 12px; }
    .stats-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    .stat { min-height: 91px; padding: 11px 9px; }
    .stat-title { min-height: 21px; font-size: 7px; letter-spacing: .04em; }
    .stat > strong { margin-top: 8px; font-size: clamp(12px, 4vw, 18px); }
    .stat > small { font-size: 8px; }
    .activity-panel, .settings-panel { margin-top: 22px; }
    .activity-tools { gap: 5px; }
    .feed-tabs button { padding: 5px 5px; font-size: 7px; }
    .settings-panel { padding: 13px; }
    .activity-row { gap: 8px; padding: 8px; }
    .activity-value { min-width: 63px; }
    .activity-row time { display: none; }
    .settings-grid { grid-template-columns: 1fr; }
    .settings-footer { align-items: flex-start; flex-direction: column; }
  }
</style>

<svelte:head>
  <title>Subathon Studio — Live control</title>
  <meta name="description" content="Real-time TikTok and Saweria subathon timer dashboard" />
</svelte:head>

{#if !authenticated}
  <main class="login-shell">
    <div class="login-panel">
      <div class="brand-mark">S</div>
      <p class="eyebrow">SUBATHON STUDIO</p>
      <h1>Masuk ke dashboard</h1>
      <p class="muted">Gunakan token admin yang disetel di konfigurasi server.</p>
      <form onsubmit={(event) => { event.preventDefault(); connect(); }}>
        <label for="token">Admin token</label>
        <input id="token" type="password" bind:value={token} autocomplete="current-password" placeholder="Masukkan token admin" />
        <button class="button primary full" type="submit">Hubungkan dashboard <span>→</span></button>
      </form>
      {#if error}<p class="error">{error}</p>{/if}
      <p class="login-foot">Koneksi privat · Token tersimpan di browser ini</p>
    </div>
  </main>
{:else}
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">S</div>
        <div><strong>subathon</strong><small>CONTROL STUDIO</small></div>
      </div>
      <div class="workspace-label">LIVE WORKSPACE</div>
      <a class="nav-item active" href="#overview"><span class="nav-icon">◷</span> Overview <span class="nav-dot"></span></a>
      <a class="nav-item" href="#activity"><span class="nav-icon">↗</span> Aktivitas</a>
      <a class="nav-item" href="#integrations"><span class="nav-icon">⌘</span> Integrasi</a>
      <div class="sidebar-bottom">
        <div class="live-status"><span class:online={tiktokStatus === "connected"}></span><div><b>TikTok Live</b><small>{tiktokStatus}</small></div></div>
        <div class="live-status"><span class:online={saweriaStatus === "configured"}></span><div><b>Saweria</b><small>{saweriaStatus === "configured" ? "webhook aktif" : "belum dikonfigurasi"}</small></div></div>
        <button class="logout" onclick={() => { localStorage.removeItem("subathon-admin-token"); socket?.disconnect(); socket = undefined; authenticated = false; token = ""; }}>Keluar <span>↗</span></button>
      </div>
    </aside>

    <main class="main-content">
      <header class="topbar">
        <div class="mobile-brand"><div class="brand-mark">S</div><strong>subathon</strong></div>
        <div><p class="eyebrow">LIVE WORKSPACE / OVERVIEW</p><h1>Dashboard</h1></div>
        <div class="top-actions"><span class="live-pill"><i></i> LIVE SESSION</span><a class="overlay-link" href="/overlay" target="_blank">Buka overlay <span>↗</span></a></div>
      </header>

      {#if error}<div class="notice">{error}</div>{/if}

      <section id="overview" class="timer-panel">
        <div class="timer-meta"><div><span class="live-pulse"></span><span class="eyebrow">COUNTDOWN TIMER</span></div><span class="state-label">{timer.status === "running" ? "SEDANG BERJALAN" : timer.status === "paused" ? "DIJEDA" : "SIAP DIMULAI"}</span></div>
        <div class="timer-display mono">{formatTime(remaining)}</div>
        <div class="timer-subtitle">{timer.status === "running" ? "Waktu terus berjalan" : timer.status === "paused" ? "Timer dijeda sementara" : "Mulai live stream kamu"}</div>
        <div class="timer-controls">
          {#if timer.status === "running"}
            <button class="button primary" disabled={busy} onclick={() => timerAction("pause")}>Ⅱ <span>Jeda timer</span></button>
          {:else if timer.status === "paused"}
            <button class="button primary" disabled={busy} onclick={() => timerAction("resume")}>▶ <span>Lanjutkan</span></button>
          {:else}
            <button class="button primary" disabled={busy} onclick={() => timerAction("start")}>▶ <span>Mulai timer</span></button>
          {/if}
          <button class="button secondary" disabled={busy} onclick={() => timerAction("reset")}>↺ <span>Reset</span></button>
        </div>
        <div class="manual-adjust">
          <span>Atur waktu</span>
          <div class="adjust-control"><input aria-label="Jumlah detik" type="number" min="1" max="86400" bind:value={adjustment} /><span>detik</span></div>
          <button class="adjust-button" aria-label="Kurangi waktu" disabled={busy} onclick={() => timerAction("adjust", { deltaSeconds: -Number(adjustment) })}>−</button>
          <button class="adjust-button add" aria-label="Tambah waktu" disabled={busy} onclick={() => timerAction("adjust", { deltaSeconds: Number(adjustment) })}>+</button>
        </div>
      </section>

      <section class="stats-grid" aria-label="Ringkasan live">
        <div class="stat"><div class="stat-title">TIKTOK COINS <span class="stat-icon">◇</span></div><strong>{timer.totalCoins.toLocaleString("id-ID")}</strong><small>Total coins terkumpul</small></div>
        <div class="stat"><div class="stat-title">DONASI SAWERIA <span class="stat-icon">Rp</span></div><strong>Rp {timer.totalDonations.toLocaleString("id-ID")}</strong><small>Total donasi masuk</small></div>
        <div class="stat"><div class="stat-title">WAKTU TAMBAHAN <span class="stat-icon">↗</span></div><strong>{formatAdded(timer.totalAddedMs)}</strong><small>Dari semua dukungan</small></div>
      </section>

      <section id="activity" class="activity-panel">
        <div class="section-heading">
          <div><p class="eyebrow">RIWAYAT REAL-TIME</p><h2>Gift & donasi terbaru</h2></div>
          <div class="activity-tools">
            <div class="feed-tabs" role="group" aria-label="Filter riwayat">
              <button class:chosen={activityFilter === "all"} onclick={() => activityFilter = "all"}>Semua</button>
              <button class:chosen={activityFilter === "gift"} onclick={() => activityFilter = "gift"}>Gift</button>
              <button class:chosen={activityFilter === "donation"} onclick={() => activityFilter = "donation"}>Saweria</button>
            </div>
            <span class="feed-live"><i></i> LIVE</span>
          </div>
        </div>
        {#if visibleActivity.length === 0}
          <div class="empty-state"><span>◌</span><p>Belum ada aktivitas</p><small>Gift dan donasi akan muncul di sini saat live.</small></div>
        {:else}
          <div class="activity-list">
            {#each visibleActivity as item (item.id)}
              <article class="activity-row">
                <div class:donation={item.type === "donation"} class="activity-icon">{item.type === "gift" ? "◇" : "Rp"}</div>
                <div class="activity-copy"><strong>{item.senderName}</strong><span>{item.description}</span></div>
                <div class="activity-value"><strong>{item.type === "gift" ? `${item.amount} coin` : `Rp ${item.amount.toLocaleString("id-ID")}`}</strong><small>{formatAdded(item.addedMs)}</small></div>
                <time>{new Date(item.createdAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</time>
              </article>
            {/each}
          </div>
        {/if}
      </section>

      <section id="integrations" class="settings-panel">
        <div class="section-heading"><div><p class="eyebrow">KONFIGURASI</p><h2>Integrasi & aturan</h2></div></div>
        <div class="settings-grid">
          <label>Username TikTok Live<div class="field-with-prefix"><span>@</span><input bind:value={settings.tiktokUsername} placeholder="username" /></div></label>
          <label>Detik per coin TikTok<div class="field-suffix"><input type="number" min="0.1" step="0.1" bind:value={settings.tiktokCoinSeconds} /><span>detik / coin</span></div></label>
          <label>Minimum donasi Saweria<div class="field-prefix"><span>Rp</span><input type="number" min="1" bind:value={settings.saweriaMinimumRupiah} /></div></label>
          <label>Kelipatan nominal<div class="field-suffix"><input type="number" min="1" bind:value={settings.saweriaRupiahStep} /><span>rupiah</span></div></label>
          <label>Menit per kelipatan<div class="field-suffix"><input type="number" min="0.1" step="0.1" bind:value={settings.saweriaMinutesPerStep} /><span>menit</span></div></label>
        </div>
        <div class="settings-footer"><p>Stream key Saweria hanya tersimpan di server dan tidak ditampilkan di dashboard.</p><button class="button secondary" disabled={busy} onclick={saveSettings}>Simpan aturan <span>→</span></button></div>
      </section>
      <footer>Subathon Studio <span>·</span> Timer real-time untuk live kamu</footer>
    </main>
  </div>
{/if}
