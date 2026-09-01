# Google Sheets sync — one-time setup

This connects the app to a Google Sheet without any OAuth login on the tablet.
Five minutes, done once from a computer.

1. **Create the Sheet.** Go to [sheets.google.com](https://sheets.google.com), create a new blank spreadsheet. Name it something like "VFW Canteen".
2. **Open the script editor.** In the Sheet, go to **Extensions → Apps Script**.
3. **Paste the code.** Delete the placeholder `Code.gs` contents and paste in the contents of [`Code.gs`](Code.gs) from this folder.
4. **Set the shared secret.** Near the top of the pasted code, change:
   ```
   var SHARED_SECRET = 'CHANGE_ME';
   ```
   to something private — a random word or phrase is fine. Save (Ctrl+S / Cmd+S).
5. **Deploy as a Web App.**
   - Click **Deploy → New deployment**.
   - Click the gear icon next to "Select type" and choose **Web app**.
   - **Execute as:** Me (your Google account).
   - **Who has access:** Anyone.
   - Click **Deploy**.
   - The first time, Google will ask you to authorize the script — click through (it's your own script accessing your own Sheet).
   - Copy the **Web app URL** it gives you (ends in `/exec`).
6. **Enter it in the app.** Open the VFW Bar POS app → **Admin** tab → **Google Sheets sync** card. Paste the Web app URL and the same shared secret you set in step 4, then tap **Save**.

That's it — closing a day in the app will now push that day's close-out summary, sales, and book entries to the Sheet automatically, appearing as three tabs (**Close-out**, **Sales**, **Book**) that get created the first time data lands. A fourth tab, **Products**, appears the first time you add/edit/retire/delete a product in Admin — unlike the others, it's a full snapshot each time (current menu, not history), so it always reflects what's on the tablet right now.

## If you ever change the script

Apps Script deployments are versioned — editing `Code.gs` in the editor does **not** update the live Web App URL. After making changes, go to **Deploy → Manage deployments**, click the pencil/edit icon on the existing deployment, and choose **New version** under "Version," then **Deploy**. The URL stays the same, so nothing needs to change in the app.

If you already had a deployment running before this file mentioned the Products/pull support: paste the updated `Code.gs` in and deploy a new version as above. **Delete the existing "Close-out" tab first** (right-click its tab at the bottom → Delete) before the next day closes — this version adds a `DateISO` column, and since Sheets only writes headers to a brand-new tab, appending to the *old* Close-out tab's headers would push every column one to the right and misalign everything after it. Sales and Book aren't affected and don't need to be recreated.

## Restoring data onto a tablet

Admin → Google Sheets sync has a **Restore from Google Sheet** button. It pulls everything currently in the Sheet and replaces the tablet's local data with it — meant for setting up a replacement/reformatted tablet, or for resetting local data after deliberately clearing the Sheet (e.g. wiping beta-test data before going live). It's one-time and destructive to whatever's currently on the tablet, so it asks for confirmation first.

Products and book balances restore exactly. Sales history restores best-effort: the Sheet only records which internal day-number a sale happened on, so the app re-derives real dates from the Close-out tab and renumbers days sequentially, anchored so the most recent day is exactly right. If the bar ever skipped calendar days between closes, older restored data may show a slightly off day-of-week — this doesn't affect "last 30 days" figures, which are what the app actually uses day-to-day.

## Troubleshooting

- **"Not set up yet"** in the app means the URL field is empty — check step 6.
- **"Couldn't reach the sheet"** with a "bad secret" error means the secret in the app doesn't match `SHARED_SECRET` in the script — they must match exactly (case-sensitive).
- If a day fails to sync (tablet was offline, etc.), it stays queued — tap **Sync now** in Admin once you're back online, or it retries automatically the next time the app opens.
