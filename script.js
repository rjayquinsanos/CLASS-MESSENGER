"use strict";

// ========================================
// SUPABASE CONFIGURATION
// ========================================

const SUPABASE_URL = "PASTE_YOUR_PROJECT_URL_HERE";
const SUPABASE_KEY = "PASTE_YOUR_PUBLISHABLE_OR_ANON_KEY_HERE";

if (!window.supabase) {
  alert("Supabase could not load. Check your internet connection.");
  throw new Error("Supabase library unavailable.");
}

const sb = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

// ========================================
// ELEMENTS
// ========================================

const authScreen = document.getElementById("auth-screen");
const chatScreen = document.getElementById("chat-screen");

const authForm = document.getElementById("auth-form");
const usernameInput = document.getElementById("username");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const authSubmit = document.getElementById("auth-submit");
const authMessage = document.getElementById("auth-message");

const loginTab = document.getElementById("login-tab");
const signupTab = document.getElementById("signup-tab");

const logoutButton = document.getElementById("logout-button");
const welcomeMessage = document.getElementById("welcome-message");

const messagesContainer = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const chatMessage = document.getElementById("chat-message");
const connectionStatus = document.getElementById("connection-status");

const weatherForm = document.getElementById("weather-form");
const weatherCity = document.getElementById("weather-city");
const weatherSearchButton = document.getElementById("weather-search-button");
const weatherStatus = document.getElementById("weather-status");
const weatherResult = document.getElementById("weather-result");

// ========================================
// APP STATE
// ========================================

let currentUser = null;
let currentUsername = "";
let authMode = "login";
let messageChannel = null;
let loadingMessages = false;
let knownMessageIds = new Set();
let profileCache = new Map();
let weatherRequestId = 0;

// ========================================
// HELPERS
// ========================================

function showAuthMessage(message, isError = true) {
  authMessage.textContent = message;
  authMessage.style.color = isError ? "#dc2626" : "#15803d";
}

function showChatMessage(message, isError = true) {
  chatMessage.textContent = message;
  chatMessage.style.color = isError ? "#dc2626" : "#15803d";
}

function setAuthMode(mode) {
  authMode = mode;

  const signingUp = mode === "signup";

  usernameInput.hidden = !signingUp;
  usernameInput.required = signingUp;
  usernameInput.autocomplete = signingUp ? "nickname" : "off";

  passwordInput.autocomplete = signingUp
    ? "new-password"
    : "current-password";

  authSubmit.textContent = signingUp ? "Create Account" : "Login";

  loginTab.classList.toggle("active", !signingUp);
  signupTab.classList.toggle("active", signingUp);

  showAuthMessage("");
}

function showChatScreen(show) {
  authScreen.hidden = show;
  chatScreen.hidden = !show;
}

function escapeSafeName(name) {
  return String(name || "Unknown user").slice(0, 40);
}

function formatMessageTime(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

// ========================================
// USER PROFILES
// ========================================

async function saveUserProfile(user, requestedName = "") {
  if (!user) {
    throw new Error("User account was not found.");
  }

  const metadataName =
    user.user_metadata?.username ||
    user.user_metadata?.full_name ||
    "";

  const username = (
    requestedName ||
    metadataName ||
    user.email?.split("@")[0] ||
    "Classmate"
  ).trim().slice(0, 40);

  const { error } = await sb
    .from("profiles")
    .upsert({
      id: user.id,
      username: username
    }, {
      onConflict: "id"
    });

  if (error) throw error;

  profileCache.set(user.id, username);
  currentUsername = username;

  return username;
}

async function loadProfileNames(userIds) {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);

  const missingIds = uniqueIds.filter(
    id => !profileCache.has(id)
  );

  if (missingIds.length === 0) return;

  const { data, error } = await sb
    .from("profiles")
    .select("id, username")
    .in("id", missingIds);

  if (error) {
    console.error("Profile lookup failed:", error.message);
    return;
  }

  for (const profile of data || []) {
    profileCache.set(
      profile.id,
      escapeSafeName(profile.username)
    );
  }
}

async function getSenderName(userId) {
  if (profileCache.has(userId)) {
    return profileCache.get(userId);
  }

  await loadProfileNames([userId]);

  return profileCache.get(userId) || "Unknown user";
}

// ========================================
// LOGIN AND SIGNUP
// ========================================

loginTab.addEventListener("click", () => setAuthMode("login"));
signupTab.addEventListener("click", () => setAuthMode("signup"));

