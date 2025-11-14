function submitQuiz(data){
  fetch("https://script.google.com/macros/s/AKfycbwheBMBalFc4FnR52hg2JhmwOURgj186kyobMCz7A2S-jF_u7prH5mgYBwQNb31hRs_/exec", {
    method: "POST",
    body: JSON.stringify(data)
  })
  .then(response => response.json())
  .then(result => console.log("Saved!", result))
  .catch(error => console.error("Error:", error));
}
