/* =========================================
   CLASS CHAT APP - SUPABASE CONFIGURATION
   ========================================= */

const SUPABASE_URL = "PASTE_YOUR_PROJECT_URL_HERE";
const SUPABASE_PUBLISHABLE_KEY = "PASTE_YOUR_PUBLISHABLE_KEY_HERE";

const $ = (selector) => document.querySelector(selector);

const authScreen = $("#auth-screen");
const chatScreen = $("#chat-screen");
const authForm = $("#auth-form");
const nameField = $("#name-field");
const displayNameInput = $("#display-name");
const emailInput = $("#email");
const passwordInput = $("#password");
const authTitle = $("#auth-title");
const authSubtitle = $("#auth-subtitle");
const authStatus = $("#auth-status");
const loginButton = $("#login-button");
const signupButton = $("#signup-button");
const currentName = $("#current-name");
const chatStatus = $("#chat-status");
const messageList = $("#message-list");
const messageForm = $("#message-form");
const messageInput = $("#message-input");
const sendButton = $("#send-button");
const logoutButton = $("#logout-button");

let sb = null;
let currentUser = null;
let messageChannel = null;
let authMode = "login";
let loadingMessages = false;

function setStatus(element, message = "", type = "") {
  element.textContent = message;
  element.className = "status" + (type ? " " + type : "");
}

function showAuth() {
  authScreen.classList.remove("hidden");
  chatScreen.classList.add("hidden");
}

function showChat() {
  authScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");
}

function setAuthMode(mode) {
  authMode = mode;
  const signingUp = mode === "signup";

  authTitle.textContent = signingUp ? "Create your account" : "Welcome back!";
  authSubtitle.textContent = signingUp
    ? "Join your class and start connecting."
    : "Sign in to continue to your class.";

  nameField.classList.toggle("hidden", !signingUp);
  displayNameInput.required = signingUp;
  passwordInput.autocomplete = signingUp ? "new-password" : "current-password";

  loginButton.classList.toggle("hidden", signingUp);
  signupButton.classList.toggle("hidden", !signingUp);

  loginButton.disabled = false;
  signupButton.disabled = false;
  setStatus(authStatus);
}

// The two buttons switch between login and signup modes.
loginButton.addEventListener("click", () => {
  if (authMode !== "login") {
    setAuthMode("login");
    setStatus(authStatus);
  }
});

signupButton.addEventListener("click", () => {
  if (authMode !== "signup") {
    setAuthMode("signup");
    setStatus(authStatus);
  }
});

function configureSupabase() {
  if (!window.supabase || !window.supabase.createClient) {
    setStatus(
      authStatus,
      "The Supabase library did not load. Refresh the page and try again.",
      "error"
    );
    loginButton.disabled = true;
    signupButton.disabled = true;
    return false;
  }

  if (
    SUPABASE_URL.includes("PASTE_YOUR_") ||
    SUPABASE_PUBLISHABLE_KEY.includes("PASTE_YOUR_") ||
    !SUPABASE_URL.startsWith("https://") ||
    !SUPABASE_PUBLISHABLE_KEY.trim()
  ) {
    setStatus(
      authStatus,
      "Add your Supabase Project URL and Publishable key in script.js.",
      "error"
    );
    return false;
  }

  try {
    sb = window.supabase.createClient(
      SUPABASE_URL.trim(),
      SUPABASE_PUBLISHABLE_KEY.trim()
    );
    return true;
  } catch (error) {
    setStatus(authStatus, "Supabase setup error: " + error.message, "error");
    return false;
  }
}

function getDisplayName(user) {
  return (
    user?.user_metadata?.display_name ||
    user?.email?.split("@")[0] ||
    "Student"
  );
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function renderMessage(message) {
  const emptyState = messageList.querySelector(".empty-state");
  if (emptyState) emptyState.remove();

  // Build message elements with textContent to avoid rendering HTML
  // submitted by another user.
  const wrapper = document.createElement("article");
  wrapper.className =
    "message" + (message.user_id === currentUser?.id ? " own" : "");
  wrapper.dataset.messageId = message.id || "";

  const author = document.createElement("div");
  author.className = "message-author";
  author.textContent =
    message.user_id === currentUser?.id
      ? "You"
      : message.display_name || "Classmate";

  const content = document.createElement("p");
  content.className = "message-content";
  content.textContent = message.content || "";

  const time = document.createElement("time");
  time.className = "message-time";
  time.textContent = formatTime(message.created_at);

  wrapper.append(author, content, time);
  messageList.appendChild(wrapper);
  messageList.scrollTop = messageList.scrollHeight;
}

function showEmptyState(message = "Messages will appear here.") {
  messageList.replaceChildren();

  const box = document.createElement("div");
  box.className = "empty-state";

  const icon = document.createElement("div");
  icon.className = "empty-icon";
  icon.textContent = "💬";

  const heading = document.createElement("h3");
  heading.textContent = "Welcome to your class chat";

  const description = document.createElement("p");
  description.textContent = message;

  box.append(icon, heading, description);
  messageList.appendChild(box);
}

async function loadMessages() {
  if (!sb || !currentUser || loadingMessages) return;

  loadingMessages = true;
  setStatus(chatStatus, "Loading messages...");

  try {
    const { data, error } = await sb
      .from("messages")
      .select("id, user_id, content, created_at")
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) throw error;

    messageList.replaceChildren();

    if (!data || data.length === 0) {
      showEmptyState("No messages yet. Be the first to say hello!");
    } else {
      data.forEach((message) => {
        renderMessage({
          ...message,
          display_name: message.user_id === currentUser.id
            ? getDisplayName(currentUser)
            : "Classmate"
        });
      });
    }

    setStatus(chatStatus);
  } catch (error) {
    setStatus(
      chatStatus,
      "Couldn't load messages: " + error.message,
      "error"
    );
  } finally {
    loadingMessages = false;
  }
}

