// ======================================
// 1. SUPABASE CONFIGURATION
// ======================================

const SUPABASE_URL = "PASTE_YOUR_PROJECT_URL_HERE";
const SUPABASE_KEY = "PASTE_YOUR_PUBLISHABLE_OR_ANON_KEY_HERE";

const configIsReady =
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_URL.includes("PASTE_") &&
  !SUPABASE_KEY.includes("PASTE_");

const sb = configIsReady
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;


// ======================================
// 2. HTML ELEMENTS
// ======================================

const authScreen = document.getElementById("auth-screen");
const chatScreen = document.getElementById("chat-screen");

const authForm = document.getElementById("auth-form");
const loginTab = document.getElementById("login-tab");
const signupTab = document.getElementById("signup-tab");
const nameField = document.getElementById("name-field");
const usernameInput = document.getElementById("username");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const authSubmit = document.getElementById("auth-submit");
const authStatus = document.getElementById("auth-status");

const welcomeText = document.getElementById("welcome-text");
const logoutBtn = document.getElementById("logout-btn");

const messagesContainer = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const messageStatus = document.getElementById("message-status");

const weatherForm = document.getElementById("weather-form");
const weatherCityInput = document.getElementById("weather-city");
const weatherStatus = document.getElementById("weather-status");
const weatherResult = document.getElementById("weather-result");


// ======================================
// 3. APP STATE
// ======================================

let currentUser = null;
let authMode = "login";
let messageChannel = null;
let loadingMessages = false;
let knownMessageIds = new Set();
let profileCache = new Map();
let weatherRequestId = 0;


// ======================================
// 4. STATUS HELPERS
// ======================================

function setStatus(element, message = "", type = "") {
  element.textContent = message;
  element.className = "status";

  if (type) {
    element.classList.add(type);
  }
}

function showAuthError(message) {
  setStatus(authStatus, message, "error");
}


// ======================================
// 5. LOGIN / SIGN-UP MODE
// ======================================

function setAuthMode(mode) {
  authMode = mode;

  const isSignup = mode === "signup";

  nameField.hidden = !isSignup;
  usernameInput.required = isSignup;
  usernameInput.disabled = !isSignup;

  passwordInput.autocomplete = isSignup
    ? "new-password"
    : "current-password";

  loginTab.classList.toggle("active", !isSignup);
  signupTab.classList.toggle("active", isSignup);

  authSubmit.textContent = isSignup
    ? "Create Account"
    : "Login";

  setStatus(authStatus);
}

loginTab.addEventListener("click", () => setAuthMode("login"));
signupTab.addEventListener("click", () => setAuthMode("signup"));


// ======================================
// 6. PROFILE FUNCTIONS
// ======================================

function getDisplayName(user) {
  const metadata = user.user_metadata || {};

  return (
    metadata.full_name ||
    metadata.username ||
    user.email?.split("@")[0] ||
    "Unknown"
  );
}

async function saveUserProfile(user, enteredName = "") {
  const name = (
    enteredName ||
    getDisplayName(user)
  ).trim().slice(0, 80) || "Unknown";

  const { error } = await sb
    .from("profiles")
    .upsert(
      {
        id: user.id,
        full_name: name,
        username: name
      },
      { onConflict: "id" }
    );

  if (error) {
    throw new Error(
      "Could not save your profile name: " + error.message
    );
  }

  profileCache.set(user.id, name);

  return name;
}

async function loadProfile(user) {
  const { data, error } = await sb
    .from("profiles")
    .select("id, full_name, username")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(
      "Could not load your profile: " + error.message
    );
  }

  if (data) {
    const savedName = (
      data.full_name ||
      data.username ||
      getDisplayName(user)
    ).trim();

    // Update both fields to keep the profile consistent.
    if (
      data.full_name !== savedName ||
      data.username !== savedName
    ) {
      await saveUserProfile(user, savedName);
    } else {
      profileCache.set(user.id, savedName);
    }

    return savedName;
  }

  // Create a profile if this account does not have one yet.
  return await saveUserProfile(user);
}

async function loadProfilesForMessages(userIds) {
  const uniqueIds = [...new Set(userIds)].filter(
    id => id && !profileCache.has(id)
  );

  if (uniqueIds.length === 0) {
    return;
  }

  const { data, error } = await sb
    .from("profiles")
    .select("id, full_name, username")
    .in("id", uniqueIds);

  if (error) {
    console.error("Could not load sender names:", error.message);
    return;
  }

  for (const profile of data || []) {
    const name = (
      profile.full_name ||
      profile.username ||
      "Unknown"
    ).trim();

    profileCache.set(profile.id, name || "Unknown");
  }
}


// ======================================
// 7. SIGN-UP AND LOGIN
// ======================================

authForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (!sb) {
    showAuthError(
      "Please add your Supabase project URL and public key in script.js."
    );
    return;
  }

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const fullName = usernameInput.value.trim();

  if (authMode === "signup" && !fullName) {
    showAuthError("Please enter your full name.");
    return;
  }

  if (authMode === "signup" && fullName.length > 80) {
    showAuthError("Your name must be 80 characters or fewer.");
    return;
  }

  authSubmit.disabled = true;
  setStatus(authStatus, "Please wait...");

  try {
    if (authMode === "signup") {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            username: fullName
          }
        }
      });

      if (error) {
        throw error;
      }

      if (data.user && data.session) {
        currentUser = data.user;

        await saveUserProfile(data.user, fullName);
        await startChat(data.user);
      } else {
        setStatus(
          authStatus,
          "Account created! Check your email to confirm your account, then log in.",
          "success"
        );

        setAuthMode("login");
        passwordInput.value = "";
      }
    } else {
      const { data, error } = await sb.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        throw error;
      }

      currentUser = data.user;
      await startChat(data.user);
    }
  } catch (error) {
    console.error(error);
    showAuthError(error.message || "Something went wrong.");
  } finally {
    authSubmit.disabled = false;
  }
});


// ======================================
// 8. START CHAT
// ======================================

async function startChat(user) {
  currentUser = user;

  const displayName = await loadProfile(user);

  authScreen.hidden = true;
  chatScreen.hidden = false;

  welcomeText.textContent = "Welcome, " + displayName + "!";

  setStatus(authStatus);
  setStatus(messageStatus);

  await loadMessages();
  subscribeToMessages();
}


// ======================================
// 9. LOG OUT
// ======================================

logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;

  try {
    if (messageChannel) {
      await sb.removeChannel(messageChannel);
      messageChannel = null;
    }

    const { error } = await sb.auth.signOut();

    if (error) {
      throw error;
    }

    currentUser = null;
    knownMessageIds.clear();
    profileCache.clear();

    chatScreen.hidden = true;
    authScreen.hidden = false;

    authForm.reset();
    messageInput.value = "";
    messagesContainer.replaceChildren();

    setStatus(authStatus, "You have logged out.", "success");
    setAuthMode("login");
  } catch (error) {
    setStatus(
      authStatus,
      error.message || "Could not log out.",
      "error"
    );
  } finally {
    logoutBtn.disabled = false;
  }
});


// ======================================
// 10. DISPLAY MESSAGES
// ======================================

function formatMessageTime(timestamp) {
  if (!timestamp) {
    return "";
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function renderMessage(message) {
  if (!currentUser || !message.id) {
    return;
  }

  if (knownMessageIds.has(message.id)) {
    return;
  }

  knownMessageIds.add(message.id);

  const isOwnMessage = message.user_id === currentUser.id;

  const senderName =
    profileCache.get(message.user_id) || "Classmate";

  const wrapper = document.createElement("article");
  wrapper.className = "message";

  if (isOwnMessage) {
    wrapper.classList.add("own");
  }

  const sender = document.createElement("div");
  sender.className = "message-sender";
  sender.textContent = isOwnMessage
    ? senderName + " (You)"
    : senderName;

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = message.content || "";

  const time = document.createElement("time");
  time.className = "message-time";
  time.textContent = formatMessageTime(message.created_at);

  wrapper.append(sender, bubble, time);
  messagesContainer.appendChild(wrapper);

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}


// ======================================
// 11. LOAD CHAT HISTORY
// ======================================

async function loadMessages() {
  if (!currentUser || loadingMessages) {
    return;
  }

  loadingMessages = true;
  messagesContainer.replaceChildren();
  knownMessageIds.clear();

  const loading = document.createElement("p");
  loading.className = "empty-state";
  loading.textContent = "Loading messages...";
  messagesContainer.appendChild(loading);

  try {
    const { data, error } = await sb
      .from("messages")
      .select("id, user_id, content, created_at")
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) {
      throw error;
    }

    messagesContainer.replaceChildren();

    const rows = data || [];

    if (rows.length > 0) {
      await loadProfilesForMessages(
        rows.map(message => message.user_id)
      );

      // If the user logged out while the query was running, stop.
      if (!currentUser) {
        return;
      }

      rows.forEach(renderMessage);
    }

    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No messages yet. Start the conversation!";
      messagesContainer.appendChild(empty);
    }
  } catch (error) {
    console.error(error);

    messagesContainer.replaceChildren();

    const errorText = document.createElement("p");
    errorText.className = "empty-state";
    errorText.textContent = "Could not load messages: " + error.message;
    messagesContainer.appendChild(errorText);
  } finally {
    loadingMessages = false;
  }
}


// ======================================
// 12. REAL-TIME MESSAGES
// ======================================

function subscribeToMessages() {
  if (!currentUser) {
    return;
  }

  if (messageChannel) {
    sb.removeChannel(messageChannel);
    messageChannel = null;
  }

  messageChannel = sb
    .channel("class-chat-messages")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages"
      },
      async payload => {
        const message = payload.new;

        if (!currentUser || knownMessageIds.has(message.id)) {
          return;
        }

        await loadProfilesForMessages([message.user_id]);

        if (!currentUser) {
          return;
        }

        renderMessage(message);

        const emptyState = messagesContainer.querySelector(".empty-state");

        if (emptyState) {
          emptyState.remove();
        }
      }
    )
    .subscribe(status => {
      if (status === "CHANNEL_ERROR") {
        console.error("Real-time connection failed.");
      }
    });
}


