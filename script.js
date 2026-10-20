/* =================================
   SUPABASE CONFIGURATION
================================= */

const SUPABASE_URL = "PASTE_YOUR_PROJECT_URL_HERE";
const SUPABASE_PUBLISHABLE_KEY = "PASTE_YOUR_PUBLISHABLE_KEY_HERE";

const sb = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

/* =================================
   HTML ELEMENTS
================================= */

const authScreen = document.getElementById("auth-screen");
const chatScreen = document.getElementById("chat-screen");

const authForm = document.getElementById("auth-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

const loginTab = document.getElementById("login-tab");
const signupTab = document.getElementById("signup-tab");
const loginButton = document.getElementById("login-button");
const signupButton = document.getElementById("signup-button");

const authMessage = document.getElementById("auth-message");
const chatMessage = document.getElementById("chat-message");

const logoutButton = document.getElementById("logout-button");
const messagesContainer = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");

let authMode = "login";
let currentUser = null;
let messageChannel = null;

/* =================================
   AUTH SCREEN
================================= */

function showAuthMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.style.color = isError ? "#dc2626" : "#2563eb";
}

function showChatMessage(message, isError = false) {
  chatMessage.textContent = message;
  chatMessage.style.color = isError ? "#dc2626" : "#2563eb";
}

function setAuthMode(mode) {
  authMode = mode;

  const isLogin = mode === "login";

  loginTab.classList.toggle("active", isLogin);
  signupTab.classList.toggle("active", !isLogin);

  loginButton.style.display = isLogin ? "block" : "none";
  signupButton.style.display = isLogin ? "none" : "block";

  passwordInput.autocomplete = isLogin
    ? "current-password"
    : "new-password";

  showAuthMessage("");
}

loginTab.addEventListener("click", () => {
  setAuthMode("login");
});

signupTab.addEventListener("click", () => {
  setAuthMode("signup");
});

/* =================================
   SIGN UP
================================= */

signupButton.addEventListener("click", async () => {
  if (!authForm.reportValidity()) return;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (password.length < 6) {
    showAuthMessage(
      "Password must be at least 6 characters.",
      true
    );
    return;
  }

  signupButton.disabled = true;
  showAuthMessage("Creating your account...");

  try {
    const { data, error } = await sb.auth.signUp({
      email,
      password
    });

    if (error) throw error;

    if (data.session) {
      await handleLoggedInUser(data.session.user);
    } else {
      showAuthMessage(
        "Account created! Check your email to confirm your account, then log in."
      );
      setAuthMode("login");
    }
  } catch (error) {
    showAuthMessage(error.message, true);
  } finally {
    signupButton.disabled = false;
  }
});

/* =================================
   LOG IN
================================= */

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (authMode !== "login") return;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  loginButton.disabled = true;
  showAuthMessage("Logging in...");

  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    await handleLoggedInUser(data.user);
  } catch (error) {
    showAuthMessage(error.message, true);
  } finally {
    loginButton.disabled = false;
  }
});

/* =================================
   LOGIN SESSION
================================= */

async function handleLoggedInUser(user) {
  currentUser = user;

  authScreen.hidden = true;
  chatScreen.hidden = false;

  showChatMessage("");
  await loadMessages();
  subscribeToMessages();
}

async function handleLoggedOutUser() {
  currentUser = null;

  if (messageChannel) {
    await sb.removeChannel(messageChannel);
    messageChannel = null;
  }

  authScreen.hidden = false;
  chatScreen.hidden = true;

  messagesContainer.replaceChildren();
  setAuthMode("login");
}

/* =================================
   LOG OUT
================================= */

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;

  try {
    const { error } = await sb.auth.signOut();
    if (error) throw error;

    await handleLoggedOutUser();
  } catch (error) {
    showChatMessage(error.message, true);
  } finally {
    logoutButton.disabled = false;
  }
});

/* =================================
   DISPLAY MESSAGES
================================= */

function renderMessage(message) {
  const item = document.createElement("div");
  item.className = "message";

  if (message.user_id === currentUser?.id) {
    item.classList.add("own-message");
  }

  const sender = document.createElement("div");
  sender.className = "message-sender";
  sender.textContent =
    message.user_id === currentUser?.id
      ? "You"
      : "Classmate";

  const content = document.createElement("p");
  content.className = "message-content";
  content.textContent = message.content;

  const time = document.createElement("small");
  time.className = "message-time";
  time.textContent = new Date(
    message.created_at
  ).toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short"
  });

  item.append(sender, content, time);
  return item;
}

function displayMessages(messages) {
  messagesContainer.replaceChildren();

  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "empty-message";
    empty.textContent = "No messages yet. Say hello!";
    messagesContainer.appendChild(empty);
    return;
  }

  messages.forEach((message) => {
    messagesContainer.appendChild(renderMessage(message));
  });

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/* =================================
   LOAD CHAT HISTORY
================================= */

async function loadMessages() {
  messagesContainer.textContent = "Loading messages...";

  try {
    const { data, error } = await sb
      .from("messages")
      .select("id, user_id, content, created_at")
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) throw error;

    displayMessages(data || []);
  } catch (error) {
    messagesContainer.textContent =
      "Could not load messages. Check your Supabase messages table and policies.";

    console.error("Load messages error:", error);
  }
}

/* =================================
   SEND A MESSAGE
================================= */

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) return;

  const content = messageInput.value.trim();
  if (!content) return;

  sendButton.disabled = true;

  try {
    const { error } = await sb
      .from("messages")
      .insert({
        user_id: currentUser.id,
        content
      });

    if (error) throw error;

    messageInput.value = "";
    showChatMessage("");
  } catch (error) {
    showChatMessage(error.message, true);
  } finally {
    sendButton.disabled = false;
    messageInput.focus();
  }
});

/* =================================
   REAL-TIME CHAT
================================= */

function subscribeToMessages() {
  if (messageChannel) {
    sb.removeChannel(messageChannel);
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
      (payload) => {
        if (!currentUser) return;

        const emptyMessage =
          messagesContainer.querySelector(".empty-message");

        if (emptyMessage) {
          emptyMessage.remove();
        }

        const message = payload.new;

        if (
          !messagesContainer.querySelector(
            `[data-message-id="${message.id}"]`
          )
        ) {
          const element = renderMessage(message);
          element.dataset.messageId = message.id;
          messagesContainer.appendChild(element);
          messagesContainer.scrollTop =
            messagesContainer.scrollHeight;
        }
      }
    )
    .subscribe();
}

/* =================================
   INITIALIZE APP
================================= */

async function initializeApp() {
  if (
    SUPABASE_URL.includes("PASTE_YOUR") ||
    SUPABASE_PUBLISHABLE_KEY.includes("PASTE_YOUR")
  ) {
    showAuthMessage(
      "Add your Supabase project URL and publishable key in script.js.",
      true
    );
    return;
  }

  try {
    const { data, error } = await sb.auth.getSession();

    if (error) throw error;

    if (data.session) {
      await handleLoggedInUser(data.session.user);
    } else {
      setAuthMode("login");
    }

    sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        currentUser = null;
      }
    });
  } catch (error) {
    showAuthMessage(
      "Could not connect to Supabase: " + error.message,
      true
    );
  }
}

initializeApp();
