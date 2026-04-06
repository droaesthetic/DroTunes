const tokenInput = document.getElementById("token");
const saveTokenButton = document.getElementById("saveToken");
const refreshButton = document.getElementById("refresh");
const playersNode = document.getElementById("players");
const template = document.getElementById("playerTemplate");
const statusNode = document.getElementById("status");

const storageKey = "dro-tunes-dashboard-token";

tokenInput.value = localStorage.getItem(storageKey) || "";

saveTokenButton.addEventListener("click", async () => {
  localStorage.setItem(storageKey, tokenInput.value.trim());
  await refreshPlayers();
});

tokenInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    localStorage.setItem(storageKey, tokenInput.value.trim());
    await refreshPlayers();
  }
});

refreshButton.addEventListener("click", refreshPlayers);

function setStatus(message, tone = "") {
  statusNode.textContent = message;
  statusNode.className = "status-message";
  if (tone) {
    statusNode.classList.add(tone);
  }
}

async function api(path, options = {}) {
  const token = tokenInput.value.trim();
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${response.status})`);
  }

  return response.json();
}

function renderPlayers(players) {
  playersNode.replaceChildren();

  if (!players.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No active players yet. Use /play in Discord and refresh.";
    playersNode.append(empty);
    setStatus("Connected. No active players yet.", "is-success");
    return;
  }

  setStatus("Connected. Dashboard data loaded.", "is-success");

  for (const player of players) {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".player-card");
    const guildName = fragment.querySelector(".guild-name");
    const statusLine = fragment.querySelector(".status-line");
    const volumePill = fragment.querySelector(".volume-pill");
    const nowPlaying = fragment.querySelector(".now-playing");
    const queue = fragment.querySelector(".queue");
    const slider = fragment.querySelector("[data-volume]");

    guildName.textContent = player.guildName;
    statusLine.textContent = player.isPaused
      ? "Paused"
      : player.isPlaying
        ? "Playing"
        : "Idle";
    volumePill.textContent = `${player.volume}%`;
    slider.value = player.volume;

    if (player.current) {
      nowPlaying.textContent = `Now playing: ${player.current.title}${
        player.current.artist ? ` by ${player.current.artist}` : ""
      }`;
    } else {
      nowPlaying.textContent = "Nothing is playing right now.";
    }

    if (player.upcoming.length) {
      player.upcoming.slice(0, 8).forEach((track, index) => {
        const item = document.createElement("div");
        item.className = "queue-item";
        item.textContent = `${index + 1}. ${track.title}${track.artist ? ` by ${track.artist}` : ""}`;
        queue.append(item);
      });
    } else {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Queue is empty.";
      queue.append(empty);
    }

    for (const button of fragment.querySelectorAll("[data-action]")) {
      button.addEventListener("click", async () => {
        await api(`/api/players/${player.guildId}/${button.dataset.action}`, { method: "POST" });
        await refreshPlayers();
      });
    }

    slider.addEventListener("change", async () => {
      await api(`/api/players/${player.guildId}/volume`, {
        method: "POST",
        body: JSON.stringify({ percent: Number(slider.value) })
      });
      await refreshPlayers();
    });

    playersNode.append(card);
  }
}

async function refreshPlayers() {
  try {
    const data = await api("/api/players");
    renderPlayers(data.players || []);
  } catch (error) {
    playersNode.replaceChildren();
    const message = document.createElement("p");
    message.className = "empty";
    const text = error instanceof Error ? error.message : "Unable to load players.";
    message.textContent = text;
    playersNode.append(message);
    if (/unauthorized/i.test(text)) {
      setStatus("That token was rejected. Check DASHBOARD_AUTH_TOKEN and try again.", "is-error");
      return;
    }
    if (/starting up/i.test(text)) {
      setStatus("The bot service is still starting up. Wait a moment and refresh.", "is-error");
      return;
    }
    setStatus(text, "is-error");
  }
}

refreshPlayers();
