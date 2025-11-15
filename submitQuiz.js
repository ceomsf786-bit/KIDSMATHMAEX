// ================================
// CHANGE THIS TO YOUR WEB APP URL
// ================================
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbybVM4Vpxo_zGdrsPDarJVosiA440jHX8lY9ZPpegmZEWxtKw41qey96NLezCkOhKI/exec";

function submitQuiz() {
    const name = document.getElementById("studentName").value.trim();
    if (!name) {
        alert("Please enter your name before submitting.");
        return;
    }

    // Collect all questions in quizData (this must exist in your quiz)
    // Example quizData format:
    // quizData = [
    //   { question: "2 + 2 = ?", correct: "4" },
    //   { question: "3 + 5 = ?", correct: "8" }
    // ];
    if (typeof quizData === "undefined") {
        alert("quizData is missing!");
        return;
    }

    let answersArray = [];
    let score = 0;

    // Collect user answers from inputs like <input name="q0">, <input name="q1"> ...
    quizData.forEach((q, index) => {
        const selected = document.querySelector(`input[name="q${index}"]:checked`);
        const userAnswer = selected ? selected.value : "";

        // Score count
        if (userAnswer === q.correct) score++;

        // Add to answers array for sheet
        answersArray.push({
            question: q.question,
            userAnswer: userAnswer,
            correctAnswer: q.correct,
            isCorrect: userAnswer === q.correct ? "YES" : "NO"
        });
    });

    // Prepare data to send
    const payload = {
        name: name,
        score: score,
        answers: answersArray
    };

    // Send to Google Sheets
    fetch(WEB_APP_URL, {
        method: "POST",
        mode: "no-cors",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    })
    .then(() => {
        alert("Your quiz was submitted successfully!");
    })
    .catch(err => {
        console.error("Submit error:", err);
        alert("Something went wrong submitting your quiz.");
    });
}
