# WhatsApp AI Automation Dashboard

A Node.js automation assistant for WhatsApp Business that uses ADB to control an Android device, parses UI dumps, stores chat memory in SQLite, and generates chat replies through Google Gemini or an external AI fallback server.

## Key Features

- Connects to an Android device over ADB Wi-Fi
- Opens and navigates WhatsApp Business using UI automation
- Parses WhatsApp chat UI dumps for unread messages
- Stores persona and group memory in `memory.sqlite`
- Sends intelligent replies via Google Gemini 2.5 Flash
- Falls back to an external AI service when Gemini is unavailable
- Provides a dashboard API for viewing chat memory and Commander interactions
- Includes a database cleanup workflow with dry-run and force options

## Project Structure

- `index.js` — Main automation loop and chat processing logic
- `adb_manager.js` — ADB connection, phone unlock, UI navigation, and dump handling
- `ui_parser.js` — Parses WhatsApp UI dump XML and extracts chat messages
- `llm_api.js` — Gemini + external fallback AI integration with strict JSON output
- `database.js` — SQLite persistence for personas, groups, and commander profile
- `dashboard_server.js` — Express dashboard backend and Commander chat endpoints
- `clean_database.js` — Safe database reset tool for `memory.sqlite`
- `public/` — Static dashboard frontend assets
- `commander_profile.txt` — Commander profile memory file used by the AI prompt

## Prerequisites

- Node.js 18+ installed
- `npm` installed
- ADB installed and accessible from your shell
- A WhatsApp Business phone reachable via ADB over Wi-Fi
- Google Gemini API key or external AI fallback service available

## Setup

1. Clone or copy this repository to your machine.
2. Open a terminal in the project directory:
   ```bash
   cd c:\Users\Administrator\Desktop\wp
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a `.env` file in the project root.

### Required `.env` variables

Create `.env` with the following values:

```env
PHONE_IP=192.168.1.100:5555
PHONE_PIN=2222
GEMINI_API_KEY=AIzaSy...
FALLBACK_SERVER_URL=https://your-fallback-server.example.com
PORT=3000
RESTRICTED_CONTACTS=Spammer,Blocked Contact
```

- `PHONE_IP`: The device IP and port for ADB Wi-Fi.
- `PHONE_PIN`: Device unlock PIN used in automation flows.
- `GEMINI_API_KEY`: Your Google Gemini API key.
- `FALLBACK_SERVER_URL`: Optional external AI fallback endpoint.
- `PORT`: Optional dashboard server port.
- `RESTRICTED_CONTACTS`: Optional comma-separated contact names to ignore.

## Database Initialization and Cleanup

The project stores chat memory in `memory.sqlite`. Use the cleanup utility when you want to reset the chat database.

- Dry run mode:
  ```bash
  npm run clean-db -- --dry-run
  ```
- Confirmed cleanup:
  ```bash
  npm run clean-db
  ```
- Force cleanup without prompt:
  ```bash
  npm run clean-db:force
  ```

## Running the App

This repository does not define a direct `start` script, so run the main app manually:

```bash
node index.js
```

Start the dashboard server separately if needed:

```bash
node dashboard_server.js
```

Then open the dashboard in your browser at:

```text
http://localhost:3000
```

## Workflow Overview

1. The automation connects to your Android device via ADB.
2. It launches WhatsApp Business and unlocks the screen using configured PIN.
3. It dumps the chat UI and extracts unread messages.
4. It sends the extracted message context to the LLM layer.
5. Gemini or fallback AI returns structured JSON with reply and memory updates.
6. The app updates `memory.sqlite` and sends replies in WhatsApp as needed.

## Important Notes

- Ensure ADB has permission on the phone and the device is reachable at `PHONE_IP`.
- The app assumes WhatsApp Business package `com.whatsapp.w4b`.
- If `GEMINI_API_KEY` is missing or invalid, the app automatically uses the fallback AI endpoint.
- Restricted contacts listed in `RESTRICTED_CONTACTS` will be skipped and will not refresh home state.
- The dashboard uses `commander_profile.txt` to store and retrieve Commander profile memory.

## Troubleshooting

- `adb connect` fails: verify your device IP, enable Wi-Fi debugging, and allow the connection.
- Gemini calls fail: confirm `GEMINI_API_KEY` is valid and the model access is enabled.
- `stdout maxBuffer length exceeded`: the code already increases `exec` buffer size for large ADB output.
- No local branch yet in Git: ensure you commit and push from the correct `main` branch.

## Extending the Project

- Add a proper startup script in `package.json` for production.
- Add unit tests for UI parsing and LLM prompt handling.
- Improve the frontend dashboard in `public/` with live task updates.
- Add robust error handling for ADB disconnects.

## License

This project is currently licensed under ISC.
 
