const WELCOME_SEEN_KEY = "welcome_seen";

export function hasSeenWelcome(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(WELCOME_SEEN_KEY) === "true";
}

export function markWelcomeSeen() {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(WELCOME_SEEN_KEY, "true");
}
