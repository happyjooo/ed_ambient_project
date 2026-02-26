require("dotenv").config()
const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const path = require("path")
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk")
const OpenAI = require("openai")

const app = express()
const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

app.use(express.static(path.join(__dirname, "public")))
app.use(express.json({ limit: "4mb" }))

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY
if (!DEEPGRAM_API_KEY) {
  console.error("Please set DEEPGRAM_API_KEY environment variable")
  process.exit(1)
}

const deepgram = createClient(DEEPGRAM_API_KEY)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null

const SYSTEM_PROMPT = `System Prompt for ED AI Clinical Advisor (Version 2.0)
[ROLE & PERSONA]
You are an "AI ED Clinical Advisor," a specialized language model designed to function as an educational tool for clinicians in a hospital Emergency Department (ED). Your persona is that of an experienced, calm, and methodical ED consultant. Your primary purpose is to provide structured, evidence-based advice to junior doctors, residents, and medical students after their initial patient consultation. Your tone should be supportive, educational, and non-judgmental. You are a teaching tool, not a replacement for human clinical judgment.
[CORE TASK]
Your task is to analyze a given transcript of a doctor-patient consultation from the ED. Based on this transcript, you will generate a concise and structured report that provides educational guidance. This report must be broken down into four specific sections:
History & Examination Guidance: Providing feedback on the history taken and recommending a course of physical examination.
Differential Diagnoses (DDx): Creating a prioritized list of potential diagnoses.
Suggested Investigations: Recommending a logical workup plan.
Clinical Red Flags: Highlighting any urgent warning signs identified in the transcript.
[INPUT FORMAT]
You will receive a single input: the full text transcript of a consultation between a clinician and a patient.
[OUTPUT STRUCTURE & INSTRUCTIONS]
You must generate your response in a clear, organized Markdown format, strictly adhering to the following structure and sections. For each point you make, you MUST provide a brief rationale explaining why it is relevant, linking it back to details from the transcript.
ED Consultation Analysis: [Patient's Chief Complaint]
1. History Analysis & Recommended Physical Examination
Analysis of History Taking:
Evaluate the history systematically against the mandatory domains below. For each domain, explicitly state whether it was covered or missed in the transcript.

A. Presenting Complaint Characterisation (WWQQAA):
  - Where: Location and radiation
  - When: Onset, timing, duration, progression
  - Quality: Character of the symptom (e.g. sharp, dull, burning, colicky)
  - Quantity: Severity or intensity (e.g. pain score out of 10)
  - Aggravating factors: What makes it worse
  - Alleviating factors: What relieves it

B. Past Medical History (PMHx): Previous illnesses, surgeries, hospitalisations
C. Medication History (DHx): Current medications, allergies (including drug allergies), recent changes
D. Family History (FHx): Relevant familial conditions (e.g. cardiac disease, cancer, diabetes)
E. Social History (SHx): Smoking, alcohol, recreational drugs, occupation, living situation, functional baseline

For every domain NOT covered in the transcript, you MUST flag it as a gap and suggest the specific questions the clinician should ask. Do NOT describe the history as "comprehensive" or "well-focused" if any of these core domains were not explored. Only acknowledge completeness for domains that were genuinely addressed.
Example of flagging a missing domain:
Domain Gap: "Medication History (DHx) was not explored."
Further Question Suggested: "What medications are you currently taking? Do you have any allergies to medications?"
Rationale: "Medication history is essential as current medications may interact with treatment and allergies must be known before prescribing."
Example of acknowledging good coverage:
"The presenting complaint was well-characterised — location, onset, character, severity, and aggravating/alleviating factors were all addressed. PMHx was explored. However, DHx, FHx, and SHx were not discussed and must be obtained."
Recommended Physical Examination:
Based on the history provided in the transcript, recommend the most important and focused physical examination steps to perform next.
Examination Step: [e.g., "Perform a full cardiovascular and respiratory examination."]
Rationale: [e.g., "This is essential to listen for cardiac murmurs, added heart sounds, or signs of heart failure (e.g., bibasilar crackles), and to detect any focal chest signs like wheezing or consolidation that would suggest a respiratory cause for the patient's symptoms."]
Examination Step: [e.g., "Assess for signs of a DVT (calf swelling, tenderness, erythema)."]
Rationale: [e.g., "Given the pleuritic nature of the chest pain, a pulmonary embolism must be ruled out, and a clinical exam for a source of embolus is a key component of this assessment."]
2. Differential Diagnoses (DDx) - Structured by Urgency
(Organize the potential diagnoses into three categories. For each diagnosis, provide a brief justification based on the patient's presentation in the transcript.)
"Can't Miss" / Life-Threatening Diagnoses:
Diagnosis: [e.g., Pulmonary Embolism]
Justification: [e.g., "Patient presents with acute onset pleuritic chest pain and tachycardia, key features concerning for PE."]
Common / Probable Diagnoses:
Diagnosis: [e.g., Pneumonia]
Justification: [e.g., "The patient mentioned a preceding cough and feeling febrile, making a community-acquired pneumonia a strong possibility."]
Less Common / Other Considerations:
Diagnosis: [e.g., Pericarditis]
Justification: [e.g., "If the pain is relieved by sitting forward (a question to be asked), this diagnosis becomes more likely."]
3. Suggested Initial Investigation Plan
(Group investigations logically. Provide a clear rationale for each test ordered.)
Bedside Tests:
Investigation: ECG (12-lead)
Rationale: "Essential to rule out ischemic changes, signs of right heart strain (suggestive of PE), or features of pericarditis."
Laboratory / Blood Tests:
Investigation: FBC (Full Blood Count), U&E (Urea & Electrolytes), Troponin
Rationale: "To check for infection, assess renal function (important for potential CT contrast), and rule out myocardial injury."
Imaging:
Investigation: Chest X-Ray (CXR)
Rationale: "Crucial for identifying pneumonia, pneumothorax, pleural effusion, or other gross cardiopulmonary abnormalities."
4. Clinical Red Flags & Immediate Actions
(A concluding summary of the most urgent findings from the transcript that require immediate attention.)
Red Flag: [e.g., "Hypoxia mentioned in transcript (SpO2 of 92% on room air)."]
Immediate Action: [e.g., "Administer supplemental oxygen to maintain saturation >94% and establish IV access."]
Red Flag: [e.g., "Patient mentioned feeling faint, and heart rate is noted to be 115 bpm."]
Immediate Action: [e.g., "Place the patient on a cardiac monitor and obtain a 12-lead ECG immediately."]
[FINAL SAFETY DISCLAIMER - MANDATORY]
Disclaimer: This is an AI-generated educational analysis. It is NOT a substitute for professional medical advice, diagnosis, or treatment. All clinical decisions, including ordering investigations and determining a final diagnosis and treatment plan, MUST be made in consultation with and under the supervision of a senior attending physician. Always prioritize direct clinical assessment.
[JSON OUTPUT SCHEMA]
Return a JSON object with this exact structure:
{
  "chief_complaint": string,
  "history": {
    "commentary": string,
    "questions": [{ "question": string, "rationale": string }],
    "examination": [{ "step": string, "rationale": string }]
  },
  "differentials": {
    "cant_miss": [{ "diagnosis": string, "rationale": string }],
    "common": [{ "diagnosis": string, "rationale": string }],
    "other": [{ "diagnosis": string, "rationale": string }]
  },
  "investigations": {
    "bedside": [{ "test": string, "rationale": string }],
    "laboratory": [{ "test": string, "rationale": string }],
    "imaging": [{ "test": string, "rationale": string }]
  },
  "red_flags": [{ "flag": string, "action": string }],
  "disclaimer": string
}`

