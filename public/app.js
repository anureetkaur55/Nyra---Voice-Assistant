const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const state = {
  recognition: null,
  listening: false
};

const elements = {
  listenButton: document.querySelector("#listenButton"),
  stopButton: document.querySelector("#stopButton"),
  clearButton: document.querySelector("#clearButton"),
  textForm: document.querySelector("#textForm"),
  textInput: document.querySelector("#textInput"),
  providerSelect: document.querySelector("#providerSelect"),
  messages: document.querySelector("#messages"),
  assistantStatus: document.querySelector("#assistantStatus"),
  connectionStatus: document.querySelector("#connectionStatus"),
  clock: document.querySelector("#clock"),
  orb: document.querySelector("#orb"),
  quickButtons: document.querySelectorAll("[data-command]")
};

boot();

async function boot() {
  updateClock();
  setInterval(updateClock, 1000);

  setupSpeechRecognition();
  bindEvents();

  addMessage("system", "Hi, I am Nyra✨ your personal voice assistant.\nUse the microphone or type a command.");
  setStatus("Ready when you are.");

  await checkHealth();
}

function bindEvents() {
  elements.listenButton.addEventListener("click", startListening);
  elements.stopButton.addEventListener("click", stopEverything);

  elements.clearButton.addEventListener("click", () => {
    elements.messages.innerHTML = "";
    addMessage("system", "Conversation cleared.");
  });

  elements.textForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const command = elements.textInput.value.trim();
    if (!command) return;

    elements.textInput.value = "";
    handleCommand(command);
  });

  for (const button of elements.quickButtons) {
    button.addEventListener("click", () => {
      handleCommand(button.dataset.command || "");
    });
  }
}

function setupSpeechRecognition() {
  if (!SpeechRecognition) {
    elements.listenButton.disabled = true;
    setStatus("Speech recognition is not supported in this browser. Try Chrome or Edge.");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.addEventListener("start", () => {
    state.listening = true;
    elements.orb.classList.add("listening");
    setStatus("Listening...");
  });

  recognition.addEventListener("result", (event) => {
    const transcript = event.results[0][0].transcript;
    handleCommand(transcript);
  });

  recognition.addEventListener("end", () => {
    state.listening = false;
    elements.orb.classList.remove("listening");
  });

  recognition.addEventListener("error", () => {
    setStatus("I could not hear that clearly. Please try again.");
  });

  state.recognition = recognition;
}

async function checkHealth() {
  try {
    const health = await api("/api/health");

    const ready = health.openaiConfigured || health.huggingFaceConfigured;
    elements.connectionStatus.textContent = ready ? "Online" : "Needs keys";
    elements.connectionStatus.classList.toggle("ready", ready);
  } catch {
    elements.connectionStatus.textContent = "Offline";
    elements.connectionStatus.classList.remove("ready");
  }
}

function startListening() {
  if (!state.recognition || state.listening) return;

  window.speechSynthesis.cancel();
  state.recognition.start();
}

function stopEverything() {
  if (state.recognition && state.listening) {
    state.recognition.stop();
  }

  window.speechSynthesis.cancel();
  setStatus("Stopped.");
}

async function handleCommand(rawCommand) {
  const command = rawCommand.trim();
  const query = command.toLowerCase();

  if (!command) return;

  addMessage("user", command);

  try {
    if (query === "stop" || query === "exit") {
      speak("Goodbye!");
      return;
    }

    if (query.includes("open youtube")) {
      openLink("https://youtube.com");
      speak("Opening YouTube.");
      return;
    }

    if (query.includes("open google")) {
      openLink("https://google.com");
      speak("Opening Google.");
      return;
    }

    if (query.includes("time")) {
      const time = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

      speak(`The time is ${time}.`);
      return;
    }

    if (query.startsWith("play ")) {
      const song = command.replace(/^play\s+/i, "").trim();
      openLink(`https://www.youtube.com/results?search_query=${encodeURIComponent(song)}`);
      speak(`Opening YouTube results for ${song}.`);
      return;
    }

    if (query.includes("wikipedia")) {
      const topic = command.replace(/wikipedia/gi, "").trim();
      await answerWikipedia(topic);
      return;
    }

    if (query.includes("send message")) {
      sendWhatsAppMessage(command);
      return;
    }

    await answerWithAi(command);
  } catch (error) {
    speak(error instanceof Error ? error.message : "Something went wrong.");
  }
}

async function answerWithAi(question) {
  const provider = elements.providerSelect.value;
  setStatus(`Asking ${provider === "openai" ? "OpenAI" : "Hugging Face"}...`);

  const data = await api("/api/ask", {
    method: "POST",
    body: JSON.stringify({ question, provider })
  });

  speak(data.answer);
}

async function answerWikipedia(topic) {
  const cleanTopic = topic || prompt("What should I search on Wikipedia?");

  if (!cleanTopic) {
    speak("Please give me a Wikipedia topic.");
    return;
  }

  setStatus("Searching Wikipedia...");

  const data = await api(`/api/wikipedia?topic=${encodeURIComponent(cleanTopic)}`);
  speak(data.summary);
}

function sendWhatsAppMessage(command) {
  const phone = prompt("Enter phone number with country code, for example +919876543210:");

  if (!phone) {
    speak("Phone number is required.");
    return;
  }

  const message = prompt("What message should I send?") || "";

  if (!message.trim()) {
    speak("Message is required.");
    return;
  }

  const cleanPhone = phone.replace(/[^\d]/g, "");

  if (!cleanPhone) {
    speak("That phone number does not look valid.");
    return;
  }

  const link = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;

  window.open(link, "_blank", "noopener,noreferrer");

  speak("WhatsApp is open with your message ready. Please press send.");
}

function parseMessageCommand(command) {
  const match = command.match(/send message(?: to)? (.*?)(?: saying| that says| message)? (.+)$/i);

  return {
    name: match?.[1]?.trim() || "",
    message: match?.[2]?.trim() || ""
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function speak(text) {
  const cleanText = String(text || "").trim();

  if (!cleanText) return;

  addMessage("assistant", cleanText);
  setStatus(cleanText);

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.lang = "en-IN";

  window.speechSynthesis.speak(utterance);
}

function addMessage(type, text) {
  const message = document.createElement("article");
  message.className = `message ${type}`;

  const label = document.createElement("strong");
  label.textContent = type === "user" ? "You" : type === "assistant" ? "Assistant" : "System";

  const body = document.createElement("span");
  body.textContent = text;

  message.append(label, body);
  elements.messages.appendChild(message);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function setStatus(text) {
  elements.assistantStatus.textContent = text;
}

function openLink(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function updateClock() {
  elements.clock.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}