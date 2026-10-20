
const SUPABASE_URL = "https://tjsfqxisaijqgwoskeno.supabase.co";
const SUPABASE_KEY = "sb_publishable_kFLtDuMQyZvUbiyZErmSdw_RVdgSRci";

const sb = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const $ = (id) => document.getElementById(id);

let authMode = "login";
let currentUser = null;
let currentProfile = null;
let messageChannel = null;
let profileChannel = null;
let loadingMessages = false;

function setStatus(id, message, type = "") {
  const el = $(id);
  el.textContent = message;
  el.className = `status ${type}`;
}

function setAuthMode(mode) {
  authMode = mode;
  const signingUp = mode === "signup";

  $("auth-title").textContent = signingUp
    ? "Create your account"
    : "Welcome back!";

  $("auth-submit").textContent = signingUp ? "Sign up" : "Login";
  $("login-tab").classList.toggle("active", !signingUp);
  $("signup-tab").classList.toggle("active", signingUp);
  $("name-field").classList.toggle("hidden", !signingUp);
  $("username-field").classList.toggle("hidden", !signingUp);
  $("full-name").required = signingUp;
  $("username").required = signingUp;
  $("password").autocomplete = signingUp
    ? "new-password"
    : "current-password";

  setStatus("auth-status", "");
}

$("login-tab").addEventListener("click", () => setAuthMode("login"));
$("signup-tab").addEventListener("click", () => setAuthMode("signup"));

async function saveUserProfile(user, fullName, username) {
  const cleanName = String(fullName || "").trim();
  const cleanUsername = String(username || "").trim();

  if (!user?.id || !cleanName || !cleanUsername) {
    throw new Error("Your full name and username are required.");
  }

  const { data, error } = await sb
    .from("profiles")
    .upsert(
      {
        id: user.id,
        full_name: cleanName,
        username: cleanUsername
      },
      { onConflict: "id" }
    )
    .select("id, full_name, username")
    .single();

  if (error) {
    console.error("Profile save failed:", error);
    throw new Error(
      "Could not save your profile name. Check the profiles table and its RLS policies."
    );
  }

  return data;
}

async function loadProfile(user) {
  const { data, error } = await sb
    .from("profiles")
    .select("id, full_name, username")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Profile load failed:", error);
    throw new Error("Could not load your profile.");
  }

  if (data) return data;

  const metadata = user.user_metadata || {};
  const name = metadata.full_name || user.email?.split("@")[0] || "Classmate";
  const username = metadata.username || name.replace(/\s+/g, "").toLowerCase();

  return await saveUserProfile(user, name, username);
}

async function enterChat(user) {
  currentUser = user;
  $("auth-screen").classList.add("hidden");
  $("chat-screen").classList.remove("hidden");
  $("logout-btn").classList.remove("hidden");

  $("current-user-name").textContent = "Loading profile...";
  $("current-user-email").textContent = user.email || "";

  try {
    currentProfile = await loadProfile(user);
    $("current-user-name").textContent = currentProfile.full_name;
    $("current-user-email").textContent = user.email || "";

    await loadMessages();
    subscribeToMessages();
  } catch (error) {
    console.error(error);
    setStatus("chat-status", error.message, "error");
  }
}

$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("email").value.trim();
  const password = $("password").value;
  const fullName = $("full-name").value.trim();
  const username = $("username").value.trim();

  const submit = $("auth-submit");
  submit.disabled = true;
  setStatus("auth-status", "Please wait...");

  try {
    if (authMode === "signup") {
      if (!fullName || !username) {
        throw new Error("Enter your full name and username.");
      }

      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            username
          }
        }
      });

      if (error) throw error;

      if (!data.user) {
        throw new Error("Account creation did not return a user.");
      }

      if (!data.session) {
        setStatus(
          "auth-status",
          "Account created! Check your email to confirm your account, then log in.",
          "success"
        );
        return;
      }

      currentProfile = await saveUserProfile(
        data.user,
        fullName,
        username
      );

      await enterChat(data.user);
      return;
    }

    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;
    await enterChat(data.user);
  } catch (error) {
    console.error("Authentication error:", error);
    setStatus(
      "auth-status",
      error.message || "Something went wrong. Please try again.",
      "error"
    );
  } finally {
    submit.disabled = false;
  }
});

async function loadMessages() {
  if (loadingMessages) return;
  loadingMessages = true;

  try {
    const { data, error } = await sb
      .from("messages")
      .select("id, user_id, content, created_at")
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) throw error;

    const userIds = [...new Set((data || []).map((m) => m.user_id).filter(Boolean))];
    let profiles = {};

    if (userIds.length) {
      const { data: profileRows, error: profileError } = await sb
        .from("profiles")
        .select("id, full_name, username")
        .in("id", userIds);

      if (profileError) throw profileError;

      for (const profile of profileRows || []) {
        profiles[profile.id] = profile;
      }
    }

    renderMessages(data || [], profiles);
  } catch (error) {
    console.error("Load messages failed:", error);
    setStatus(
      "chat-status",
      "Could not load messages. Check your messages and profiles table policies.",
      "error"
    );
  } finally {
    loadingMessages = false;
  }
}

