const patInput = document.getElementById("pat");
const status = document.getElementById("status");

chrome.storage.local.get("pat").then(({ pat }) => {
  if (pat) patInput.placeholder = "Token saved. Paste a new one to replace it.";
});

document.getElementById("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const pat = patInput.value.trim();
  if (pat) {
    await chrome.storage.local.set({ pat });
    patInput.value = "";
    patInput.placeholder = "Token saved. Paste a new one to replace it.";
    status.textContent = "Saved.";
  } else {
    await chrome.storage.local.remove("pat");
    patInput.placeholder = "";
    status.textContent = "Cleared.";
  }
  status.className = "status ok";
});
