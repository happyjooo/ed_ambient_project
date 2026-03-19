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
    docAssistReasoning: null,
    showReasoning: false,
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
              <div class="flex items-center justify-between mb-4">
                <div>
                  <p class="text-xs uppercase tracking-[0.3em] text-slate-400 font-mono">AI Review</p>
                  <h2 class="text-2xl font-semibold text-slate-900">DocAssist</h2>
                </div>
                <div class="flex items-center gap-2">
                  <button data-ref="reasoningBtn" class="hidden px-3 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition">
                    Show Reasoning
                  </button>
                  <span data-ref="docAssistStatus" class="text-xs font-semibold uppercase tracking-wide text-slate-400">Awaiting transcript</span>
                </div>
              </div>
              <div data-ref="reasoningPanel" class="hidden mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 overflow-y-auto text-xs font-mono text-slate-600 leading-relaxed" style="max-height:40%;min-height:0">
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
    ui.reasoningBtn = root.querySelector('[data-ref="reasoningBtn"]')
    ui.reasoningPanel = root.querySelector('[data-ref="reasoningPanel"]')

    renderEmptyTranscript()
    setDocAssistState("idle", "Stop a session to generate structured feedback for the encounter.")
    updateControls()
  }

  function bindEvents() {
    ui.startBtn.addEventListener("click", startSession)
    ui.stopBtn.addEventListener("click", stopSession)
    ui.reasoningBtn.addEventListener("click", toggleReasoning)
  }

  function toggleReasoning() {
    state.showReasoning = !state.showReasoning
    ui.reasoningBtn.textContent = state.showReasoning ? "Hide Reasoning" : "Show Reasoning"
    if (state.showReasoning) {
      ui.reasoningPanel.innerHTML = `<p class="whitespace-pre-wrap">${escapeHtml(state.docAssistReasoning || "")}</p>`
      ui.reasoningPanel.classList.remove("hidden")
    } else {
      ui.reasoningPanel.classList.add("hidden")
    }
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
        if (payload?.type === "session_ready") {
          return
        }
        if (payload?.type === "error") {
          console.error("Server error:", payload.message)
          return
        }
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

      state.ws.send(JSON.stringify({ type: "start_session" }))

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
    if (state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: "stop_session" }))
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
        <p class="text-sm mt-1">Press "Start Listening" to capture the dialogue.</p>
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

    let accContent = ""
    let accReasoning = ""

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

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const chunks = buffer.split("\n\n")
        buffer = chunks.pop()

        for (const chunk of chunks) {
          const line = chunk.trim()
          if (!line.startsWith("data: ")) continue

          let event
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          if (event.type === "thinking") {
            accReasoning += event.text
            ui.docAssistStatus.textContent = "Thinking…"
          } else if (event.type === "text") {
            accContent += event.text
            ui.docAssistStatus.textContent = "Generating…"
          } else if (event.type === "done") {
            state.docAssistReasoning = accReasoning || null
            let parsed = null
            try {
              parsed = JSON.parse(accContent)
            } catch {
              parsed = null
            }
            if (parsed && typeof parsed === "object") {
              setDocAssistState("structured", parsed)
            } else {
              setDocAssistState("markdown", accContent)
            }
          } else if (event.type === "error") {
            throw new Error(event.message || "analysis_failed")
          }
        }
      }
    } catch (err) {
      console.error("DocAssist error", err)
      setDocAssistState("error", err.message)
    }
  }

  function setDocAssistState(status, data) {
    state.docAssistStatus = status

    // Reset reasoning toggle
    state.showReasoning = false
    ui.reasoningPanel.classList.add("hidden")
    ui.reasoningPanel.innerHTML = ""

    switch (status) {
      case "idle":
        ui.docAssistStatus.textContent = "Awaiting transcript"
        ui.docAssistContent.innerHTML = docAssistPlaceholder(data)
        ui.reasoningBtn.classList.add("hidden")
        break
      case "loading":
        ui.docAssistStatus.textContent = "Analyzing…"
        ui.docAssistContent.innerHTML = loadingBlock()
        ui.reasoningBtn.classList.add("hidden")
        break
      case "structured":
        ui.docAssistStatus.textContent = "AI summary ready"
        ui.docAssistContent.innerHTML = docAssistStructured(data)
        if (state.docAssistReasoning) {
          ui.reasoningBtn.textContent = "Show Reasoning"
          ui.reasoningBtn.classList.remove("hidden")
        }
        break
      case "markdown":
        ui.docAssistStatus.textContent = "AI summary (markdown)"
        ui.docAssistContent.innerHTML = docAssistMarkdown(data)
        if (state.docAssistReasoning) {
          ui.reasoningBtn.textContent = "Show Reasoning"
          ui.reasoningBtn.classList.remove("hidden")
        }
        break
      case "error":
      default:
        ui.docAssistStatus.textContent = "Analysis unavailable"
        ui.docAssistContent.innerHTML = errorBlock(data)
        ui.reasoningBtn.classList.add("hidden")
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
        ${safetyFlagsBlock(data.safety_flags)}
        ${priorityActionsBlock(data.priority_actions)}
        ${chiefComplaintBlock(data.chief_complaint)}
        ${historyBlock(data.history)}
        ${differentialBlock(data.differentials)}
        ${investigationBlock(data.investigations)}
        ${empiricalTreatmentBlock(data.empirical_treatment)}
        ${escalationBlock(data.escalation)}
        ${redFlagsBlock(data.red_flags)}
        ${disclaimerBlock(data.disclaimer)}
      </div>
    `
  }

  function safetyFlagsBlock(flags) {
    if (!flags || !flags.length) return ""
    const items = flags.map((f) => {
      const isCritical = f.severity === "critical"
      const icon = isCritical ? "⛔" : "⚠️"
      const theme = isCritical
        ? { border: "border-red-300", bg: "bg-red-50", title: "text-red-900", detail: "text-red-800", badge: "bg-red-100 text-red-800" }
        : { border: "border-amber-300", bg: "bg-amber-50", title: "text-amber-900", detail: "text-amber-800", badge: "bg-amber-100 text-amber-800" }
      return `
        <div class="rounded-2xl border ${theme.border} ${theme.bg} p-4">
          <div class="flex items-start gap-3">
            <span class="text-lg leading-none mt-0.5">${icon}</span>
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-1">
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${theme.badge}">${escapeHtml(f.severity)}</span>
                <p class="font-semibold ${theme.title}">${escapeHtml(f.issue || "")}</p>
              </div>
              <p class="text-sm ${theme.detail}">${escapeHtml(f.detail || "")}</p>
            </div>
          </div>
        </div>`
    })
    return `
      <section class="space-y-3">
        <div class="flex items-center gap-2">
          <h3 class="text-base font-semibold uppercase tracking-wide text-red-700">Safety Review</h3>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">${flags.length} issue${flags.length !== 1 ? "s" : ""}</span>
        </div>
        ${items.join("")}
      </section>
    `
  }

  function priorityActionsBlock(actions) {
    if (!actions || !actions.length) return ""
    return `
      <section class="rounded-3xl border border-orange-200 p-5 bg-orange-50 shadow-sm space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-semibold text-orange-900">Do This Now</h3>
          <span class="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-orange-100 text-orange-800">Priority</span>
        </div>
        <ol class="space-y-3 list-none">
          ${actions.map((a, i) => `
            <li class="flex items-start gap-3">
              <span class="flex-shrink-0 w-6 h-6 rounded-full bg-orange-200 text-orange-900 text-xs font-bold flex items-center justify-center mt-0.5">${i + 1}</span>
              <div>
                <p class="font-semibold text-orange-900">${escapeHtml(a.action || "")}</p>
                <p class="text-sm text-orange-700 mt-0.5">${escapeHtml(a.rationale || "")}</p>
              </div>
            </li>`).join("")}
        </ol>
      </section>
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

    const precipitants = (history.precipitants || []).map((p) => {
      const covered = p.covered === true
      const badge = covered
        ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 whitespace-nowrap">Explored</span>`
        : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 whitespace-nowrap">Not explored</span>`
      return `
        <li class="flex items-start gap-2">
          <div class="mt-0.5">${badge}</div>
          <div>
            <p class="font-semibold text-slate-900">${escapeHtml(p.factor || "")}</p>
            ${!covered && p.suggested_question ? `<p class="text-sm text-slate-600 mt-0.5">${escapeHtml(p.suggested_question)}</p>` : ""}
          </div>
        </li>`
    })

    const exams = (history.examination || []).map((step) => {
      const done = step.status === "already_performed"
      const badge = done
        ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 whitespace-nowrap">Done</span>`
        : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 whitespace-nowrap">Recommended</span>`
      return `
        <li class="flex items-start gap-2">
          <div class="mt-0.5">${badge}</div>
          <div>
            <p class="font-semibold ${done ? "text-slate-400" : "text-slate-900"}">${escapeHtml(step.step || "")}</p>
            <p class="text-sm text-slate-500 mt-0.5">${escapeHtml(step.rationale || "")}</p>
          </div>
        </li>`
    })

    return `
      <section class="rounded-3xl border border-slate-200 p-5 bg-white shadow-sm space-y-5">
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-semibold text-slate-900">History &amp; Examination Guidance</h3>
          <span class="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700">History</span>
        </div>
        ${history.commentary ? `<p class="text-slate-600 leading-relaxed">${escapeHtml(history.commentary)}</p>` : ""}
        ${questions.length ? `<div class="rounded-2xl bg-slate-50 p-4 border border-slate-200"><p class="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">High-yield questions to add</p><ul class="space-y-3 text-slate-700">${questions.join("")}</ul></div>` : ""}
        ${precipitants.length ? `<div class="rounded-2xl bg-slate-50 p-4 border border-slate-200"><p class="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">Precipitants — why now?</p><ul class="space-y-3 text-slate-700">${precipitants.join("")}</ul></div>` : ""}
        ${exams.length ? `<div class="rounded-2xl bg-slate-50 p-4 border border-slate-200"><p class="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">Physical examination</p><ul class="space-y-3 text-slate-700">${exams.join("")}</ul></div>` : ""}
      </section>
    `
  }

  function differentialBlock(diff) {
    if (!diff) return ""

    const bucket = (title, palette, items, showRiskScreen) => {
      if (!items || !items.length) return ""
      return `
        <div class="rounded-2xl border ${palette.border} ${palette.bg} p-4">
          <p class="text-xs font-semibold uppercase tracking-wide ${palette.text} mb-2">${title}</p>
          <ul class="space-y-4">
            ${items.map((item) => {
              const rs = showRiskScreen && item.risk_screen
              const asked = rs?.asked || []
              const gaps = rs?.gaps || []
              return `
                <li>
                  <p class="font-semibold text-slate-900">${escapeHtml(item.diagnosis || "")}</p>
                  <p class="text-sm text-slate-600">${escapeHtml(item.rationale || "")}</p>
                  ${rs && (asked.length || gaps.length) ? `
                    <div class="mt-2 space-y-0.5">
                      ${asked.length ? `<p class="text-xs text-green-700"><span class="font-semibold">Risk factors asked:</span> ${asked.map(escapeHtml).join(", ")}</p>` : ""}
                      ${gaps.length ? `<p class="text-xs text-amber-700"><span class="font-semibold">Not asked:</span> ${gaps.map(escapeHtml).join(", ")}</p>` : ""}
                    </div>` : ""}
                </li>`
            }).join("")}
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
          ${bucket("Can't Miss", { border: "border-rose-100", bg: "bg-rose-50/70", text: "text-rose-600" }, diff.cant_miss, true)}
          ${bucket("Common / Probable", { border: "border-emerald-100", bg: "bg-emerald-50/70", text: "text-emerald-600" }, diff.common, true)}
          ${bucket("Other Considerations", { border: "border-slate-200", bg: "bg-slate-50", text: "text-slate-500" }, diff.other, false)}
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

  function empiricalTreatmentBlock(items) {
    if (!items || !items.length) return ""
    return `
      <section class="rounded-3xl border border-violet-200 p-5 bg-violet-50 shadow-sm space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-semibold text-violet-900">Empirical Treatment</h3>
          <span class="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-violet-100 text-violet-700">Treat to Test</span>
        </div>
        <ul class="space-y-4">
          ${items.map((item) => `
            <li>
              <p class="font-semibold text-violet-900">${escapeHtml(item.diagnosis || "")}</p>
              <p class="text-sm text-violet-800 mt-0.5"><span class="font-semibold">Treatment:</span> ${escapeHtml(item.treatment || "")}</p>
              <p class="text-sm text-violet-700 mt-0.5"><span class="font-semibold">Expected response:</span> ${escapeHtml(item.expected_response || "")}</p>
            </li>`).join("")}
        </ul>
      </section>
    `
  }

  function escalationBlock(items) {
    if (!items || !items.length) return ""
    const urgencyTheme = (u) => {
      if (u === "immediate") return "bg-red-100 text-red-800"
      if (u === "urgent") return "bg-amber-100 text-amber-800"
      return "bg-slate-100 text-slate-600"
    }
    return `
      <section class="rounded-3xl border border-sky-200 p-5 bg-sky-50 shadow-sm space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-semibold text-sky-900">Escalation Required</h3>
          <span class="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-sky-100 text-sky-700">Escalate</span>
        </div>
        <ul class="space-y-3">
          ${items.map((item) => `
            <li class="flex items-start gap-3">
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap mt-0.5 ${urgencyTheme(item.urgency)}">${escapeHtml(item.urgency || "")}</span>
              <div>
                <p class="font-semibold text-sky-900">${escapeHtml(item.team || "")}</p>
                <p class="text-sm text-sky-700">${escapeHtml(item.trigger || "")}</p>
              </div>
            </li>`).join("")}
        </ul>
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