app.post("/analyze", async (req, res) => {
  if (!openai) {
    return res.status(503).json({ error: "OPENAI_API_KEY not configured" })
  }

  const transcript = req.body?.transcript
  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ error: "Transcript is required" })
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Return ONLY valid JSON matching the schema above. Transcript:\n${transcript}` },
      ],
    })

    const content = response.choices?.[0]?.message?.content
    res.json({ content })
  } catch (err) {
    console.error("OpenAI analysis error", err)
    res.status(500).json({ error: "analysis_failed" })
  }
})

const HEARTBEAT_MS = 30_000

wss.on("connection", (clientWs) => {
  console.log("Client connected")

  clientWs.isAlive = true
  clientWs.on("pong", () => { clientWs.isAlive = true })

  const heartbeat = setInterval(() => {
    if (!clientWs.isAlive) {
      clearInterval(heartbeat)
      return clientWs.terminate()
    }
    clientWs.isAlive = false
    clientWs.ping()
  }, HEARTBEAT_MS)

  let dgSocket = null
  let dgReady = false
  let audioBuffer = []

  const forward = (payload) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      try {
        clientWs.send(typeof payload === "string" ? payload : JSON.stringify(payload))
      } catch (err) {
        console.error("Error forwarding message to client", err)
      }
    }
  }

  function openDeepgram() {
    closeDeepgram()
    try {
      dgSocket = deepgram.listen.live({
        model: "nova-3-medical",
        diarize: true,
        utterances: true,
        smart_format: true,
      })
    } catch (err) {
      console.error("Unable to initialize Deepgram connection", err)
      forward({ type: "error", message: "Deepgram connection failed" })
      return
    }

    dgSocket.on(LiveTranscriptionEvents.Open, () => {
      console.log("Connected to Deepgram")
      dgReady = true
      for (const chunk of audioBuffer) {
        dgSocket.send(chunk)
      }
      audioBuffer = []
      forward({ type: "session_ready" })
    })

    dgSocket.on(LiveTranscriptionEvents.Close, () => {
      console.log("Deepgram socket closed")
      dgReady = false
      dgSocket = null
    })

    dgSocket.on(LiveTranscriptionEvents.Error, (err) => console.error("Deepgram socket error", err))
    dgSocket.on(LiveTranscriptionEvents.Transcript, forward)
    dgSocket.on(LiveTranscriptionEvents.Metadata, forward)
    dgSocket.on(LiveTranscriptionEvents.Unhandled, forward)
  }

  function closeDeepgram() {
    dgReady = false
    audioBuffer = []
    if (dgSocket) {
      try {
        dgSocket.requestClose?.()
        dgSocket.disconnect?.()
      } catch (err) {
        console.error("Error closing Deepgram socket", err)
      }
      dgSocket = null
    }
  }

  clientWs.on("message", (message, isBinary) => {
    if (!isBinary) {
      try {
        const data = JSON.parse(message.toString())
        if (data?.type === "start_session") {
          openDeepgram()
          return
        }
        if (data?.type === "stop_session") {
          closeDeepgram()
          return
        }
        if (data?.type === "control") {
          dgSocket?.send(JSON.stringify(data))
        }
      } catch {
        // ignore non-JSON text
      }
      return
    }

    if (dgReady && dgSocket) {
      dgSocket.send(message)
    } else if (dgSocket) {
      audioBuffer.push(message)
    }
  })

  clientWs.on("close", () => {
    console.log("Client disconnected")
    clearInterval(heartbeat)
    closeDeepgram()
  })

  clientWs.on("error", (err) => {
    console.error("Client WS error", err)
    clearInterval(heartbeat)
    closeDeepgram()
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => console.log(`Server listening on ${PORT}`))
