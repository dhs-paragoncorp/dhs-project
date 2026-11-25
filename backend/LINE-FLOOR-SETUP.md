# Persistent line-to-floor mappings

The Data Center Admin mapping panel uses a separate Google Apps Script web app for durable storage. The mapping is stored in the Apps Script project's Script Properties (not the history sheet), independent from the existing history endpoint and Render's ephemeral filesystem.

## 1. Create the storage script

1. Open [script.google.com](https://script.google.com) with the Google account that should own this configuration.
2. Create a standalone Apps Script project.
3. Replace the editor contents with `line-floor-config.gs` from this folder and save.
4. Open **Project Settings** and add a Script Property:
   - Property: `LINE_FLOOR_CONFIG_SECRET`
   - Value: a newly generated, private random string of at least 32 characters. Do not reuse a password.

## 2. Deploy the web app

1. Select **Deploy → New deployment → Web app**.
2. Set **Execute as** to your account.
3. Set **Who has access** to **Anyone** so the backend can call it. The script rejects requests without the private secret.
4. Deploy, approve the requested permissions, and copy the Web app URL ending in `/exec`.

Do not put the secret in frontend code or share it publicly. It belongs only in the Apps Script property and the backend environment.

## 3. Configure the backend

Set these environment variables on the Render backend service (and locally if testing):

- `LINE_FLOOR_CONFIG_URL` — the deployed `/exec` URL
- `LINE_FLOOR_CONFIG_SECRET` — the exact same private value as the Script Property

Redeploy or restart the backend. On first connection it seeds the permanent store from the current default mappings and any configured operator line/floor entries. The Data Center shows whether permanent storage is connected.

## 4. Use the Admin panel

Log in with an account whose `role` is `ADMIN`, open the menu, and choose **Mapping Line & Lantai**. Add a line, choose floor 1–3, then save. Existing lines can be reassigned from **Ubah lantai**; a line can be removed with **Hapus**.

This manages line-to-floor mapping only. A new operator login still needs its own entry in the backend `USERS_JSON` environment variable.