// ======================================
// 13. SEND MESSAGE
// ======================================

messageForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser) {
    setStatus(messageStatus, "Please log in first.", "error");
    return;
  }

  const content = messageInput.value.trim();

  if (!content) {
    return;
  }

  if (content.length > 2000) {
    setStatus(
      messageStatus,
      "Your message must be 2000 characters or fewer.",
      "error"
    );
    return;
  }

  sendBtn.disabled = true;
  setStatus(messageStatus, "Sending...");

  try {
    const { data, error } = await sb
      .from("messages")
      .insert({
        user_id: currentUser.id,
        content
      })
      .select("id, user_id, content, created_at")
      .single();

    if (error) {
      throw error;
    }

    // Render immediately; the real-time event won't duplicate it.
    renderMessage(data);

    const emptyState = messagesContainer.querySelector(".empty-state");

    if (emptyState) {
      emptyState.remove();
    }

    messageInput.value = "";
    setStatus(messageStatus);
    messageInput.focus();
  } catch (error) {
    console.error(error);
    setStatus(
      messageStatus,
      "Could not send message: " + error.message,
      "error"
    );
  } finally {
    sendBtn.disabled = false;
  }
});


// ======================================
// 14. WEATHER SEARCH
// ======================================

function getWeatherDescription(code) {
  const descriptions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail"
  };

  return descriptions[code] || "Weather information unavailable";
}

weatherForm.addEventListener("submit", async event => {
  event.preventDefault();

  const city = weatherCityInput.value.trim();

  if (!city) {
    setStatus(weatherStatus, "Enter a city name.", "error");
    return;
  }

  const requestId = ++weatherRequestId;

  setStatus(weatherStatus, "Searching for weather...");
  weatherResult.hidden = true;

  try {
    const geocodingUrl =
      "https://geocoding-api.open-meteo.com/v1/search?" +
      new URLSearchParams({
        name: city,
        count: "1",
        language: "en",
        format: "json"
      });

    const locationResponse = await fetch(geocodingUrl);

    if (!locationResponse.ok) {
      throw new Error("Could not search for that city.");
    }

    const locationData = await locationResponse.json();

    if (requestId !== weatherRequestId) {
      return;
    }

    if (!locationData.results || locationData.results.length === 0) {
      throw new Error("City not found. Check the spelling and try again.");
    }

    const place = locationData.results[0];

    const forecastUrl =
      "https://api.open-meteo.com/v1/forecast?" +
      new URLSearchParams({
        latitude: String(place.latitude),
        longitude: String(place.longitude),
        current: [
          "temperature_2m",
          "relative_humidity_2m",
          "apparent_temperature",
          "is_day",
          "precipitation",
          "weather_code",
          "wind_speed_10m"
        ].join(","),
        timezone: "auto"
      });

    const forecastResponse = await fetch(forecastUrl);

    if (!forecastResponse.ok) {
      throw new Error("Could not retrieve the weather.");
    }

    const forecastData = await forecastResponse.json();

    if (requestId !== weatherRequestId) {
      return;
    }

    const current = forecastData.current;

    if (!current) {
      throw new Error("Weather data is not available for this city.");
    }

    const locationParts = [
      place.name,
      place.admin1,
      place.country
    ].filter((value, index, array) =>
      value && array.indexOf(value) === index
    );

    document.getElementById("weather-location").textContent =
      locationParts.join(", ");

    document.getElementById("weather-description").textContent =
      getWeatherDescription(current.weather_code);

    document.getElementById("weather-temperature").textContent =
      `${current.temperature_2m} °C`;

    document.getElementById("weather-feels").textContent =
      `${current.apparent_temperature} °C`;

    document.getElementById("weather-humidity").textContent =
      `${current.relative_humidity_2m}%`;

    document.getElementById("weather-wind").textContent =
      `${current.wind_speed_10m} km/h`;

    document.getElementById("weather-time").textContent =
      "Local time: " + (current.time || "Unavailable");

    weatherResult.hidden = false;
    setStatus(weatherStatus);
  } catch (error) {
    if (requestId !== weatherRequestId) {
      return;
    }

    setStatus(
      weatherStatus,
      error.message || "Weather search failed. Please try again.",
      "error"
    );
  }
});


// ======================================
// 15. RESTORE LOGIN SESSION
// ======================================

async function restoreSession() {
  setAuthMode("login");

  if (!sb) {
    showAuthError(
      "Setup required: add your Supabase project URL and public key in script.js."
    );
    return;
  }

  try {
    const { data, error } = await sb.auth.getSession();

    if (error) {
      throw error;
    }

    if (data.session?.user) {
      await startChat(data.session.user);
    }
  } catch (error) {
    console.error(error);
    showAuthError(
      "Could not restore your session: " + error.message
    );
  }
}

restoreSession();
