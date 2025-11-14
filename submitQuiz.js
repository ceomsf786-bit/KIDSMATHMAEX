function submitQuiz(data){
  fetch("https://script.google.com/macros/s/AKfycbz9oGOePvA0i8uwOV30KUG6uqy_es0zWhVOnz6_ltmkVnFKvNJPfXANV-2mBCTr7nrr/exec", {
    method: "POST",
    body: JSON.stringify(data)
  })
  .then(response => response.json())
  .then(result => console.log("Saved!", result))
  .catch(error => console.error("Error:", error));
}
