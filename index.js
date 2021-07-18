const express = require('express');
const morgan = require('morgan');

const app = express();
const port = process.env.PORT || 3000;

app.use(morgan('combined'));

app.get("/", (req, res) => {
    res.send("Hello");
});

app.use(function(req, res) {
    res.status(404).send("404: Page not Found");
});
  
app.use(function(error, req, res, next) {
    res.status(500).send("500: Internal Server Error");
});

app.listen(port, () => {
    console.log(`Service started on port: ${port}`);
})