function renderMessages(messages, profiles) {
  const container = $("messages");
  container.replaceChildren();

  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No messages yet. Send the first message!";
    container.appendChild(empty);
    return;
  }

  for (const message of messages) {
    const profile = profiles[message.user_id];
    const senderName = profile?.full_name || profile?.username || "Classmate";

    const bubble = document.createElement("article");
    bubble.className =
      "message" + (message.user_id === currentUser?.id ? " own" : "");

    const header = document.createElement("div");
    header.className = "message-header";

    const sender = document.createElement("span");
    sender.className = "sender-name";
    sender.textContent = senderName;

    const time = document.createElement("span");
    time.className = "message-time";

    const date = new Date(message.created_at);
    time.textContent = Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        });

    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = message.content;

    header.append(sender, time);
    bubble.append(header, content);
    container.appendChild(bubble);
  }

  container.scrollTop = container.scrollHeight;
}

function subscribeToMessages() {
  if (messageChannel) {
    sb.removeChannel(messageChannel);
  }

  messageChannel = sb
    .channel("class-chat-messages")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "messages"
      },
      () => loadMessages()
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR") {
        setStatus(
          "chat-status",
          "Live updates failed. Enable messages in Supabase Realtime.",
          "error"
        );
      }
    });
}

$("message-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) {
    setStatus("chat-status", "Please log in first.", "error");
    return;
  }

  const input = $("message-input");
  const content = input.value.trim();
  if (!content) return;

  const button = $("message-form").querySelector("button");
  button.disabled = true;

  try {
    const { error } = await sb.from("messages").insert({
      user_id: currentUser.id,
      content
    });

    if (error) throw error;

    input.value = "";
    setStatus("chat-status", "");
    await loadMessages();
  } catch (error) {
    console.error("Send message failed:", error);
    setStatus(
      "chat-status",
      "Message could not be sent. Check your messages table and INSERT policy.",
      "error"
    );
  } finally {
    button.disabled = false;
    input.focus();
  }
});

$("logout-btn").addEventListener("click", async () => {
  $("logout-btn").disabled = true;

  try {
    if (messageChannel) {
      await sb.removeChannel(messageChannel);
      messageChannel = null;
    }

    const { error } = await sb.auth.signOut();
    if (error) throw error;

    currentUser = null;
    currentProfile = null;
    $("chat-screen").classList.add("hidden");
    $("auth-screen").classList.remove("hidden");
    $("logout-btn").classList.add("hidden");
    $("messages").replaceChildren();
    setStatus("auth-status", "You have logged out.", "success");
  } catch (error) {
    console.error("Logout failed:", error);
    setStatus("chat-status", "Could not log out. Please try again.", "error");
  } finally {
    $("logout-btn").disabled = false;
  }
});

const weatherCodes = {
  0: "Clear sky",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Moderate rain showers",
  82: "Heavy rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm"
};

$("weather-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const place = $("weather-city").value.trim();
  const result = $("weather-result");

  if (!place) return;

  result.textContent = "Checking weather...";

  try {
    const geoResponse = await fetch(
      "https://geocoding-api.open-meteo.com/v1/search?name=" +
      encodeURIComponent(place) +
      "&count=1&language=en&format=json"
    );

    if (!geoResponse.ok) throw new Error("Weather location search failed.");

    const geo = await geoResponse.json();
    const location = geo.results?.[0];

    if (!location) {
      throw new Error("Location not found. Try another city or place.");
    }

    const weatherResponse = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=" +
      location.latitude +
      "&longitude=" +
      location.longitude +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m"
    );

    if (!weatherResponse.ok) throw new Error("Could not retrieve weather.");

    const weather = await weatherResponse.json();
    const current = weather.current;

    result.replaceChildren();

    const placeName = document.createElement("p");
    placeName.textContent =
      location.name + (location.admin1 ? ", " + location.admin1 : "");

    const temperature = document.createElement("p");
    temperature.className = "weather-temperature";
    temperature.textContent = Math.round(current.temperature_2m) + "°C";

    const description = document.createElement("p");
    description.textContent =
      weatherCodes[current.weather_code] || "Current conditions";

    const feelsLike = document.createElement("p");
    feelsLike.textContent =
      "Feels like: " + Math.round(current.apparent_temperature) + "°C";

    const humidity = document.createElement("p");
    humidity.textContent =
      "Humidity: " + current.relative_humidity_2m + "%";

    const wind = document.createElement("p");
    wind.textContent = "Wind: " + current.wind_speed_10m + " km/h";

    for (const element of [
      placeName,
      temperature,
      description,
      feelsLike,
      humidity,
      wind
    ]) {
      result.appendChild(element);
    }
  } catch (error) {
    console.error("Weather error:", error);
    result.textContent = error.message || "Unable to get weather right now.";
  }
});

async function startApp() {
  setAuthMode("login");

  const { data, error } = await sb.auth.getSession();

  if (error) {
    console.error("Session error:", error);
    setStatus("auth-status", "Could not check your login session.", "error");
    return;
  }

  if (data.session?.user) {
    await enterChat(data.session.user);
  }
}

startApp();
