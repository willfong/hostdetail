const express = require('express');
const morgan = require('morgan');

const app = express();
const port = process.env.PORT || 3000;

app.use(morgan('combined'));

app.get("/", (req, res) => {
    res.send("Hello");
});

// Handle 404
app.use(function(req, res) {
    res.send('404: Page not Found', 404);
});
  
// Handle 500
app.use(function(error, req, res, next) {
    res.send('500: Internal Server Error', 500);
});

app.listen(port, () => {
    console.log(`Service started on port: ${port}`);
})
