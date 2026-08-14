const $ = (id) => document.getElementById(id);

const setStatus = (message, kind = "") => {
  const el = $("status");
  el.textContent = message || "";
  el.className = `status ${kind}`.trim();
};

const getActiveTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  return tab;
};

const isAdoUrl = (url = "") =>
  /https:\/\/dev\.azure\.com\//i.test(url) ||
  /https:\/\/[^/]+\.visualstudio\.com\//i.test(url);

const getPat = async () => {
  const { pat } = await chrome.storage.local.get("pat");
  return pat || "";
};

const callPage = async (tabId, method, payload) => {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["page-bridge.js"],
  });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (name, args) => {
      try {
        return await window.__adoQuickTask[name](args);
      } catch (err) {
        return { ok: false, error: err?.message || String(err), status: err?.status };
      }
    },
    args: [method, payload ?? null],
  });
  return injection?.result || { ok: false, error: "No response from the Azure DevOps page." };
};

const fillParent = (ctx) => {
  $("parent").hidden = false;
  $("parent-meta").textContent = `${ctx.type} ${ctx.id} · ${ctx.state}`;
  $("parent-title").textContent = ctx.title;
  $("task-title").textContent = ctx.childTitle;
  $("form").hidden = false;
  $("effort").focus();
};

const showCreated = (result) => {
  const el = $("created");
  el.hidden = false;
  el.replaceChildren();
  el.append("Created ");
  const link = document.createElement("a");
  link.href = result.htmlUrl;
  link.textContent = `Task ${result.id}`;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: result.htmlUrl });
  });
  el.append(link);
  el.append(` · ${result.title} · Effort ${result.effort}`);
};

const loadContext = async () => {
  setStatus("Reading current work item…");
  const tab = await getActiveTab();
  if (!isAdoUrl(tab.url)) {
    setStatus("Open a work item in Azure DevOps, then click this again.", "error");
    return;
  }

  const ctx = await callPage(tab.id, "getContext");
  if (!ctx.ok) {
    setStatus(ctx.error || "Could not read this work item.", "error");
    return;
  }

  fillParent(ctx);
  if (/^task$/i.test(ctx.type)) {
    setStatus("This item is already a Task. Child tasks are often rejected.");
    return;
  }
  setStatus("Enter effort and create the child Task.");
};

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const effort = $("effort").value.trim();
  if (effort === "") return;

  $("submit").disabled = true;
  $("created").hidden = true;
  setStatus("Creating task…");

  try {
    const tab = await getActiveTab();
    const result = await callPage(tab.id, "createChild", {
      effort,
      pat: await getPat(),
    });

    if (!result.ok) {
      const hint =
        result.status === 401 || result.status === 403
          ? " If the session was rejected, add a PAT in Settings."
          : "";
      setStatus((result.error || "Create failed.") + hint, "error");
      return;
    }

    showCreated(result);
    setStatus("Child task linked.", "ok");
    $("effort").value = "";
    $("effort").focus();
  } catch (err) {
    setStatus(err.message || "Create failed.", "error");
  } finally {
    $("submit").disabled = false;
  }
});

$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

loadContext().catch((err) => setStatus(err.message || "Could not load this tab.", "error"));
