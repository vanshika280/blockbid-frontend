// ──────────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────────
let provider;
let signer;
let contract;
let connectedAddress = "";
let playerCache = [];
let knownTeamWallets = new Set();
let addressToTeamName = {};        // Cache: walletAddress -> TeamName
let ownerAddress = "";
let activeTimers = {};
let txHistory = [];
let leaderboardChartInstance = null;
let activeFilter = "all";         // filter tab state
const ethersLib = window.ethers;

const statusLabels = ["Upcoming", "Active", "Sold"];

// Local player images (user-provided photos)
const LOCAL_PLAYER_IMAGES = {
  "Virat Kohli":    "./images/virat.png",
  "MS Dhoni":       "./images/dhoni.png",
  "Rohit Sharma":   "./images/rohit.png",
  "Jasprit Bumrah": "./images/bumrah.png",
  "Rashid Khan":    "./images/rashid.png",
};

// Player roles map
const PLAYER_ROLES = {
  "Virat Kohli":    { role: "Batsman",      cls: "role-bat",  icon: "🏏" },
  "MS Dhoni":       { role: "Wicket-Keeper", cls: "role-wk",  icon: "🧤" },
  "Rohit Sharma":   { role: "Batsman",      cls: "role-bat",  icon: "🏏" },
  "Jasprit Bumrah": { role: "Bowler",       cls: "role-bowl", icon: "🎯" },
  "Rashid Khan":    { role: "All-Rounder",  cls: "role-ar",   icon: "⭐" },
};

// Confetti colours
const CONFETTI_COLORS = ["#fcd34d","#f97316","#ef4444","#22c55e","#3b82f6","#a855f7","#ec4899"];

// ──────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────
const el = (id) => document.getElementById(id);

function showToast(message, isError = false) {
  const toast = el("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.style.background = isError ? "rgba(176,0,32,0.95)" : "rgba(11,17,32,0.96)";
  toast.style.borderColor = isError ? "rgba(239,68,68,0.4)" : "rgba(252,211,77,0.15)";
  setTimeout(() => toast.classList.add("hidden"), 3500);
}

function shortAddress(addr) {
  return addr && addr !== "0x0000000000000000000000000000000000000000"
    ? `${addr.slice(0, 6)}…${addr.slice(-4)}`
    : "-";
}

function formatEth(value) {
  if (!ethersLib) return "0.0000";
  return Number(ethersLib.formatEther(value)).toFixed(4);
}

// ──────────────────────────────────────────────────────────────
// TICKER
// ──────────────────────────────────────────────────────────────
const tickerQueue = [];

function pushTicker(msg) {
  tickerQueue.push(msg);
  if (tickerQueue.length > 12) tickerQueue.shift();
  el("tickerContent").textContent = tickerQueue.join("   ·   ");
}

// ──────────────────────────────────────────────────────────────
// TRANSACTION HISTORY
// ──────────────────────────────────────────────────────────────
function pushTxHistory(text) {
  txHistory.unshift(`${new Date().toLocaleTimeString()} – ${text}`);
  txHistory = txHistory.slice(0, 20);
  pushTicker(text);
  renderTxHistory();
}

function renderTxHistory() {
  const txList = el("txHistory");
  txList.innerHTML = "";
  if (!txHistory.length) {
    txList.innerHTML = "<li class='muted'>No transactions yet.</li>";
    return;
  }
  txHistory.forEach((tx) => {
    const item = document.createElement("li");
    item.textContent = tx;
    txList.appendChild(item);
  });
}

// ──────────────────────────────────────────────────────────────
// LIVE STATS BANNER
// ──────────────────────────────────────────────────────────────
function updateStatsBanner() {
  if (!playerCache.length) return;
  const total    = playerCache.length;
  const sold     = playerCache.filter(p => Number(p.status) === 2).length;
  const active   = playerCache.filter(p => Number(p.status) === 1).length;
  const upcoming = playerCache.filter(p => Number(p.status) === 0).length;
  const totalEth = Array.from(playerCache).reduce((sum, p) => sum + BigInt(p.highestBid), 0n);

  el("statTotal").textContent   = total;
  el("statSold").textContent    = sold;
  el("statActive").textContent  = active;
  el("statUpcoming").textContent = upcoming;
  el("statEth").textContent     = `${formatEth(totalEth)} ETH`;
}

// ──────────────────────────────────────────────────────────────
// WALLET PILL
// ──────────────────────────────────────────────────────────────
function updateWalletPill(address) {
  const dot  = el("walletDot");
  const text = el("walletPillText");
  if (address) {
    dot.classList.add("connected");
    text.textContent = shortAddress(address);
  } else {
    dot.classList.remove("connected");
    text.textContent = "Not Connected";
  }
}

// ──────────────────────────────────────────────────────────────
// WIN MODAL
// ──────────────────────────────────────────────────────────────
function showWinModal(playerName, playerImg, ethAmount) {
  el("modalPlayerName").textContent  = playerName;
  el("modalWinAmount").textContent   = `🏆 Won for ${ethAmount} ETH`;
  el("modalPlayerImg").src           = playerImg;
  el("winModal").classList.remove("hidden");
  spawnConfetti();
}

function spawnConfetti() {
  const container = el("modalConfetti");
  container.innerHTML = "";
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.top  = `${Math.random() * -30}px`;
    piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    piece.style.animationDelay = `${Math.random() * 1.5}s`;
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    container.appendChild(piece);
  }
}