function subscribeToMessages() {
  if (!sb || !currentUser) return;

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
      (payload) => {
        const message = payload.new;

        // Avoid adding a duplicate when a live update arrives
        // for a message already rendered.
        if (
          messageList.querySelector(
            `[data-message-id="${CSS.escape(String(message.id))}"]`
          )
        ) {
          return;
        }

        renderMessage({
          ...message,
          display_name:
            message.user_id === currentUser.id
              ? getDisplayName(currentUser)
              : "Classmate"
        });
      }
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setStatus(
          chatStatus,
          "Live updates aren't connected. Refresh to try again.",
          "error"
        );
      }
    });
}

async function enterChat(user) {
  currentUser = user;
  currentName.textContent = getDisplayName(user);
  showChat();
  messageInput.value = "";

  await loadMessages();
  subscribeToMessages();
}

// Handle both Login and Create Account through the form.
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!sb) {
    setStatus(
      authStatus,
      "Supabase is not configured. Check your URL and key in script.js.",
      "error"
    );
    return;
  }

  const submitter = event.submitter;
  if (submitter?.id === "login-button") authMode = "login";
  if (submitter?.id === "signup-button") authMode = "signup";

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const displayName = displayNameInput.value.trim();

  if (!email || !password) {
    setStatus(authStatus, "Please enter your email and password.", "error");
    return;
  }

  if (authMode === "signup" && !displayName) {
    setStatus(authStatus, "Please enter your display name.", "error");
    return;
  }

  loginButton.disabled = true;
  signupButton.disabled = true;
  setStatus(authStatus, authMode === "signup" ? "Creating account..." : "Logging in...");

  try {
    if (authMode === "signup") {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName }
        }
      });

      if (error) throw error;

      if (data.session && data.user) {
        setStatus(authStatus, "Account created. Opening chat...", "success");
        await enterChat(data.user);
      } else {
        setStatus(
          authStatus,
          "Account created. Check your email if confirmation is required, then log in.",
          "success"
        );
        setAuthMode("login");
      }
    } else {
      const { data, error } = await sb.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      if (!data.user) {
        throw new Error("Login did not return a user. Please try again.");
      }

      setStatus(authStatus, "Login successful!", "success");
      await enterChat(data.user);
    }
  } catch (error) {
    setStatus(authStatus, error.message || "Something went wrong.", "error");
  } finally {
    loginButton.disabled = false;
    signupButton.disabled = false;
  }
});

// Send a new class message.
messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!sb || !currentUser) {
    setStatus(chatStatus, "Please log in again to send a message.", "error");
    return;
  }

  const content = messageInput.value.trim();
  if (!content) return;

  sendButton.disabled = true;
  setStatus(chatStatus, "Sending message...");

  try {
    const { error } = await sb.from("messages").insert({
      user_id: currentUser.id,
      content
    });

    if (error) throw error;

    messageInput.value = "";
    setStatus(chatStatus);
  } catch (error) {
    setStatus(
      chatStatus,
      "Message not sent: " + error.message,
      "error"
    );
  } finally {
    sendButton.disabled = false;
    messageInput.focus();
  }
});

// Log out and stop live message updates.
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
    messageList.replaceChildren();
    authForm.reset();
    setAuthMode("login");
    setStatus(authStatus, "You have logged out.", "success");
    showAuth();
  } catch (error) {
    setStatus(chatStatus, "Couldn't log out: " + error.message, "error");
  } finally {
    logoutButton.disabled = false;
  }
});

// Restore the existing login session after a refresh.
async function startApp() {
  setAuthMode("login");

  if (!configureSupabase()) return;

  try {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;

    if (data.session?.user) {
      await enterChat(data.session.user);
    } else {
      showAuth();
    }

    sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        currentUser = null;
        if (messageChannel) {
          sb.removeChannel(messageChannel);
          messageChannel = null;
        }
        showAuth();
      }
    });
  } catch (error) {
    setStatus(authStatus, "Couldn't check your session: " + error.message, "error");
    showAuth();
  }
}

startApp();
