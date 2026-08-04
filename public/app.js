(() => {
  const lobby = document.getElementById("lobby");
  const call = document.getElementById("call");
  const joinForm = document.getElementById("join-form");
  const nameInput = document.getElementById("display-name");
  const roomInput = document.getElementById("room-id");
  const lobbyError = document.getElementById("lobby-error");
  const joinBtn = document.getElementById("join-btn");
  const modeVideo = document.getElementById("mode-video");
  const modeAudio = document.getElementById("mode-audio");

  const localVideo = document.getElementById("local-video");
  const remoteVideo = document.getElementById("remote-video");
  const remotePlaceholder = document.getElementById("remote-placeholder");
  const placeholderText = document.getElementById("placeholder-text");
  const activeRoom = document.getElementById("active-room");
  const callStatus = document.getElementById("call-status");
  const remoteName = document.getElementById("remote-name");
  const localLabel = document.getElementById("local-label");
  const stage = document.getElementById("stage");
  const toggleAudioBtn = document.getElementById("toggle-audio");
  const toggleVideoBtn = document.getElementById("toggle-video");
  const hangupBtn = document.getElementById("hangup");

  /** @type {import("socket.io-client").Socket | null} */
  let socket = null;
  /** @type {RTCPeerConnection | null} */
  let pc = null;
  /** @type {MediaStream | null} */
  let localStream = null;
  /** @type {RTCIceServer[]} */
  let iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

  let callMode = "video"; // "video" | "audio"
  let audioEnabled = true;
  let videoEnabled = true;
  let polite = true;
  let makingOffer = false;
  let ignoreOffer = false;
  let remotePeerId = null;

  const savedName = localStorage.getItem("rudra-name");
  if (savedName) nameInput.value = savedName;

  modeVideo.addEventListener("click", () => setMode("video"));
  modeAudio.addEventListener("click", () => setMode("audio"));

  function setMode(mode) {
    callMode = mode;
    modeVideo.classList.toggle("active", mode === "video");
    modeAudio.classList.toggle("active", mode === "audio");
  }

  function showError(message) {
    lobbyError.hidden = !message;
    lobbyError.textContent = message || "";
  }

  function setStatus(text, color) {
    callStatus.textContent = text;
    callStatus.style.color = color || "var(--ok)";
  }

  function updatePlaceholder() {
    const hasRemote = Boolean(remoteVideo.srcObject);
    remotePlaceholder.hidden = hasRemote && callMode === "video";
    if (!hasRemote) {
      placeholderText.textContent = remotePeerId
        ? "Connecting media…"
        : "Waiting for someone to join…";
    } else if (callMode === "audio") {
      placeholderText.textContent = `${remoteName.textContent} is on audio`;
      remotePlaceholder.hidden = false;
    }
  }

  async function getMedia() {
    const constraints = {
      audio: true,
      video:
        callMode === "video"
          ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }
          : false,
    };

    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (callMode === "video") {
        // Fall back to audio-only if camera is unavailable
        console.warn("Camera unavailable, falling back to audio:", err);
        setMode("audio");
        return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }
      throw err;
    }
  }

  function createPeerConnection() {
    const connection = new RTCPeerConnection({ iceServers });

    connection.onicecandidate = ({ candidate }) => {
      if (candidate && remotePeerId && socket) {
        socket.emit("signal", {
          to: remotePeerId,
          data: { type: "candidate", candidate },
        });
      }
    };

    connection.ontrack = ({ streams }) => {
      remoteVideo.srcObject = streams[0];
      setStatus("Connected", "var(--ok)");
      updatePlaceholder();
    };

    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      if (state === "connected") setStatus("Connected", "var(--ok)");
      else if (state === "connecting") setStatus("Connecting…", "var(--accent)");
      else if (state === "failed") setStatus("Connection failed", "var(--danger)");
      else if (state === "disconnected") setStatus("Reconnecting…", "var(--accent)");
      else if (state === "closed") setStatus("Ended", "var(--ink-muted)");
    };

    connection.onnegotiationneeded = async () => {
      try {
        makingOffer = true;
        await connection.setLocalDescription();
        if (remotePeerId && socket) {
          socket.emit("signal", {
            to: remotePeerId,
            data: { type: "description", description: connection.localDescription },
          });
        }
      } catch (err) {
        console.error("negotiationneeded failed:", err);
      } finally {
        makingOffer = false;
      }
    };

    if (localStream) {
      for (const track of localStream.getTracks()) {
        connection.addTrack(track, localStream);
      }
    }

    return connection;
  }

  async function ensurePeerConnection() {
    if (!pc) pc = createPeerConnection();
    return pc;
  }

  async function handleSignal({ from, data }) {
    remotePeerId = from;
    const connection = await ensurePeerConnection();

    try {
      if (data.type === "description") {
        const description = data.description;
        const offerCollision =
          description.type === "offer" &&
          (makingOffer || connection.signalingState !== "stable");

        ignoreOffer = !polite && offerCollision;
        if (ignoreOffer) return;

        await connection.setRemoteDescription(description);
        if (description.type === "offer") {
          await connection.setLocalDescription();
          socket.emit("signal", {
            to: from,
            data: { type: "description", description: connection.localDescription },
          });
        }
      } else if (data.type === "candidate" && data.candidate) {
        try {
          await connection.addIceCandidate(data.candidate);
        } catch (err) {
          if (!ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error("signal handling failed:", err);
      setStatus("Signaling error", "var(--danger)");
    }
  }

  function attachRemotePeer(peer) {
    remotePeerId = peer.id;
    remoteName.textContent = peer.name || "Peer";
    polite = socket.id > peer.id;
    updatePlaceholder();
    ensurePeerConnection();
  }

  function clearRemotePeer() {
    remotePeerId = null;
    remoteName.textContent = "Waiting for peer";
    if (remoteVideo.srcObject) {
      remoteVideo.srcObject.getTracks().forEach((t) => t.stop());
      remoteVideo.srcObject = null;
    }
    if (pc) {
      pc.close();
      pc = null;
    }
    makingOffer = false;
    ignoreOffer = false;
    setStatus("Waiting…", "var(--ink-muted)");
    updatePlaceholder();
  }

  function syncControls() {
    toggleAudioBtn.setAttribute("aria-pressed", String(!audioEnabled));
    toggleAudioBtn.textContent = audioEnabled ? "Mic" : "Muted";
    toggleVideoBtn.disabled = callMode === "audio";
    toggleVideoBtn.setAttribute("aria-pressed", String(!videoEnabled));
    toggleVideoBtn.textContent = videoEnabled && callMode === "video" ? "Cam" : "Cam off";
    stage.classList.toggle("audio-only", callMode === "audio" || !videoEnabled);
  }

  function broadcastMediaState() {
    if (!socket) return;
    socket.emit("media-state", {
      audio: audioEnabled,
      video: videoEnabled && callMode === "video",
    });
  }

  async function startCall({ roomId, name, peers }) {
    localStorage.setItem("rudra-name", name);

    localStream = await getMedia();
    localVideo.srcObject = localStream;
    localLabel.textContent = name;
    audioEnabled = true;
    videoEnabled = callMode === "video";
    syncControls();

    lobby.hidden = true;
    call.hidden = false;
    activeRoom.textContent = roomId;
    setStatus(peers.length ? "Connecting…" : "Waiting…", peers.length ? "var(--accent)" : "var(--ink-muted)");
    updatePlaceholder();

    if (peers.length > 0) {
      attachRemotePeer(peers[0]);
    }
  }

  async function endCall() {
    if (socket) {
      socket.emit("leave-room");
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }

    clearRemotePeer();

    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    localVideo.srcObject = null;

    call.hidden = true;
    lobby.hidden = false;
    showError("");
    joinBtn.disabled = false;
  }

  joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");
    joinBtn.disabled = true;

    const name = nameInput.value.trim();
    const roomId = roomInput.value.trim().toUpperCase();
    roomInput.value = roomId;

    if (!name || !roomId) {
      showError("Name and room code are required");
      joinBtn.disabled = false;
      return;
    }

    try {
      socket = io({
        transports: ["websocket", "polling"],
        reconnection: true,
      });

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Connection timed out")), 10000);
        socket.once("connect", () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once("connect_error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      socket.on("welcome", (payload) => {
        if (payload?.iceServers?.length) iceServers = payload.iceServers;
      });

      socket.on("peer-joined", (peer) => {
        if (!remotePeerId) attachRemotePeer(peer);
      });

      socket.on("peer-left", ({ id }) => {
        if (id === remotePeerId) clearRemotePeer();
      });

      socket.on("signal", handleSignal);

      socket.on("disconnect", () => {
        setStatus("Disconnected", "var(--danger)");
      });

      const result = await new Promise((resolve) => {
        socket.emit("join-room", { roomId, name }, resolve);
      });

      if (!result?.ok) {
        throw new Error(result?.error || "Could not join room");
      }

      await startCall(result);
      broadcastMediaState();
    } catch (err) {
      console.error(err);
      showError(err.message || "Unable to start call. Check camera/mic permissions.");
      await endCall();
    } finally {
      joinBtn.disabled = false;
    }
  });

  toggleAudioBtn.addEventListener("click", () => {
    if (!localStream) return;
    audioEnabled = !audioEnabled;
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = audioEnabled;
    });
    syncControls();
    broadcastMediaState();
  });

  toggleVideoBtn.addEventListener("click", () => {
    if (!localStream || callMode === "audio") return;
    videoEnabled = !videoEnabled;
    localStream.getVideoTracks().forEach((track) => {
      track.enabled = videoEnabled;
    });
    syncControls();
    broadcastMediaState();
  });

  hangupBtn.addEventListener("click", () => {
    endCall();
  });

  window.addEventListener("beforeunload", () => {
    if (socket) socket.emit("leave-room");
  });
})();