// ──────────────────────────────────────────────────────────────
// CONNECT WALLET
// ──────────────────────────────────────────────────────────────
async function connectWallet() {
  if (!ethersLib) { showToast("Ethers library not loaded.", true); return; }
  if (!window.ethereum) { showToast("MetaMask not detected.", true); return; }

  provider = new ethersLib.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = await provider.getSigner();
  connectedAddress = await signer.getAddress();
  contract = new ethersLib.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
  ownerAddress = await contract.owner();

  const balance = await provider.getBalance(connectedAddress);
  const network = await provider.getNetwork();

  el("walletAddress").textContent = connectedAddress;
  el("walletBalance").textContent = `${formatEth(balance)} ETH`;
  el("networkBadge").textContent  = `${network.name} (${network.chainId})`;

  updateWalletPill(connectedAddress);
  showToast("Wallet connected successfully! ✅");
  pushTxHistory(`Wallet connected: ${shortAddress(connectedAddress)}`);

  await bindEvents();
  await refreshAll();
}

// ──────────────────────────────────────────────────────────────
// TEAM ACTIONS
// ──────────────────────────────────────────────────────────────
async function registerTeam() {
  try {
    const teamName = el("teamNameInput").value.trim();
    if (!teamName) { showToast("Please enter a team name.", true); return; }
    const tx = await contract.registerTeam(teamName);
    pushTxHistory(`⏳ Team registration submitted…`);
    await tx.wait();
    addressToTeamName[connectedAddress.toLowerCase()] = teamName;
    showToast(`Team "${teamName}" registered! 🏏`);
    await refreshAll();
  } catch (err) {
    showToast(err?.shortMessage || "Team registration failed.", true);
  }
}

async function activateAuction(playerId) {
  try {
    const tx = await contract.activateAuction(playerId, 60);
    pushTxHistory(`⏳ Auction activation for player #${playerId}…`);
    await tx.wait();
    showToast(`🔴 Auction started for player #${playerId}!`);
    await refreshPlayers();
  } catch (err) {
    showToast(err?.shortMessage || "Activation failed.", true);
  }
}

async function bidForPlayer(playerId, overrideAmount = null) {
  try {
    const bidInput = el(`bid-input-${playerId}`);
    const bidValue = overrideAmount !== null ? String(overrideAmount) : bidInput.value.trim();
    if (!bidValue || Number(bidValue) <= 0) { showToast("Enter a valid ETH bid.", true); return; }
    const tx = await contract.placeBid(playerId, { value: ethersLib.parseEther(bidValue) });
    pushTxHistory(`💸 Bid placed for player #${playerId}: ${bidValue} ETH`);
    await tx.wait();
    showToast(`Bid of ${bidValue} ETH placed! ✅`);
    if (bidInput) bidInput.value = "";
    await refreshAll();
  } catch (err) {
    showToast(err?.shortMessage || "Bid failed.", true);
  }
}

async function endAuction(playerId) {
  try {
    const tx = await contract.endAuction(playerId);
    pushTxHistory(`🔚 End auction submitted for player #${playerId}…`);
    await tx.wait();
    showToast(`Auction ended for player #${playerId}`);
    await refreshAll();
  } catch (err) {
    showToast(err?.shortMessage || "Could not end auction.", true);
  }
}

