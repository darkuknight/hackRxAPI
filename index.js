const express = require("express");
const app = express();
const port = 8000;
require("dotenv").config();

app.set("view engine", "ejs");

app.use(express.json());

const Api = require("./Api.js");
app.post("/", Api.handle);

const home = require("./home.js");
app.get("/", home.render);

app.listen(port, () => {
    console.log(`app running on port:${port}`);
});
