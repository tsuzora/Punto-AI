class PuntoAI {
  constructor(game) {
    this.game = game;
    this.log = [];
  }

  findBestMove(playerId) {
    this.logs = []; // Reset logs
    this.logs.push("Analyzing board state...");

    let nodesEvaluated = 0;

    const p = this.game.players.find((pl) => pl.id === playerId);
    let bestMove = null;
    let maxScore = -Infinity;

    const candidates = this.getPlayableCoordinates();
    let significantMovesFound = 0;

    // Shuffle cards to vary gameplay if scores are equal
    const handIndices = p.hand.map((_, i) => i).sort(() => Math.random() - 0.5);

    for (let cardIdx of handIndices) {
      const card = p.hand[cardIdx];

      candidates.forEach((pos) => {
        const validation = this.game.checkMoveValidity(
          pos.x,
          pos.y,
          card.value,
          p
        );

        if (validation.valid) {
          const result = this.calculateHeuristic(pos.x, pos.y, card, p);
          const score = result.score + Math.random(); // Tie-breaker

          nodesEvaluated++;

          // Log interesting moves (High value only)
          if (result.type !== "Normal" && significantMovesFound < 4) {
            this.logs.push(
              `> Candidate (${pos.x + this.game.CENTER - 4},${
                pos.y + this.game.CENTER - 4
              }): ${result.type}`
            );
            significantMovesFound++;
          }

          if (score > maxScore) {
            maxScore = score;
            bestMove = {
              lx: pos.x,
              ly: pos.y,
              cardIndex: cardIdx,
              type: result.type,
            };
          }
        }
      });
    }

    if (bestMove) {
      this.logs.push(`----------------`);
      this.logs.push(`DECISION: ${bestMove.type.toUpperCase()}`);
      this.logs.push(
        `Target: ${bestMove.lx + this.game.CENTER - 4}, ${
          bestMove.ly + this.game.CENTER - 4
        }`
      );
      this.logs.push(
        `Card: ${p.hand[bestMove.cardIndex].color} ${
          p.hand[bestMove.cardIndex].value
        }`
      );
    } else {
      this.logs.push("No valid moves found.");
    }

    return { move: bestMove, logs: this.logs, nodes: nodesEvaluated };
  }

  getPlayableCoordinates() {
    const coords = [];
    const bounds = this.game.bounds;
    const padding = 1;
    if (!this.game.hasCards) return [{ x: 0, y: 0 }];
    for (let y = bounds.minY - padding; y <= bounds.maxY + padding; y++) {
      for (let x = bounds.minX - padding; x <= bounds.maxX + padding; x++) {
        coords.push({ x, y });
      }
    }
    return coords;
  }

  calculateHeuristic(x, y, card, player) {
    const W_WIN = 10000;
    const W_BLOCK = 5000;
    const W_SETUP = 100;
    const W_BASE = 1;

    let score = W_BASE;
    let type = "Normal";

    const key = `${x},${y}`;
    const originalCell = this.game.gridData[key];

    this.game.gridData[key] = {
      color: card.color,
      value: card.value,
      ownerId: player.id,
    };

    // f1: Winning Move
    if (this.game.checkWin(x, y, card.color, true)) {
      score += W_WIN;
      type = "f1: VICTORY";
    }

    // f3: Setup (3 in a row)
    if (type === "Normal") {
      // Only check if not already winning
      const lines = this.game.countLines(x, y, card.color);
      if (lines.maxLength >= 3) {
        score += W_SETUP;
        type = "f3: Build Line";
      }
    }

    // Revert for defensive check
    this.game.gridData[key] = originalCell ? originalCell : undefined;
    if (!originalCell) delete this.game.gridData[key];

    // f2: Blocking
    if (type === "Normal" || type === "f3: Build Line") {
      const opponents = this.game.players.filter((pl) => pl.id !== player.id);
      for (let opp of opponents) {
        opp.colors.forEach((oppColor) => {
          const old = this.game.gridData[key];
          this.game.gridData[key] = {
            color: oppColor,
            value: 9,
            ownerId: opp.id,
          };
          if (this.game.checkWin(x, y, oppColor, true)) {
            score += W_BLOCK;
            type = "f2: BLOCK THREAT";
          }
          this.game.gridData[key] = old ? old : undefined;
          if (!old) delete this.game.gridData[key];
        });
      }
    }

    if (originalCell) score += (card.value - originalCell.value) * 2;

    return { score, type };
  }
}