// ──────────────────────────────────────────────────────────────
// TIMER UTILS
// ──────────────────────────────────────────────────────────────
function calculateTimeLeft(player) {
  const now = Math.floor(Date.now() / 1000);
  return Number(player.auctionEndTime) - now;
}

function calculateDuration(player) {
  return Number(player.auctionEndTime) - Number(player.auctionStartTime);
}

// ──────────────────────────────────────────────────────────────
// RENDER PLAYERS
// ──────────────────────────────────────────────────────────────
function renderPlayers() {
  const search = el("searchInput").value.trim().toLowerCase();
  const grid   = el("playerGrid");
  grid.innerHTML = "";

  let players = [...playerCache];

  // Filter by active tab
  if (activeFilter !== "all") {
    const filterMap = { upcoming: 0, active: 1, sold: 2 };
    players = players.filter(p => Number(p.status) === filterMap[activeFilter]);
  }

  // Filter by search
  if (search) {
    players = players.filter(p => p.name.toLowerCase().includes(search));
  }

  if (!players.length) {
    grid.innerHTML = `<div class="muted" style="padding:20px;text-align:center;">No players found.</div>`;
    return;
  }

  players.forEach((player) => {
    const status     = Number(player.status);
    const bidInputId = `bid-input-${player.id}`;
    const isOwner    = connectedAddress && connectedAddress.toLowerCase() === ownerAddress.toLowerCase();
    const timeLeft   = status === 1 ? calculateTimeLeft(player) : 0;
    const duration   = status === 1 ? calculateDuration(player) : 60;
    const pct        = status === 1 ? Math.max(0, Math.min(100, (timeLeft / duration) * 100)) : 0;
    const imgSrc     = LOCAL_PLAYER_IMAGES[player.name] || player.imageUrl;
    const roleInfo   = PLAYER_ROLES[player.name] || { role: "Player", cls: "role-bat", icon: "🏏" };
    const currentBid = Number(ethersLib.formatEther(player.highestBid));

    const card = document.createElement("div");
    card.className = `player-card${status === 1 ? " active-auction" : ""}`;

    card.innerHTML = `
      <div class="player-info-container">
        <img src="${imgSrc}" alt="${player.name}" class="player-avatar" />
        <div class="player-details">
          <div class="player-name-row">
            <h3>${player.name}</h3>
            <span class="badge status-${statusLabels[status].toLowerCase()}">${status === 1 ? "🔴 LIVE" : statusLabels[status]}</span>
            <span class="badge ${roleInfo.cls}">${roleInfo.icon} ${roleInfo.role}</span>
          </div>
          <p class="muted">Base Price: <strong>${formatEth(player.basePrice)} ETH</strong></p>
          <p>💰 Highest Bid: <strong class="accent-text">${formatEth(player.highestBid)} ETH</strong></p>
          <p>👤 Top Bidder: <strong>${shortAddress(player.highestBidder)}</strong></p>
          ${status === 1 ? `
          <div class="timer-bar-container">
            <div class="timer-bar" id="timerbar-${player.id}" style="width:${pct}%"></div>
          </div>
          <p style="font-size:0.78rem;" class="muted">⏱ <span id="timer-${player.id}">${timeLeft > 0 ? `${timeLeft}s left` : "Ending…"}</span></p>
          ` : ""}
          ${status === 2 ? `
            <p class="muted" style="font-size:0.82rem; margin-top:4px;">
              🏠 Sold to: <strong class="success-text" style="color:var(--accent-color);">${addressToTeamName[player.soldTo.toLowerCase()] || shortAddress(player.soldTo)}</strong>
            </p>
          ` : ""}
        </div>
      </div>
      <div class="player-actions">
        ${status === 1 ? `
          <div class="quick-bid-row">
            <button class="quick-bid-btn" data-quickbid="${player.id}" data-amount="${(currentBid + 0.01).toFixed(4)}" ${status !== 1 ? "disabled" : ""}>+0.01</button>
            <button class="quick-bid-btn" data-quickbid="${player.id}" data-amount="${(currentBid + 0.05).toFixed(4)}" ${status !== 1 ? "disabled" : ""}>+0.05</button>
            <button class="quick-bid-btn" data-quickbid="${player.id}" data-amount="${(currentBid + 0.10).toFixed(4)}" ${status !== 1 ? "disabled" : ""}>+0.10</button>
          </div>
          <div class="bid-row">
            <input id="${bidInputId}" type="number" min="0" step="0.01" placeholder="ETH amount" />
            <button data-bid="${player.id}">Bid</button>
          </div>
          <div class="admin-row">
            ${isOwner ? `<button data-end="${player.id}" class="secondary-btn">End Auction</button>` : ""}
          </div>
        ` : ""}
        ${status === 0 && isOwner ? `
          <div class="admin-row">
            <button data-start="${player.id}">▶ Start 60s Auction</button>
          </div>
        ` : ""}
        ${status === 0 && !isOwner ? `<p class="muted" style="font-size:0.82rem;">Awaiting auction start</p>` : ""}
        ${status === 2 ? `<p class="success" style="font-size:0.88rem;">✅ Auction Complete</p>` : ""}
      </div>
    `;

    grid.appendChild(card);
  });

  // Bind events
  grid.querySelectorAll("button[data-bid]").forEach(btn =>
    btn.addEventListener("click", () => bidForPlayer(Number(btn.dataset.bid))));
  grid.querySelectorAll("button[data-start]").forEach(btn =>
    btn.addEventListener("click", () => activateAuction(Number(btn.dataset.start))));
  grid.querySelectorAll("button[data-end]").forEach(btn =>
    btn.addEventListener("click", () => endAuction(Number(btn.dataset.end))));
  grid.querySelectorAll(".quick-bid-btn").forEach(btn =>
    btn.addEventListener("click", () => bidForPlayer(Number(btn.dataset.quickbid), btn.dataset.amount)));
}

