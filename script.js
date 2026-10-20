/* ===== 1. SUPABASE CONFIGURATION ===== */
const SUPABASE_URL = "https://tjsfqxisaijqgwoskeno.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kFLtDuMQyZvUbiyZErmSdw_RVdgSRci";

const configured =
  SUPABASE_URL.startsWith("https://") &&
  SUPABASE_URL.includes(".supabase.co") &&
  SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_");

const sb = configured && window.supabase
  ? window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY
    )
  : null;

/* ===== 2. ELEMENTS ===== */
const authScreen = document.getElementById("auth-screen");
const chatScreen = document.getElementById("chat-screen");
const authForm = document.getElementById("auth-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const nameInput = document.getElementById("display-name");
const authStatus = document.getElementById("auth-status");
const chatStatus = document.getElementById("chat-status");
const messageList = document.getElementById("message-list");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const currentName = document.getElementById("current-name");

let currentUser = null;
let realtimeChannel = null;
let authMode = "login";

function status(element, text, error = false) {
  if (!element) return;
  element.textContent = text;
  element.style.color = error ? "red" : "";
}

function showScreen(loggedIn) {
  if (authScreen) authScreen.hidden = loggedIn;
  if (chatScreen) chatScreen.hidden = !loggedIn;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#039;"
  })[char]);
}

/* ===== 3. SIGN UP ===== */
async function signUp() {
  if (!sb) {
    status(authStatus, "Check your Supabase URL and publishable key.", true);
    return;
  }

  const email = emailInput?.value.trim();
  const password = passwordInput?.value;
  const displayName =
    nameInput?.value.trim() || email?.split("@")[0] || "Student";

  if (!email || !password) {
    status(authStatus, "Enter your email and password.", true);
    return;
  }

  status(authStatus, "Creating account...");

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } }
  });

  if (error) {
    status(authStatus, error.message, true);
    return;
  }

  if (data.session && data.user) {
    await enterChat(data.user);
  } else {
    status(
      authStatus,
      "Account created. Check whether email confirmation is required, then log in."
    );
  }
}

/* ===== 4. LOGIN ===== */
async function logIn() {
  if (!sb) {
    status(authStatus, "Check your Supabase URL and publishable key.", true);
    return;
  }

  const email = emailInput?.value.trim();
  const password = passwordInput?.value;

  if (!email || !password) {
    status(authStatus, "Enter your email and password.", true);
    return;
  }

  status(authStatus, "Logging in...");

  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    status(authStatus, error.message, true);
    return;
  }

  await enterChat(data.user);
}

/* ===== 5. ENTER CHAT ===== */
async function enterChat(user) {
  currentUser = user;
  showScreen(true);

  const displayName =
    user.user_metadata?.display_name ||
    user.email?.split("@")[0] ||
    "Student";

  if (currentName) currentName.textContent = displayName;

  status(chatStatus, "Loading messages...");
  await loadMessages();
  subscribeToMessages();
}

/* ===== 6. LOAD MESSAGES ===== */
async function loadMessages() {
  if (!sb || !messageList) return;

  const { data, error } = await sb
    .from("messages")
    .select("id, user_id, content, created_at")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    status(chatStatus, "Could not load messages: " + error.message, true);
    return;
  }

  messageList.replaceChildren();

  for (const message of data || []) {
    renderMessage(message);
  }

  status(chatStatus, "Connected to Class Chat.");
}

/* ===== 7. DISPLAY MESSAGE ===== */
function renderMessage(message) {
  if (!messageList) return;

  const item = document.createElement("div");
  item.className =
    message.user_id === currentUser?.id
      ? "chat-message own-message"
      : "chat-message";

  const name =
    message.user_id === currentUser?.id ? "You" : "Student";

  const time = message.created_at
    ? new Date(message.created_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      })
    : "";

  item.innerHTML = `
    <div class="message-meta">
      <strong>${escapeHTML(name)}</strong>
      <small>${escapeHTML(time)}</small>
    </div>
    <div class="message-content">${escapeHTML(message.content)}</div>
  `;

  item.dataset.messageId = String(message.id);
  messageList.appendChild(item);
  messageList.scrollTop = messageList.scrollHeight;
}

/* ===== 8. SEND MESSAGE ===== */
async function sendMessage(event) {
  event.preventDefault();

  if (!sb || !currentUser || !messageInput) return;

  const content = messageInput.value.trim();
  if (!content) return;

  status(chatStatus, "Sending...");

  const { error } = await sb.from("messages").insert({
    content: content
  });

  if (error) {
    status(chatStatus, "Could not send message: " + error.message, true);
    return;
  }

  messageInput.value = "";
  status(chatStatus, "Message sent.");
}

/* ===== 9. REAL-TIME UPDATES ===== */
function subscribeToMessages() {
  if (!sb) return;

  if (realtimeChannel) {
    sb.removeChannel(realtimeChannel);
  }

  realtimeChannel = sb
    .channel("class-chat-live")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages"
      },
      payload => {
        const message = payload.new;
        const exists = messageList?.querySelector(
          `[data-message-id="${CSS.escape(String(message.id))}"]`
        );

        if (!exists) renderMessage(message);
      }
    )
    .subscribe();
}

/* ===== 10. LOGOUT ===== */
async function logOut() {
  if (!sb) return;

  if (realtimeChannel) {
    await sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  const { error } = await sb.auth.signOut();

  if (error) {
    status(chatStatus, error.message, true);
    return;
  }

  currentUser = null;
  showScreen(false);
  if (messageList) messageList.replaceChildren();
  if (authForm) authForm.reset();
  status(authStatus, "Logged out.");
}

/* ===== 11. CONNECT BUTTONS ===== */
document.getElementById("signup-button")
  ?.addEventListener("click", () => {
    authMode = "signup";
  });

document.getElementById("login-button")
  ?.addEventListener("click", () => {
    authMode = "login";
  });

authForm?.addEventListener("submit", async event => {
  event.preventDefault();

  const action = event.submitter?.dataset?.authMode ||
    event.submitter?.id || authMode;

  if (action === "signup" || action === "signup-button") {
    await signUp();
  } else {
    await logIn();
  }
});

messageForm?.addEventListener("submit", sendMessage);

document.getElementById("logout-button")
  ?.addEventListener("click", logOut);

/* ===== 12. RESTORE SESSION ===== */
async function restoreSession() {
  if (!configured || !sb) {
    showScreen(false);
    status(
      authStatus,
      "Add your real Supabase Project URL and Publishable key.",
      true
    );
    return;
  }

  const { data, error } = await sb.auth.getSession();

  if (error) {
    status(authStatus, error.message, true);
    return;
  }

  if (data.session?.user) {
    await enterChat(data.session.user);
  } else {
    showScreen(false);
  }
}

showScreen(false);
restoreSession();
