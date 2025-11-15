// ================================
// CHANGE THIS TO YOUR WEB APP URL
// ================================
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbz0f6FskZzVIhsB7TPUWgFCZkwR43pVsK4-tLmoj08Q9hb7rmH0RVMOWUOcKb_eEZzO/exec";


// Submit quiz data to Google Sheet
function submitQuiz() {
    const name = document.getElementById("studentName").value.trim();
    if (!name) {
        alert("Please enter your name before submitting.");
        return;
    }

    // Check if quizData exists
    if (typeof quizData === "undefined") {
        alert("quizData is missing!");
        return;
    }

    let answersArray = [];
    let totalScore = 0;

    // Loop through each question
    quizData.forEach((q, i) => {
        const userAnswer = document.getElementById(`q${i}`).value.trim() || "(no answer)";
        const isCorrect = userAnswer === q.exactAnswer ? "YES" : "NO";

        if (isCorrect === "YES") totalScore++;

        answersArray.push({
            question: q.question,        // Question text
            userAnswer: userAnswer,      // What student entered
            correctAnswer: q.exactAnswer, // Correct answer
            isCorrect: isCorrect
        });
    });

    // Prepare payload to send
    const payload = {
        name: name,
        totalScore: totalScore,
        answers: answersArray,
        timestamp: new Date().toISOString()
    };

    // DEBUG: Uncomment to check payload before sending
    // console.log(payload);

    // Send data to Google Sheets
    fetch(WEB_APP_URL, {
        method: "POST",
        mode: "no-cors",   // allows sending to sheet without CORS issues
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    })
    .then(() => {
        alert("Your quiz was submitted successfully!");
    })
    .catch(err => {
        console.error("Error submitting quiz:", err);
        alert("Something went wrong while submitting your quiz.");
    });
}