// ──────────────────────────────────────────────────────────────
// TIMERS
// ──────────────────────────────────────────────────────────────
function startTimers() {
  Object.values(activeTimers).forEach(t => clearInterval(t));
  activeTimers = {};

  playerCache.forEach((player) => {
    if (Number(player.status) !== 1) return;
    const duration = calculateDuration(player);

    activeTimers[player.id] = setInterval(async () => {
      const left  = calculateTimeLeft(player);
      const timerEl = el(`timer-${player.id}`);
      const barEl   = el(`timerbar-${player.id}`);
      const pct     = Math.max(0, Math.min(100, (left / duration) * 100));

      if (timerEl) timerEl.textContent = left > 0 ? `${left}s left` : "Ending…";
      if (barEl)   barEl.style.width = `${pct}%`;

      if (left <= 0) {
        clearInterval(activeTimers[player.id]);
        try { await endAuction(Number(player.id)); } catch (_) {}
      }
    }, 1000);
  });
}

// ──────────────────────────────────────────────────────────────
// REFRESH FUNCTIONS
// ──────────────────────────────────────────────────────────────
async function refreshPlayers() {
  playerCache = await contract.getPlayers();
  renderPlayers();
  startTimers();
  updateStatsBanner();
}

async function refreshTeamDashboard() {
  const team = await contract.getTeam(connectedAddress);

  if (!team.isRegistered) {
    el("teamStatus").textContent = "No team registered yet.";
    el("dashboardTeamName").textContent = "-";
    el("dashboardSpent").textContent    = "0 ETH";
    el("dashboardPlayerCount").textContent = "0";
    el("dashboardPlayers").innerHTML    = "<li class='muted'>—</li>";
    return;
  }

  el("teamStatus").textContent   = `✅ Registered as "${team.name}"`;
  el("dashboardTeamName").textContent  = team.name;
  el("dashboardSpent").textContent     = `${formatEth(team.totalSpent)} ETH`;
  el("dashboardPlayerCount").textContent = team.playersBought.length;

  const list = el("dashboardPlayers");
  list.innerHTML = "";
  if (!team.playersBought.length) {
    list.innerHTML = "<li class='muted'>No players yet</li>";
    return;
  }
  team.playersBought.forEach((playerId) => {
    const p  = playerCache.find(x => Number(x.id) === Number(playerId));
    const li = document.createElement("li");
    const name = p ? p.name : `Player #${playerId}`;
    const role = p ? PLAYER_ROLES[p.name] : null;
    li.innerHTML = `${role ? role.icon : "🏏"} <strong>${name}</strong>`;
    list.appendChild(li);
  });
}