authForm.addEventListener("submit", async event => {
  event.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const username = usernameInput.value.trim();

  if (authMode === "signup" && !username) {
    showAuthMessage("Please enter your name or username.");
    usernameInput.focus();
    return;
  }

  authSubmit.disabled = true;
  showAuthMessage(
    authMode === "signup" ? "Creating your account..." : "Logging in...",
    false
  );

  try {
    if (authMode === "signup") {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: username
          }
        }
      });

      if (error) throw error;

      if (data.user && data.session) {
        await saveUserProfile(data.user, username);
        await startChat(data.user);
        showAuthMessage("Account created successfully.", false);
      } else {
        showAuthMessage(
          "Account created. Check your email to confirm it, then log in.",
          false
        );
        setAuthMode("login");
      }
    } else {
      const { data, error } = await sb.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      await startChat(data.user);
    }
  } catch (error) {
    console.error(error);
    showAuthMessage(error.message || "Authentication failed.");
  } finally {
    authSubmit.disabled = false;
  }
});

// ========================================
// CHAT STARTUP AND LOGOUT
// ========================================

async function startChat(user) {
  if (!user) return;

  currentUser = user;
  profileCache.clear();

  let username = "";

  const { data: profile, error: profileError } = await sb
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (profile?.username) {
    username = profile.username;
    profileCache.set(user.id, username);
  } else {
    // Supports accounts created before the profile was saved.
    username = await saveUserProfile(user);
  }

  currentUsername = username;

  welcomeMessage.textContent = `Welcome, ${username}!`;
  showChatScreen(true);

  showChatMessage("");
  messageInput.disabled = false;
  sendButton.disabled = false;

  await loadMessages();
  subscribeToMessages();
}

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;

  try {
    if (messageChannel) {
      await sb.removeChannel(messageChannel);
      messageChannel = null;
    }

    const { error } = await sb.auth.signOut();
    if (error) throw error;

    currentUser = null;
    currentUsername = "";
    profileCache.clear();
    knownMessageIds.clear();

    messagesContainer.replaceChildren();
    showChatScreen(false);
    authForm.reset();
    setAuthMode("login");
    showAuthMessage("You have logged out.", false);
  } catch (error) {
    showChatMessage(error.message || "Could not log out.");
  } finally {
    logoutButton.disabled = false;
  }
});

// Restore a previous login after refreshing the page.
async function restoreSession() {
  if (
    SUPABASE_URL.includes("PASTE_YOUR") ||
    SUPABASE_KEY.includes("PASTE_YOUR")
  ) {
    showAuthMessage(
      "Add your Supabase project URL and public key in script.js."
    );
    return;
  }

  const { data, error } = await sb.auth.getSession();

  if (error) {
    showAuthMessage(error.message);
    return;
  }

  if (data.session?.user) {
    try {
      await startChat(data.session.user);
    } catch (err) {
      console.error(err);
      showAuthMessage(
        "Could not open your profile. Check the Supabase SQL setup."
      );
    }
  }
}

// ========================================
// DISPLAY MESSAGES WITH SENDER NAMES
// ========================================

async function renderMessage(message) {
  if (!message?.id || knownMessageIds.has(message.id)) return;

  // Mark it immediately to avoid duplicate realtime events.
  knownMessageIds.add(message.id);

  const senderName = await getSenderName(message.user_id);

  // A logout or rerender might have happened during the lookup.
  if (!currentUser || !messagesContainer.isConnected) return;

  const emptyMessage = messagesContainer.querySelector(".empty-message");
  if (emptyMessage) emptyMessage.remove();

  const item = document.createElement("div");
  item.className = "message";
  item.dataset.messageId = message.id;

  if (message.user_id === currentUser.id) {
    item.classList.add("own-message");
  }

  const sender = document.createElement("div");
  sender.className = "message-sender";
  sender.textContent = message.user_id === currentUser.id
    ? `${senderName} (You)`
    : senderName;

  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = message.content || "";

  const time = document.createElement("div");
  time.className = "message-time";
  time.textContent = formatMessageTime(message.created_at);

  item.append(sender, content, time);
  messagesContainer.appendChild(item);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function loadMessages() {
  if (!currentUser || loadingMessages) return;

  loadingMessages = true;
  connectionStatus.textContent = "Loading...";

  try {
    const { data, error } = await sb
      .from("messages")
      .select("id, user_id, content, created_at")
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) throw error;

    const messages = data || [];

    await loadProfileNames(messages.map(m => m.user_id));

    messagesContainer.replaceChildren();
    knownMessageIds.clear();

    if (messages.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-message";
      empty.textContent = "No messages yet. Start the conversation!";
      messagesContainer.appendChild(empty);
    } else {
      for (const message of messages) {
        await renderMessage(message);
      }
    }

    connectionStatus.textContent = "Connected";
  } catch (error) {
    console.error(error);
    connectionStatus.textContent = "Connection issue";
    showChatMessage(
      "Could not load messages. Check your Supabase table and policies."
    );
  } finally {
    loadingMessages = false;
  }
}

