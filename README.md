# ADO Quick Task

Chrome/Edge extension that creates a child Azure DevOps Task from the work item you have open.

On ticket `12345`, type `8` and it creates a child Task titled `12345 AWS Effort`, sets Effort to `8`, and links it under that ticket.

## Load the extension

1. Clone this repo (or download the zip and unzip it).
2. Open Chrome at `chrome://extensions` or Edge at `edge://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this folder (the one with `manifest.json`).
5. Pin **ADO Quick Task** in the toolbar.

## Use it

1. Open a User Story or Bug in Azure DevOps.
2. Click the extension icon (or press **Alt+Shift+T**).
3. Confirm the title preview looks like `{ticket id} AWS Effort`.
4. Type the effort number and click **Create child task**.

It uses your existing Azure DevOps login. If create fails with 401/403, open **Settings** in the popup and paste a PAT with **Work Items (Read, Write)**.

After pulling code updates, click **Reload** on the extension card at `chrome://extensions`.