async function refreshLeaderboard() {
  try {
    const logs = await contract.queryFilter(contract.filters.TeamRegistered(), 0);
    logs.forEach(log => knownTeamWallets.add(log.args.teamWallet));

  if (!knownTeamWallets.size) {
    el("leaderboardList").innerHTML = "<li class='muted'>No teams yet.</li>";
    return;
  }

  const ranked = [];
  for (const wallet of knownTeamWallets) {
    const team = await contract.getTeam(wallet);
    if (!team.isRegistered) continue;
    
    // Update team name cache
    addressToTeamName[wallet.toLowerCase()] = team.name;
    
    ranked.push({ 
      wallet, 
      name: team.name, 
      spent: team.totalSpent, // Keep as BigInt
      playersBought: team.playersBought.length 
    });
  }
  ranked.sort((a, b) => (b.spent > a.spent ? 1 : b.spent < a.spent ? -1 : 0));

  const leaderboard = el("leaderboardList");
  leaderboard.innerHTML = "";
  const labels = [], data = [];

  ranked.forEach((entry, idx) => {
    labels.push(entry.name);
    data.push(Number(entry.spent)); // Chart.js needs Number, precision loss in visual is okay
    const li = document.createElement("li");
    const medal = ["🥇","🥈","🥉"][idx] || `#${idx+1}`;
    li.innerHTML = `${medal} <strong>${entry.name}</strong> &nbsp;·&nbsp; ${formatEth(BigInt(entry.spent))} ETH &nbsp;·&nbsp; ${entry.playersBought} player(s)`;
    leaderboard.appendChild(li);
  });

    updateChart(labels, data);
  } catch (err) {
    console.error("Error refreshing leaderboard:", err);
    el("leaderboardList").innerHTML = "<li class='error-text'>Error loading leaderboard data.</li>";
  }
}

async function refreshAll() {
  await refreshPlayers();
  await refreshTeamDashboard();
  await refreshLeaderboard();
}

// ──────────────────────────────────────────────────────────────
// CHART
// ──────────────────────────────────────────────────────────────
function updateChart(labels, data) {
  console.log("Updating leaderboard chart with data:", { labels, data });
  const ctx = el("leaderboardChart");
  if (!ctx) { console.warn("leaderboardChart canvas not found."); return; }
  if (typeof Chart === "undefined") { 
    console.error("Chart.js not loaded. Leaderboard visual will not render."); 
    return; 
  }

  const isLight   = document.body.classList.contains("light");
  const textColor = isLight ? "#1e293b" : "#f1f5f9";
  const gridColor = isLight ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.07)";
  const barColor  = isLight ? "#d97706" : "#fcd34d";
  const barHover  = isLight ? "#b45309" : "#f59e0b";

  if (leaderboardChartInstance) {
    leaderboardChartInstance.data.labels = labels;
    leaderboardChartInstance.data.datasets[0].data = data;
    leaderboardChartInstance.data.datasets[0].backgroundColor = barColor;
    leaderboardChartInstance.options.scales.y.ticks.color = textColor;
    leaderboardChartInstance.options.scales.x.ticks.color = textColor;
    leaderboardChartInstance.options.scales.y.grid.color   = gridColor;
    leaderboardChartInstance.options.plugins.legend.labels.color = textColor;
    leaderboardChartInstance.update();
    return;
  }

  leaderboardChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Total Spent (wei)",
        data,
        backgroundColor: barColor,
        hoverBackgroundColor: barHover,
        borderRadius: 8,
        borderSkipped: false,
        maxBarThickness: 50,
        categoryPercentage: 0.8,
        barPercentage: 0.9,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: textColor, font: { weight: "700" } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${(ctx.raw / 1e18).toFixed(4)} ETH`
          }
        }
      },
      scales: {
        y: { beginAtZero:true, ticks:{ color:textColor, callback: v => (v/1e18).toFixed(2)+" ETH" }, grid:{ color:gridColor }, border:{ color:"transparent" } },
        x: { ticks:{ color:textColor }, grid:{ display:false }, border:{ color:"transparent" } }
      }
    }
  });
}

// ──────────────────────────────────────────────────────────────
// BLOCKCHAIN EVENTS
// ──────────────────────────────────────────────────────────────
async function bindEvents() {
  contract.removeAllListeners();

  contract.on("TeamRegistered", async (teamWallet, teamName) => {
    knownTeamWallets.add(teamWallet);
    pushTxHistory(`🏏 New team: "${teamName}" (${shortAddress(teamWallet)})`);
    await refreshLeaderboard();
    if (teamWallet.toLowerCase() === connectedAddress.toLowerCase()) await refreshTeamDashboard();
  });

  contract.on("AuctionActivated", async (playerId) => {
    const p = playerCache.find(x => Number(x.id) === Number(playerId));
    pushTxHistory(`🔴 Auction started: ${p?.name || "#"+playerId}`);
    await refreshPlayers();
  });

  contract.on("NewBid", async (playerId, bidder, bidAmount) => {
    const p = playerCache.find(x => Number(x.id) === Number(playerId));
    pushTxHistory(`💸 Bid on ${p?.name || "#"+playerId}: ${formatEth(bidAmount)} ETH by ${shortAddress(bidder)}`);
    await refreshPlayers();
    await refreshLeaderboard();
  });

  contract.on("AuctionEnded", async (playerId, winner, winningBid) => {
    const p = playerCache.find(x => Number(x.id) === Number(playerId));
    const name = p?.name || `Player #${playerId}`;
    pushTxHistory(`🏆 Auction ended: ${name} → ${shortAddress(winner)} for ${formatEth(winningBid)} ETH`);

    // Show win modal if current user is the winner
    if (winner && winner.toLowerCase() === connectedAddress.toLowerCase()) {
      showWinModal(name, LOCAL_PLAYER_IMAGES[name] || p?.imageUrl || "", formatEth(winningBid));
    }

    await refreshAll();
  });

  if (window.ethereum) {
    window.ethereum.on("accountsChanged", () => window.location.reload());
    window.ethereum.on("chainChanged",    () => window.location.reload());
  }
}

