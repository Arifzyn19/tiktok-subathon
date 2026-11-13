<script lang="ts">
  import { onMount } from "svelte";
  import { io } from "socket.io-client";
  import { apiUrl, type Activity, type TimerState } from "$lib/types";

  let timer: TimerState = { remainingMs: 3_600_000, status: "idle", totalCoins: 0, totalDonations: 0, totalAddedMs: 0, serverTime: Date.now() };
  let now = Date.now();
  let notification: Activity | undefined;
  let notifyTimer: ReturnType<typeof setTimeout>;
  $: remaining = timer.status === "running" ? Math.max(0, timer.remainingMs - (now - timer.serverTime)) : timer.remainingMs;

  function formatTime(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function formatAdded(ms: number): string {
    return ms < 60_000 ? `+${Math.round(ms / 1000)} dtk` : `+${Math.round(ms / 60_000)} mnt`;
  }

  onMount(() => {
    const socket = io(apiUrl, { transports: ["websocket", "polling"] });
    socket.on("timer:update", (value: TimerState) => { timer = value; });
    socket.on("activity:new", (item: Activity) => {
      notification = item;
      clearTimeout(notifyTimer);
      notifyTimer = setTimeout(() => { notification = undefined; }, 6500);
    });
    const interval = window.setInterval(() => { now = Date.now(); }, 200);
    return () => { window.clearInterval(interval); clearTimeout(notifyTimer); socket.disconnect(); };
  });
</script>

<svelte:head>
  <title>Subathon Timer Overlay</title>
  <meta name="description" content="Transparent OBS countdown and support alerts" />
</svelte:head>

<main class="overlay">
  <div class="timer-wrap">
    <div class="timer-label"><span></span> LIVE SUBATHON</div>
    <div class="timer mono">{formatTime(remaining)}</div>
    <div class="timer-state">{timer.status === "running" ? "WAKTU TERSISA" : timer.status === "paused" ? "TIMER DIJEDA" : "SEGERA DIMULAI"}</div>
  </div>
  {#if notification}
    <aside class="alert" class:gift={notification.type === "gift"}>
      <div class="alert-icon">{notification.type === "gift" ? "◇" : "Rp"}</div>
      <div class="alert-content">
        <span>{notification.type === "gift" ? "TIKTOK GIFT" : "DONASI SAWERIA"}</span>
        <strong>{notification.senderName}</strong>
        <small>{notification.type === "gift" ? notification.description : `Rp ${notification.amount.toLocaleString("id-ID")}${notification.description ? ` · ${notification.description}` : ""}`}</small>
      </div>
      <div class="alert-added">{formatAdded(notification.addedMs)}</div>
    </aside>
  {/if}
</main>

<style>
  :global(html), :global(body) { width: 100%; height: 100%; overflow: hidden; background: transparent !important; }
  :global(body) { color: #f3f6f3; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  .overlay { position: relative; display: flex; width: 100vw; height: 100vh; align-items: flex-start; justify-content: center; padding-top: 5vh; }
  .timer-wrap { min-width: 430px; padding: 18px 34px 20px; text-align: center; border: 1px solid rgba(207, 231, 214, .18); border-radius: 22px; background: rgba(15, 21, 17, .86); box-shadow: 0 15px 50px rgba(0, 0, 0, .28); backdrop-filter: blur(12px); }
  .timer-label { display: flex; align-items: center; justify-content: center; gap: 9px; color: #c6d0c8; font-size: 11px; font-weight: 700; letter-spacing: .19em; }
  .timer-label span { width: 7px; height: 7px; border-radius: 50%; background: #70c795; box-shadow: 0 0 14px #70c79577; }
  .timer { margin: 6px 0 0; color: #f5faf6; font-size: clamp(70px, 11vw, 112px); font-weight: 650; letter-spacing: -.075em; line-height: 1.12; text-shadow: 0 3px 22px rgba(0,0,0,.2); }
  .timer-state { color: #8d9b91; font-size: 11px; font-weight: 650; letter-spacing: .15em; }
  .mono { font-variant-numeric: tabular-nums; }
  .alert { position: absolute; top: calc(5vh + 200px); display: flex; width: min(460px, calc(100vw - 32px)); align-items: center; gap: 14px; padding: 14px 18px; border: 1px solid rgba(130, 206, 156, .32); border-radius: 16px; background: rgba(15, 21, 17, .94); box-shadow: 0 16px 45px rgba(0,0,0,.3); animation: alert-in .34s cubic-bezier(.2,.8,.2,1) both; }
  .alert-icon { display: grid; width: 40px; height: 40px; flex: 0 0 auto; place-items: center; border-radius: 12px; color: #8ed3a7; background: #20372a; font-size: 16px; font-weight: 700; }
  .alert-content { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
  .alert-content > span { color: #8ed3a7; font-size: 9px; font-weight: 750; letter-spacing: .14em; }
  .alert-content strong { overflow: hidden; color: #f0f4f1; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
  .alert-content small { overflow: hidden; color: #a7b3aa; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .alert-added { color: #a5ddb6; font-size: 12px; font-weight: 700; white-space: nowrap; }
  @keyframes alert-in { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @media (max-width: 520px) { .timer-wrap { min-width: 0; width: calc(100vw - 24px); padding: 16px 12px; } .timer { font-size: 72px; } .alert { top: 190px; } }
</style>