class PuntoTactics {
  constructor() {
    this.GRID_SIZE = 9;
    this.CENTER = 4;
    this.WIN_COUNT = 4;
    this.WINS_NEEDED = 2;

    this.gridData = {};
    this.players = [];
    this.currentPlayerIndex = 0;
    this.bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    this.hasCards = false;
    this.gameStarted = false;

    this.isVsCPU = false;
    this.ai = new PuntoAI(this);
    this.aiStats = { games: 0, wins: 0 };

    // UI Refs
    this.gridEl = document.getElementById("grid");
    this.turnBadge = document.getElementById("turn-indicator");
    this.handContainer = document.getElementById("player-hand");
    this.deckCountEl = document.getElementById("deck-count");
    this.scoreboardEl = document.getElementById("scoreboard");
    this.roundModal = document.getElementById("round-modal");
    this.setupModal = document.getElementById("setup-modal");
    this.instructionsModal = document.getElementById("instructions-modal");

    this.selectedCardIndex = null;
  }

  //  --- AI LOGS ---
  logToSidebar(message, className = "") {
    const container = document.getElementById("ai-logs");
    if (!container) return;

    const line = document.createElement("div");
    line.className = `log-line ${className}`;
    line.textContent = message;

    container.appendChild(line);

    container.scrollTop = container.scrollHeight; // Auto scroll
  }

  processAiTurn() {
    const p = this.players[this.currentPlayerIndex];

    this.logToSidebar(`___ ${p.name} Turn ___`, "info");

    // 1. Calculate
    const start = performance.now();
    // -- Find Move --
    const { move, logs, nodes } = this.ai.findBestMove(p.id);
    // -- End Timer --

    const end = performance.now();
    const latency = Math.round(end - start);

    this.updateStatsUI(p.id, latency, nodes);

    // 2. Animate "Thinking"
    this.logToSidebar(`Time: ${latency}ms | Nodes: ${nodes}`, "highlight");

    const typeDelay = this.gameMode === "cvc" ? 50 : 150; // Speed of log typing

    let i = 0;
    const typeNextLog = () => {
      if (i < logs.length) {
        let msg = logs[i];
        let cls = "";

        // Style specific keywords
        if (msg.includes("VICTORY")) cls = "highlight";
        if (msg.includes("BLOCK")) cls = "error";
        if (msg.includes("DECISION")) cls = "info";

        this.logToSidebar(msg, "", p.colors[0]);
        i++;
        setTimeout(typeNextLog, typeDelay);
      } else {
        // 3. Execute Move after logs finish
        setTimeout(() => {
          if (move) {
            this.executeMove(move.lx, move.ly, move.cardIndex);
          } else {
            this.currentPlayerIndex =
              (this.currentPlayerIndex + 1) % this.players.length;
            this.updateTurnUI();
          }
        }, 500);
      }
    };

    typeNextLog();
  }

  updateStatsUI(playerId, latency, nodes) {
    const row = document.getElementById(`stat-row-${playerId}`);
    if (!row) return;

    const elLat = row.querySelector(".val-lat");
    const elNodes = row.querySelector(".val-nodes");
    const elWin = row.querySelector(".val-win");

    // Latency Color
    elLat.textContent = `${latency}ms`;
    elLat.style.color =
      latency < 50
        ? "var(--neon-green)"
        : latency < 100
        ? "var(--neon-yellow)"
        : "var(--neon-red)";

    elNodes.textContent = nodes;

    // Calculate Win Rate for THIS player
    const p = this.players.find((pl) => pl.id === playerId);
    const total = p.stats.games || 0;
    if (total > 0) {
      const rate = Math.round((p.stats.wins / total) * 100);
      elWin.textContent = `${rate}%`;
    } else {
      elWin.textContent = "0%";
    }
  }
  // --- UI Control ---

  showInstructions() {
    this.instructionsModal.classList.add("active");
  }

  closeInstructions() {
    this.instructionsModal.classList.remove("active");
    if (!this.gameStarted) this.setupModal.classList.add("active");
  }

  resetMatch() {
    this.log = [];
    this.gameStarted = false;
    this.setupModal.classList.add("active");
    this.roundModal.classList.remove("active");
    this.instructionsModal.classList.remove("active");
    this.players = [];
    this.scoreboardEl.innerHTML = "";
    this.isVsCPU = false;
  }

