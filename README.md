# MedTranscribeApp

Minimal demo: browser microphone -> Node.js proxy -> Deepgram Live Streaming API. The UI shows diarized Doctor/Patient turns and (optionally) DocAssist insights powered by OpenAI.

## Run locally
1. Install deps: `npm install`
2. Create a `.env` file in the project root:
   ```
   DEEPGRAM_API_KEY=your_deepgram_key
   OPENAI_API_KEY=your_openai_key
   ```
3. `npm start`
4. Visit http://localhost:3000, allow mic access, click **Start Listening**.

The DocAssist report appears after you stop a session. Keep API keys server-side and add auth/HTTPS/PHI controls for production.
