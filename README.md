# Cadenza

Agenda personale e lavorativa con pianificazione automatica. La stessa base dati Supabase sincronizza app Android e webapp.

## Avvio sul computer

1. Installa Node.js LTS e le dipendenze con `npm install`.
2. Crea `.env` nella radice del progetto con `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` del tuo progetto Supabase. Usa solo la chiave pubblicabile, mai la chiave segreta.
3. Avvia la webapp con `npx expo start --web` e apri l'indirizzo mostrato nel terminale.
4. Accedi con lo stesso account usato sul telefono: task e blocchi dell'Agenda arrivano da Supabase.

Per provare il pacchetto destinato alla pubblicazione, esegui `npx expo export --platform web` e poi `npx expo serve`. L'export statico si trova in `dist/`.

## Configurazione Supabase per il web

- In **Authentication → URL Configuration**, aggiungi l'indirizzo locale mostrato da Expo (per esempio `http://localhost:8081`) agli URL di reindirizzamento. Quando pubblichi la webapp, aggiungi anche il suo indirizzo HTTPS. Serve per le email di conferma dei nuovi account.
- Per collegare Google Calendar direttamente dal browser, applica la migrazione `supabase/migrations/017_google_oauth_web_redirect.sql` e distribuisci di nuovo le Edge Functions `google-calendar-connect` e `google-calendar-oauth-callback`. I segreti Google già configurati restano gli stessi.
- Per usare l'opzione **Tieni fuori dall'Agenda**, applica anche `supabase/migrations/018_exclude_tasks_from_plan.sql`.
- Il riconoscimento vocale sul web dipende dal browser e dal permesso per il microfono. In produzione usa HTTPS.

I promemoria locali sono disponibili nell'app Android; la webapp mostra task e Agenda senza promettere notifiche del browser.

## Verifiche

```bash
npx tsc --noEmit
npx expo lint
npx expo export --platform web
```

## Build Android di prova

Il profilo `preview` in `eas.json` produce un APK installabile. Le modifiche al codice web condiviso non aggiornano automaticamente un APK già installato.
