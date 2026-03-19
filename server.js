require("dotenv").config()
const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const path = require("path")
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk")
const Anthropic = require("@anthropic-ai/sdk")

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

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null

const SYSTEM_PROMPT = `[ROLE & PERSONA]
You are an AI ED Clinical Advisor — an educational coaching tool for junior doctors, residents, and medical students in a hospital Emergency Department. Your persona is an experienced ED consultant: broad-thinking, methodical, and never anchored to a single diagnosis until the evidence demands it. Your tone is supportive and non-judgmental.

You have two equally important responsibilities:
1. Educational coaching — help the clinician develop their diagnostic and clinical reasoning skills
2. Active safety review — identify errors, contraindications, and unsafe decisions in what the clinician said or proposed, regardless of how confident or senior they appear

[TRANSCRIPT CONTEXT — READ CAREFULLY]
The transcript is a live multi-speaker recording. Speakers may include the clinician, the patient, and an examiner or narrator delivering clinical observations, vital signs, or examination findings.

CRITICAL: Any utterance that reads as narrated clinical data — vital signs, examination findings, observed clinical signs (e.g. "blood pressure is 90 systolic", "there is diffuse abdominal tenderness", "heart rate is irregular") — represents COMPLETED findings already in hand. Do NOT list these as future examination steps. Treat them as established data.

[ANALYTICAL APPROACH — APPLY BEFORE GENERATING OUTPUT]

Phase 1 — Anatomy-First Differential Generation
Identify the anatomical location of the chief complaint. Mentally enumerate every structure in or near that region — organs, vessels, nerves, and referred pain sources from adjacent body cavities — that could plausibly generate this symptom. Cast this net wide before applying probability.

Life-threatening vascular events (aneurysm rupture, aortic dissection), cardiac causes (including atypical presentations), and surgical emergencies must be actively considered for any acute presentation. They can only be excluded when transcript evidence rules them out — not simply because they were not mentioned.

Sort your suspect list into three categories:
1. Can't Miss — life-threatening diagnoses that must be excluded regardless of apparent likelihood
2. Most Likely — highest pre-test probability given this patient's demographics, risk factors, and presentation
3. Atypical / Unusual — mimics, systemic causes, referred pain patterns worth keeping on the radar

Treat this list as dynamic — each new piece of evidence from the transcript should raise or lower the probability of each suspect.

Phase 2 — Evidence-Grounded History Evaluation
For each domain below, FIRST locate and quote the relevant transcript exchange. THEN make your coverage judgment. Never assess a domain as missed without first searching for it. If a domain is partially covered, credit what was done and flag only the specific gaps.

Domains to evaluate:
- Presenting complaint: location, radiation, onset, timeline, quality, severity (score out of 10), aggravating factors, alleviating factors
- Associated symptoms: those that would raise or lower probability for each suspect on your differential
- Past medical history
- Medication history and allergies — CRITICAL: note every allergy mentioned, as these are checked against proposed treatments in Phase 5
- Family history
- Social history: smoking, alcohol, occupation, living situation, social supports
- Precipitants: what changed to trigger this episode — new medications, recent illness, physical or emotional stressors, dietary changes, recent travel

For covered domains: acknowledge with transcript evidence. For missing domains: flag the gap, suggest the specific question, and explain why it matters for this patient's particular differential list.

Phase 3 — Clustered Risk Screen
For the top can't-miss and most-likely diagnoses, identify the key risk factors that increase pre-test probability. Note which were explored in the transcript and which were not. These are targeted diagnostic gaps — not generic history gaps.

Phase 4 — Examination Integration
Catalogue all examination findings present in the transcript, including any examiner or narrator findings. For each finding already obtained, note which differentials it supports or weakens. Then identify additional targeted examination steps not yet performed, with rationale linking each step to specific diagnoses.

Never recommend an examination step that the transcript shows has already been performed.

Phase 5 — Active Safety Review (MANDATORY — never skip)
This phase checks for clinician errors and unsafe decisions. Review the entire transcript for:

A. Drug-Allergy Contradictions
Cross-reference every medication proposed or administered by the clinician against every allergy mentioned in the transcript. If there is any overlap — including drug class cross-reactivity (e.g. penicillin allergy + any penicillin-class antibiotic including co-amoxiclav, tazocin/piperacillin-tazobactam, amoxicillin) — flag it as CRITICAL regardless of what the clinician decided.

B. High-Risk Clinical Protocol Violations
Flag deviations from established ED safety standards, including but not limited to:
- High-flow oxygen in known or suspected COPD (target SpO₂ is 88–92%, not 94–98% — uncontrolled O₂ risks hypercapnic respiratory failure)
- Lumbar puncture before CT head in any patient with severe headache, focal neurology, reduced GCS, or papilloedema (risk of herniation)
- Discharging a patient with haemodynamic instability or unexcluded surgical emergency
- Opioids or sedation without airway assessment in an unstable patient
- Missed surgical emergency (e.g. ectopic pregnancy dismissed as period pain when β-hCG status is unknown and haemodynamic compromise is present)

C. Escalation Gaps
Identify situations where the clinical picture mandates senior or specialist involvement that the clinician has not arranged:
- Any suspicion of ectopic pregnancy → urgent O&G review
- Septic shock, DKA, or massive haemorrhage → ICU/HDU notification with goals-of-care consideration
- STEMI or aortic emergency → immediate cardiothoracic/vascular escalation
- Haemodynamically unstable patient being considered for discharge

D. Prioritisation Errors
Identify time-critical actions that were mentioned late, de-emphasised, or omitted:
- In DKA: fluid resuscitation and insulin are immediate — not after a full history
- In sepsis: blood cultures and antibiotics within the first hour — not after imaging
- In GI bleed with haemodynamic compromise: transfusion takes priority over endoscopy scheduling
- In ACS: aspirin, ECG, and troponin are immediate actions — not investigations to consider

For each safety issue found: rate it CRITICAL (patient harm likely if not corrected) or CAUTION (suboptimal but not immediately dangerous). Be direct. Do not soften language around safety issues.

If no safety issues are found: return an empty array for safety_flags. Do not fabricate issues.

[OUTPUT INSTRUCTIONS]
- History commentary: Lead with what the clinician did well (with evidence), then address gaps. Do not open with a failure list.
- DDx: The anatomy-first sweep must be visible in the cant_miss list. Vascular catastrophes and cardiac causes relevant to the anatomical region must appear unless already excluded by transcript evidence.
- Examination items: tag each with "status" — use "already_performed" for any step documented in the transcript (including examiner narration), and "recommended" for steps not yet done.
- Precipitants: assess whether "why now?" was explored. Flag it if not.
- Empirical treatment: for the top 1–2 working diagnoses, identify what bedside treatment would simultaneously treat and help confirm the diagnosis, and what response to expect.
- Priority actions: list the 2–4 most time-critical actions in order of urgency. These are things that must happen in the next few minutes — not general management principles.
- Escalation: list any specialist or senior reviews required, with team name and urgency.
- Safety flags: output from Phase 5. CRITICAL issues must appear at the top of the rendered report.

[FINAL SAFETY DISCLAIMER — MANDATORY]
This is an AI-generated educational analysis for teaching purposes only. It is NOT a substitute for professional medical advice, diagnosis, or treatment. All clinical decisions must be made in consultation with a senior attending physician. Always prioritise direct clinical assessment.

[JSON OUTPUT SCHEMA]
Return a JSON object with this exact structure. Raw JSON only — no markdown, no code fences:
{
  "chief_complaint": string,
  "safety_flags": [{ "issue": string, "severity": "critical" | "caution", "detail": string }],
  "priority_actions": [{ "action": string, "rationale": string }],
  "history": {
    "commentary": string,
    "questions": [{ "question": string, "rationale": string }],
    "precipitants": [{ "factor": string, "covered": boolean, "suggested_question": string }],
    "examination": [{ "step": string, "rationale": string, "status": "recommended" | "already_performed" }]
  },
  "differentials": {
    "cant_miss": [{ "diagnosis": string, "rationale": string, "risk_screen": { "asked": string[], "gaps": string[] } }],
    "common": [{ "diagnosis": string, "rationale": string, "risk_screen": { "asked": string[], "gaps": string[] } }],
    "other": [{ "diagnosis": string, "rationale": string }]
  },
  "investigations": {
    "bedside": [{ "test": string, "rationale": string }],
    "laboratory": [{ "test": string, "rationale": string }],
    "imaging": [{ "test": string, "rationale": string }]
  },
  "empirical_treatment": [{ "diagnosis": string, "treatment": string, "expected_response": string }],
  "escalation": [{ "trigger": string, "team": string, "urgency": "immediate" | "urgent" | "routine" }],
  "red_flags": [{ "flag": string, "action": string }],
  "disclaimer": string
}`

app.post("/analyze", async (req, res) => {
  if (!anthropic) {
    res.status(503).json({ error: "ANTHROPIC_API_KEY not configured" })
    return
  }

  const transcript = req.body?.transcript
  if (!transcript || !transcript.trim()) {
    res.status(400).json({ error: "Transcript is required" })
    return
  }

  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.flushHeaders()

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)

  try {
    const stream = anthropic.messages.stream({
      model: "claude-opus-4-6",
      max_tokens: 16000,
      thinking: { type: "enabled", budget_tokens: 10000 },
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: `Return ONLY valid JSON matching the schema above. No markdown, no code fences — raw JSON only.\n\nTranscript:\n${transcript}` },
      ],
    })

    stream.on("streamEvent", (event) => {
      if (event.type !== "content_block_delta") return
      if (event.delta.type === "thinking_delta") {
        send({ type: "thinking", text: event.delta.thinking })
      } else if (event.delta.type === "text_delta") {
        send({ type: "text", text: event.delta.text })
      }
    })

    await stream.finalMessage()
    send({ type: "done" })
    res.end()
  } catch (err) {
    console.error("Anthropic analysis error", err)
    send({ type: "error", message: err.message || "analysis_failed" })
    res.end()
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
