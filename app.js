"use strict";

const CONFIG = window.SNT_MATH_CONFIG || {};
const MIN_GRADE = Object.freeze({ operations: 1, fractions: 3, decimals: 4, measurement: 2, percent: 5, critical: 1 });
const TOPIC_LABELS = Object.freeze({
  operations: "Number Operations",
  fractions: "Fractions",
  decimals: "Decimals",
  measurement: "Conversions",
  percent: "% • Fraction • Decimal",
  critical: "Critical Thinking Skills"
});
const MODE_LABELS = Object.freeze({
  add: "Addition", subtract: "Subtraction", multiply: "Multiplication", divide: "Division", mixed: "Mixed",
  length: "Length", mass: "Mass", capacity: "Capacity",
  add_same: "Addition — Same Denominators",
  subtract_same: "Subtraction — Same Denominators",
  add_different: "Addition — Different Denominators",
  subtract_different: "Subtraction — Different Denominators",
  patterns: "Patterns & Sequences",
  missing: "Missing Number Logic",
  balance: "Balance the Equation",
  machines: "Number Machines"
});
const UNIT_LABELS = Object.freeze({ mm: "mm", cm: "cm", m: "m", km: "km", mL: "mL", L: "L", g: "g", kg: "kg" });

let db = null;
let configured = false;
let questionRandom = Math.random;
const state = {
  publicLearners: [],
  verifiedLearner: null,
  learnerCode: "",
  topic: "operations",
  operationMode: "mixed",
  measurementMode: "mixed",
  fractionMode: "mixed",
  criticalMode: "mixed",
  questions: [],
  elapsedSeconds: 0,
  timerId: null,
  attemptToken: null,
  submitting: false,
  submitted: false,
  pendingSubmission: null,
  latestResultText: "",
  learnerQueue: [],
  currentAssignment: null,
  activeAssignment: null,
  teacherUser: null,
  scoreRows: [],
  teacherLearners: [],
  teacherAssignments: [],
  editingAssignmentId: null,
  assignmentPreviewId: null,
  assignmentPreviewFingerprint: "",
  learnerResults: [],
  leaderboardRows: [],
  overallLeaderboardRows: [],
  weeklyChampion: null
};

window.addEventListener("DOMContentLoaded", initialiseApp);

async function initialiseApp() {
  document.getElementById("appTitle").textContent = CONFIG.appName || "SNT Dynamic Math";
  configured = isConfigured();
  document.getElementById("setupWarning").classList.toggle("hidden", configured);

  if (!configured || !window.supabase) {
    setConnectionBadge("Setup needed", false);
    setStudentDropdownMessage("Complete Supabase setup first");
    return;
  }

  db = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  bindStaticEvents();
  updateAssignmentModeOptions();
  updateDigitControls();
  await Promise.all([loadPublicLearners(), restoreTeacherSession(), loadLeaderboard(false), loadOverallLeaderboard()]);
  updateTopicAvailability();
}

function isConfigured() {
  return Boolean(
    CONFIG.supabaseUrl &&
    CONFIG.supabasePublishableKey &&
    CONFIG.groupId &&
    !String(CONFIG.supabaseUrl).includes("PASTE_") &&
    !String(CONFIG.supabasePublishableKey).includes("PASTE_")
  );
}

function bindStaticEvents() {
  document.getElementById("studentSelect").addEventListener("change", clearLearnerVerification);
  document.getElementById("studentCode").addEventListener("input", clearLearnerVerification);
  document.getElementById("studentCode").addEventListener("keydown", event => {
    if (event.key === "Enter") verifyLearner();
  });
  document.getElementById("teacherPassword").addEventListener("keydown", event => {
    if (event.key === "Enter") teacherSignIn();
  });
  ["assignStudent","assignTitle","assignTopic","assignMode","assignQuestionCount","assignFirstDigits","assignSecondDigits"].forEach(id => {
    const control = document.getElementById(id);
    if (!control) return;
    control.addEventListener(id === "assignTitle" ? "input" : "change", () => closeAssignmentPreview(true));
  });
}

function setConnectionBadge(text, ok = null) {
  const badge = document.getElementById("connectionBadge");
  badge.textContent = text;
  badge.classList.remove("ok", "bad");
  if (ok === true) badge.classList.add("ok");
  if (ok === false) badge.classList.add("bad");
}

function setStudentDropdownMessage(message) {
  const select = document.getElementById("studentSelect");
  select.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = message;
  select.appendChild(option);
  select.disabled = true;
}

async function loadPublicLearners() {
  if (!db) return;
  setStudentDropdownMessage("Loading learners…");
  try {
    const { data, error } = await db.rpc("get_public_math_students", { p_group_id: CONFIG.groupId });
    if (error) throw error;

    state.publicLearners = Array.isArray(data) ? data : [];
    const select = document.getElementById("studentSelect");
    select.innerHTML = '<option value="">Select your name</option>';
    state.publicLearners.forEach(learner => {
      const option = document.createElement("option");
      option.value = learner.student_id;
      option.textContent = `${learner.display_name} — Grade ${learner.grade}`;
      select.appendChild(option);
    });
    select.disabled = state.publicLearners.length === 0;
    if (!state.publicLearners.length) setStudentDropdownMessage("No active learners added yet");
    setConnectionBadge("Supabase connected", true);
  } catch (error) {
    console.error("Learner list error:", error);
    setStudentDropdownMessage("Learner list could not load");
    setConnectionBadge("Supabase setup error", false);
  }
}

function clearLearnerVerification() {
  state.verifiedLearner = null;
  state.learnerCode = "";
  state.learnerQueue = [];
  state.currentAssignment = null;
  state.activeAssignment = null;
  state.learnerResults = [];
  state.weeklyChampion = null;
  closeWeeklyChampionCelebration();
  stopTimer();
  const status = document.getElementById("learnerStatus");
  status.textContent = "Not verified";
  status.classList.remove("ok");
  document.getElementById("verifiedLearnerCard").classList.add("hidden");
  document.getElementById("verifiedLearnerMessage").textContent = "";
  document.getElementById("myResultsContent").classList.add("hidden");
  document.getElementById("myResultsLoginNotice").classList.remove("hidden");
  document.getElementById("resultRank").classList.add("hidden");
  document.getElementById("gradeBadge").textContent = "Grade —";
  document.getElementById("allocationWaiting").classList.remove("hidden");
  document.getElementById("currentAllocationCard").classList.add("hidden");
  document.getElementById("noAllocationState").classList.add("hidden");
  document.getElementById("learnerQueueWrap").classList.add("hidden");
  document.getElementById("queueBadge").textContent = "0 waiting";
  document.getElementById("quizArea").classList.add("hidden");
  document.getElementById("resultsPanel").classList.add("hidden");
  updateTopicAvailability();
}

async function verifyLearner() {
  if (!db) return alert("Complete Supabase setup first.");
  const studentId = cleanText(document.getElementById("studentSelect").value, 80);
  const code = normaliseCode(document.getElementById("studentCode").value);
  if (!studentId) return alert("Select your name.");
  if (code.length < 2) return alert("Enter your private learner code.");

  const button = document.getElementById("verifyLearnerBtn");
  button.disabled = true;
  button.textContent = "Logging in…";
  try {
    const { data, error } = await db.rpc("verify_math_student", {
      p_student_id: studentId,
      p_student_code: code,
      p_group_id: CONFIG.groupId
    });
    if (error) throw error;
    const learner = Array.isArray(data) ? data[0] : data;
    if (!learner || !learner.student_id) throw new Error("The code does not match the selected learner.");

    state.verifiedLearner = learner;
    state.learnerCode = code;
    document.getElementById("studentCode").value = "";
    const status = document.getElementById("learnerStatus");
    status.textContent = "Logged in ✓";
    status.classList.add("ok");
    document.getElementById("gradeBadge").textContent = `Grade ${learner.grade}`;
    const card = document.getElementById("verifiedLearnerCard");
    document.getElementById("verifiedLearnerMessage").textContent = `Welcome, ${learner.display_name}! Loading your teacher’s quiz plan…`;
    card.classList.remove("hidden");
    document.getElementById("myResultsHeading").textContent = `${learner.display_name}’s results`;
    const leaderboardGrade = document.getElementById("leaderboardGradeFilter");
    if (leaderboardGrade) leaderboardGrade.value = String(learner.grade);
    updateTopicAvailability();
    await Promise.all([loadLearnerQueue(true), loadMyResults(false), loadLeaderboard(false), loadOverallLeaderboard()]);
    await checkWeeklyChampionCelebration();
  } catch (error) {
    console.error(error);
    clearLearnerVerification();
    alert(error.message || "The code does not match the selected learner.");
  } finally {
    button.disabled = false;
    button.textContent = "Learner login";
  }
}

async function loadLearnerQueue(autoStart = false) {
  if (!db || !state.verifiedLearner || !state.learnerCode) return;
  document.getElementById("allocationWaiting").textContent = "Loading the teacher’s allocated order…";
  document.getElementById("allocationWaiting").classList.remove("hidden");
  try {
    const { data, error } = await db.rpc("get_math_student_assignments", {
      p_student_id: state.verifiedLearner.student_id,
      p_student_code: state.learnerCode,
      p_group_id: CONFIG.groupId
    });
    if (error) throw error;
    state.learnerQueue = Array.isArray(data) ? data : [];
    state.currentAssignment = state.learnerQueue.find(item => item.status === "pending") || null;
    renderLearnerQueue();
    const waiting = state.learnerQueue.filter(item => item.status === "pending").length;
    document.getElementById("verifiedLearnerMessage").textContent = waiting
      ? `Welcome, ${state.verifiedLearner.display_name}! ${waiting} allocated quiz${waiting === 1 ? " is" : "zes are"} waiting.`
      : `Welcome, ${state.verifiedLearner.display_name}! All currently allocated quizzes are complete.`;
    if (autoStart && state.currentAssignment) {
      window.setTimeout(() => startAllocatedQuiz(), 250);
    }
  } catch (error) {
    console.error("Learner queue error:", error);
    document.getElementById("allocationWaiting").textContent = error.message || "The allocated quiz plan could not load.";
    throw error;
  }
}

function renderLearnerQueue() {
  const pending = state.learnerQueue.filter(item => item.status === "pending");
  const waiting = pending.length;
  document.getElementById("queueBadge").textContent = `${waiting} waiting`;
  document.getElementById("allocationWaiting").classList.add("hidden");
  document.getElementById("learnerQueueWrap").classList.toggle("hidden", state.learnerQueue.length === 0);
  document.getElementById("noAllocationState").classList.toggle("hidden", Boolean(state.currentAssignment));
  document.getElementById("currentAllocationCard").classList.toggle("hidden", !state.currentAssignment);

  if (state.currentAssignment) {
    const assignment = state.currentAssignment;
    const pendingOrder = pending.findIndex(item => item.assignment_id === assignment.assignment_id) + 1;
    document.getElementById("currentAssignmentOrder").textContent = `NEXT • ${pendingOrder} OF ${waiting}`;
    document.getElementById("currentAssignmentTopic").textContent = TOPIC_LABELS[assignment.topic] || assignment.topic;
    document.getElementById("currentAssignmentTitle").textContent = assignmentFullDisplayName(assignment);
    document.getElementById("currentAssignmentMeta").textContent = `${assignmentModeLabel(assignment)} • ${assignment.question_count} questions${assignmentDigitsText(assignment)} • Grade ${state.verifiedLearner.grade}`;
  }

  document.querySelectorAll("#topicTabs .topic-tab").forEach(card => {
    card.classList.toggle("active", Boolean(state.currentAssignment && card.dataset.topic === state.currentAssignment.topic));
  });

  const queue = document.getElementById("learnerQueue");
  queue.innerHTML = "";
  state.learnerQueue.forEach((assignment, index) => {
    const item = document.createElement("div");
    item.className = `queue-item ${assignment.status}`;
    const number = document.createElement("span");
    number.className = "queue-number";
    number.textContent = assignment.status === "completed" ? "✓" : String(index + 1);
    const copy = document.createElement("div");
    copy.className = "queue-copy";
    const title = document.createElement("strong");
    title.textContent = assignmentFullDisplayName(assignment);
    const meta = document.createElement("small");
    meta.textContent = `${TOPIC_LABELS[assignment.topic]} • ${assignmentModeLabel(assignment)} • ${assignment.question_count} questions${assignmentDigitsText(assignment)}`;
    copy.append(title, meta);
    const status = document.createElement("span");
    status.className = `status-pill ${assignment.status === "completed" ? "active" : "waiting"}`;
    status.textContent = assignment.status === "completed" ? "Completed" : assignment.assignment_id === state.currentAssignment?.assignment_id ? "Next" : "Waiting";
    item.append(number, copy, status);
    queue.appendChild(item);
  });
}

function updateTopicAvailability() {
  const grade = Number(state.verifiedLearner?.grade || 0);
  document.querySelectorAll("#topicTabs .topic-tab").forEach(card => {
    const topic = card.dataset.topic;
    card.classList.toggle("locked", !grade || grade < MIN_GRADE[topic]);
  });
}

function assignmentDisplayTitle(assignment) {
  const topic = TOPIC_LABELS[assignment?.topic] || "Maths";
  const mode = assignmentModeLabel(assignment || {});
  if (assignment?.topic === "operations") return `${topic} — ${mode}`;
  if (assignment?.topic === "measurement") return `${topic} — ${mode}`;
  if (assignment?.topic === "fractions") return `${topic} — ${mode}`;
  return `${topic} — ${mode}`;
}