function subscribeToMessages() {
  if (messageChannel) {
    sb.removeChannel(messageChannel);
    messageChannel = null;
  }

  messageChannel = sb
    .channel("class-chat-live-messages")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages"
      },
      payload => {
        if (currentUser) {
          renderMessage(payload.new);
        }
      }
    )
    .subscribe(status => {
      connectionStatus.textContent =
        status === "SUBSCRIBED"
          ? "Live"
          : status === "CHANNEL_ERROR"
            ? "Realtime error"
            : "Connecting...";
    });
}

// ========================================
// SEND MESSAGE
// ========================================

messageForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser) {
    showChatMessage("Please log in to send messages.");
    return;
  }

  const content = messageInput.value.trim();
  if (!content) return;

  sendButton.disabled = true;
  showChatMessage("");

  try {
    const { data, error } = await sb
      .from("messages")
      .insert({
        user_id: currentUser.id,
        content: content
      })
      .select("id, user_id, content, created_at")
      .single();

    if (error) throw error;

    // Render immediately; the realtime event won't duplicate it.
    await renderMessage(data);
    messageInput.value = "";
    messageInput.focus();
  } catch (error) {
    console.error(error);
    showChatMessage(error.message || "Could not send the message.");
  } finally {
    sendButton.disabled = false;
  }
});

// ========================================
// WEATHER SEARCH
// Open-Meteo requires no API key.
// ========================================

const weatherCodes = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Freezing drizzle",
  57: "Heavy freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm with hail"
};

weatherForm.addEventListener("submit", async event => {
  event.preventDefault();

  const requestId = ++weatherRequestId;
  const city = weatherCity.value.trim();

  if (!city) {
    weatherStatus.textContent = "Please enter a city name.";
    return;
  }

  weatherSearchButton.disabled = true;
  weatherStatus.textContent = "Searching for weather...";
  weatherResult.hidden = true;

  try {
    const geoUrl = new URL(
      "https://geocoding-api.open-meteo.com/v1/search"
    );

    geoUrl.search = new URLSearchParams({
      name: city,
      count: "1",
      language: "en",
      format: "json"
    });

    const geoResponse = await fetch(geoUrl);

    if (!geoResponse.ok) {
      throw new Error("Could not search for that city.");
    }

    const geoData = await geoResponse.json();
    const place = geoData.results?.[0];

    if (!place) {
      throw new Error("City not found. Try another city name.");
    }

    const weatherUrl = new URL(
      "https://api.open-meteo.com/v1/forecast"
    );

    weatherUrl.search = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      current: [
        "temperature_2m",
        "relative_humidity_2m",
        "apparent_temperature",
        "weather_code",
        "wind_speed_10m"
      ].join(","),
      timezone: "auto"
    });

    const weatherResponse = await fetch(weatherUrl);

    if (!weatherResponse.ok) {
      throw new Error("Could not retrieve the weather.");
    }

    const weatherData = await weatherResponse.json();
    const current = weatherData.current;

    if (!current) {
      throw new Error("Weather data is unavailable right now.");
    }

    // Ignore old responses if the user searched again.
    if (requestId !== weatherRequestId) return;

    document.getElementById("weather-location").textContent =
      [place.name, place.admin1, place.country]
        .filter(Boolean)
        .join(", ");

    document.getElementById("weather-temperature").textContent =
      `${current.temperature_2m}°C`;

    document.getElementById("weather-description").textContent =
      weatherCodes[current.weather_code] || "Conditions unavailable";

    document.getElementById("weather-feels").textContent =
      `Feels like ${current.apparent_temperature}°C`;

    document.getElementById("weather-humidity").textContent =
      `Humidity ${current.relative_humidity_2m}%`;

    document.getElementById("weather-wind").textContent =
      `Wind ${current.wind_speed_10m} km/h`;

    document.getElementById("weather-updated").textContent =
      `Local time: ${String(current.time || "").replace("T", " ")}`;

    weatherResult.hidden = false;
    weatherStatus.textContent = "Weather loaded successfully.";
  } catch (error) {
    if (requestId === weatherRequestId) {
      weatherStatus.textContent =
        error.message || "Weather search failed. Please try again.";
    }
  } finally {
    if (requestId === weatherRequestId) {
      weatherSearchButton.disabled = false;
    }
  }
});

// ========================================
// INITIALIZE
// ========================================

setAuthMode("login");
restoreSession();
