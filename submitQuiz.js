// ---------------- GLOBALS ----------------
let quizData = [];
let currentType = "mixed";

const GOOGLE_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbyeb1es1ZaGXWWE8LRqPwkBbnywsmxE8CdMzdBNLOBjwAUY2A-NP4ND_3HXr8QY1t02/exec";

// ---------------- QUIZ GENERATOR ----------------
function generateQuestions() {
  const types = currentType === "mixed"
    ? ["add","subtract","multiply","divide"]
    : [currentType];

  const arr = [];

  for (let i = 0; i < 20; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    let a = Math.floor(Math.random() * 12) + 1;
    let b = Math.floor(Math.random() * 12) + 1;

    let question, correct;

    if (type === "add") {
      question = `${a} + ${b}`;
      correct = a + b;
    }
    else if (type === "subtract") {
      question = `${a} - ${b}`;
      correct = a - b;
    }
    else if (type === "multiply") {
      question = `${a} × ${b}`;
      correct = a * b;
    }
    else {
      let product = a * b;
      question = `${product} ÷ ${a}`;
      correct = b;
    }

    arr.push({ question, exactAnswer: correct.toString() });
  }
  return arr;
}

// ---------------- START QUIZ ----------------
function startQuiz(type) {
  currentType = type;
  quizData = generateQuestions();

  document.querySelectorAll(".quiz-btn").forEach(b => b.classList.remove("active"));
  event.target.classList.add("active");

  let html = "";
  quizData.forEach((q,i)=>{
    html += `
      <div class="question-box">
        <strong>Q${i+1}: ${q.question} = ?</strong>
        <input inputmode="numeric" pattern="-?[0-9]*" class="answer" id="ans${i}" placeholder="Enter answer">
      </div>
    `;
  });

  document.getElementById("quizArea").innerHTML = html;
}

// ---------------- SUBMIT QUIZ ----------------
function submitQuiz() {
  let name = document.getElementById("studentName").value.trim();
  if (!name) return alert("Please enter your name.");

  let score = 0;
  let answerArray = [];

  quizData.forEach((q,i)=>{
    let userVal = document.getElementById("ans"+i).value.trim();
    let correct = q.exactAnswer;
    let isCorrect = (userVal === correct);

    if (isCorrect) score++;

    answerArray.push({
      question: q.question,
      userAnswer: userVal || "(blank)",
      correctAnswer: correct,
      isCorrect: isCorrect ? "YES" : "NO"
    });

    document.getElementById("ans"+i).classList.add(isCorrect ? "correct" : "incorrect");
  });

  document.getElementById("results").style.display = "block";
  document.getElementById("results").innerHTML =
    `<h2>Your Score: ${score}/20</h2><p>Saved to Google Sheets ✔</p>`;

  sendToSheet(name, score, answerArray);
}

// ---------------- SEND TO GOOGLE SHEET ----------------
function sendToSheet(name, score, answers) {
  fetch(GOOGLE_WEBAPP_URL, {
    method: "POST",
    body: JSON.stringify({
      name: name,
      totalScore: score,
      timestamp: new Date().toISOString(),
      answers: answers
    })
  })
  .then(r => r.json())
  .then(d => console.log("SAVED:", d))
  .catch(e => console.error("ERROR:", e));
}

// Load quiz default
startQuiz("mixed");