function assignmentFullDisplayName(assignment) {
  const detail = assignmentDisplayTitle(assignment);
  const optionalTitle = cleanText(assignment?.title || "", 80);
  return optionalTitle ? `${optionalTitle} — ${detail}` : detail;
}

function assignmentModeLabel(assignment) {
  if (assignment?.mode === "mixed") {
    if (assignment?.topic === "operations") return "Mixed Operations";
    if (assignment?.topic === "fractions") return "Mixed Fraction Skills";
    if (assignment?.topic === "measurement") return "Mixed Conversions";
    if (assignment?.topic === "decimals") return "Mixed Decimals";
    if (assignment?.topic === "percent") return "Mixed % / Fraction / Decimal";
    if (assignment?.topic === "critical") return "Mixed Critical Thinking";
  }
  return MODE_LABELS[assignment?.mode] || assignment?.mode || "Mixed";
}

function showPage(page) {
  const pages = {
    practice: "practicePage",
    "my-results": "myResultsPage",
    leaderboard: "leaderboardPage",
    teacher: "teacherPage"
  };
  const targetId = pages[page] || pages.practice;
  Object.values(pages).forEach(id => document.getElementById(id).classList.toggle("hidden", id !== targetId));
  document.querySelectorAll(".main-nav-btn").forEach(button => button.classList.toggle("active", button.dataset.page === page));

  // Keep the timer running while a learner views results or the leaderboard.
  if (page === "practice" && state.questions.length && !state.submitted && !state.pendingSubmission && !state.timerId) startTimer(false);
  if (page === "my-results") loadMyResults(false);
  if (page === "leaderboard") loadLeaderboard(false);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function startAllocatedQuiz() {
  if (!state.verifiedLearner) return alert("Log in as a learner first.");
  if (!state.currentAssignment) return alert("No unfinished quiz is allocated.");
  if (state.activeAssignment?.assignment_id === state.currentAssignment.assignment_id && state.questions.length && !state.submitted) {
    return document.getElementById("quizArea").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  state.activeAssignment = { ...state.currentAssignment };
  applyAssignmentToState(state.activeAssignment);
  startQuiz();
}

function startNextAllocatedQuiz() {
  document.getElementById("resultsPanel").classList.add("hidden");
  if (!state.currentAssignment) return document.getElementById("learnerPlanPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  startAllocatedQuiz();
}

function applyAssignmentToState(assignment) {
  state.topic = assignment.topic;
  state.operationMode = assignment.topic === "operations" ? assignment.mode : "mixed";
  state.measurementMode = assignment.topic === "measurement" ? assignment.mode : "mixed";
  state.fractionMode = assignment.topic === "fractions" ? assignment.mode : "mixed";
  state.criticalMode = assignment.topic === "critical" ? assignment.mode : "mixed";
}

function startQuiz() {
  if (!state.verifiedLearner || !state.activeAssignment) return alert("Open the next teacher-allocated quiz first.");
  const grade = Number(state.verifiedLearner.grade);
  if (grade < MIN_GRADE[state.topic]) return alert(`${TOPIC_LABELS[state.topic]} starts in Grade ${MIN_GRADE[state.topic]}.`);
  if (state.activeAssignment.status !== "pending") return alert("This allocated quiz is no longer waiting.");

  const count = Number(state.activeAssignment.question_count) || 20;
  state.questions = generateQuestions(state.topic, grade, count);
  state.elapsedSeconds = 0;
  state.attemptToken = createAttemptToken();
  state.submitting = false;
  state.submitted = false;
  state.pendingSubmission = null;
  state.latestResultText = "";

  // A completed quiz disables this button. Every newly opened allocation
  // must explicitly restore it; changing state.submitted alone does not
  // change the button's disabled DOM property.
  const submitButton = document.getElementById("submitQuizBtn");
  submitButton.disabled = false;
  submitButton.textContent = "Submit and mark";
  document.getElementById("saveStatus").textContent = "";
  document.getElementById("retrySaveBtn").classList.add("hidden");
  document.getElementById("resultRank").classList.add("hidden");

  document.getElementById("resultsPanel").classList.add("hidden");
  document.getElementById("nextAllocatedQuizBtn").classList.add("hidden");
  document.getElementById("quizArea").classList.remove("hidden");
  document.getElementById("quizTopicLabel").textContent = TOPIC_LABELS[state.topic].toUpperCase();
  document.getElementById("quizHeading").textContent = buildQuizHeading();
  document.getElementById("quizInstruction").textContent = topicInstruction(state.topic);
  renderQuiz();
  startTimer(true);
  document.getElementById("quizArea").scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildQuizHeading() {
  return assignmentFullDisplayName(state.activeAssignment || { topic: state.topic, mode: currentMode() });
}

function topicInstruction(topic) {
  return {
    operations: "Work carefully and enter one answer for each number sentence.",
    fractions: "Use the numerator above the line and the denominator below the line.",
    decimals: "Remember place value and line up decimal points carefully.",
    measurement: "Write only the number. The unit is already shown for you.",
    percent: "Move between percentages, fractions and decimals using the notation shown.",
    critical: "Think carefully about the pattern or relationship before choosing your answer."
  }[topic];
}

function renderQuiz() {
  const form = document.getElementById("quizForm");
  form.innerHTML = "";
  state.questions.forEach((question, index) => {
    const card = document.createElement("article");
    card.className = "question-card";
    card.id = `question-card-${question.id}`;
    card.innerHTML = `
      <div class="question-number">Question ${index + 1}</div>
      <div class="question-prompt">${question.promptHtml}</div>
      <div class="answer-row">${answerControlHtml(question)}</div>
      <div class="correction" id="correction-${question.id}"></div>`;
    form.appendChild(card);
  });

  form.querySelectorAll("input,select").forEach(control => {
    control.addEventListener("input", updateQuizProgress);
    control.addEventListener("change", updateQuizProgress);
  });
  updateQuizProgress();
}

function answerControlHtml(question) {
  const id = escapeAttribute(question.id);
  if (question.answerType === "fraction") {
    return `<span class="answer-label">Answer</span>
      <span class="fraction-answer-wrap">
        <span class="fraction-input">
          <input id="answer-${id}-num" data-question-id="${id}" data-part="num" type="text" inputmode="decimal" aria-label="Numerator" autocomplete="off">
          <span class="fraction-line"></span>
          <input id="answer-${id}-den" data-question-id="${id}" data-part="den" type="text" inputmode="numeric" aria-label="Denominator" autocomplete="off">
        </span>
        <button type="button" class="minus-key" aria-label="Toggle negative numerator" title="Add or remove a minus sign" onclick="toggleAnswerMinus('answer-${id}-num')">−</button>
      </span>`;
  }
  if (question.answerType === "choice") {
    const options = question.choices.map(choice => `<option value="${escapeAttribute(choice)}">${escapeHtml(choice)}</option>`).join("");
    return `<span class="answer-label">Answer</span><select id="answer-${id}" data-question-id="${id}"><option value="">Choose…</option>${options}</select>`;
  }
  const unit = question.answerUnit ? `<span class="unit-chip">${escapeHtml(question.answerUnit)}</span>` : "";
  return `<span class="answer-label">Answer</span>
    <span class="number-answer-wrap">
      <input id="answer-${id}" data-question-id="${id}" type="text" inputmode="decimal" autocomplete="off" placeholder="Enter number">
      <button type="button" class="minus-key" aria-label="Toggle negative answer" title="Add or remove a minus sign" onclick="toggleAnswerMinus('answer-${id}')">−</button>
    </span>${unit}`;
}

function toggleAnswerMinus(inputId) {
  const input = document.getElementById(inputId);
  if (!input || input.disabled) return;
  const current = String(input.value || "").trim();
  input.value = current.startsWith("-") ? current.slice(1) : `-${current}`;
  input.focus();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function updateQuizProgress() {
  if (!state.questions.length) return;
  const answered = state.questions.filter(question => responseIsComplete(question, collectQuestionResponse(question))).length;
  const total = state.questions.length;
  document.getElementById("progressText").textContent = `${answered} of ${total} answered`;
  document.getElementById("progressBar").style.width = `${Math.round((answered / total) * 100)}%`;
  state.questions.forEach(question => {
    const card = document.getElementById(`question-card-${question.id}`);
    if (card) card.classList.toggle("answered", responseIsComplete(question, collectQuestionResponse(question)));
  });
}

function collectQuestionResponse(question) {
  if (question.answerType === "fraction") {
    return {
      num: cleanNumericText(document.getElementById(`answer-${question.id}-num`)?.value),
      den: cleanNumericText(document.getElementById(`answer-${question.id}-den`)?.value)
    };
  }
  return cleanNumericText(document.getElementById(`answer-${question.id}`)?.value);
}

function responseIsComplete(question, response) {
  if (question.answerType === "fraction") return response.num !== "" && response.den !== "";
  return String(response) !== "";
}

function buildSubmissionQuestions() {
  return state.questions.map(question => ({
    id: question.id,
    kind: question.kind,
    params: question.params,
    response: collectQuestionResponse(question)
  }));
}

async function submitQuiz() {
  if (state.submitting || state.submitted) return;
  const firstUnanswered = state.questions.find(question => !responseIsComplete(question, collectQuestionResponse(question)));
  if (firstUnanswered) {
    document.getElementById(`question-card-${firstUnanswered.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    return alert("Please answer every question before submitting.");
  }

  stopTimer();
  state.pendingSubmission = buildSubmissionQuestions();
  disableQuizInputs(true);
  await sendSubmission();
}

async function retrySave() {
  if (!state.pendingSubmission || state.submitting) return;
  await sendSubmission();
}

async function sendSubmission() {
  if (!db || !state.verifiedLearner) return;
  state.submitting = true;
  const submitButton = document.getElementById("submitQuizBtn");
  submitButton.disabled = true;
  submitButton.textContent = "Marking and saving…";
  document.getElementById("retrySaveBtn").classList.add("hidden");

  try {
    const { data, error } = await db.rpc("submit_math_quiz_attempt", {
      p_attempt_token: state.attemptToken,
      p_assignment_id: state.activeAssignment.assignment_id,
      p_student_id: state.verifiedLearner.student_id,
      p_student_code: state.learnerCode,
      p_group_id: CONFIG.groupId,
      p_topic: state.topic,
      p_mode: currentMode(),
      p_duration_seconds: state.elapsedSeconds,
      p_questions: state.pendingSubmission
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result || !Number.isFinite(Number(result.percentage))) throw new Error("Supabase returned an invalid marking result.");
    markQuiz(result);
    state.submitted = true;
    state.pendingSubmission = null;
    document.getElementById("saveStatus").textContent = "✓ Marked, saved and removed from the waiting queue.";
    try {
      await loadLearnerQueue(false);
    } catch (queueError) {
      console.warn("Result saved, but the refreshed queue could not load:", queueError);
    }
    const nextButton = document.getElementById("nextAllocatedQuizBtn");
    nextButton.classList.toggle("hidden", !state.currentAssignment);
    if (!state.currentAssignment) {
      document.getElementById("saveStatus").textContent += " All allocated quizzes are now complete.";
    }
    await Promise.all([loadMyResults(false), loadLeaderboard(false), loadOverallLeaderboard()]);
    showCurrentLearnerRank();
    await checkWeeklyChampionCelebration();
    if (state.teacherUser) {
      loadTeacherScores(false);
      loadTeacherAssignments(false);
    }
  } catch (error) {
    console.error("Submit error:", error);
    showSaveFailure(error);
  } finally {
    state.submitting = false;
    submitButton.textContent = state.submitted ? "Quiz submitted" : "Submit and mark";
    submitButton.disabled = state.submitted;
  }
}

function showSaveFailure(error) {
  const panel = document.getElementById("resultsPanel");
  panel.classList.remove("hidden");
  document.getElementById("resultHeading").textContent = "Your answers are safe on this device";
  document.getElementById("resultScore").textContent = "Not marked";
  document.getElementById("resultSummary").textContent = "Supabase could not mark or save the quiz. Retry using the same answers.";
  document.getElementById("saveStatus").textContent = error?.message || "Connection or database error.";
  document.getElementById("retrySaveBtn").classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function markQuiz(result) {
  const details = Array.isArray(result.details) ? result.details : [];
  const detailMap = new Map(details.map(detail => [String(detail.id), detail]));
  state.questions.forEach(question => {
    const detail = detailMap.get(String(question.id));
    const card = document.getElementById(`question-card-${question.id}`);
    const correction = document.getElementById(`correction-${question.id}`);
    if (!card || !detail) return;
    card.classList.add("marked", detail.is_correct ? "correct" : "incorrect");
    const label = detail.is_correct ? "✓ Correct" : "✗ Correct answer:";
    correction.innerHTML = detail.is_correct
      ? `<span>${label}</span>`
      : `<span>${label} ${formatAnswerMarkup(detail.correct_answer)}</span>`;
  });

  const score = Number(result.score);
  const total = Number(result.total);
  const percentage = Number(result.percentage);
  const learnerName = state.verifiedLearner.display_name;
  const quizName = assignmentFullDisplayName(state.activeAssignment || { topic: state.topic, mode: currentMode() });
  const feedback = percentage >= 90 ? "Outstanding work!" : percentage >= 75 ? "Excellent effort!" : percentage >= 60 ? "Good progress!" : "Keep practising—you are learning!";
  document.getElementById("resultHeading").textContent = feedback;
  document.getElementById("resultScore").textContent = `${percentage}%`;
  document.getElementById("resultSummary").textContent = `${learnerName} scored ${score} out of ${total} in ${quizName} and took ${formatDuration(state.elapsedSeconds)}.`;
  document.getElementById("resultsPanel").classList.remove("hidden");
  document.getElementById("retrySaveBtn").classList.add("hidden");
  document.getElementById("resultRank").classList.add("hidden");
  state.latestResultText = `${learnerName}\nGrade ${state.verifiedLearner.grade} ${TOPIC_LABELS[state.topic]}\nScore: ${score}/${total} (${percentage}%)\nTime: ${formatDuration(state.elapsedSeconds)}`;
  document.getElementById("resultsPanel").scrollIntoView({ behavior: "smooth", block: "center" });
}

function disableQuizInputs(disabled) {
  document.querySelectorAll("#quizForm input,#quizForm select").forEach(control => { control.disabled = disabled; });
}

function restartSameQuiz() {
  if (state.submitted) return alert("This allocated quiz is already complete.");
  document.getElementById("resultsPanel").classList.add("hidden");
  startQuiz();
}

function leaveQuiz() {
  stopTimer();
  state.questions = [];
  state.submitted = false;
  state.pendingSubmission = null;
  state.activeAssignment = null;
  document.getElementById("quizArea").classList.add("hidden");
  document.getElementById("resultsPanel").classList.add("hidden");
  document.getElementById("timerDisplay").classList.add("hidden");
  document.getElementById("learnerPlanPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function copyResult() {
  if (!state.latestResultText) return alert("No marked result is available to copy.");
  try {
    await navigator.clipboard.writeText(state.latestResultText);
    alert("Result copied. The learner code was not included.");
  } catch {
    prompt("Copy this result:", state.latestResultText);
  }
}

function startTimer(reset = false) {
  stopTimer();
  if (reset) state.elapsedSeconds = 0;
  updateTimer();
  document.getElementById("timerDisplay").classList.remove("hidden");
  state.timerId = window.setInterval(() => {
    state.elapsedSeconds += 1;
    updateTimer();
  }, 1000);
}

function stopTimer() {
  if (state.timerId) window.clearInterval(state.timerId);
  state.timerId = null;
}

function updateTimer() {
  const mins = String(Math.floor(state.elapsedSeconds / 60)).padStart(2, "0");
  const secs = String(state.elapsedSeconds % 60).padStart(2, "0");
  document.getElementById("timerDisplay").textContent = `⏱ ${mins}:${secs}`;
}

function currentMode() {
  if (state.topic === "operations") return state.operationMode;
  if (state.topic === "measurement") return state.measurementMode;
  if (state.topic === "fractions") return state.fractionMode;
  if (state.topic === "critical") return state.criticalMode;
  return "mixed";
}

function generateQuestions(topic, grade, count) {
  const generator = {
    operations: generateOperationQuestion,
    fractions: generateFractionQuestion,
    decimals: generateDecimalQuestion,
    measurement: generateMeasurementQuestion,
    percent: generatePercentQuestion,
    critical: generateCriticalThinkingQuestion
  }[topic];
  const questions = [];
  const signatures = new Set();
  let attempts = 0;
  const previousRandom = questionRandom;
  const seedText = state.activeAssignment?.assignment_id || `${topic}-${grade}-${count}-${createAttemptToken()}`;
  questionRandom = createSeededRandom(seedText);

  try {
    while (questions.length < count && attempts < count * 80) {
      const question = generator(grade, questions.length, count);
      const signature = `${question.kind}:${JSON.stringify(question.params)}`;
      attempts += 1;
      if (signatures.has(signature)) continue;
      signatures.add(signature);
      question.id = `q${questions.length + 1}-${randomInt(1000, 9999)}`;
      questions.push(question);
    }
  } finally {
    questionRandom = previousRandom;
  }

  if (questions.length < count) throw new Error("Could not generate enough unique questions.");
  return questions;
}

function generateOperationQuestion(grade, index) {
  let mode = state.operationMode;
  if (mode === "mixed") {
    const allowed = grade === 1 ? ["add", "subtract"] : ["add", "subtract", "multiply", "divide"];
    mode = allowed[index % allowed.length];
  }

  const defaults = defaultOperationDigits(grade, mode);
  const firstDigits = clampInteger(state.activeAssignment?.first_number_digits, 1, 6, defaults.first);
  const secondDigits = clampInteger(state.activeAssignment?.second_number_digits, 1, 6, defaults.second);

  if (mode === "add") {
    const max = operationGradeMaximum(grade);
    const a = randomWholeWithDigits(firstDigits, max);
    const b = randomWholeWithDigits(secondDigits, max);
    return numberQuestion("add", { a, b }, `${formatWhole(a)} + ${formatWhole(b)} = ?`, `${a} + ${b}`);
  }

  if (mode === "subtract") {
    const max = operationGradeMaximum(grade);
    let a = randomWholeWithDigits(firstDigits, max);
    let b = randomWholeWithDigits(secondDigits, max);
    if (a < b) [a, b] = [b, a];
    return numberQuestion("subtract", { a, b }, `${formatWhole(a)} − ${formatWhole(b)} = ?`, `${a} - ${b}`);
  }

  if (mode === "multiply") {
    const a = randomWholeWithDigits(firstDigits, 999, 1);
    const b = randomWholeWithDigits(secondDigits, 999, 1);
    return numberQuestion("multiply", { a, b }, `${formatWhole(a)} × ${formatWhole(b)} = ?`, `${a} x ${b}`);
  }

  const division = makeExactDivision(firstDigits, secondDigits);
  return numberQuestion(
    "divide",
    { dividend: division.dividend, divisor: division.divisor },
    `${formatWhole(division.dividend)} ÷ ${formatWhole(division.divisor)} = ?`,
    `${division.dividend} / ${division.divisor}`
  );
}

function operationGradeMaximum(grade) {
  return [0, 20, 100, 1000, 10000, 100000, 1000000][Number(grade)] || 20;
}

function defaultOperationDigits(grade, mode) {
  if (mode === "multiply") return grade <= 4 ? { first: 1, second: 1 } : { first: 2, second: grade >= 6 ? 2 : 1 };
  if (mode === "divide") return grade <= 3 ? { first: 2, second: 1 } : { first: Math.min(grade, 4), second: 1 };
  return { first: Math.min(Math.max(Number(grade), 1), 6), second: Math.min(Math.max(Number(grade) - 1, 1), 6) };
}

function randomWholeWithDigits(digits, absoluteMax = Number.MAX_SAFE_INTEGER, minimum = 1) {
  const safeDigits = Math.max(1, Math.min(6, Number(digits) || 1));
  const lower = safeDigits === 1 ? Math.max(1, minimum) : 10 ** (safeDigits - 1);
  const upper = Math.min((10 ** safeDigits) - 1, Number(absoluteMax));
  if (lower > upper) throw new Error(`A ${safeDigits}-digit number is not available for this grade and quiz type.`);
  return randomInt(lower, upper);
}

function makeExactDivision(dividendDigits, divisorDigits) {
  const first = Math.max(1, Math.min(6, Number(dividendDigits) || 2));
  const second = Math.max(1, Math.min(3, Number(divisorDigits) || 1));
  const minDividend = first === 1 ? 1 : 10 ** (first - 1);
  const maxDividend = (10 ** first) - 1;

  for (let attempt = 0; attempt < 300; attempt += 1) {
    const divisor = randomWholeWithDigits(second, 999, 1);
    const minQuotient = Math.max(1, Math.ceil(minDividend / divisor));
    const maxQuotient = Math.floor(maxDividend / divisor);
    if (minQuotient > maxQuotient) continue;
    const quotient = randomInt(minQuotient, maxQuotient);
    const dividend = divisor * quotient;
    if (wholeDigitCount(dividend) === first) return { dividend, divisor, quotient };
  }
  throw new Error("Could not make an exact division question with those digit sizes. Use at least as many digits in the first number as the second number.");
}

function wholeDigitCount(value) {
  return String(Math.abs(Math.trunc(Number(value)))).length;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function generateFractionQuestion(grade, index) {
  const mode = state.fractionMode || "mixed";
  if (mode !== "mixed") return generateFocusedFractionQuestion(grade, mode);

  const grade3Kinds = ["fraction_of", "fraction_equivalent_missing", "fraction_compare"];
  const grade4Kinds = [...grade3Kinds, "fraction_simplify", "fraction_add", "fraction_subtract"];
  const upperKinds = ["fraction_of", "fraction_equivalent_missing", "fraction_compare", "fraction_simplify", "fraction_add", "fraction_subtract"];
  const kinds = grade === 3 ? grade3Kinds : grade === 4 ? grade4Kinds : upperKinds;
  const kind = kinds[index % kinds.length];
  const denominators = grade <= 4 ? [2, 3, 4, 5, 6, 8, 10] : [2, 3, 4, 5, 6, 8, 10, 12];

  if (kind === "fraction_of") {
    const d = randomChoice(denominators);
    const n = randomInt(1, d - 1);
    const multiplier = randomInt(2, grade >= 5 ? 12 : 8);
    const whole = d * multiplier;
    return numberQuestion(
      kind,
      { numerator: n, denominator: d, whole },
      `${fractionHtml(n, d)} of ${formatWhole(whole)} = ?`,
      `${n}/${d} of ${whole}`
    );
  }

  if (kind === "fraction_equivalent_missing") {
    const d = randomChoice(denominators.filter(value => value <= 8));
    const n = randomInt(1, d - 1);
    const multiplier = randomInt(2, grade >= 5 ? 6 : 4);
    const missing = questionRandom() < .5 ? "numerator" : "denominator";
    const left = fractionHtml(n, d);
    const right = missing === "numerator" ? fractionHtml("?", d * multiplier) : fractionHtml(n * multiplier, "?");
    return numberQuestion(kind, { numerator: n, denominator: d, multiplier, missing }, `${left} = ${right}`, `${n}/${d} equivalent fraction`);
  }

  if (kind === "fraction_compare") {
    let d1 = randomChoice(denominators);
    let d2 = grade === 3 ? d1 : randomChoice(denominators);
    let n1 = randomInt(1, d1 - 1);
    let n2 = randomInt(1, d2 - 1);
    if (questionRandom() < .18) { n2 = n1; d2 = d1; }
    return {
      kind,
      params: { n1, d1, n2, d2 },
      promptHtml: `${fractionHtml(n1, d1)} <span class="unit-chip">?</span> ${fractionHtml(n2, d2)}`,
      promptText: `${n1}/${d1} compare ${n2}/${d2}`,
      answerType: "choice",
      choices: [">", "<", "="]
    };
  }

  if (kind === "fraction_simplify") {
    const baseD = randomChoice([2, 3, 4, 5, 6]);
    const baseN = randomInt(1, baseD - 1);
    const multiplier = randomInt(2, grade >= 5 ? 8 : 5);
    const n = baseN * multiplier;
    const d = baseD * multiplier;
    return fractionQuestion(kind, { numerator: n, denominator: d }, `Simplify ${fractionHtml(n, d)}`, `Simplify ${n}/${d}`);
  }

  return generateFractionOperationQuestion(grade, kind === "fraction_add" ? "add_same_or_level" : "subtract_same_or_level");
}

function generateFocusedFractionQuestion(grade, mode) {
  if (mode === "add_same") return generateFractionOperationQuestion(grade, "add_same");
  if (mode === "subtract_same") return generateFractionOperationQuestion(grade, "subtract_same");
  if (mode === "add_different") return generateFractionOperationQuestion(grade, "add_different");
  if (mode === "subtract_different") return generateFractionOperationQuestion(grade, "subtract_different");
  throw new Error("Invalid fraction quiz type.");
}

function generateFractionOperationQuestion(grade, mode) {
  const denominators = grade <= 4 ? [2, 3, 4, 5, 6, 8, 10] : [2, 3, 4, 5, 6, 8, 10, 12];
  const isAdd = mode.startsWith("add");
  const forceSame = mode.endsWith("same") || (mode.endsWith("same_or_level") && grade <= 4);
  const forceDifferent = mode.endsWith("different") || (mode.endsWith("same_or_level") && grade >= 5);

  let d1 = randomChoice(denominators);
  let d2 = d1;
  if (forceDifferent) {
    const alternatives = denominators.filter(value => value !== d1);
    d2 = randomChoice(alternatives);
  } else if (!forceSame && grade >= 5) {
    d2 = randomChoice(denominators);
  }

  let n1 = randomInt(1, d1 - 1);
  let n2 = randomInt(1, d2 - 1);
  if (!isAdd && n1 / d1 < n2 / d2) {
    [n1, n2] = [n2, n1];
    [d1, d2] = [d2, d1];
  }

  const kind = isAdd ? "fraction_add" : "fraction_subtract";
  const symbol = isAdd ? "+" : "−";
  return fractionQuestion(
    kind,
    { n1, d1, n2, d2, require_simplified: true },
    `${fractionHtml(n1, d1)} ${symbol} ${fractionHtml(n2, d2)} = ? <small class="help-text">Give the simplest fraction.</small>`,
    `${n1}/${d1} ${symbol} ${n2}/${d2}`
  );
}

function generateDecimalQuestion(grade, index) {
  const kinds = ["decimal_add", "decimal_subtract", "decimal_compare", "decimal_multiply_power", "decimal_divide_power"];
  const kind = kinds[index % kinds.length];
  const places = grade === 4 ? 1 : grade === 5 ? randomChoice([1, 2]) : randomChoice([1, 2, 3]);
  const maxWhole = grade === 4 ? 20 : grade === 5 ? 100 : 500;

  if (kind === "decimal_compare") {
    const a = randomDecimal(places, maxWhole);
    let b = randomDecimal(places, maxWhole);
    if (questionRandom() < .15) b = a;
    return {
      kind,
      params: { a, b },
      promptHtml: `${decimalText(a, places)} <span class="unit-chip">?</span> ${decimalText(b, places)}`,
      promptText: `${a} compare ${b}`,
      answerType: "choice",
      choices: [">", "<", "="]
    };
  }

  if (kind === "decimal_multiply_power" || kind === "decimal_divide_power") {
    const power = grade === 4 ? 10 : grade === 5 ? randomChoice([10, 100]) : randomChoice([10, 100, 1000]);
    let value;
    if (kind === "decimal_divide_power") {
      value = randomInt(1, maxWhole * power);
    } else {
      value = randomDecimal(places, maxWhole);
    }
    const symbol = kind === "decimal_multiply_power" ? "×" : "÷";
    return numberQuestion(kind, { value, power }, `${formatNumber(value)} ${symbol} ${power} = ?`, `${value} ${symbol} ${power}`);
  }

  let a = randomDecimal(places, maxWhole);
  let b = randomDecimal(places, maxWhole);
  if (kind === "decimal_subtract" && a < b) [a, b] = [b, a];
  const symbol = kind === "decimal_add" ? "+" : "−";
  return numberQuestion(kind, { a, b }, `${decimalText(a, places)} ${symbol} ${decimalText(b, places)} = ?`, `${a} ${symbol} ${b}`);
}

function generateMeasurementQuestion(grade, index) {
  let category = state.measurementMode;
  const available = grade === 2 ? ["length", "capacity", "mass"] : ["length", "capacity", "mass"];
  if (category === "mixed") category = available[index % available.length];

  const pairs = {
    length: grade <= 3
      ? [["m", "cm"], ["cm", "m"], ["cm", "mm"], ["mm", "cm"]]
      : [["km", "m"], ["m", "km"], ["m", "cm"], ["cm", "m"], ["cm", "mm"], ["mm", "cm"]],
    mass: [["kg", "g"], ["g", "kg"]],
    capacity: [["L", "mL"], ["mL", "L"]]
  };
  const [fromUnit, toUnit] = randomChoice(pairs[category]);
  const fromFactor = unitFactor(category, fromUnit);
  const toFactor = unitFactor(category, toUnit);
  const ratio = fromFactor / toFactor;
  const allowHalves = grade >= 5;
  let value;
  if (ratio >= 1) {
    value = randomInt(1, grade >= 5 ? 20 : 10);
    if (allowHalves && questionRandom() < .30) value += .5;
  } else {
    let answer = randomInt(1, grade >= 5 ? 20 : 10);
    if (allowHalves && questionRandom() < .30) answer += .5;
    value = answer / ratio;
  }
  value = roundTo(value, 4);
  return numberQuestion(
    "measurement_convert",
    { category, from_unit: fromUnit, to_unit: toUnit, value },
    `${formatNumber(value)} <span class="unit-chip">${UNIT_LABELS[fromUnit]}</span> = ? <span class="unit-chip">${UNIT_LABELS[toUnit]}</span>`,
    `${value} ${fromUnit} to ${toUnit}`
  );
}

function generatePercentQuestion(grade, index) {
  const grade5Kinds = ["percent_to_fraction", "fraction_to_percent", "decimal_to_percent", "percent_to_decimal"];
  const grade6Kinds = [...grade5Kinds, "fraction_to_decimal", "decimal_to_fraction"];
  const kinds = grade === 5 ? grade5Kinds : grade6Kinds;
  const kind = kinds[index % kinds.length];
  const common = [
    { n: 1, d: 10, decimal: .1, percent: 10 }, { n: 1, d: 5, decimal: .2, percent: 20 },
    { n: 1, d: 4, decimal: .25, percent: 25 }, { n: 2, d: 5, decimal: .4, percent: 40 },
    { n: 1, d: 2, decimal: .5, percent: 50 }, { n: 3, d: 5, decimal: .6, percent: 60 },
    { n: 3, d: 4, decimal: .75, percent: 75 }, { n: 4, d: 5, decimal: .8, percent: 80 },
    { n: 9, d: 10, decimal: .9, percent: 90 }
  ];
  if (grade === 6) common.push({ n: 1, d: 8, decimal: .125, percent: 12.5 }, { n: 3, d: 8, decimal: .375, percent: 37.5 });
  const item = randomChoice(common);

  if (kind === "percent_to_fraction") {
    return fractionQuestion(kind, { percent: item.percent }, `${formatNumber(item.percent)}% = ${fractionHtml("?", "?")}`, `${item.percent}% to fraction`);
  }
  if (kind === "fraction_to_percent") {
    return { ...numberQuestion(kind, { numerator: item.n, denominator: item.d }, `${fractionHtml(item.n, item.d)} = ?`, `${item.n}/${item.d} to percent`), answerUnit: "%" };
  }
  if (kind === "decimal_to_percent") {
    return { ...numberQuestion(kind, { value: item.decimal }, `${formatNumber(item.decimal)} = ?`, `${item.decimal} to percent`), answerUnit: "%" };
  }
  if (kind === "percent_to_decimal") {
    return numberQuestion(kind, { percent: item.percent }, `${formatNumber(item.percent)}% = ?`, `${item.percent}% to decimal`);
  }
  if (kind === "fraction_to_decimal") {
    return numberQuestion(kind, { numerator: item.n, denominator: item.d }, `${fractionHtml(item.n, item.d)} = ?`, `${item.n}/${item.d} to decimal`);
  }
  return fractionQuestion(kind, { value: item.decimal }, `${formatNumber(item.decimal)} = ${fractionHtml("?", "?")}`, `${item.decimal} to fraction`);
}


function generateCriticalThinkingQuestion(grade, index) {
  let mode = state.criticalMode || "mixed";
  const allowed = grade === 1
    ? ["patterns", "missing"]
    : grade === 2
      ? ["patterns", "missing", "balance"]
      : ["patterns", "missing", "balance", "machines"];
  if (mode === "mixed" || !allowed.includes(mode)) mode = allowed[index % allowed.length];

  if (mode === "patterns") {
    const terms = grade <= 2 ? 4 : 5;
    const maxStep = grade === 1 ? 5 : grade === 2 ? 10 : grade <= 4 ? 20 : 50;
    let step = randomInt(1, maxStep);
    let start = randomInt(grade === 1 ? 1 : 0, grade <= 2 ? 40 : grade <= 4 ? 150 : 500);
    if (grade >= 4 && questionRandom() < 0.25) {
      step = -step;
      start = randomInt(Math.abs(step) * terms + 5, grade <= 4 ? 200 : 600);
    }
    const shown = Array.from({ length: terms }, (_, i) => start + (i * step));
    return numberQuestion(
      "critical_pattern_next",
      { start, step, terms },
      `<span class="logic-sequence">${shown.map(formatWhole).join(" , ")} , ?</span>`,
      `${shown.join(", ")}, ?`
    );
  }

  if (mode === "missing") {
    const operations = grade <= 2 ? ["add", "subtract"] : ["add", "subtract", "multiply", "divide"];
    const operation = operations[index % operations.length];
    const missing = questionRandom() < 0.5 ? "a" : "b";
    let a;
    let b;
    let result;
    let symbol;

    if (operation === "add") {
      const max = grade === 1 ? 20 : grade === 2 ? 100 : Math.min(1000, 10 ** Math.min(grade, 3));
      a = randomInt(1, Math.max(2, Math.floor(max * 0.7)));
      b = randomInt(1, Math.max(2, max - a));
      result = a + b;
      symbol = "+";
    } else if (operation === "subtract") {
      const max = grade === 1 ? 20 : grade === 2 ? 100 : 1000;
      a = randomInt(2, max);
      b = randomInt(1, a);
      result = a - b;
      symbol = "−";
    } else if (operation === "multiply") {
      a = randomInt(2, grade >= 5 ? 20 : 12);
      b = randomInt(2, grade >= 5 ? 12 : 10);
      result = a * b;
      symbol = "×";
    } else {
      b = randomInt(2, grade >= 5 ? 12 : 10);
      result = randomInt(2, grade >= 5 ? 20 : 12);
      a = b * result;
      symbol = "÷";
    }

    const leftA = missing === "a" ? "?" : formatWhole(a);
    const leftB = missing === "b" ? "?" : formatWhole(b);
    return numberQuestion(
      "critical_missing_number",
      { operation, a, b, missing },
      `<span class="logic-equation">${leftA} ${symbol} ${leftB} = ${formatWhole(result)}</span>`,
      `${missing === "a" ? "?" : a} ${symbol} ${missing === "b" ? "?" : b} = ${result}`
    );
  }

  if (mode === "balance") {
    const max = grade === 2 ? 50 : grade <= 4 ? 200 : 1000;
    const a = randomInt(2, Math.floor(max * 0.6));
    const b = randomInt(2, Math.floor(max * 0.4));
    const total = a + b;
    const c = randomInt(1, Math.max(1, total - 1));
    return numberQuestion(
      "critical_balance",
      { a, b, c },
      `<span class="logic-equation">${formatWhole(a)} + ${formatWhole(b)} = ${formatWhole(c)} + ?</span>`,
      `${a} + ${b} = ${c} + ?`
    );
  }

  const multiplier = randomInt(2, grade <= 3 ? 5 : grade <= 4 ? 8 : 12);
  const addend = randomInt(0, grade <= 3 ? 10 : grade <= 4 ? 20 : 50);
  const input = randomInt(1, grade <= 3 ? 12 : grade <= 4 ? 20 : 50);
  return numberQuestion(
    "critical_number_machine",
    { input, multiplier, addend },
    `<span class="number-machine"><b>INPUT ${formatWhole(input)}</b><span>× ${multiplier}</span><span>+ ${addend}</span><b>OUTPUT ?</b></span>`,
    `Number machine: ${input} × ${multiplier} + ${addend}`
  );
}

function numberQuestion(kind, params, promptHtml, promptText) {
  return { kind, params, promptHtml, promptText, answerType: "number", choices: [] };
}

function fractionQuestion(kind, params, promptHtml, promptText) {
  return { kind, params, promptHtml, promptText, answerType: "fraction", choices: [] };
}

function fractionHtml(numerator, denominator) {
  return `<span class="fraction" aria-label="${escapeAttribute(numerator)} over ${escapeAttribute(denominator)}"><span>${escapeHtml(numerator)}</span><span>${escapeHtml(denominator)}</span></span>`;
}

function formatAnswerMarkup(answer) {
  const text = String(answer ?? "");
  const match = text.match(/^(-?\d+)\/(-?\d+)$/);
  if (match) return fractionHtml(match[1], match[2]);
  return escapeHtml(text);
}

function randomDecimal(places, maxWhole) {
  const scale = 10 ** places;
  return randomInt(1, maxWhole * scale) / scale;
}

function decimalText(value, places) {
  return Number(value).toFixed(places);
}

function unitFactor(category, unit) {
  const factors = {
    length: { mm: 1, cm: 10, m: 1000, km: 1000000 },
    mass: { g: 1, kg: 1000 },
    capacity: { mL: 1, L: 1000 }
  };
  return factors[category][unit];
}

function createAttemptToken() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, char => {
    const r = Math.random() * 16 | 0;
    const v = char === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function restoreTeacherSession() {
  if (!db) return;
  const { data } = await db.auth.getSession();
  if (data?.session?.user) await establishTeacherSession(data.session.user, false);
}

async function teacherSignIn() {
  if (!db) return alert("Complete Supabase setup first.");
  const email = cleanText(document.getElementById("teacherEmail").value, 200);
  const password = document.getElementById("teacherPassword").value;
  const message = document.getElementById("teacherLoginMessage");
  message.className = "form-message";
  if (!email || !password) {
    message.textContent = "Enter the teacher email and password.";
    message.classList.add("error");
    return;
  }

  const button = document.getElementById("teacherLoginBtn");
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await establishTeacherSession(data.user, true);
    document.getElementById("teacherPassword").value = "";
  } catch (error) {
    console.error(error);
    message.textContent = error.message || "Teacher sign-in failed.";
    message.classList.add("error");
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
}

async function establishTeacherSession(user, showError) {
  try {
    const { data: allowed, error } = await db.rpc("is_current_math_teacher");
    if (error) throw error;
    if (!allowed) {
      await db.auth.signOut();
      throw new Error("This Supabase account is not listed as an SNT maths teacher.");
    }

    const { data: profile } = await db.from("math_teacher_users").select("display_name").eq("user_id", user.id).maybeSingle();
    state.teacherUser = user;
    document.getElementById("teacherLoginPanel").classList.add("hidden");
    document.getElementById("teacherDashboard").classList.remove("hidden");
    document.getElementById("teacherWelcome").textContent = `Welcome, ${profile?.display_name || user.email}`;
    await loadTeacherLearners();
    await Promise.all([loadTeacherScores(), loadTeacherAssignments()]);
  } catch (error) {
    console.error(error);
    if (showError) throw error;
  }
}

async function teacherSignOut() {
  if (!db) return;
  await db.auth.signOut();
  state.teacherUser = null;
  state.scoreRows = [];
  state.teacherLearners = [];
  state.teacherAssignments = [];
  cancelAssignmentEdit();
  document.getElementById("teacherDashboard").classList.add("hidden");
  document.getElementById("teacherLoginPanel").classList.remove("hidden");
  document.getElementById("teacherLoginMessage").textContent = "Signed out.";
}

function showTeacherTab(tab) {
  document.querySelectorAll(".teacher-tab").forEach(button => button.classList.toggle("active", button.dataset.teacherTab === tab));
  document.getElementById("teacherScoresTab").classList.toggle("hidden", tab !== "scores");
  document.getElementById("teacherLearnersTab").classList.toggle("hidden", tab !== "learners");
  document.getElementById("teacherAssignmentsTab").classList.toggle("hidden", tab !== "assignments");
  if (tab === "assignments") renderTeacherAssignments();
}

async function loadTeacherScores(showLoading = true) {
  if (!db || !state.teacherUser) return;
  if (showLoading) {
    setTableMessage("summaryMessage", "Loading scores…");
    setTableMessage("attemptsMessage", "Loading attempts…");
  }
  try {
    const { data, error } = await db
      .from("math_quiz_results")
      .select("id,assignment_id,student_id,student_name_snapshot,grade,quiz_title,topic,mode,score,total,percentage,duration_seconds,created_at")
      .eq("group_id", CONFIG.groupId)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw error;
    state.scoreRows = data || [];
    renderTeacherScores();
  } catch (error) {
    console.error(error);
    setTableMessage("summaryMessage", "Could not load scores. Check teacher access and RLS.", true);
    setTableMessage("attemptsMessage", "Could not load attempts.", true);
  }
}

function getFilteredScoreRows() {
  const search = document.getElementById("scoreSearch").value.trim().toLowerCase();
  const grade = document.getElementById("scoreGradeFilter").value;
  const topic = document.getElementById("scoreTopicFilter").value;
  return state.scoreRows.filter(row => {
    const nameMatches = !search || String(row.student_name_snapshot || "").toLowerCase().includes(search);
    const gradeMatches = grade === "all" || Number(row.grade) === Number(grade);
    const topicMatches = topic === "all" || row.topic === topic;
    return nameMatches && gradeMatches && topicMatches;
  });
}

function renderTeacherScores() {
  const rows = getFilteredScoreRows();
  const summaryBody = document.getElementById("summaryBody");
  const attemptsBody = document.getElementById("attemptsBody");
  summaryBody.innerHTML = "";
  attemptsBody.innerHTML = "";

  const grouped = new Map();
  rows.forEach(row => {
    const key = String(row.student_id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  const summaries = [...grouped.values()].map(attempts => {
    attempts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const latest = attempts[0];
    const percentages = attempts.map(item => Number(item.percentage) || 0);
    return {
      name: latest.student_name_snapshot,
      grade: latest.grade,
      latest: percentages[0],
      best: Math.max(...percentages),
      average: Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length),
      attempts: attempts.length,
      latestTopic: latest.topic,
      createdAt: latest.created_at
    };
  }).sort((a, b) => b.latest - a.latest || String(a.name).localeCompare(String(b.name)));

  summaries.forEach((summary, index) => {
    const tr = document.createElement("tr");
    addCell(tr, index + 1);
    addCell(tr, summary.name);
    addCell(tr, `Grade ${summary.grade}`);
    addScoreCell(tr, summary.latest);
    addScoreCell(tr, summary.best);
    addScoreCell(tr, summary.average);
    addCell(tr, summary.attempts);
    addCell(tr, TOPIC_LABELS[summary.latestTopic] || summary.latestTopic);
    addCell(tr, formatDate(summary.createdAt));
    summaryBody.appendChild(tr);
  });

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    addCell(tr, index + 1);
    addCell(tr, row.student_name_snapshot);
    addCell(tr, `Grade ${row.grade}`);
    addCell(tr, row.quiz_title || `${TOPIC_LABELS[row.topic] || "Maths"} Quiz`);
    addCell(tr, TOPIC_LABELS[row.topic] || row.topic);
    addCell(tr, MODE_LABELS[row.mode] || row.mode || "Mixed");
    addCell(tr, `${row.score}/${row.total}`);
    addScoreCell(tr, Number(row.percentage) || 0);
    addCell(tr, formatDuration(Number(row.duration_seconds) || 0));
    addCell(tr, formatDate(row.created_at));
    const pdfCell = document.createElement("td");
    pdfCell.appendChild(actionButton("Result PDF", "Download the marked quiz", () => downloadCompletedQuizPdf(row), "pdf-action"));
    tr.appendChild(pdfCell);
    attemptsBody.appendChild(tr);
  });

  const percentages = rows.map(row => Number(row.percentage) || 0);
  const learnerAverages = summaries.map(item => item.average);
  document.getElementById("studentCount").textContent = summaries.length;
  document.getElementById("attemptCount").textContent = rows.length;
  document.getElementById("attemptAverage").textContent = percentages.length ? `${Math.round(average(percentages))}%` : "0%";
  document.getElementById("learnerAverage").textContent = learnerAverages.length ? `${Math.round(average(learnerAverages))}%` : "0%";
  document.getElementById("highestScore").textContent = percentages.length ? `${Math.max(...percentages)}%` : "0%";
  setTableMessage("summaryMessage", summaries.length ? "" : "No learner scores match this filter.");
  setTableMessage("attemptsMessage", rows.length ? "" : "No attempts match this filter.");
}

async function loadTeacherLearners() {
  if (!db || !state.teacherUser) return;
  try {
    const { data, error } = await db
      .from("math_students")
      .select("id,full_name,display_name,grade,active,created_at")
      .eq("group_id", CONFIG.groupId)
      .order("full_name", { ascending: true });
    if (error) throw error;
    state.teacherLearners = data || [];
    renderTeacherLearners();
    populateAssignmentLearners();
  } catch (error) {
    console.error(error);
    setTableMessage("learnersMessage", "Could not load learners.", true);
  }
}

function populateAssignmentLearners() {
  const select = document.getElementById("assignStudent");
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '<option value="">Select learner</option>';
  state.teacherLearners.filter(item => item.active).forEach(learner => {
    const option = document.createElement("option");
    option.value = learner.id;
    option.textContent = `${learner.full_name} — Grade ${learner.grade}`;
    select.appendChild(option);
  });
  if (state.teacherLearners.some(item => item.id === previous && item.active)) select.value = previous;
}

function updateAssignmentModeOptions() {
  const topic = document.getElementById("assignTopic")?.value || "operations";
  const select = document.getElementById("assignMode");
  if (!select) return;
  const learner = state.teacherLearners.find(item => item.id === document.getElementById("assignStudent")?.value);
  const grade = Number(learner?.grade || 6);
  const previous = select.value;

  let options;
  if (topic === "operations") {
    options = [["mixed","Mixed"],["add","Addition"],["subtract","Subtraction"],["multiply","Multiplication"],["divide","Division"]];
    if (grade === 1) options = options.filter(([value]) => !["multiply", "divide"].includes(value));
  } else if (topic === "measurement") {
    options = [["mixed","Mixed conversions"],["length","Length"],["mass","Mass"],["capacity","Capacity"]];
  } else if (topic === "fractions") {
    options = [["mixed","Mixed fraction skills"]];
    if (grade >= 4) {
      options.push(["add_same","Addition — same denominators"], ["subtract_same","Subtraction — same denominators"]);
    }
    if (grade >= 5) {
      options.push(["add_different","Addition — different denominators"], ["subtract_different","Subtraction — different denominators"]);
    }
  } else if (topic === "decimals") {
    options = [["mixed","Mixed decimals"]];
  } else if (topic === "percent") {
    options = [["mixed","Mixed % / Fraction / Decimal"]];
  } else if (topic === "critical") {
    options = [["mixed","Mixed critical thinking"], ["patterns","Patterns & sequences"], ["missing","Missing number logic"]];
    if (grade >= 2) options.push(["balance","Balance the equation"]);
    if (grade >= 3) options.push(["machines","Number machines"]);
  } else {
    options = [["mixed","Mixed conversions"]];
  }

  select.innerHTML = "";
  options.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
  if (options.some(([value]) => value === previous)) select.value = previous;
  updateDigitControls();
}
async function loadTeacherAssignments(showLoading = true) {
  if (!db || !state.teacherUser) return;
  if (showLoading) {
    setTableMessage("assignmentsMessage", "Loading allocated quizzes…");
    setTableMessage("completedAssignmentsMessage", "Loading completed quizzes…");
  }
  try {
    const { data, error } = await db
      .from("math_quiz_assignments")
      .select("id,student_id,title,topic,mode,question_count,first_number_digits,second_number_digits,position,status,completed_attempt_id,completed_at,created_at")
      .eq("group_id", CONFIG.groupId)
      .neq("status", "cancelled")
      .order("position", { ascending: true });
    if (error) throw error;
    state.teacherAssignments = data || [];
    renderTeacherAssignments();
  } catch (error) {
    console.error(error);
    setTableMessage("assignmentsMessage", "Could not load allocated quizzes. Run the V5 Supabase upgrades.", true);
    setTableMessage("completedAssignmentsMessage", "Could not load completed quizzes.", true);
  }
}

function renderTeacherAssignments() {
  const waitingBody = document.getElementById("waitingAssignmentsBody");
  const completedBody = document.getElementById("completedAssignmentsBody");
  if (!waitingBody || !completedBody) return;
  waitingBody.innerHTML = "";
  completedBody.innerHTML = "";

  const studentId = document.getElementById("assignStudent").value;
  const learner = state.teacherLearners.find(item => item.id === studentId);
  const rows = state.teacherAssignments
    .filter(item => item.student_id === studentId)
    .sort((a, b) => Number(a.position) - Number(b.position));
  const waiting = rows.filter(item => item.status === "pending");
  const completed = rows.filter(item => item.status === "completed");

  document.getElementById("assignmentLearnerSummary").textContent = learner
    ? `${learner.full_name} • Grade ${learner.grade} • ${waiting.length} waiting • ${completed.length} completed`
    : "Select a learner to view the allocated order.";
  document.getElementById("completedAssignmentCount").textContent = completed.length;

  waiting.forEach(assignment => {
    const tr = document.createElement("tr");
    addCell(tr, assignment.position);
    addCell(tr, assignmentFullDisplayName(assignment));
    addCell(tr, TOPIC_LABELS[assignment.topic] || assignment.topic);
    addCell(tr, assignmentModeLabel(assignment));
    addCell(tr, assignment.question_count);
    addCell(tr, assignmentNumberSizeLabel(assignment));
    const statusCell = document.createElement("td");
    statusCell.innerHTML = '<span class="status-pill waiting">Waiting</span>';
    tr.appendChild(statusCell);

    const actions = document.createElement("td");
    actions.className = "table-actions";
    actions.append(
      actionButton("Edit", "Edit this waiting quiz", () => editTeacherAssignment(assignment), "edit-action"),
      actionButton("↑", "Move earlier", () => moveTeacherAssignment(assignment.id, "up")),
      actionButton("↓", "Move later", () => moveTeacherAssignment(assignment.id, "down")),
      actionButton("Remove", "Remove from queue", () => cancelTeacherAssignment(assignment.id), "danger-action")
    );
    tr.appendChild(actions);
    waitingBody.appendChild(tr);
  });

  completed.forEach(assignment => {
    const tr = document.createElement("tr");
    addCell(tr, `✓ ${assignment.position}`);
    addCell(tr, assignmentFullDisplayName(assignment));
    addCell(tr, TOPIC_LABELS[assignment.topic] || assignment.topic);
    addCell(tr, assignmentModeLabel(assignment));
    addCell(tr, assignment.question_count);
    addCell(tr, assignmentNumberSizeLabel(assignment));
    addCell(tr, assignment.completed_at ? formatDate(assignment.completed_at) : "—");

    const actions = document.createElement("td");
    actions.className = "table-actions";
    actions.append(
      actionButton("Result PDF", "Download the marked learner quiz", () => downloadCompletedAssignmentPdf(assignment), "pdf-action"),
      actionButton("Allocate again", "Add the same quiz to the end", () => repeatTeacherAssignment(assignment))
    );
    tr.appendChild(actions);
    completedBody.appendChild(tr);
  });

  setTableMessage("assignmentsMessage", !studentId ? "Select a learner." : waiting.length ? "" : "No waiting quizzes for this learner.");
  setTableMessage("completedAssignmentsMessage", !studentId ? "Select a learner." : completed.length ? "" : "No completed quizzes yet.");
}

function assignmentNumberSizeLabel(assignment) {
  if (assignment.topic !== "operations" || !assignment.first_number_digits || !assignment.second_number_digits) return "—";
  const first = Number(assignment.first_number_digits);
  const second = Number(assignment.second_number_digits);
  return `${first} digit${first === 1 ? "" : "s"} / ${second} digit${second === 1 ? "" : "s"}`;
}

function actionButton(text, title, handler, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ghost-btn tiny-btn ${extraClass}`.trim();
  button.textContent = text;
  button.title = title;
  button.addEventListener("click", handler);
  return button;
}


function readTeacherAssignmentDraft() {
  const studentId = document.getElementById("assignStudent")?.value || "";
  const learner = state.teacherLearners.find(item => item.id === studentId);
  const topic = document.getElementById("assignTopic")?.value || "operations";
  const mode = document.getElementById("assignMode")?.value || "mixed";
  const questionCount = Number(document.getElementById("assignQuestionCount")?.value || 20);
  const firstDigits = topic === "operations" ? Number(document.getElementById("assignFirstDigits")?.value || 1) : null;
  const secondDigits = topic === "operations" ? Number(document.getElementById("assignSecondDigits")?.value || 1) : null;
  const title = cleanText(document.getElementById("assignTitle")?.value || "", 80);
  return { studentId, learner, topic, mode, questionCount, firstDigits, secondDigits, title };
}

function teacherAssignmentDraftError(draft) {
  const { learner, topic, mode, questionCount, firstDigits, secondDigits } = draft;
  if (!learner) return "Select a learner first.";
  if (!TOPIC_LABELS[topic]) return "Choose a valid topic.";
  if (![5,10,15,20].includes(questionCount)) return "Choose 5, 10, 15 or 20 questions.";
  if (Number(learner.grade) < MIN_GRADE[topic]) return `${TOPIC_LABELS[topic]} starts in Grade ${MIN_GRADE[topic]}.`;
  if (Number(learner.grade) === 1 && topic === "operations" && ["multiply","divide"].includes(mode)) return "Grade 1 cannot use multiplication or division.";
  if (topic === "fractions" && Number(learner.grade) < 4 && mode !== "mixed") return "Grade 3 uses mixed basic fraction skills.";
  if (topic === "fractions" && Number(learner.grade) < 5 && ["add_different","subtract_different"].includes(mode)) return "Different-denominator fractions start from Grade 5.";
  if (topic === "critical" && Number(learner.grade) < 2 && mode === "balance") return "Balance-the-equation critical thinking starts from Grade 2.";
  if (topic === "critical" && Number(learner.grade) < 3 && mode === "machines") return "Number machines start from Grade 3.";
  if (topic === "operations" && ["subtract","divide","mixed"].includes(mode) && firstDigits < secondDigits) return "The first number must have at least as many digits as the second number.";
  return "";
}

function assignmentDraftFingerprint(draft) {
  return JSON.stringify({
    studentId: draft.studentId,
    title: draft.title,
    topic: draft.topic,
    mode: draft.mode,
    questionCount: draft.questionCount,
    firstDigits: draft.firstDigits,
    secondDigits: draft.secondDigits
  });
}

function previewTeacherAssignment() {
  const draft = readTeacherAssignmentDraft();
  const errorText = teacherAssignmentDraftError(draft);
  const message = document.getElementById("assignmentEditorMessage");
  if (errorText) return setFormMessage(message, errorText, false);

  try {
    const fingerprint = assignmentDraftFingerprint(draft);
    let previewId = state.editingAssignmentId || null;
    if (!previewId) {
      if (state.assignmentPreviewFingerprint === fingerprint && state.assignmentPreviewId) previewId = state.assignmentPreviewId;
      else previewId = createAttemptToken();
    }
    state.assignmentPreviewId = previewId;
    state.assignmentPreviewFingerprint = fingerprint;
    const previewAssignment = {
      assignment_id: previewId,
      id: previewId,
      student_id: draft.studentId,
      title: draft.title || null,
      topic: draft.topic,
      mode: draft.mode,
      question_count: draft.questionCount,
      first_number_digits: draft.firstDigits,
      second_number_digits: draft.secondDigits,
      status: "pending"
    };
    const questions = generateQuestionsForAssignment(previewAssignment, draft.learner.grade);
    const panel = document.getElementById("assignmentPreviewPanel");
    const heading = document.getElementById("assignmentPreviewHeading");
    const meta = document.getElementById("assignmentPreviewMeta");
    const list = document.getElementById("assignmentPreviewQuestions");
    heading.textContent = assignmentFullDisplayName(previewAssignment);
    meta.textContent = `${draft.learner.display_name} • Grade ${draft.learner.grade} • ${draft.questionCount} questions • Preview before allocation`;
    list.innerHTML = "";
    questions.forEach((question, index) => {
      const item = document.createElement("article");
      item.className = "preview-question";
      item.innerHTML = `<span>Question ${index + 1}</span><div>${question.promptHtml}</div>`;
      list.appendChild(item);
    });
    panel.classList.remove("hidden");
    setFormMessage(message, state.editingAssignmentId ? "Preview ready. Saving these settings keeps this exact edited question set." : "Preview ready. If you add this quiz without changing the settings, the learner will receive these exact questions.", true);
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    console.error(error);
    setFormMessage(message, error.message || "The question preview could not be generated.", false);
  }
}

function closeAssignmentPreview(resetSeed = false) {
  document.getElementById("assignmentPreviewPanel")?.classList.add("hidden");
  if (resetSeed) {
    state.assignmentPreviewId = null;
    state.assignmentPreviewFingerprint = "";
  }
}

async function addTeacherAssignment() {
  if (!db || !state.teacherUser) return;
  const studentId = document.getElementById("assignStudent").value;
  const learner = state.teacherLearners.find(item => item.id === studentId);
  const topic = document.getElementById("assignTopic").value;
  const mode = document.getElementById("assignMode").value;
  const questionCount = Number(document.getElementById("assignQuestionCount").value);
  const firstDigits = topic === "operations" ? Number(document.getElementById("assignFirstDigits").value) : null;
  const secondDigits = topic === "operations" ? Number(document.getElementById("assignSecondDigits").value) : null;
  const title = cleanText(document.getElementById("assignTitle").value, 80);
  const message = document.getElementById("assignmentEditorMessage");
  const editingId = state.editingAssignmentId;

  if (!learner) return setFormMessage(message, "Select a learner first.", false);
  if (Number(learner.grade) < MIN_GRADE[topic]) return setFormMessage(message, `${TOPIC_LABELS[topic]} starts in Grade ${MIN_GRADE[topic]}.`, false);
  if (Number(learner.grade) === 1 && topic === "operations" && ["multiply","divide"].includes(mode)) {
    return setFormMessage(message, "Grade 1 allocations can use addition, subtraction or mixed.", false);
  }
  if (topic === "fractions" && Number(learner.grade) < 4 && mode !== "mixed") {
    return setFormMessage(message, "Grade 3 uses mixed basic fraction skills. Fraction addition and subtraction start from Grade 4.", false);
  }
  if (topic === "fractions" && Number(learner.grade) < 5 && ["add_different", "subtract_different"].includes(mode)) {
    return setFormMessage(message, "Different-denominator fraction quizzes start from Grade 5.", false);
  }
  if (topic === "critical" && Number(learner.grade) < 2 && mode === "balance") {
    return setFormMessage(message, "Balance-the-equation critical thinking starts from Grade 2.", false);
  }
  if (topic === "critical" && Number(learner.grade) < 3 && mode === "machines") {
    return setFormMessage(message, "Number-machine critical thinking starts from Grade 3.", false);
  }
  if (topic === "operations" && ["subtract", "divide", "mixed"].includes(mode) && firstDigits < secondDigits) {
    return setFormMessage(message, "For subtraction, division or mixed quizzes, the first number must have at least as many digits as the second number.", false);
  }

  const button = document.getElementById("addAssignmentBtn");
  button.disabled = true;
  button.textContent = editingId ? "Saving…" : "Adding…";
  try {
    const currentDraft = { studentId, learner, topic, mode, questionCount, firstDigits, secondDigits, title };
    const fingerprint = assignmentDraftFingerprint(currentDraft);
    const newAssignmentId = state.assignmentPreviewFingerprint === fingerprint && state.assignmentPreviewId
      ? state.assignmentPreviewId
      : createAttemptToken();
    const rpcName = editingId ? "teacher_update_math_assignment_v5" : "teacher_create_math_assignment_v6";
    const rpcParams = editingId ? {
      p_assignment_id: editingId,
      p_title: title || null,
      p_topic: topic,
      p_mode: mode,
      p_question_count: questionCount,
      p_first_number_digits: firstDigits,
      p_second_number_digits: secondDigits
    } : {
      p_assignment_id: newAssignmentId,
      p_group_id: CONFIG.groupId,
      p_student_id: studentId,
      p_title: title || null,
      p_topic: topic,
      p_mode: mode,
      p_question_count: questionCount,
      p_first_number_digits: firstDigits,
      p_second_number_digits: secondDigits
    };
    const { error } = await db.rpc(rpcName, rpcParams);
    if (error) throw error;
    setFormMessage(message, editingId ? "Allocated quiz updated." : "Quiz added to the end of the learner’s queue.", true);
    closeAssignmentPreview(true);
    cancelAssignmentEdit(true);
    await loadTeacherAssignments(false);
  } catch (error) {
    console.error(error);
    setFormMessage(message, error.message || (editingId ? "Could not update the allocated quiz." : "Could not allocate the quiz."), false);
  } finally {
    button.disabled = false;
    button.textContent = state.editingAssignmentId ? "Save changes" : "Add to queue";
  }
}
async function moveTeacherAssignment(id, direction) {
  try {
    const { error } = await db.rpc("teacher_move_math_assignment", { p_assignment_id: id, p_direction: direction });
    if (error) throw error;
    await loadTeacherAssignments(false);
  } catch (error) {
    alert(error.message || "The quiz order could not be changed.");
  }
}

async function cancelTeacherAssignment(id) {
  if (!confirm("Remove this unfinished quiz from the learner’s queue?")) return;
  if (state.editingAssignmentId === id) cancelAssignmentEdit();
  try {
    const { error } = await db.rpc("teacher_cancel_math_assignment", { p_assignment_id: id });
    if (error) throw error;
    await loadTeacherAssignments(false);
  } catch (error) {
    alert(error.message || "The quiz could not be removed.");
  }
}

function editTeacherAssignment(assignment) {
  if (assignment.status !== "pending") return alert("Only a waiting quiz can be edited.");
  if (!confirm("Edit this waiting quiz? If the learner already opened it, ask them to refresh before continuing.")) return;
  state.editingAssignmentId = assignment.id;
  document.getElementById("editAssignmentId").value = assignment.id;
  const learnerSelect = document.getElementById("assignStudent");
  learnerSelect.value = assignment.student_id;
  learnerSelect.disabled = true;
  document.getElementById("assignTitle").value = assignment.title || "";
  document.getElementById("assignTopic").value = assignment.topic;
  updateAssignmentModeOptions();
  document.getElementById("assignMode").value = assignment.mode;
  document.getElementById("assignQuestionCount").value = String(assignment.question_count);
  updateDigitControls();
  if (assignment.first_number_digits) document.getElementById("assignFirstDigits").value = String(assignment.first_number_digits);
  if (assignment.second_number_digits) document.getElementById("assignSecondDigits").value = String(assignment.second_number_digits);
  document.getElementById("addAssignmentBtn").textContent = "Save changes";
  document.getElementById("cancelAssignmentEditBtn").classList.remove("hidden");
  setFormMessage(document.getElementById("assignmentEditorMessage"), `Editing: ${assignmentFullDisplayName(assignment)}`, true);
  document.getElementById("teacherAssignmentsTab").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelAssignmentEdit(keepMessage = false) {
  closeAssignmentPreview(true);
  state.editingAssignmentId = null;
  document.getElementById("editAssignmentId").value = "";
  document.getElementById("assignStudent").disabled = false;
  document.getElementById("assignTitle").value = "";
  document.getElementById("addAssignmentBtn").textContent = "Add to queue";
  document.getElementById("cancelAssignmentEditBtn").classList.add("hidden");
  if (!keepMessage) setFormMessage(document.getElementById("assignmentEditorMessage"), "", true);
}

async function repeatTeacherAssignment(assignment) {
  cancelAssignmentEdit();
  document.getElementById("assignStudent").value = assignment.student_id;
  document.getElementById("assignTitle").value = assignment.title || "";
  document.getElementById("assignTopic").value = assignment.topic;
  updateAssignmentModeOptions();
  document.getElementById("assignMode").value = assignment.mode;
  document.getElementById("assignQuestionCount").value = String(assignment.question_count);
  updateDigitControls();
  if (assignment.first_number_digits) document.getElementById("assignFirstDigits").value = String(assignment.first_number_digits);
  if (assignment.second_number_digits) document.getElementById("assignSecondDigits").value = String(assignment.second_number_digits);
  await addTeacherAssignment();
}

function handleAssignmentLearnerChange() {
  cancelAssignmentEdit();
  updateAssignmentModeOptions();
  renderTeacherAssignments();
  updateDigitControls();
}

function updateDigitControls() {
  const topic = document.getElementById("assignTopic")?.value || "operations";
  const mode = document.getElementById("assignMode")?.value || "mixed";
  const learner = state.teacherLearners.find(item => item.id === document.getElementById("assignStudent")?.value);
  const grade = Number(learner?.grade || 6);
  const firstLabel = document.getElementById("firstDigitsLabel");
  const secondLabel = document.getElementById("secondDigitsLabel");
  if (!firstLabel || !secondLabel) return;

  const visible = topic === "operations";
  firstLabel.classList.toggle("hidden", !visible);
  secondLabel.classList.toggle("hidden", !visible);
  if (!visible) return;

  const gradeMaximum = grade <= 2 ? 2 : Math.min(grade, 6);
  let firstMaximum = gradeMaximum;
  let secondMaximum = gradeMaximum;
  if (mode === "multiply" || mode === "mixed") {
    firstMaximum = Math.min(firstMaximum, 3);
    secondMaximum = Math.min(secondMaximum, 3);
  }
  if (mode === "divide") secondMaximum = Math.min(secondMaximum, 3);

  fillDigitSelect("assignFirstDigits", firstMaximum);
  fillDigitSelect("assignSecondDigits", secondMaximum);
  if (["subtract", "divide", "mixed"].includes(mode)) {
    const first = Number(document.getElementById("assignFirstDigits").value);
    const secondSelect = document.getElementById("assignSecondDigits");
    if (Number(secondSelect.value) > first) secondSelect.value = String(first);
  }
}

function fillDigitSelect(id, maximum) {
  const select = document.getElementById(id);
  if (!select) return;
  const previous = Number(select.value) || 1;
  select.innerHTML = "";
  for (let digits = 1; digits <= maximum; digits += 1) {
    const option = document.createElement("option");
    option.value = String(digits);
    option.textContent = `${digits} digit${digits === 1 ? "" : "s"}`;
    select.appendChild(option);
  }
  select.value = String(Math.min(previous, maximum));
}

function assignmentDigitsText(assignment) {
  if (assignment?.topic !== "operations") return "";
  const first = Number(assignment.first_number_digits);
  const second = Number(assignment.second_number_digits);
  if (!first || !second) return "";
  return ` • first number ${first} digit${first === 1 ? "" : "s"} • second number ${second} digit${second === 1 ? "" : "s"}`;
}

function operationSymbol(mode) {
  return ({ add: "+", subtract: "−", multiply: "×", divide: "÷", mixed: "mixed with" })[mode] || "with";
}


function generateQuestionsForAssignment(assignment, grade) {
  const snapshot = {
    activeAssignment: state.activeAssignment,
    topic: state.topic,
    operationMode: state.operationMode,
    measurementMode: state.measurementMode,
    fractionMode: state.fractionMode,
    criticalMode: state.criticalMode
  };
  const normalised = { ...assignment, assignment_id: assignment.assignment_id || assignment.id };
  try {
    state.activeAssignment = normalised;
    applyAssignmentToState(normalised);
    return generateQuestions(normalised.topic, Number(grade), Number(normalised.question_count));
  } finally {
    state.activeAssignment = snapshot.activeAssignment;
    state.topic = snapshot.topic;
    state.operationMode = snapshot.operationMode;
    state.measurementMode = snapshot.measurementMode;
    state.fractionMode = snapshot.fractionMode;
    state.criticalMode = snapshot.criticalMode;
  }
}

function getPdfConstructor() {
  const PdfConstructor = window.jspdf?.jsPDF;
  if (!PdfConstructor) throw new Error("The PDF library did not load. Refresh the page and try again.");
  return PdfConstructor;
}

function createPdfWriter(title) {
  const PdfConstructor = getPdfConstructor();
  const doc = new PdfConstructor({ unit: "mm", format: "a4" });
  doc.setProperties({ title: pdfSafeText(title), subject: "SNT Dynamic Math", creator: "SNT Dynamic Math" });
  const margin = 15;
  const maxWidth = 180;
  let y = 16;

  function ensure(space = 10) {
    if (y + space <= 282) return;
    doc.addPage();
    y = 16;
  }

  function write(text, options = {}) {
    const size = Number(options.size || 10);
    const bold = Boolean(options.bold);
    const indent = Number(options.indent || 0);
    const after = Number(options.after ?? 2.5);
    const safe = pdfSafeText(text);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(safe || " ", maxWidth - indent);
    const lineHeight = size * 0.43;
    ensure((lines.length * lineHeight) + after + 2);
    doc.text(lines, margin + indent, y);
    y += (lines.length * lineHeight) + after;
  }

  function rule() {
    ensure(5);
    doc.line(margin, y, 195, y);
    y += 5;
  }

  function spacer(amount = 3) {
    ensure(amount);
    y += amount;
  }

  return { doc, write, rule, spacer };
}

function finishAndSavePdf(writer, filename) {
  const { doc } = writer;
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`SNT Dynamic Math • Page ${page} of ${totalPages}`, 15, 290);
  }
  doc.save(safeFileName(filename));
}

function pdfSafeText(value) {
  return String(value ?? "")
    .replace(/−/g, "-")
    .replace(/×/g, "x")
    .replace(/÷/g, "/")
    .replace(/[—–]/g, "-")
    .replace(/•/g, "-")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "");
}

function safeFileName(value) {
  const cleaned = pdfSafeText(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `${cleaned || "snt-dynamic-math"}.pdf`;
}

async function downloadCompletedAssignmentPdf(assignment) {
  try {
    let result = state.scoreRows.find(item => item.assignment_id === assignment.id);
    if (!result) {
      const { data, error } = await db
        .from("math_quiz_results")
        .select("id,assignment_id,student_id,student_name_snapshot,grade,quiz_title,topic,mode,score,total,percentage,duration_seconds,response_payload,marking_details,created_at")
        .eq("assignment_id", assignment.id)
        .maybeSingle();
      if (error) throw error;
      result = data;
    }
    if (!result) throw new Error("No completed result was found for this allocation.");
    await downloadCompletedQuizPdf(result);
  } catch (error) {
    console.error(error);
    alert(error.message || "The completed quiz PDF could not be created.");
  }
}

async function downloadCompletedQuizPdf(resultRow) {
  try {
    let result = resultRow;
    if (!Array.isArray(result.response_payload) || !Array.isArray(result.marking_details)) {
      const { data, error } = await db
        .from("math_quiz_results")
        .select("id,assignment_id,student_id,student_name_snapshot,grade,quiz_title,topic,mode,score,total,percentage,duration_seconds,response_payload,marking_details,created_at")
        .eq("id", result.id)
        .single();
      if (error) throw error;
      result = data;
    }

    const assignment = state.teacherAssignments.find(item => item.id === result.assignment_id);
    const questions = Array.isArray(result.response_payload) ? result.response_payload : [];
    const details = Array.isArray(result.marking_details) ? result.marking_details : [];
    const detailMap = new Map(details.map(detail => [String(detail.id), detail]));
    const wrongCount = details.filter(detail => !detail.is_correct).length;
    const quizName = assignment
      ? assignmentFullDisplayName(assignment)
      : `${result.quiz_title || "Maths Quiz"} — ${TOPIC_LABELS[result.topic] || result.topic} — ${MODE_LABELS[result.mode] || result.mode || "Mixed"}`;

    const writer = createPdfWriter(quizName);
    writer.write("SNT DYNAMIC MATH", { size: 17, bold: true, after: 1 });
    writer.write("COMPLETED QUIZ REPORT", { size: 11, bold: true, after: 5 });
    writer.write(`Learner: ${result.student_name_snapshot}`);
    writer.write(`Grade: ${result.grade}`);
    writer.write(`Quiz: ${quizName}`);
    writer.write(`Score: ${result.score}/${result.total} (${result.percentage}%)`);
    writer.write(`Time: ${formatDuration(Number(result.duration_seconds) || 0)}`);
    writer.write(`Completed: ${formatDate(result.created_at)}`);
    writer.write(`Incorrect answers: ${wrongCount}`);
    writer.rule();

    questions.forEach((question, index) => {
      const detail = detailMap.get(String(question.id)) || {};
      const correct = Boolean(detail.is_correct);
      writer.write(`${index + 1}. ${questionTextFromPayload(question)}`, { size: 11, bold: true, after: 1.5 });
      writer.write(`Learner answer: ${responseTextFromPayload(question)}`, { indent: 5, after: 1.5 });
      writer.write(`Correct answer: ${detail.correct_answer || "Not available"}`, { indent: 5, after: 1.5 });
      writer.write(`Result: ${correct ? "CORRECT" : "WRONG"}`, { indent: 5, bold: !correct, after: 5 });
    });

    finishAndSavePdf(writer, `${result.student_name_snapshot}-${quizName}-result`);
  } catch (error) {
    console.error(error);
    alert(error.message || "The completed quiz PDF could not be created.");
  }
}

function responseTextFromPayload(question) {
  const response = question?.response;
  if (response && typeof response === "object" && !Array.isArray(response)) {
    const numerator = response.num ?? "";
    const denominator = response.den ?? "";
    return `${numerator}/${denominator}`;
  }
  const text = String(response ?? "").trim();
  return text || "No answer";
}

function questionTextFromPayload(question) {
  const kind = question?.kind;
  const p = question?.params || {};
  switch (kind) {
    case "add": return `${p.a} + ${p.b} = ?`;
    case "subtract": return `${p.a} - ${p.b} = ?`;
    case "multiply": return `${p.a} x ${p.b} = ?`;
    case "divide": return `${p.dividend} / ${p.divisor} = ?`;
    case "fraction_of": return `${p.numerator}/${p.denominator} of ${p.whole} = ?`;
    case "fraction_equivalent_missing":
      return p.missing === "numerator"
        ? `${p.numerator}/${p.denominator} = ?/${Number(p.denominator) * Number(p.multiplier)}`
        : `${p.numerator}/${p.denominator} = ${Number(p.numerator) * Number(p.multiplier)}/?`;
    case "fraction_compare": return `${p.n1}/${p.d1} ? ${p.n2}/${p.d2}`;
    case "fraction_simplify": return `Simplify ${p.numerator}/${p.denominator}`;
    case "fraction_add": return `${p.n1}/${p.d1} + ${p.n2}/${p.d2} = ?`;
    case "fraction_subtract": return `${p.n1}/${p.d1} - ${p.n2}/${p.d2} = ?`;
    case "decimal_add": return `${p.a} + ${p.b} = ?`;
    case "decimal_subtract": return `${p.a} - ${p.b} = ?`;
    case "decimal_compare": return `${p.a} ? ${p.b}`;
    case "decimal_multiply_power": return `${p.value} x ${p.power} = ?`;
    case "decimal_divide_power": return `${p.value} / ${p.power} = ?`;
    case "measurement_convert": return `${p.value} ${p.from_unit} = ? ${p.to_unit}`;
    case "percent_to_fraction": return `${p.percent}% = ? as a fraction`;
    case "fraction_to_percent": return `${p.numerator}/${p.denominator} = ?%`;
    case "decimal_to_percent": return `${p.value} = ?%`;
    case "percent_to_decimal": return `${p.percent}% = ? as a decimal`;
    case "fraction_to_decimal": return `${p.numerator}/${p.denominator} = ? as a decimal`;
    case "decimal_to_fraction": return `${p.value} = ? as a fraction`;
    case "critical_pattern_next": {
      const terms = Number(p.terms) || 4;
      const shown = Array.from({ length: terms }, (_, i) => Number(p.start) + (i * Number(p.step)));
      return `${shown.join(", ")}, ?`;
    }
    case "critical_missing_number": {
      const symbol = ({ add: "+", subtract: "-", multiply: "x", divide: "/" })[p.operation] || "?";
      const result = p.operation === "add" ? Number(p.a) + Number(p.b)
        : p.operation === "subtract" ? Number(p.a) - Number(p.b)
        : p.operation === "multiply" ? Number(p.a) * Number(p.b)
        : Number(p.a) / Number(p.b);
      return `${p.missing === "a" ? "?" : p.a} ${symbol} ${p.missing === "b" ? "?" : p.b} = ${result}`;
    }
    case "critical_balance": return `${p.a} + ${p.b} = ${p.c} + ?`;
    case "critical_number_machine": return `Number machine: ${p.input} x ${p.multiplier} + ${p.addend} = ?`;
    default: return question?.promptText || "Maths question";
  }
}

async function learnerLogout() {
  if (!state.verifiedLearner) {
    showPage("practice");
    return;
  }
  if (state.questions.length && !state.submitted && !confirm("Log out and leave the unfinished quiz?")) return;
  clearLearnerVerification();
  document.getElementById("studentSelect").value = "";
  document.getElementById("studentCode").value = "";
  state.questions = [];
  state.pendingSubmission = null;
  state.latestResultText = "";
  document.getElementById("quizForm").innerHTML = "";
  showPage("practice");
}

async function loadMyResults(showLoading = true) {
  const notice = document.getElementById("myResultsLoginNotice");
  const content = document.getElementById("myResultsContent");
  if (!db || !state.verifiedLearner || !state.learnerCode) {
    notice.classList.remove("hidden");
    content.classList.add("hidden");
    return;
  }
  notice.classList.add("hidden");
  content.classList.remove("hidden");
  if (showLoading) setTableMessage("myResultsMessage", "Loading your results…");
  try {
    const { data, error } = await db.rpc("get_math_student_results", {
      p_student_id: state.verifiedLearner.student_id,
      p_student_code: state.learnerCode,
      p_group_id: CONFIG.groupId
    });
    if (error) throw error;
    state.learnerResults = Array.isArray(data) ? data : [];
    renderMyResults();
  } catch (error) {
    console.error("My results error:", error);
    setTableMessage("myResultsMessage", error.message || "Your results could not load.", true);
  }
}

function renderMyResults() {
  const body = document.getElementById("myResultsBody");
  if (!body) return;
  const topic = document.getElementById("myResultsTopicFilter")?.value || "all";
  const rows = state.learnerResults.filter(row => topic === "all" || row.topic === topic);
  body.innerHTML = "";
  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    addCell(tr, index + 1);
    addCell(tr, formatDate(row.created_at));
    addCell(tr, row.quiz_title || `${TOPIC_LABELS[row.topic] || "Maths"} Quiz`);
    addCell(tr, TOPIC_LABELS[row.topic] || row.topic);
    addCell(tr, `${row.score}/${row.total}`);
    addScoreCell(tr, Number(row.percentage) || 0);
    addCell(tr, formatDuration(row.duration_seconds));
    body.appendChild(tr);
  });
  const percentages = rows.map(row => Number(row.percentage) || 0);
  document.getElementById("myQuizCount").textContent = rows.length;
  document.getElementById("myLatestScore").textContent = rows.length ? `${percentages[0]}%` : "0%";
  document.getElementById("myBestScore").textContent = rows.length ? `${Math.max(...percentages)}%` : "0%";
  document.getElementById("myAverageScore").textContent = rows.length ? `${Math.round(average(percentages))}%` : "0%";
  showCurrentLearnerRank();
  setTableMessage("myResultsMessage", rows.length ? "" : "No results match this topic yet.");
}

async function loadLeaderboard(showLoading = true) {
  if (!db) return;
  const topic = document.getElementById("leaderboardTopicFilter")?.value || "all";
  const gradeValue = document.getElementById("leaderboardGradeFilter")?.value || "all";
  if (showLoading) setTableMessage("leaderboardMessage", "Loading leaderboard…");
  try {
    const { data, error } = await db.rpc("get_math_weekly_leaderboard", {
      p_group_id: CONFIG.groupId,
      p_topic: topic,
      p_grade: gradeValue === "all" ? null : Number(gradeValue)
    });
    if (error) throw error;
    state.leaderboardRows = Array.isArray(data) ? data : [];
    renderLeaderboard();
  } catch (error) {
    console.error("Leaderboard error:", error);
    setTableMessage("leaderboardMessage", error.message || "The leaderboard could not load.", true);
  }
}

async function loadOverallLeaderboard() {
  if (!db) return;
  try {
    const { data, error } = await db.rpc("get_math_weekly_leaderboard", {
      p_group_id: CONFIG.groupId,
      p_topic: "all",
      p_grade: null
    });
    if (error) throw error;
    state.overallLeaderboardRows = Array.isArray(data) ? data : [];
    showCurrentLearnerRank();
  } catch (error) {
    console.warn("Overall leaderboard error:", error);
  }
}


async function checkWeeklyChampionCelebration() {
  if (!db || !state.verifiedLearner || !state.learnerCode) return;
  try {
    const { data, error } = await db.rpc("get_math_weekly_champion_for_student", {
      p_student_id: state.verifiedLearner.student_id,
      p_student_code: state.learnerCode,
      p_group_id: CONFIG.groupId
    });
    if (error) throw error;
    const champion = Array.isArray(data) ? data[0] : data;
    state.weeklyChampion = champion || null;
    if (!champion?.ready || !champion?.is_winner) return;

    const weekKey = cleanText(champion.week_start || "current-week", 30);
    const storageKey = `snt-weekly-champion:${CONFIG.groupId}:${state.verifiedLearner.student_id}:${weekKey}`;
    if (window.localStorage?.getItem(storageKey)) return;
    showWeeklyChampionCelebration(champion);
    try { window.localStorage?.setItem(storageKey, new Date().toISOString()); } catch {}
  } catch (error) {
    console.warn("Weekly champion check could not run:", error);
  }
}

function showWeeklyChampionCelebration(champion) {
  const overlay = document.getElementById("weeklyChampionOverlay");
  if (!overlay) return;
  document.getElementById("weeklyChampionName").textContent = champion.winner_display_name || state.verifiedLearner?.display_name || "Weekly Champion";
  document.getElementById("weeklyChampionScore").textContent = `${Number(champion.winner_average_percentage) || 0}% weekly average`;
  document.getElementById("weeklyChampionWeek").textContent = `Grade ${champion.grade} champion • ${formatWeekRange(champion.week_start, champion.week_end)}`;
  const image = document.getElementById("weeklyChampionImage");
  if (image) image.src = `weekly-champion.gif?week=${encodeURIComponent(champion.week_start || Date.now())}&play=${Date.now()}`;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
}

function closeWeeklyChampionCelebration() {
  const overlay = document.getElementById("weeklyChampionOverlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
}

function renderLeaderboard() {
  const body = document.getElementById("leaderboardBody");
  const podium = document.getElementById("leaderboardPodium");
  if (!body || !podium) return;
  body.innerHTML = "";
  podium.innerHTML = "";
  const weekLabel = document.getElementById("leaderboardWeekLabel");
  const sample = state.leaderboardRows[0];
  if (weekLabel) weekLabel.textContent = sample
    ? `Weekly competition: ${formatWeekRange(sample.week_start, sample.week_end)}`
    : `Weekly competition: ${currentMondayFridayLabel()}`;
  const medals = ["🥇", "🥈", "🥉"];
  state.leaderboardRows.slice(0, 3).forEach((row, index) => {
    const card = document.createElement("article");
    card.className = `podium-card place-${index + 1}`;
    card.innerHTML = `<div class="podium-medal">${medals[index]}</div><strong>${escapeHtml(row.display_name)}</strong><span>Grade ${row.grade}</span><b>${row.weekly_average_percentage}% this week</b><small>${row.weekly_quizzes_completed} quiz${Number(row.weekly_quizzes_completed) === 1 ? "" : "zes"} this week</small>`;
    podium.appendChild(card);
  });
  state.leaderboardRows.forEach(row => {
    const tr = document.createElement("tr");
    const rankCell = document.createElement("td");
    rankCell.innerHTML = `<span class="rank-badge rank-${Math.min(Number(row.rank_position), 4)}">${rankLabel(row.rank_position)}</span>`;
    tr.appendChild(rankCell);
    addCell(tr, row.display_name);
    addCell(tr, `Grade ${row.grade}`);
    addScoreCell(tr, Number(row.weekly_average_percentage) || 0);
    addScoreCell(tr, Number(row.all_time_average_percentage) || 0);
    addScoreCell(tr, Number(row.all_time_best_percentage) || 0);
    addCell(tr, row.weekly_quizzes_completed);
    addCell(tr, formatDuration(row.weekly_average_duration_seconds));
    body.appendChild(tr);
  });
  showCurrentLearnerRank();
  setTableMessage("leaderboardMessage", state.leaderboardRows.length ? "" : "No quizzes have been completed in the current Monday-to-Friday competition yet.");
}

function rankLabel(position) {
  const rank = Number(position);
  if (rank === 1) return "🥇 1st";
  if (rank === 2) return "🥈 2nd";
  if (rank === 3) return "🥉 3rd";
  return `${rank}th`;
}

function showCurrentLearnerRank() {
  if (!state.verifiedLearner) return;
  const row = state.overallLeaderboardRows.find(item => String(item.display_name).toLowerCase() === String(state.verifiedLearner.display_name).toLowerCase());
  const rankText = row ? rankLabel(row.rank_position) : "—";
  const stat = document.getElementById("myOverallRank");
  if (stat) stat.textContent = rankText;
  const weeklyAverage = document.getElementById("myWeeklyAverage");
  if (weeklyAverage) weeklyAverage.textContent = row ? `${Number(row.weekly_average_percentage) || 0}%` : "0%";
  const resultRank = document.getElementById("resultRank");
  if (resultRank && state.submitted && row) {
    resultRank.textContent = `🏆 This week’s leaderboard position: ${rankText}`;
    resultRank.classList.remove("hidden");
  }
}

function formatWeekRange(startValue, endValue) {
  if (!startValue || !endValue) return currentMondayFridayLabel();
  const start = new Date(`${startValue}T12:00:00`);
  const end = new Date(`${endValue}T12:00:00`);
  const fmt = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short" });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

function currentMondayFridayLabel() {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setHours(12, 0, 0, 0);
  monday.setDate(now.getDate() + mondayOffset);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const fmt = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short" });
  return `${fmt.format(monday)} – ${fmt.format(friday)}`;
}

function renderTeacherLearners() {
  const body = document.getElementById("learnersBody");
  body.innerHTML = "";
  state.teacherLearners.forEach(learner => {
    const tr = document.createElement("tr");
    addCell(tr, learner.full_name);
    addCell(tr, learner.display_name);
    addCell(tr, `Grade ${learner.grade}`);
    const statusCell = document.createElement("td");
    statusCell.innerHTML = `<span class="status-pill ${learner.active ? "active" : "inactive"}">${learner.active ? "Active" : "Inactive"}</span>`;
    tr.appendChild(statusCell);
    const actionCell = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-btn small-btn";
    button.textContent = "Edit";
    button.addEventListener("click", () => editLearner(learner.id));
    actionCell.appendChild(button);
    tr.appendChild(actionCell);
    body.appendChild(tr);
  });
  setTableMessage("learnersMessage", state.teacherLearners.length ? "" : "No learners have been added.");
}

function editLearner(id) {
  const learner = state.teacherLearners.find(item => item.id === id);
  if (!learner) return;
  document.getElementById("editStudentId").value = learner.id;
  document.getElementById("editFullName").value = learner.full_name;
  document.getElementById("editDisplayName").value = learner.display_name;
  document.getElementById("editGrade").value = String(learner.grade);
  document.getElementById("editCode").value = "";
  document.getElementById("editCode").placeholder = "Leave blank to keep current code";
  document.getElementById("editActive").checked = learner.active;
  document.getElementById("saveLearnerBtn").textContent = "Update learner";
  document.getElementById("learnerEditorMessage").textContent = `Editing ${learner.full_name}.`;
  document.getElementById("teacherLearnersTab").scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearLearnerEditor() {
  document.getElementById("editStudentId").value = "";
  document.getElementById("editFullName").value = "";
  document.getElementById("editDisplayName").value = "";
  document.getElementById("editGrade").value = "1";
  document.getElementById("editCode").value = "";
  document.getElementById("editCode").placeholder = "Required for new learner";
  document.getElementById("editActive").checked = true;
  document.getElementById("saveLearnerBtn").textContent = "Save learner";
  document.getElementById("learnerEditorMessage").textContent = "";
}

async function saveLearner() {
  if (!db || !state.teacherUser) return;
  const studentId = document.getElementById("editStudentId").value || null;
  const fullName = cleanText(document.getElementById("editFullName").value, 100);
  const displayName = cleanText(document.getElementById("editDisplayName").value, 60);
  const grade = Number(document.getElementById("editGrade").value);
  const code = normaliseCode(document.getElementById("editCode").value);
  const active = document.getElementById("editActive").checked;
  const message = document.getElementById("learnerEditorMessage");
  message.className = "form-message";

  if (!fullName || !displayName) return setFormMessage(message, "Enter both the full name and display name.", false);
  if (!studentId && code.length < 2) return setFormMessage(message, "A private code is required for a new learner.", false);

  const button = document.getElementById("saveLearnerBtn");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const { error } = await db.rpc("teacher_save_math_student", {
      p_student_id: studentId,
      p_group_id: CONFIG.groupId,
      p_full_name: fullName,
      p_display_name: displayName,
      p_grade: grade,
      p_new_code: code || null,
      p_active: active
    });
    if (error) throw error;
    setFormMessage(message, studentId ? "Learner updated successfully." : "Learner added successfully.", true);
    clearLearnerEditor();
    await Promise.all([loadTeacherLearners(), loadPublicLearners()]);
  } catch (error) {
    console.error(error);
    setFormMessage(message, error.message || "Could not save the learner.", false);
  } finally {
    button.disabled = false;
    button.textContent = document.getElementById("editStudentId").value ? "Update learner" : "Save learner";
  }
}

function setFormMessage(element, text, success) {
  element.textContent = text;
  element.className = `form-message ${success ? "success" : "error"}`;
}

function downloadScoresCsv() {
  const rows = getFilteredScoreRows();
  if (!rows.length) return alert("There are no score rows to download.");
  const header = ["Learner", "Grade", "Quiz", "Topic", "Mode", "Score", "Total", "Percentage", "Duration Seconds", "Date"];
  const csv = [header.map(csvCell).join(",")];
  rows.forEach(row => {
    csv.push([
      row.student_name_snapshot,
      row.grade,
      row.quiz_title || `${TOPIC_LABELS[row.topic] || "Maths"} Quiz`,
      TOPIC_LABELS[row.topic] || row.topic,
      MODE_LABELS[row.mode] || row.mode,
      row.score,
      row.total,
      row.percentage,
      row.duration_seconds,
      row.created_at
    ].map(csvCell).join(","));
  });
  const blob = new Blob(["\uFEFF" + csv.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `snt-dynamic-math-scores-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function addCell(row, value) {
  const td = document.createElement("td");
  td.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
  row.appendChild(td);
}

function addScoreCell(row, value) {
  const td = document.createElement("td");
  const span = document.createElement("span");
  span.className = "score-pill";
  span.textContent = `${value}%`;
  td.appendChild(span);
  row.appendChild(td);
}

function setTableMessage(id, text, isError = false) {
  const element = document.getElementById(id);
  element.textContent = text;
  element.classList.toggle("hidden", !text);
  element.style.color = isError ? "#dc2626" : "";
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg"
  }).format(new Date(value));
}

function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(value / 60);
  const secs = value % 60;
  return mins ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatWhole(value) {
  return new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 0 }).format(Number(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 6, useGrouping: true }).format(Number(value));
}

function cleanText(value, maxLength = 200) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normaliseCode(value) {
  return cleanText(value, 40).toUpperCase().replace(/\s+/g, "");
}

function cleanNumericText(value) {
  return String(value ?? "").trim().replace(",", ".");
}

function createSeededRandom(seedText) {
  let seed = 2166136261;
  for (const char of String(seedText)) {
    seed ^= char.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return function seededRandom() {
    seed += 0x6D2B79F5;
    let value = seed;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function randomInt(min, max) {
  return Math.floor(questionRandom() * (max - min + 1)) + min;
}

function randomChoice(items) {
  return items[Math.floor(questionRandom() * items.length)];
}

function roundTo(value, places) {
  const scale = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