  init(count, mode = "pvp") {
    // mode: 'pvp', 'pve', 'cvc'
    this.gameStarted = true;
    this.gameMode = mode; // Store mode
    this.setupModal.classList.remove("active");
    this.createPlayers(count, mode);

    const sidebar = document.getElementById("ai-sidebar");

    if (sidebar) {
      if (mode === "pve" || mode === "cvc") {
        sidebar.classList.add("visible");
        // Force display style to ensure it overrides any defaults
        sidebar.style.display = "flex";
        this.initStatsUI(count, mode);
      } else {
        sidebar.classList.remove("visible");
        sidebar.style.display = "none";
      }
    }

    this.renderScoreboard();
    this.startRound();
  }

  // --- Core Logic ---

  startRound() {
    this.roundModal.classList.remove("active");
    this.gridData = {};
    this.gridEl.innerHTML = "";
    this.hasCards = false;
    this.bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    this.currentPlayerIndex = 0;

    this.players.forEach((p) => {
      p.deck = this.generateDeck(p.colors);
      p.hand = [];
      this.drawCards(p, 2);
    });

    this.renderGrid();
    this.updateTurnUI();
  }

  generateDeck(colors) {
    let deck = [];
    colors.forEach((color) => {
      for (let val = 1; val <= 9; val++) {
        deck.push({ color, value: val });
        deck.push({ color, value: val });
      }
    });
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  createPlayers(count, mode) {
    this.players = [];

    // 1. Determine Player Types
    // If mode is an array ['human', 'cpu', 'cpu'], use it directly.
    // Otherwise, generate it based on the preset strings.
    let playerTypes = [];
    if (Array.isArray(mode)) {
      playerTypes = mode;
      count = mode.length; // Override count to match array
      // Determine if it's a generic mode for sidebar logic
      this.mode = playerTypes.includes("cpu") ? "pve" : "pvp";
      if (playerTypes.every((t) => t === "cpu")) this.mode = "cvc";
    } else {
      // Legacy/Standard Modes
      for (let i = 0; i < count; i++) {
        if (mode === "cvc") playerTypes.push("cpu");
        else if (mode === "pve") playerTypes.push(i === 0 ? "human" : "cpu");
        else playerTypes.push("human");
      }
    }

    // 2. Assign Colors (Standard Punto Rules)
    // 2 Players: P1(Red/Blue), P2(Green/Yellow)
    // 3 Players: Red, Blue, Green
    // 4 Players: Red, Blue, Green, Yellow
    const getColors = (idx, total) => {
      if (total === 2) return idx === 0 ? ["red"] : ["blue"];
      const pool = ["red", "blue", "green", "yellow"];
      return [pool[idx]];
    };

    // 3. Build Player Objects
    playerTypes.forEach((type, i) => {
      // Auto-Generate Name (e.g., "P1" or "CPU 1")
      let name = type === "cpu" ? `CPU ${i + 1}` : `P${i + 1}`;

      this.players.push({
        id: i,
        name: name,
        colors: getColors(i, count),
        wins: 0,
        deck: [],
        hand: [],
        type: type, // 'human' or 'cpu'
        stats: { games: 0, wins: 0 },
      });
    });

    // 4. Force Update Sidebar Visibility based on new roster
    const sidebar = document.getElementById("ai-sidebar");
    if (sidebar) {
      const hasCpu = this.players.some((p) => p.type === "cpu");
      if (hasCpu) {
        sidebar.classList.add("visible");
        sidebar.style.display = "flex";
        this.initStatsUI(count, this.mode);
      } else {
        sidebar.classList.remove("visible");
        sidebar.style.display = "none";
      }
    }
  }

  drawCards(player, count) {
    for (let i = 0; i < count; i++) {
      if (player.deck.length > 0 && player.hand.length <= count) {
        player.hand.push(player.deck.pop());
      }
    }
  }

  // --- Rendering ---

  initStatsUI() {
    // Hide all first
    document
      .querySelectorAll(".stat-row")
      .forEach((el) => el.classList.add("hidden"));

    // Show rows for CPU players
    this.players.forEach((p) => {
      if (p.type === "cpu") {
        const row = document.getElementById(`stat-row-${p.id}`);
        if (row) {
          row.classList.remove("hidden");
          // Reset text
          row.querySelector(".val-lat").textContent = "-";
          row.querySelector(".val-nodes").textContent = "0";
          row.querySelector(".val-win").textContent = "0%";
        }
      }
    });
  }

  renderGrid() {
    this.gridEl.innerHTML = "";

    for (let y = 0; y < this.GRID_SIZE; y++) {
      for (let x = 0; x < this.GRID_SIZE; x++) {
        const cell = document.createElement("div");
        cell.classList.add("cell");
        const lx = x - this.CENTER;
        const ly = y - this.CENTER;
        cell.dataset.lx = lx;
        cell.dataset.ly = ly;

        // Only allow click if human turn
        cell.onclick = () => {
          if (this.players[this.currentPlayerIndex].type === "human") {
            this.handleBoardClick(lx, ly);
          }
        };

        this.gridEl.appendChild(cell);
      }
    }
  }

  renderScoreboard() {
    this.scoreboardEl.innerHTML = "";
    this.players.forEach((p, idx) => {
      const div = document.createElement("div");
      div.className = `score-badge`;
      div.id = `score-p${idx}`;
      div.style.color = `var(--neon-${p.colors[0]})`;
      let dots = "";
      for (let i = 0; i < this.WINS_NEEDED; i++) {
        dots += `<div class="score-dot ${i < p.wins ? "filled" : ""}"></div>`;
      }
      div.innerHTML = `${p.name} ${dots}`;
      this.scoreboardEl.appendChild(div);
    });
  }

  renderHand() {
    const p = this.players[this.currentPlayerIndex];
    const label = document.getElementById("hand-label");

    // 1. UPDATE LABEL
    if (label) {
      label.style.color = `var(--neon-${p.colors[0]})`;
      if (p.type === "cpu") {
        label.textContent = `${p.name} (AI) is thinking...`;
        label.style.opacity = "0.7"; // Dim slightly for CPU
      } else {
        label.textContent = `${p.name}: Choose Card`;
        label.style.opacity = "1";
      }
    }

    this.handContainer.innerHTML = "";

    // 2. SELECTION LOGIC (Human Only)
    // We generally don't want to visually "select" a card for the CPU
    // until they actually play it, to avoid confusion.
    if (
      p.type !== "cpu" &&
      this.selectedCardIndex === null &&
      p.hand.length > 0
    ) {
      this.selectedCardIndex = 0;
    }

    // 3. RENDER CARDS
    p.hand.forEach((card, index) => {
      const el = document.createElement("div");
      el.className = `hand-card ${card.color}`;

      // Highlight selection only for Human
      if (p.type !== "cpu" && this.selectedCardIndex === index) {
        el.classList.add("selected");
        if (label)
          label.textContent = `Place ${card.color.toUpperCase()} ${card.value}`;
      }

      el.textContent = card.value;

      // Click Interaction
      el.onclick = () => {
        // BLOCK CLICKS IF CPU TURN
        if (p.type === "cpu") return;

        this.selectedCardIndex = index;
        this.renderHand();
      };
      this.handContainer.appendChild(el);
    });

    // 4. BOARD HIGHLIGHTS
    // Only show valid move previews for Human
    if (
      p.type !== "cpu" &&
      this.selectedCardIndex !== null &&
      p.hand[this.selectedCardIndex]
    ) {
      this.highlightValidMoves();
    } else {
      // Clear highlights during CPU turn so the board is clean
      Array.from(this.gridEl.children).forEach((c) =>
        c.classList.remove("valid-move", "invalid-bounds")
      );
    }
  }

  updateTurnUI() {
    const p = this.players[this.currentPlayerIndex];

    // 1. Update Turn Badge (Existing)
    this.turnBadge.textContent = `${p.name}'s Turn`;
    this.turnBadge.style.color = `var(--neon-${p.colors[0]})`;
    this.turnBadge.style.borderColor = `var(--neon-${p.colors[0]})`;

    // 2. NEW: Update "Choose Card" Label Color
    const handLabel = document.querySelector(".hand-container .label");
    if (handLabel) {
      handLabel.style.color = `var(--neon-${p.colors[0]})`;
      // Optional: Add a text shadow for better neon effect
      handLabel.style.textShadow = `0 0 5px var(--neon-${p.colors[0]})`;
    }

    // 3. Highlight active player in scoreboard (Existing)
    document
      .querySelectorAll(".score-badge")
      .forEach((b) => b.classList.remove("active"));
    document.getElementById(`score-p${p.id}`).classList.add("active");

    this.deckCountEl.textContent = p.deck.length;

    // Reset Selection for new turn
    this.selectedCardIndex = null;
    this.renderHand();

    // Trigger AI if needed
    if (p.type === "cpu" && this.gameStarted) {
      setTimeout(() => this.processAiTurn(), 1000);
    }
  }

  // --- Game Logic ---

  // Human Interaction
  handleBoardClick(lx, ly) {
    const p = this.players[this.currentPlayerIndex];
    if (this.selectedCardIndex === null || !p.hand[this.selectedCardIndex])
      return;

    // Execute Human Move
    this.executeMove(lx, ly, this.selectedCardIndex);
  }

  // Shared Execution Logic (Human & AI)
  executeMove(lx, ly, cardHandIndex) {
    const p = this.players[this.currentPlayerIndex];
    const card = p.hand[cardHandIndex];

    const validation = this.checkMoveValidity(lx, ly, card.value, p);
    if (!validation.valid) {
      if (p.type === "human") {
        // Shake or error effect could go here
        console.log("Invalid Move", validation.reason);
      }
      return;
    }

    // 1. Remove from hand
    p.hand.splice(cardHandIndex, 1);
    this.drawCards(p, 1);

    // 2. Update Logical Grid
    const key = `${lx},${ly}`;
    this.gridData[key] = {
      color: card.color,
      value: card.value,
      ownerId: p.id,
    };

    // 3. Update Bounds
    if (!this.hasCards) {
      this.hasCards = true;
      this.bounds = { minX: lx, maxX: lx, minY: ly, maxY: ly };
    } else {
      this.bounds.minX = Math.min(this.bounds.minX, lx);
      this.bounds.maxX = Math.max(this.bounds.maxX, lx);
      this.bounds.minY = Math.min(this.bounds.minY, ly);
      this.bounds.maxY = Math.max(this.bounds.maxY, ly);
    }

    // 4. Render
    this.renderCardOnBoard(lx, ly, card);

    // 5. Check Win
    if (this.checkWin(lx, ly, card.color)) {
      this.handleRoundWin(p);
      return;
    }

    // 6. Draw Check
    if (
      this.players.every((pl) => pl.deck.length === 0 && pl.hand.length === 0)
    ) {
      alert("Draw!");
      this.startRound();
      return;
    }

    // 7. Next Turn
    this.currentPlayerIndex =
      (this.currentPlayerIndex + 1) % this.players.length;
    this.updateTurnUI();
  }

  checkMoveValidity(tx, ty, cardValue, player) {
    const absX = tx + this.CENTER;
    const absY = ty + this.CENTER;

    if (
      absX < 0 ||
      absX >= this.GRID_SIZE ||
      absY < 0 ||
      absY >= this.GRID_SIZE
    ) {
      return { valid: false, reason: "edge-of-board" };
    }
    const key = `${tx},${ty}`;
    const existing = this.gridData[key];

    if (!this.hasCards) {
      // Relative (0,0) corresponds to the visual center (5,5)
      if (tx !== 0 || ty !== 0) {
        return { valid: false, reason: "must-start-center" };
      }
    }
    // 1. Adjacency
    if (this.hasCards) {
      let hasNeighbor = false;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          if (this.gridData[`${tx + dx},${ty + dy}`]) hasNeighbor = true;
        }
      }
      if (!hasNeighbor && !existing) return { valid: false };
    }

