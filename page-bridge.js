(() => {
  const API = "7.1";
  const TASK_TYPE = "Task";
  const TITLE_SUFFIX = "AWS Effort";
  const FALLBACK_EFFORT_FIELDS = [
    "Microsoft.VSTS.Scheduling.Effort",
    "Microsoft.VSTS.Scheduling.RemainingWork",
    "Microsoft.VSTS.Scheduling.OriginalEstimate",
  ];

  const parseLocation = (href = location.href) => {
    const url = new URL(href);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    let org = "";
    let project = "";

    if (host === "dev.azure.com" || host.endsWith(".dev.azure.com")) {
      org = decodeURIComponent(parts[0] || "");
      if (parts[1] && !parts[1].startsWith("_")) project = decodeURIComponent(parts[1]);
    } else if (host.endsWith(".visualstudio.com")) {
      org = host.split(".")[0];
      if (parts[0] && !parts[0].startsWith("_")) project = decodeURIComponent(parts[0]);
    }

    const editMatch = url.pathname.match(/\/_workitems\/edit\/(\d+)/i);
    const id =
      editMatch?.[1] ||
      url.searchParams.get("workitem") ||
      url.searchParams.get("id") ||
      document.title.match(/^(\d+)\s*:/)?.[1] ||
      "";

    return { org, project, id: String(id || "") };
  };

  const apiBase = (org) => {
    const host = location.hostname.toLowerCase();
    if (host.endsWith(".visualstudio.com")) return location.origin;
    return `${location.origin}/${encodeURIComponent(org)}`;
  };

  const adoFetch = async (url, options = {}, flags = {}) => {
    const headers = new Headers(options.headers || {});
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    headers.set("X-TFS-FedAuthRedirect", "Suppress");
    if (flags.pat) {
      headers.set("Authorization", `Basic ${btoa(`:${flags.pat}`)}`);
    } else if (flags.token) {
      headers.set("Authorization", `Bearer ${flags.token}`);
    }

    const res = await fetch(url, { ...options, credentials: "include", headers });
    const text = await res.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: text.slice(0, 400) };
      }
    }
    if (!res.ok) {
      const err = new Error(body?.message || `${res.status} ${res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return body;
  };

  const sessionToken = async (org) => {
    try {
      const data = await adoFetch(
        `${apiBase(org)}/_apis/WebPlatformAuth/SessionToken?api-version=7.1-preview.1`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appId: "00000000-0000-0000-0000-000000000000",
            force: false,
          }),
        }
      );
      return data?.token || "";
    } catch {
      return "";
    }
  };

  const childTitle = (id) => `${id} ${TITLE_SUFFIX}`;

  const getContext = async () => {
    const loc = parseLocation();
    if (!loc.org) {
      return { ok: false, error: "Open this popup on an Azure DevOps page." };
    }
    if (!loc.id) {
      return {
        ok: false,
        error: "No work item found in this tab. Open a user story or bug first.",
      };
    }

    const item = await adoFetch(
      `${apiBase(loc.org)}/_apis/wit/workitems/${loc.id}?$expand=fields&api-version=${API}`
    );
    const fields = item.fields || {};
    const project = fields["System.TeamProject"] || loc.project;
    return {
      ok: true,
      org: loc.org,
      project,
      id: item.id,
      title: fields["System.Title"] || "",
      type: fields["System.WorkItemType"] || "",
      state: fields["System.State"] || "",
      areaPath: fields["System.AreaPath"] || "",
      iterationPath: fields["System.IterationPath"] || "",
      url: item.url,
      childTitle: childTitle(item.id),
    };
  };

  const resolveEffortField = async (ctx, auth) => {
    try {
      const type = await adoFetch(
        `${apiBase(ctx.org)}/${encodeURIComponent(ctx.project)}/_apis/wit/workitemtypes/${encodeURIComponent(TASK_TYPE)}?api-version=${API}`,
        {},
        auth
      );
      const fields = type.fields || [];
      const match =
        fields.find((f) => /^effort$/i.test(f.name)) ||
        fields.find((f) => /\.effort$/i.test(f.referenceName || ""));
      if (match?.referenceName) return match.referenceName;
    } catch {
      // Use fallbacks below.
    }
    return FALLBACK_EFFORT_FIELDS[0];
  };

  const buildOps = (ctx, title, effort, effortField) => {
    const ops = [
      { op: "add", path: "/fields/System.Title", value: title },
      { op: "add", path: `/fields/${effortField}`, value: effort },
      {
        op: "add",
        path: "/relations/-",
        value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: ctx.url },
      },
    ];
    if (ctx.areaPath) {
      ops.push({ op: "add", path: "/fields/System.AreaPath", value: ctx.areaPath });
    }
    if (ctx.iterationPath) {
      ops.push({ op: "add", path: "/fields/System.IterationPath", value: ctx.iterationPath });
    }
    return ops;
  };

  const postTask = async (ctx, ops, auth) => {
    const type = encodeURIComponent(`$${TASK_TYPE}`);
    const project = encodeURIComponent(ctx.project);
    return adoFetch(
      `${apiBase(ctx.org)}/${project}/_apis/wit/workitems/${type}?api-version=${API}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json-patch+json" },
        body: JSON.stringify(ops),
      },
      auth
    );
  };

  const createChild = async (input = {}) => {
    try {
      const ctx = await getContext();
      if (!ctx.ok) return ctx;

      const effort = Number(input.effort);
      if (!Number.isFinite(effort) || effort < 0) {
        return { ok: false, error: "Enter an effort number." };
      }

      const title = childTitle(ctx.id);
      const token = await sessionToken(ctx.org);
      let auth = token ? { token } : {};
      const preferredField = await resolveEffortField(ctx, auth);
      const fieldsToTry = [
        preferredField,
        ...FALLBACK_EFFORT_FIELDS.filter((name) => name !== preferredField),
      ];

      const createWithAuth = async (authMode) => {
        let lastError;
        for (const field of fieldsToTry) {
          try {
            return await postTask(ctx, buildOps(ctx, title, effort, field), authMode);
          } catch (err) {
            lastError = err;
          }
        }
        throw lastError;
      };

      let created;
      try {
        created = await createWithAuth(auth);
      } catch (err) {
        if (input.pat && (err.status === 401 || err.status === 403)) {
          created = await createWithAuth({ pat: input.pat });
        } else {
          throw err;
        }
      }

      const host = location.hostname.toLowerCase();
      const project = encodeURIComponent(ctx.project);
      const htmlUrl =
        created._links?.html?.href ||
        (host.endsWith(".visualstudio.com")
          ? `${location.origin}/${project}/_workitems/edit/${created.id}`
          : `${location.origin}/${encodeURIComponent(ctx.org)}/${project}/_workitems/edit/${created.id}`);

      return {
        ok: true,
        id: created.id,
        title: created.fields?.["System.Title"] || title,
        effort,
        htmlUrl,
        parentId: ctx.id,
      };
    } catch (err) {
      return { ok: false, error: err.message || String(err), status: err.status };
    }
  };

  window.__adoQuickTask = { getContext, createChild };
})();
