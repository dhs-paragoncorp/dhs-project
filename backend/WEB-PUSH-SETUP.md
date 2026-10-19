# DHS Web Push setup

Web Push lets the browser display QC notifications when the DHS page is closed. It requires HTTPS (localhost is allowed for local testing), notification permission, and a running backend. The backend creates and stores VAPID keys automatically on first startup.

## Optional: manage VAPID keys yourself

To provide your own key pair, generate it from the `backend` folder:

```powershell
npx web-push generate-vapid-keys
```

Keep the private key secret. Configure these environment variables on the backend:

- `VAPID_PUBLIC_KEY` — generated public key
- `VAPID_PRIVATE_KEY` — generated private key
- `VAPID_SUBJECT` — a real contact such as `mailto:admin@your-domain.example`
- `PUSH_SUBSCRIPTIONS_FILE` — optional path for persisted browser subscriptions
- `PUSH_VAPID_FILE` — optional path for the generated VAPID key file

Do not commit the private key, `vapid-keys.json`, or `push-subscriptions.json`.

## Local testing

Run `npm.cmd start` in the backend terminal. The key and subscription files are saved by default under the user's `.dhs-project` folder, outside the publicly served project. Open the Data Center over Live Server on `localhost`, click **Aktifkan Alarm**, and allow browser notifications. The backend must stay running and reachable.

## Render deployment

For reliable delivery after deploys/restarts, attach a persistent disk and set `PUSH_SUBSCRIPTIONS_FILE` and `PUSH_VAPID_FILE` to paths on its mount (for example `/var/data/push-subscriptions.json` and `/var/data/vapid-keys.json`). These files must stay outside the publicly served project directory. Set `VAPID_SUBJECT` to a real contact address in the Render environment. Without persistent storage, subscriptions and generated keys are lost on restart, so browsers need to enable the alarm again and the backend creates a new VAPID key pair. A changed VAPID key invalidates subscriptions already stored by each browser; after deploying a stable key, press **Aktifkan Alarm** again on every device so it can refresh its subscription. If you manage VAPID keys with environment variables instead, set them in the Render service environment settings and still persist subscriptions.

Each new FG Full sends a push immediately. If it is still waiting for QC Release, another push is sent every 10 minutes. The reminder stops after QC Release or task completion. Operators can enable browser push from the Operator sidebar; when KFG marks their line's large trolley or wooden pallet as sent to the lift, the registered browser receives a push even if the page is closed. Enable push separately on each operator device/browser. Notification sound and visibility are controlled by the browser and operating system; Web Push cannot guarantee a loud sound.

## Helper BB dashboard

Open `frontend/helper-bb.html` directly; it does not require a Helper BB login. Helper BB presses the pickup button when an empty BB trolley needs collecting. KFG gets a real-time dashboard alert and sound, then confirms when the trolley has been collected. Only one pickup request can be active at a time, and Helper BB can cancel it before KFG collects it. This flow is separate from QC and does not require browser push permission.