    // 2. Value & Ownership (P01 Rule Implemented)
    if (existing) {
      if (existing.ownerId === player.id)
        return { valid: false, reason: "self-overwrite" }; // P01: p(x,y) != w
      if (cardValue <= existing.value)
        return { valid: false, reason: "value-too-low" };
    }

    // 3. 6x6 Constraint
    const newMinX = this.hasCards ? Math.min(this.bounds.minX, tx) : tx;
    const newMaxX = this.hasCards ? Math.max(this.bounds.maxX, tx) : tx;
    const newMinY = this.hasCards ? Math.min(this.bounds.minY, ty) : ty;
    const newMaxY = this.hasCards ? Math.max(this.bounds.maxY, ty) : ty;

    if (newMaxX - newMinX + 1 > 6 || newMaxY - newMinY + 1 > 6) {
      return { valid: false, reason: "bounds" };
    }

    return { valid: true };
  }

  highlightValidMoves() {
    Array.from(this.gridEl.children).forEach((c) => (c.className = "cell"));

    const p = this.players[this.currentPlayerIndex];
    if (
      p.type === "cpu" ||
      this.selectedCardIndex === null ||
      !p.hand[this.selectedCardIndex]
    )
      return;

    const cardVal = p.hand[this.selectedCardIndex].value;

    Array.from(this.gridEl.children).forEach((cell) => {
      const lx = parseInt(cell.dataset.lx);
      const ly = parseInt(cell.dataset.ly);
      const check = this.checkMoveValidity(lx, ly, cardVal, p);

      if (check.valid) {
        cell.classList.add("valid-move");
      } else if (check.reason === "bounds") {
        // Visual feedback for bounds (only if near existing cards)
        let hasNeighbor = false;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (this.gridData[`${lx + dx},${ly + dy}`]) hasNeighbor = true;
          }
        }
        if (hasNeighbor && !this.gridData[`${lx},${ly}`]) {
          cell.classList.add("invalid-bounds");
        }
      }
    });
  }

  checkWin(x, y, color, simulationMode = false) {
    const dirs = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ];
    for (let [dx, dy] of dirs) {
      let line = [`${x},${y}`];
      // + direction
      for (let i = 1; i < 4; i++) {
        const k = `${x + dx * i},${y + dy * i}`;
        if (this.gridData[k]?.color === color) line.push(k);
        else break;
      }
      // - direction
      for (let i = 1; i < 4; i++) {
        const k = `${x - dx * i},${y - dy * i}`;
        if (this.gridData[k]?.color === color) line.push(k);
        else break;
      }

      if (line.length >= this.WIN_COUNT) {
        if (!simulationMode) this.highlightWin(line);
        return true;
      }
    }
    return false;
  }

  countLines(x, y, color) {
    // Helper for Heuristics (f3)
    let maxLength = 0;
    const dirs = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ];
    for (let [dx, dy] of dirs) {
      let count = 1;
      for (let i = 1; i < 4; i++) {
        const k = `${x + dx * i},${y + dy * i}`;
        if (this.gridData[k]?.color === color) count++;
        else break;
      }
      for (let i = 1; i < 4; i++) {
        const k = `${x - dx * i},${y - dy * i}`;
        if (this.gridData[k]?.color === color) count++;
        else break;
      }
      if (count > maxLength) maxLength = count;
    }
    return { maxLength };
  }

  renderCardOnBoard(lx, ly, card) {
    const vx = lx + this.CENTER;
    const vy = ly + this.CENTER;
    const cell = this.gridEl.children[vy * this.GRID_SIZE + vx];
    cell.innerHTML = "";
    const cardDiv = document.createElement("div");
    cardDiv.className = `card ${card.color}`;
    cardDiv.textContent = card.value;
    cell.appendChild(cardDiv);
  }

  highlightWin(keys) {
    keys.forEach((k) => {
      const [lx, ly] = k.split(",");
      const vx = parseInt(lx) + this.CENTER;
      const vy = parseInt(ly) + this.CENTER;
      const cell = this.gridEl.children[vy * this.GRID_SIZE + vx];
      if (cell.firstChild) cell.firstChild.classList.add("winning");
    });
  }

  handleRoundWin(player) {
    this.players.forEach((p) => {
      p.stats.games++;
      if (p.id === player.id) {
        p.stats.wins++;
      }
    });

    // Refresh UI percentages immediately
    this.players.forEach((p) => {
      if (p.type === "cpu") this.updateStatsUI(p.id, 0, 0);
    });

    player.wins++;
    this.renderScoreboard();

    const msg = document.getElementById("round-msg");
    const summary = document.getElementById("score-summary");

    const btn = document.querySelector("#round-modal button");

    if (player.wins >= this.WINS_NEEDED) {
      msg.textContent = `CHAMPION: ${player.name}`;
      summary.textContent = "Match Complete!";

      if (btn) btn.onclick = () => this.resetMatch();

      if (this.mode === "cvc") {
        setTimeout(() => this.resetMatch(), 4000);
      }
    } else {
      msg.textContent = `${player.name} Takes the Round!`;
      summary.textContent = `Score: ${player.wins} / ${this.WINS_NEEDED}`;

      if (btn) btn.onclick = () => this.startRound();

      if (this.mode === "cvc") {
        setTimeout(() => this.startRound(), 1000);
      }
    }

    setTimeout(() => {
      this.roundModal.classList.add("active");
    }, 1000);
  }

  nextRound() {
    this.startRound();
  }
}

const game = new PuntoTactics();
