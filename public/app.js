;(function () {
  const root = document.getElementById("root")
  if (!root) return

  const state = {
    ws: null,
    connected: false,
    preparing: false,
    listening: false,
    turns: [],
    mediaRecorder: null,
    audioStream: null,
    docAssistStatus: "idle",
  }

  const ui = {}

  renderShell()
  bindEvents()
  connectSocket()

  function renderShell() {
    root.innerHTML = `
      <div class="min-h-screen flex items-center justify-center px-4 py-8">
        <div class="glass-card w-full max-w-6xl rounded-3xl shadow-2xl border border-white/40 p-8 md:p-10 space-y-8">
          <header class="flex flex-col gap-4">
            <div>
              <h1 class="text-3xl md:text-4xl font-semibold text-black">Live Clinical Dictation</h1>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <button data-ref="startBtn" class="px-6 py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl shadow-lg shadow-blue-900/40 transition hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">
                Start Listening
              </button>
              <button data-ref="stopBtn" class="px-6 py-3 bg-red-600 text-white text-sm font-semibold rounded-xl shadow-lg shadow-rose-900/30 transition hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed">
                Stop Session
              </button>
            </div>
          </header>

          <div class="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
            <section class="rounded-2xl bg-white/95 p-6 shadow-lg border border-slate-100 flex flex-col overflow-hidden" style="height:70vh">
              <div class="flex items-center justify-between mb-4">
                <div>
                  <p class="text-xs uppercase tracking-[0.3em] text-slate-400 font-mono">Realtime Feed</p>
                  <h2 class="text-2xl font-semibold text-slate-900">Live Transcript</h2>
                </div>
                <div data-ref="liveStatus" class="hidden px-4 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
                  Recording…
                </div>
              </div>
              <div data-ref="transcriptList" class="flex-1 space-y-4 overflow-y-auto pt-1 scrollbar-thin" style="min-height:0">
              </div>
            </section>

            <section class="rounded-2xl bg-white/95 p-6 shadow-lg border border-slate-100 flex flex-col overflow-hidden" style="height:70vh">
              <div class="flex items-baseline justify-between mb-4">
                <div>
                  <p class="text-xs uppercase tracking-[0.3em] text-slate-400 font-mono">AI Review</p>
                  <h2 class="text-2xl font-semibold text-slate-900">DocAssist Suggestions</h2>
                </div>
                <span data-ref="docAssistStatus" class="text-xs font-semibold uppercase tracking-wide text-slate-400">Awaiting transcript</span>
              </div>
              <div data-ref="docAssistContent" class="flex-1 overflow-y-auto scrollbar-thin pr-1" style="min-height:0">
              </div>
            </section>
          </div>
        </div>
      </div>
    `

    ui.startBtn = root.querySelector('[data-ref="startBtn"]')
    ui.stopBtn = root.querySelector('[data-ref="stopBtn"]')
    ui.liveStatus = root.querySelector('[data-ref="liveStatus"]')
    ui.transcriptList = root.querySelector('[data-ref="transcriptList"]')
    ui.docAssistContent = root.querySelector('[data-ref="docAssistContent"]')
    ui.docAssistStatus = root.querySelector('[data-ref="docAssistStatus"]')

    renderEmptyTranscript()
    setDocAssistState("idle", "Stop a session to generate structured feedback for the encounter.")
    updateControls()
  }

  function bindEvents() {
    ui.startBtn.addEventListener("click", startSession)
    ui.stopBtn.addEventListener("click", stopSession)
  }

  function connectSocket() {
    if (state.ws) {
      state.ws.close()
    }

    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
    const ws = new WebSocket(url)
    state.ws = ws
    ws.binaryType = "arraybuffer"

    ws.addEventListener("open", () => {
      state.connected = true
      updateControls()
    })

    ws.addEventListener("close", () => {
      state.connected = false
      updateControls()
      if (state.listening) {
        stopSession()
      }
      setTimeout(connectSocket, 1500)
    })

    ws.addEventListener("error", () => {
      state.connected = false
      updateControls()
    })

    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload?.channel?.alternatives) {
          processTranscriptPayload(payload)
        }
      } catch {
      }
    })

  }

  async function startSession() {
    if (!state.connected || state.listening || state.preparing) return
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Media capture is not supported in this browser.")
      return
    }

    try {
      state.preparing = true
      updateControls()

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      state.audioStream = stream

      const options = {}
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        options.mimeType = "audio/webm;codecs=opus"
      }

      const recorder = new MediaRecorder(stream, options)
      recorder.addEventListener("dataavailable", (evt) => {
        if (!evt.data || evt.data.size === 0) return
        evt.data.arrayBuffer().then((buffer) => {
          if (state.ws?.readyState === WebSocket.OPEN) {
            state.ws.send(buffer)
          }
        })
      })

      recorder.addEventListener("stop", () => {
        state.listening = false
        updateControls()
      })

      recorder.start(250)
      state.mediaRecorder = recorder
      state.listening = true
      state.preparing = false
      updateControls()
      ui.liveStatus.classList.remove("hidden")
      ui.liveStatus.textContent = "Recording…"
    } catch (err) {
      console.error("Unable to start microphone", err)
      alert("Microphone access was denied or is unavailable.")
      state.preparing = false
      updateControls()
    }
  }

  function stopSession() {
    if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
      state.mediaRecorder.stop()
    }
    if (state.audioStream) {
      state.audioStream.getTracks().forEach((track) => track.stop())
    }
    state.mediaRecorder = null
    state.audioStream = null
    state.listening = false
    state.preparing = false
    ui.liveStatus.classList.add("hidden")
    updateControls()

    if (state.turns.length) {
      requestDocAssist()
    } else {
      setDocAssistState("idle", "Capture at least one exchange to unlock DocAssist.")
    }
  }

  function processTranscriptPayload(payload) {
    const channel = payload.channel || {}
    const alternatives = channel.alternatives || []
    if (!alternatives.length) return

    const alt = alternatives[0]
    if (alt.words && alt.words.length) {
      const turns = wordsToTurns(alt.words)
      state.turns = mergeTurns(state.turns, turns)
      renderTranscript()
    } else if (alt.transcript) {
      state.turns = mergeTurns(state.turns, [{ speaker: 0, text: alt.transcript }])
      renderTranscript()
    }
  }

  function wordsToTurns(words) {
    const turns = []
    let current = null

    for (const word of words) {
      const speaker = Number.isInteger(word.speaker) ? word.speaker : 0
      if (!current || current.speaker !== speaker) {
        if (current) turns.push(current)
        current = {
          speaker,
          text: word.word || "",
          start: word.start,
          end: word.end,
        }
      } else {
        const chunk = word.word?.startsWith("'") ? word.word : ` ${word.word}`
        current.text += chunk
        current.end = word.end
      }
    }

    if (current) turns.push(current)
    return turns
  }

  function mergeTurns(existing, incoming) {
    const merged = existing.slice()
    for (const turn of incoming) {
      const last = merged[merged.length - 1]
      if (last && last.speaker === turn.speaker) {
        const proximityOk =
          !turn.start || !last.end || Math.abs(turn.start - last.end) < 1
        if (proximityOk) {
          last.text = `${last.text} ${turn.text}`.replace(/\s+/g, " ").trim()
          last.end = turn.end || last.end
          continue
        }
      }
      merged.push({ ...turn, text: (turn.text || "").trim() })
    }
    return merged
  }

  function renderTranscript() {
    if (!state.turns.length) {
      renderEmptyTranscript()
      return
    }

    ui.transcriptList.innerHTML = state.turns
      .map((turn) => renderTurnCard(turn))
      .join("")
    requestAnimationFrame(() => {
      ui.transcriptList.scrollTop = ui.transcriptList.scrollHeight
    })
  }

  function renderEmptyTranscript() {
    ui.transcriptList.innerHTML = `
      <div class="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
        <p class="text-lg font-semibold text-slate-500">Awaiting conversation</p>
        <p class="text-sm mt-1">Press “Start Listening” to capture the dialogue.</p>
      </div>
    `
  }

  function renderTurnCard(turn) {
    const role = mapSpeakerToRole(turn.speaker)
    const speakerLabel = `Speaker ${turn.speaker + 1}`
    const theme = speakerTheme(turn.speaker)
    return `
      <article class="rounded-2xl border ${theme.border} ${theme.bg} p-4 shadow-sm transition hover:-translate-y-0.5">
        <div class="flex items-center justify-between mb-2">
          <div>
            <p class="text-xs uppercase tracking-wide font-semibold ${theme.badgeText}">${speakerLabel}</p>
            <p class="text-base font-semibold ${theme.headline}">${role}</p>
          </div>
          <span class="text-xs font-mono text-slate-400">${turn.start ? turn.start.toFixed(1) : "--"}s</span>
        </div>
        <p class="text-lg leading-relaxed ${theme.body}">${escapeHtml(turn.text)}</p>
      </article>
    `
  }

  function speakerTheme(speaker) {
    const themes = [
      {
        border: "border-blue-100",
        bg: "bg-blue-50",
        badgeText: "text-blue-500",
        headline: "text-blue-900",
        body: "text-blue-900",
      },
      {
        border: "border-green-100",
        bg: "bg-green-50",
        badgeText: "text-green-500",
        headline: "text-green-900",
        body: "text-green-900",
      },
      {
        border: "border-indigo-100",
        bg: "bg-indigo-50",
        badgeText: "text-indigo-500",
        headline: "text-indigo-900",
        body: "text-indigo-900",
      },
    ]
    return themes[speaker] || themes[themes.length - 1]
  }

  function mapSpeakerToRole(speaker) {
    if (speaker === 0) return "Doctor"
    if (speaker === 1) return "Patient"
    return `Speaker ${speaker + 1}`
  }

  function updateControls() {
    const startDisabled = !state.connected || state.listening || state.preparing
    const stopDisabled = !(state.listening || state.preparing)
    setButtonState(ui.startBtn, startDisabled)
    setButtonState(ui.stopBtn, stopDisabled)
  }

  function setButtonState(button, disabled) {
    button.disabled = disabled
    button.classList.toggle("pointer-events-none", disabled)
    button.classList.toggle("opacity-40", disabled)
    button.classList.toggle("cursor-not-allowed", disabled)
  }

  async function requestDocAssist() {
    const transcript = state.turns
      .map((turn) => `${mapSpeakerToRole(turn.speaker)}: ${turn.text}`)
      .join("\n")

    if (!transcript.trim()) {
      setDocAssistState("idle", "Transcript is empty.")
      return
    }

    setDocAssistState("loading")
    try {
      const response = await fetch("/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || "DocAssist unavailable")
      }
      const payload = await response.json()
      if (!payload?.content) {
        throw new Error("Invalid response")
      }

      let parsed = null
      try {
        parsed = JSON.parse(payload.content)
      } catch {
        parsed = null
      }

      if (parsed && typeof parsed === "object") {
        setDocAssistState("structured", parsed)
      } else {
        setDocAssistState("markdown", payload.content)
      }
    } catch (err) {
      console.error("DocAssist error", err)
      setDocAssistState("error", err.message)
    }
  }

  function setDocAssistState(status, data) {
    state.docAssistStatus = status
    switch (status) {
      case "idle":
        ui.docAssistStatus.textContent = "Awaiting transcript"
        ui.docAssistContent.innerHTML = docAssistPlaceholder(data)
        break
      case "loading":
        ui.docAssistStatus.textContent = "Analyzing…"
        ui.docAssistContent.innerHTML = loadingBlock()
        break
      case "structured":
        ui.docAssistStatus.textContent = "AI summary ready"
        ui.docAssistContent.innerHTML = docAssistStructured(data)
        break
      case "markdown":
        ui.docAssistStatus.textContent = "AI summary (markdown)"
        ui.docAssistContent.innerHTML = docAssistMarkdown(data)
        break
      case "error":
      default:
        ui.docAssistStatus.textContent = "Analysis unavailable"
        ui.docAssistContent.innerHTML = errorBlock(data)
        break
    }
  }

  function docAssistPlaceholder(message) {
    return `
      <div class="rounded-2xl border border-dashed border-slate-200 p-6 text-slate-500 text-sm bg-slate-50/50">
        ${escapeHtml(message || "Stop the session to receive DocAssist guidance.")}
      </div>
    `
  }

  function loadingBlock() {
    return `
      <div class="rounded-2xl border border-slate-200 p-6 bg-white animate-pulse space-y-4">
        <div class="h-4 bg-slate-200 rounded w-1/2"></div>
        <div class="h-4 bg-slate-200 rounded w-2/3"></div>
        <div class="h-4 bg-slate-200 rounded w-1/3"></div>
      </div>
    `
  }

  function errorBlock(message) {
    return `
      <div class="rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 p-6">
        <p class="font-semibold mb-1">Unable to fetch DocAssist guidance</p>
        <p class="text-sm">${escapeHtml(message || "Please check your API key and try again.")}</p>
      </div>
    `
  }

  function docAssistMarkdown(content) {
    const html = window.marked ? window.marked.parse(content) : `<pre>${escapeHtml(content)}</pre>`
    return `
      <article class="prose prose-slate max-w-none">
        ${html}
      </article>
    `
  }

  function docAssistStructured(data) {
    return `
      <div class="space-y-6 text-slate-900">
            ${chiefComplaintBlock(data.chief_complaint)}
            ${historyBlock(data.history)}
            ${differentialBlock(data.differentials)}
            ${investigationBlock(data.investigations)}
            ${redFlagsBlock(data.red_flags)}
            ${disclaimerBlock(data.disclaimer)}
          </div>
        `
      }

  function chiefComplaintBlock(chief) {
    if (!chief) return ""
    return `
      <section class="rounded-2xl border border-slate-200 p-4 bg-gradient-to-r from-slate-50 to-slate-100 shadow-sm">
        <div class="flex items-center gap-2">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Chief Complaint</p>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-700">Focus</span>
        </div>
        <p class="text-xl font-semibold text-slate-900 mt-1">${escapeHtml(chief)}</p>
      </section>
    `
  }

  function historyBlock(history) {
    if (!history) return ""
    const questions = (history.questions || []).map(
      (q) => `
        <li class="mb-2">
          <p class="font-semibold text-slate-900">${escapeHtml(q.question || "")}</p>
          <p class="text-xs text-slate-500 uppercase tracking-wide">Rationale</p>
          <p class="text-sm text-slate-600">${escapeHtml(q.rationale || "")}</p>
        </li>`
    )

    const exams = (history.examination || []).map(
      (step) => `
        <li class="mb-2">
          <p class="font-semibold text-slate-900">${escapeHtml(step.step || "")}</p>
          <p class="text-xs text-slate-500 uppercase tracking-wide">Why</p>
          <p class="text-sm text-slate-600">${escapeHtml(step.rationale || "")}</p>
        </li>`
    )

    return `
      <section class="rounded-3xl border border-slate-200 p-5 bg-white shadow-sm space-y-5">
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-semibold text-slate-900">History &amp; Examination Guidance</h3>
          <span class="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700">History</span>
        </div>
        ${history.commentary ? `<p class="text-slate-600 leading-relaxed">${escapeHtml(history.commentary)}</p>` : ""}
        ${questions.length ? `<div class="rounded-2xl bg-slate-50 p-4 border border-slate-200"><p class="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">High-yield questions to add</p><ul class="space-y-3 text-slate-700">${questions.join("")}</ul></div>` : ""}
        ${exams.length ? `<div class="rounded-2xl bg-slate-50 p-4 border border-slate-200"><p class="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">Physical examination priorities</p><ul class="space-y-3 text-slate-700">${exams.join("")}</ul></div>` : ""}
      </section>
    `
  }

  function differentialBlock(diff) {
    if (!diff) return ""
    const bucket = (title, palette, items) => {
      if (!items || !items.length) return ""
      return `
        <div class="rounded-2xl border ${palette.border} ${palette.bg} p-4">
          <p class="text-xs font-semibold uppercase tracking-wide ${palette.text} mb-2">${title}</p>
          <ul class="space-y-3">
            ${items
              .map(
                (item) => `
                  <li>
                    <p class="font-semibold text-slate-900">${escapeHtml(item.diagnosis || "")}</p>
                    <p class="text-sm text-slate-600">${escapeHtml(item.rationale || "")}</p>
                  </li>`
              )
              .join("")}
          </ul>
        </div>
      `
    }

    return `
      <section class="rounded-3xl border border-slate-200 p-5 bg-white shadow-sm space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-semibold text-slate-900">Differential Diagnoses</h3>
          <span class="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-600">DDx</span>
        </div>
        <div class="space-y-4">
          ${bucket("Can't Miss", { border: "border-rose-100", bg: "bg-rose-50/70", text: "text-rose-600" }, diff.cant_miss)}
          ${bucket("Common / Probable", { border: "border-emerald-100", bg: "bg-emerald-50/70", text: "text-emerald-600" }, diff.common)}
          ${bucket("Other Considerations", { border: "border-slate-200", bg: "bg-slate-50", text: "text-slate-500" }, diff.other)}
        </div>
      </section>
    `
  }

  function investigationBlock(plan) {
    if (!plan) return ""
    const block = (title, items) => {
      if (!items || !items.length) return ""
      return `
        <div class="rounded-2xl border border-slate-100 p-4 bg-slate-50/80">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">${title}</p>
          <ul class="space-y-2">
            ${items
              .map(
                (item) => `
                  <li>
                    <p class="font-semibold text-slate-900">${escapeHtml(item.test || "")}</p>
                    <p class="text-sm text-slate-600">${escapeHtml(item.rationale || "")}</p>
                  </li>`
              )
              .join("")}
          </ul>
        </div>
      `
    }

    return `
      <section class="rounded-3xl border border-slate-200 p-5 bg-white shadow-sm space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-semibold text-slate-900">Suggested Investigation Plan</h3>
          <span class="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-600">Workup</span>
        </div>
        <div class="grid gap-4">
          ${block("Bedside Tests", plan.bedside)}
          ${block("Laboratory / Bloods", plan.laboratory)}
          ${block("Imaging", plan.imaging)}
        </div>
      </section>
    `
  }

  function redFlagsBlock(flags) {
    if (!flags || !flags.length) return ""
    return `
      <section class="rounded-3xl border border-amber-100 bg-amber-50 p-5 space-y-4 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-semibold text-amber-900">Clinical Red Flags</h3>
          <span class="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">Alert</span>
        </div>
        <ul class="space-y-4">
          ${flags
            .map(
              (flag) => `
                <li>
                  <p class="font-semibold text-amber-900">${escapeHtml(flag.flag || "")}</p>
                  <p class="text-sm text-amber-700 mt-1"><span class="font-semibold uppercase tracking-wide text-amber-800">Action:</span> ${escapeHtml(flag.action || "")}</p>
                </li>`
            )
            .join("")}
        </ul>
      </section>
    `
  }

  function disclaimerBlock(disclaimer) {
    if (!disclaimer) return ""
    return `
      <p class="text-xs text-slate-400 font-mono leading-relaxed border-t border-slate-100 pt-3">
        ${escapeHtml(disclaimer)}
      </p>
    `
  }

  function escapeHtml(str) {
    if (typeof str !== "string") return ""
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
  }
})()