// ──────────────────────────────────────────────────────────────
// THEME TOGGLE
// ──────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem("bb-theme");
  if (saved === "light") document.body.classList.add("light");
  else el("themeToggle").textContent = "☀️ Light Mode";

  el("themeToggle").addEventListener("click", () => {
    const isLight = document.body.classList.toggle("light");
    localStorage.setItem("bb-theme", isLight ? "light" : "dark");
    el("themeToggle").textContent = isLight ? "🌙 Dark Mode" : "☀️ Light Mode";
    if (leaderboardChartInstance) {
      leaderboardChartInstance.destroy();
      leaderboardChartInstance = null;
      refreshLeaderboard().catch(() => {});
    }
  });
}

// ──────────────────────────────────────────────────────────────
// FILTER TABS
// ──────────────────────────────────────────────────────────────
function initFilterTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilter = btn.dataset.filter;
      renderPlayers();
    });
  });
}

// ──────────────────────────────────────────────────────────────
// UI BINDINGS
// ──────────────────────────────────────────────────────────────
function bindUI() {
  el("connectWalletBtn").addEventListener("click", connectWallet);
  el("registerTeamBtn").addEventListener("click", registerTeam);
  el("searchInput").addEventListener("input", renderPlayers);
  el("modalClose").addEventListener("click", () => el("winModal").classList.add("hidden"));
  el("winModal").addEventListener("click", (e) => { if (e.target === el("winModal")) el("winModal").classList.add("hidden"); });
}

// ──────────────────────────────────────────────────────────────
// STARTUP
// ──────────────────────────────────────────────────────────────
function startupNotice() {
  if (CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000" || CONTRACT_ADDRESS.includes("Your")) {
    showToast("⚠️ Update frontend/config.js with your deployed contract address!", true);
  }
}

async function startup() {
  initTheme();
  initFilterTabs();
  bindUI();
  renderTxHistory();
  startupNotice();

  // Try to load players even without MetaMask
  try {
    if (ethersLib) {
      // Use local node as a read-only provider for initial view
      const defaultProvider = new ethersLib.JsonRpcProvider("http://127.0.0.1:8545");
      contract = new ethersLib.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, defaultProvider);
      await refreshPlayers();
      await refreshLeaderboard(); // Ensure leaderboard loads on startup
      console.log("Initial data loaded via local node.");
    }
  } catch (err) {
    console.warn("Could not load initial data:", err);
  }
}

startup();
