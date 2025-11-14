function submitQuiz(data){
  fetch("https://script.google.com/macros/s/AKfycbzIOW_m-xvpQ-HfKSULtsk7LsQWpLoKeG8eiEgdFsI/dev", {
    method: "POST",
    body: JSON.stringify(data)
  })
  .then(response => response.json())
  .then(result => console.log("Saved!", result))
  .catch(error => console.error("Error:", error));
}
